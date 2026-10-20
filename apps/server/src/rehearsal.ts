import { randomBytes } from 'node:crypto';
import {
  fakeInput,
  fakeName,
  fakePostText,
  fakeResponse,
  isPostType,
  isResponseType,
  MAX_FAKE_PARTICIPANTS,
  quizPoints,
  sentenceState,
  validateResponse,
  type QuizAnswer,
  type RunState,
  type Slide,
} from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOwner } from './access.ts';
import { loadBoard, targetsOf } from './board.ts';
import { exec, json, one, query, type Db } from './db.ts';
import { CommandError } from './errors.ts';
import type { LiveHub } from './live.ts';
import { withRunLock } from './runs.ts';
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

/** Zufallsantworten aller Testteilnehmenden auf die aktuelle Folie. Gibt die Anzahl und ggf. einen Hinweis zurück. */
export async function fakeAnswers(
  db: Db,
  runId: number,
  state: RunState,
  slides: Slide[],
  fakes: Fake[],
  random: () => number = Math.random,
): Promise<{ answered: number; note: string | null }> {
  const slide = slides.find((s) => s.id === state.slideId);
  if (!slide) return { answered: 0, note: 'Keine Folie ausgewählt' };
  if (fakes.length === 0) return { answered: 0, note: 'Noch keine Testteilnehmenden' };
  let answered = 0;
  // Kartenwand: beim Sammeln entstehen Karten (Posts), sonst Punkte/Bewertungen (Antworten)
  const collecting = slide.type === 'board' && slide.config.mode === 'collect';

  if (isResponseType(slide.type) && !collecting) {
    let targets: string[] = [];
    let round = 1;
    const now = Date.now();
    if (slide.type === 'board') {
      if (slide.config.mode !== 'dots' && slide.config.mode !== 'rate')
        return { answered: 0, note: 'Auf dieser Folie ordnet die Moderation – hier gibt es nichts zu beantworten' };
      targets = targetsOf(slide.config, await loadBoard(db, runId, slides, slide));
      if (targets.length === 0) return { answered: 0, note: 'Auf der Wand liegen noch keine Einträge' };
    }
    if (slide.type === 'quiz' && effectiveQuiz(state, slide.id, now).phase !== 'open')
      return { answered: 0, note: 'Erst die Frage starten – Antworten zählen nur, solange sie läuft' };
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
    for (const p of fakes) {
      if (done.has(p.id)) continue;
      const raw = fakeResponse(slide.type, slide.config as never, random, targets);
      if (raw === null) continue;
      const result = validateResponse(slide.type, slide.config as never, raw);
      if (!result.ok) continue;
      let payload: unknown = result.value;
      if (slide.type === 'quiz') {
        const q = effectiveQuiz(state, slide.id, now);
        const choice = (result.value as { choice: number }).choice;
        const correct = slide.config.correct.includes(choice);
        const elapsed = Math.max(500, now - (q.openedAt ?? now));
        const ms = Math.round(500 + random() * (elapsed - 500));
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
    const own = new Map(
      (
        await query<{ participant_id: number; n: number }>(
          db,
          'SELECT participant_id, COUNT(*) AS n FROM posts WHERE run_id = ? AND slide_id = ? AND participant_id IS NOT NULL GROUP BY participant_id',
          [runId, slide.id],
        )
      ).map((r) => [r.participant_id, Number(r.n)]),
    );
    for (const p of fakes) {
      if ((own.get(p.id) ?? 0) > 0) continue;
      let count = 1;
      let tags = 0;
      let columns = 0;
      if (slide.type === 'board') {
        count = 1 + Math.floor(random() * Math.min(3, slide.config.maxCards));
        tags = slide.config.tags.length;
      }
      if (slide.type === 'pinboard') columns = slide.config.columns.length;
      const used = new Set<string>();
      for (let i = 0; i < count; i++) {
        let text = fakePostText(slide.type, random);
        for (let tries = 0; used.has(text) && tries < 5; tries++) text = fakePostText(slide.type, random);
        if (used.has(text)) continue;
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

export function rehearsalRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  const ownRun = requireOwner(db, 'run');
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
        const existing = await query<Fake>(db, 'SELECT id, name FROM participants WHERE run_id = ? AND fake = 1 ORDER BY id', [id]);
        const add = Math.min(body.data.add, MAX_FAKE_PARTICIPANTS - existing.length);
        if (body.data.add > 0 && add <= 0) throw new CommandError(`Höchstens ${MAX_FAKE_PARTICIPANTS} Testteilnehmende`);
        // Fortlaufend nummerieren, auch wenn schon welche angelegt wurden
        let next = existing.reduce((max, p) => Math.max(max, Number(/^Test (\d+)$/.exec(p.name)?.[1] ?? 0)), 0) + 1;
        const fakes = [...existing];
        for (let i = 0; i < add; i++, next++) {
          const name = fakeName(next);
          const res = await exec(db, 'INSERT INTO participants (run_id, token, name, fake) VALUES (?, ?, ?, 1)', [
            id,
            randomBytes(24).toString('base64url'),
            name,
          ]);
          fakes.push({ id: res.insertId, name });
        }
        let answered = 0;
        let note: string | null = null;
        if (body.data.answer) {
          const slides = await loadSlides(db, run.presentation_id);
          ({ answered, note } = await fakeAnswers(db, id, json<RunState>(run.state), slides, fakes));
        }
        return { added: Math.max(0, add), total: fakes.length, answered, note };
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
        return (await exec(db, 'DELETE FROM participants WHERE run_id = ? AND fake = 1', [id])).affectedRows;
      });
      live.notify(id, true);
      return { removed };
    } catch (err) {
      if (err instanceof CommandError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });
}
