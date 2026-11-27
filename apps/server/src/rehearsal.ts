import { randomBytes } from 'node:crypto';
import {
  fakeInput,
  fakeName,
  fakePostText,
  fakeResponse,
  hash32,
  isAnytimeSlide,
  isPostType,
  isResponseType,
  MAX_FAKE_PARTICIPANTS,
  quizPoints,
  sentenceState,
  simAudienceSize,
  simCardsDue,
  simDelay,
  slideHeadline,
  validateResponse,
  type QuizAnswer,
  type RunState,
  type SimKind,
  type Slide,
} from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAccess } from './access.ts';
import { loadBoard, targetsOf } from './board.ts';
import { exec, json, one, query, type Db } from './db.ts';
import { CommandError } from './errors.ts';
import type { LiveHub } from './live.ts';
import { loadRunState, saveRunState, withRunLock } from './runs.ts';
import { effectiveQuiz, loadSlides } from './snapshot.ts';

/**
 * Probelauf: Testteilnehmende anlegen und die aktuelle Folie mit Zufallsantworten
 * füllen. Nur in Durchführungen mit `runs.rehearsal = 1`. Testteilnehmende sind
 * normale Zeilen in `participants` (mit `fake = 1`) – so laufen Gruppen, Wand,
 * Punkte und Ergebnisse durch denselben Code wie im echten Vortrag.
 */

interface Fake {
  id: number;
  name: string;
}

/** Simulation: Folie bzw. Runde begann bei `at`; nur wer laut Zeitplan bis `now` dran ist, antwortet */
interface SimClock {
  at: number;
  now: number;
}

/**
 * Antworten bzw. Karten der Testteilnehmenden auf die aktuelle Folie. Ohne `sim` antworten
 * alle sofort (Knopf „Zufallsantworten“), mit `sim` nur, wer laut Zeitplan schon dran ist –
 * das ist idempotent: wer schon geantwortet hat bzw. genug Karten hat, kommt nicht noch einmal.
 */
export async function fakeAnswers(
  db: Db,
  runId: number,
  state: RunState,
  slides: Slide[],
  fakes: Fake[],
  { random = Math.random, sim }: { random?: () => number; sim?: SimClock } = {},
): Promise<{ answered: number; note: string | null }> {
  const slide = slides.find((s) => s.id === state.slideId);
  if (!slide) return { answered: 0, note: 'Keine Folie ausgewählt' };
  if (fakes.length === 0) return { answered: 0, note: 'Noch keine Testteilnehmenden' };
  if (state.locked.includes(slide.id)) return { answered: 0, note: 'Die Folie ist geschlossen' };
  const now = sim?.now ?? Date.now();
  const context = { seed: hash32(runId, slide.id), prompt: slideHeadline(slide) };
  let answered = 0;
  // Kartenwand: beim Sammeln entstehen Karten (Posts), sonst Punkte/Bewertungen (Antworten)
  const collecting = slide.type === 'board' && slide.config.mode === 'collect';

  if (isResponseType(slide.type) && !collecting) {
    let targets: string[] = [];
    let round = 1;
    let anchor = sim?.at ?? now;
    if (slide.type === 'board') {
      if (slide.config.mode !== 'dots' && slide.config.mode !== 'rate' && slide.config.mode !== 'choose')
        return { answered: 0, note: 'Auf dieser Folie ordnet die Moderation – hier gibt es nichts zu beantworten' };
      targets = targetsOf(slide.config, await loadBoard(db, runId, slides, slide));
      if (targets.length === 0) return { answered: 0, note: 'Auf der Wand liegen noch keine Einträge' };
    }
    if (slide.type === 'quiz') {
      const q = effectiveQuiz(state, slide.id, now);
      if (q.phase !== 'open') return { answered: 0, note: 'Erst die Frage starten – Antworten zählen nur, solange sie läuft' };
      anchor = q.openedAt ?? anchor;
    }
    if (slide.type === 'sentence') {
      const s = sentenceState(state, slide.id);
      if (s.done || s.revealed) return { answered: 0, note: 'Die Runde ist geschlossen' };
      round = s.round;
    }
    const done = new Set(
      (
        await query<{ participant_id: number }>(
          db,
          'SELECT participant_id FROM responses WHERE run_id = ? AND slide_id = ? AND round = ?',
          [runId, slide.id, round],
        )
      ).map((r) => r.participant_id),
    );
    const timeLimit = slide.type === 'quiz' ? slide.config.timeLimit : 30;
    for (const p of fakes) {
      if (done.has(p.id)) continue;
      if (sim) {
        const delay = simDelay(
          slide.type === 'quiz' ? 'quiz' : 'vote',
          { run: runId, slide: slide.id, round, participant: p.id },
          timeLimit,
        );
        if (delay === null || now - anchor < delay) continue;
      }
      const raw = fakeResponse(slide.type, slide.config as never, random, targets, context);
      if (raw === null) continue;
      const result = validateResponse(slide.type, slide.config as never, raw);
      if (!result.ok) continue;
      let payload: unknown = result.value;
      if (slide.type === 'quiz') {
        const choice = (result.value as { choice: number }).choice;
        const correct = slide.config.correct.includes(choice);
        const elapsed = Math.max(500, now - anchor);
        // Simuliert: die echte Zeit seit dem Start; sofort: irgendwann bis jetzt
        const ms = sim ? elapsed : Math.round(500 + random() * (elapsed - 500));
        payload = { choice, correct, ms, points: quizPoints(correct, ms, slide.config.timeLimit) } satisfies QuizAnswer;
      }
      await exec(db, 'INSERT IGNORE INTO responses (run_id, slide_id, participant_id, round, payload) VALUES (?, ?, ?, ?, ?)', [
        runId,
        slide.id,
        p.id,
        round,
        JSON.stringify(payload),
      ]);
      answered++;
    }
    return { answered, note: null };
  }

  if (isPostType(slide.type)) {
    const rows = await query<{ participant_id: number | null; text: string }>(
      db,
      'SELECT participant_id, text FROM posts WHERE run_id = ? AND slide_id = ?',
      [runId, slide.id],
    );
    const own = new Map<number, number>();
    for (const r of rows) if (r.participant_id !== null) own.set(r.participant_id, (own.get(r.participant_id) ?? 0) + 1);
    // Möglichst keine wörtlich gleichen Karten
    const used = new Set(rows.map((r) => r.text));
    const kind: SimKind = slide.type === 'qa' ? 'question' : isAnytimeSlide(slide) ? 'parking' : 'text';
    const max =
      slide.type === 'board' ? Math.min(3, slide.config.maxCards) : slide.type === 'brainstorm' || slide.type === 'pinboard' ? 2 : 1;
    const tags = slide.type === 'board' ? slide.config.tags.length : 0;
    const columns = slide.type === 'pinboard' ? slide.config.columns.length : 0;
    for (const p of fakes) {
      const key = { run: runId, slide: slide.id, round: 1, participant: p.id };
      // Sofort: alle Karten, die die Person insgesamt schreiben würde
      const due = simCardsDue(kind, key, sim ? sim.now - sim.at : Number.POSITIVE_INFINITY, max);
      const need = due - (own.get(p.id) ?? 0);
      if (need <= 0) continue;
      for (let i = 0; i < need; i++) {
        let text = fakePostText(slide.type, random, context.prompt);
        for (let tries = 0; used.has(text) && tries < 8; tries++) text = fakePostText(slide.type, random, context.prompt);
        used.add(text);
        if (slide.type === 'open') text = text.slice(0, slide.config.maxLength);
        const column = columns > 0 ? Math.floor(random() * columns) : tags > 0 ? Math.floor(random() * tags) : null;
        const status = slide.type === 'qa' && slide.config.moderated ? 'pending' : 'visible';
        await exec(
          db,
          'INSERT INTO posts (run_id, slide_id, participant_id, author_name, text, column_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [runId, slide.id, p.id, slide.type === 'qa' ? p.name : null, text, column, status],
        );
      }
      answered++;
    }
    return { answered, note: null };
  }
  return { answered: 0, note: 'Auf dieser Folie gibt es nichts zu beantworten' };
}

/** Testteilnehmende anlegen – Namen fortlaufend, nie doppelt */
async function addFakes(db: Db, runId: number, existing: Fake[], count: number): Promise<Fake[]> {
  const fakes = [...existing];
  for (let i = 0; i < count; i++) {
    const name = fakeName(fakes.length);
    const res = await exec(db, 'INSERT INTO participants (run_id, token, name, fake) VALUES (?, ?, ?, 1)', [
      runId,
      randomBytes(24).toString('base64url'),
      name,
    ]);
    fakes.push({ id: res.insertId, name });
  }
  return fakes;
}

const loadFakes = (db: Db, runId: number) =>
  query<Fake>(db, 'SELECT id, name FROM participants WHERE run_id = ? AND fake = 1 ORDER BY id', [runId]);

/** Simuliertes Publikum an- oder ausschalten; beim Einschalten ohne Testteilnehmende 30–50 anlegen. Im Run-Lock aufrufen. */
async function setSimulation(db: Db, runId: number, auto: boolean, now = Date.now()) {
  const loaded = await loadRunState(db, runId);
  if (!loaded) return;
  const { state } = loaded;
  if (auto && (await loadFakes(db, runId)).length === 0) await addFakes(db, runId, [], simAudienceSize(runId));
  state.sim = { auto, slideId: state.slideId, round: anchorRound(state), at: now };
  await saveRunState(db, runId, state);
}

/** Probelauf gestartet: gleich mit einem simulierten Publikum */
export const startSimulation = (db: Db, runId: number) => withRunLock(runId, () => setSimulation(db, runId, true));

const anchorRound = (state: RunState) => (state.slideId === null ? 1 : (state.sentence[state.slideId]?.round ?? 1));

/**
 * Ein Takt des simulierten Publikums für alle offenen Probeläufe: neue Folie bzw. Runde
 * merken (`sim.at`), dann antwortet, wer laut Zeitplan dran ist. Alles liegt in der DB –
 * ein Neustart macht einfach weiter, ohne doppelte Antworten.
 */
export async function simulateRehearsals(db: Db, live: LiveHub, now = Date.now()) {
  const runs = await query<{ id: number; state: string }>(db, 'SELECT id, state FROM runs WHERE rehearsal = 1 AND ended_at IS NULL');
  for (const run of runs) {
    // Verlassene Probeläufe nicht ständig weiter befüllen – nur, solange Steuerpult oder Beamer offen sind
    if (!json<RunState>(run.state).sim?.auto || !live.watched(run.id)) continue;
    const answered = await withRunLock(run.id, async () => {
      // Im Lock neu lesen – sonst überschriebe der Takt einen Befehl der Moderation
      const loaded = await loadRunState(db, run.id);
      if (!loaded || loaded.ended || !loaded.state.sim?.auto) return 0;
      const { state } = loaded;
      const sim = state.sim!;
      const round = anchorRound(state);
      if (sim.slideId !== state.slideId || sim.round !== round) {
        state.sim = { ...sim, slideId: state.slideId, round, at: now };
        await saveRunState(db, run.id, state);
        return 0;
      }
      const fakes = await loadFakes(db, run.id);
      if (fakes.length === 0) return 0;
      const slides = await loadSlides(db, loaded.presentationId);
      return (await fakeAnswers(db, run.id, state, slides, fakes, { sim: { at: sim.at, now } })).answered;
    });
    if (answered > 0) live.notify(run.id);
  }
}

export function rehearsalRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  const ownRun = requireAccess(db, 'run', 'host');
  const idParam = z.object({ id: z.coerce.number().int() });

  async function rehearsalRun(id: number) {
    const run = await one<{ presentation_id: number; state: string; ended_at: Date | null; rehearsal: number }>(
      db,
      'SELECT presentation_id, state, ended_at, rehearsal FROM runs WHERE id = ?',
      [id],
    );
    if (!run) throw new CommandError('Durchführung nicht gefunden');
    if (!run.rehearsal) throw new CommandError('Testteilnehmende gibt es nur im Probelauf');
    if (run.ended_at) throw new CommandError('Dieser Probelauf ist beendet');
    return run;
  }

  /** Testteilnehmende hinzufügen und/oder die aktuelle Folie mit Zufallsantworten füllen. */
  app.post('/api/runs/:id/rehearsal/fake', ownRun, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = fakeInput.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    try {
      const result = await withRunLock(id, async () => {
        const run = await rehearsalRun(id);
        const existing = await loadFakes(db, id);
        const add = Math.min(body.data.add, MAX_FAKE_PARTICIPANTS - existing.length);
        if (body.data.add > 0 && add <= 0) throw new CommandError(`Höchstens ${MAX_FAKE_PARTICIPANTS} Testteilnehmende`);
        let fakes = await addFakes(db, id, existing, Math.max(0, add));
        if (body.data.simulate !== undefined) {
          await setSimulation(db, id, body.data.simulate);
          fakes = await loadFakes(db, id);
        }
        let answered = 0;
        let note: string | null = null;
        if (body.data.answer) {
          const slides = await loadSlides(db, run.presentation_id);
          ({ answered, note } = await fakeAnswers(db, id, json<RunState>(run.state), slides, fakes));
        }
        return { added: Math.max(0, fakes.length - existing.length), total: fakes.length, answered, note };
      });
      live.notify(id, true);
      return result;
    } catch (err) {
      if (err instanceof CommandError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  /** Alle Testteilnehmenden samt ihrer Antworten und Karten entfernen. */
  app.delete('/api/runs/:id/rehearsal/fake', ownRun, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    try {
      const removed = await withRunLock(id, async () => {
        await rehearsalRun(id);
        const removed = (await exec(db, 'DELETE FROM participants WHERE run_id = ? AND fake = 1', [id])).affectedRows;
        // Entfernt bleibt entfernt: die Simulation geht mit aus
        await setSimulation(db, id, false);
        return removed;
      });
      live.notify(id, true);
      return { removed };
    } catch (err) {
      if (err instanceof CommandError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });
}
