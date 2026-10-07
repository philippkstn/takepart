import { randomBytes, randomInt } from 'node:crypto';
import {
  assetUrl,
  buildSteps,
  hostCommand,
  initialRunState,
  isPostType,
  quizState,
  sentenceStart,
  sentenceState,
  slideHeadline,
  SLIDE_TYPE_LABELS,
  type HandoutData,
  type HandoutSlide,
  type HostCommand,
  type PublicSlide,
  type SlideConfigs,
  type RunState,
} from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireHost } from './auth.ts';
import { BRAND_COLUMNS, brandView, type BrandRow } from './brands.ts';
import { exec, isDuplicateKey, json, one, query, transaction, type Db } from './db.ts';
import { exportCsv } from './export.ts';
import type { LiveHub } from './live.ts';
import { computeResults, effectiveQuiz, loadSlides, sentenceText } from './snapshot.ts';

/** Befehle pro Durchführung nacheinander ausführen (ein Prozess, kein DB-Lock nötig). */
const locks = new Map<number, Promise<unknown>>();
export function withRunLock<T>(runId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(runId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => undefined);
  locks.set(runId, settled);
  void settled.then(() => {
    if (locks.get(runId) === settled) locks.delete(runId);
  });
  return next;
}

export class CommandError extends Error {}

export async function loadRunState(db: Db, runId: number): Promise<{ state: RunState; presentationId: number; ended: boolean } | null> {
  const row = await one<{ state: string; presentation_id: number; ended_at: Date | null }>(
    db,
    'SELECT state, presentation_id, ended_at FROM runs WHERE id = ?',
    [runId],
  );
  return row ? { state: json<RunState>(row.state), presentationId: row.presentation_id, ended: row.ended_at !== null } : null;
}

async function saveRunState(db: Db, runId: number, state: RunState) {
  await exec(db, 'UPDATE runs SET state = ? WHERE id = ?', [JSON.stringify(state), runId]);
}

/** Wendet einen Steuerbefehl auf den Zustand an. Reine Zustandsänderungen; Löschungen laufen separat. */
/**
 * Wendet einen Steuerbefehl auf den Zustand an. `buildSteps` kennt je Folie die
 * Anzahl der Aufbau-Klicks (importierte Animationen).
 */
export function applyCommand(
  state: RunState,
  cmd: HostCommand,
  slideIds: number[],
  now = Date.now(),
  buildSteps: Map<number, number> = new Map(),
): RunState {
  const s: RunState = structuredClone(state);
  const setBuild = (slideId: number, value: number) => {
    s.build = { ...s.build, [slideId]: value };
  };
  const enter = (slideId: number, build: number) => {
    if (s.slideId !== slideId) {
      s.slideId = slideId;
      s.spotlight = null;
      s.leaderboard = false;
    }
    setBuild(slideId, build);
  };
  const assertSlide = (id: number) => {
    if (!slideIds.includes(id)) throw new CommandError('Folie gehört nicht zu dieser Präsentation');
  };
  switch (cmd.action) {
    case 'goto':
      assertSlide(cmd.slideId);
      enter(cmd.slideId, 0);
      s.blank = null;
      break;
    case 'step': {
      // Wie in PowerPoint: erst die Animationen der Folie, dann die nächste Folie.
      // Zurück: erst Animationen zurücknehmen, dann die vorige Folie im Endzustand.
      s.blank = null;
      const current = s.slideId;
      const build = current === null ? 0 : (s.build?.[current] ?? 0);
      const steps = current === null ? 0 : (buildSteps.get(current) ?? 0);
      if (current !== null && cmd.delta === 1 && build < steps) {
        setBuild(current, build + 1);
        break;
      }
      if (current !== null && cmd.delta === -1 && build > 0) {
        setBuild(current, build - 1);
        break;
      }
      const index = current === null ? -1 : slideIds.indexOf(current);
      const next = slideIds[Math.min(slideIds.length - 1, Math.max(0, index + cmd.delta))];
      if (next !== undefined && next !== current) enter(next, cmd.delta === -1 ? (buildSteps.get(next) ?? 0) : 0);
      break;
    }
    case 'jump': {
      const target = cmd.index === -1 ? slideIds.at(-1) : slideIds[Math.min(cmd.index, slideIds.length - 1)];
      if (target !== undefined) enter(target, 0);
      s.blank = null;
      break;
    }
    case 'blank':
      s.blank = cmd.mode;
      break;
    case 'results':
      s.resultsVisible = cmd.visible;
      break;
    case 'lock':
      assertSlide(cmd.slideId);
      s.locked = cmd.locked ? [...new Set([...s.locked, cmd.slideId])] : s.locked.filter((id) => id !== cmd.slideId);
      break;
    case 'spotlight':
      s.spotlight = cmd.postId;
      break;
    case 'join':
      s.showJoin = cmd.visible;
      break;
    case 'leaderboard':
      s.leaderboard = cmd.visible;
      break;
    case 'quiz-start': {
      assertSlide(cmd.slideId);
      const q = quizState(s, cmd.slideId);
      if (q.phase !== 'ready') throw new CommandError('Diese Frage läuft bereits');
      s.quiz[cmd.slideId] = { ...q, phase: 'open', openedAt: now, closesAt: null };
      break;
    }
    case 'quiz-close': {
      assertSlide(cmd.slideId);
      const q = quizState(s, cmd.slideId);
      s.quiz[cmd.slideId] = { ...q, phase: 'closed', closesAt: Math.min(q.closesAt ?? now, now) };
      break;
    }
    case 'quiz-reveal': {
      assertSlide(cmd.slideId);
      const q = quizState(s, cmd.slideId);
      s.quiz[cmd.slideId] = { ...q, phase: 'closed', closesAt: Math.min(q.closesAt ?? now, now), revealed: true };
      s.resultsVisible = true;
      break;
    }
    case 'quiz-reset':
      assertSlide(cmd.slideId);
      delete s.quiz[cmd.slideId];
      break;
    case 'sentence-reveal': {
      assertSlide(cmd.slideId);
      s.sentence[cmd.slideId] = { ...sentenceState(s, cmd.slideId), revealed: cmd.revealed };
      break;
    }
    case 'sentence-append': {
      assertSlide(cmd.slideId);
      const st = sentenceState(s, cmd.slideId);
      s.sentence[cmd.slideId] = { ...st, words: [...st.words, cmd.word], round: st.round + 1, revealed: false };
      break;
    }
    case 'sentence-undo': {
      assertSlide(cmd.slideId);
      const st = sentenceState(s, cmd.slideId);
      if (st.words.length === 0) throw new CommandError('Es wurde noch kein Wort angehängt');
      s.sentence[cmd.slideId] = { ...st, words: st.words.slice(0, -1), round: st.round + 1, revealed: false, done: false };
      break;
    }
    case 'sentence-done': {
      assertSlide(cmd.slideId);
      s.sentence[cmd.slideId] = { ...sentenceState(s, cmd.slideId), done: cmd.done, revealed: false };
      break;
    }
    case 'sentence-reset': {
      assertSlide(cmd.slideId);
      const st = sentenceState(s, cmd.slideId);
      s.sentence[cmd.slideId] = { ...st, words: [], round: st.round + 1, revealed: false, done: false };
      break;
    }
    case 'timer-reset':
      s.timerStartedAt = now;
      break;
    case 'post-status':
    case 'clear-responses':
      break;
  }
  return s;
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function runRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  const host = { preHandler: requireHost(db) };
  const idParam = z.object({ id: z.coerce.number().int() });

  app.post('/api/presentations/:id/runs', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const pres = await one<{ id: number }>(db, 'SELECT id FROM presentations WHERE id = ?', [id]);
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    const live_ = await one<{ id: number }>(db, 'SELECT id FROM runs WHERE presentation_id = ? AND ended_at IS NULL', [id]);
    if (live_) return { id: live_.id };
    const slides = await loadSlides(db, id);
    const state = initialRunState(slides[0]?.id ?? null);
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const result = await exec(db, 'INSERT INTO runs (presentation_id, code, display_token, state) VALUES (?, ?, ?, ?)', [
          id,
          newCode(),
          randomBytes(24).toString('base64url'),
          JSON.stringify(state),
        ]);
        return { id: result.insertId };
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
    throw new Error('Kein freier Code gefunden');
  });

  app.get('/api/presentations/:id/runs', host, async (request) => {
    const { id } = idParam.parse(request.params);
    const rows = await query<{ id: number; code: string | null; started_at: Date; ended_at: Date | null; participants: number }>(
      db,
      `SELECT r.id, r.code, r.started_at, r.ended_at,
              (SELECT COUNT(*) FROM participants p WHERE p.run_id = r.id) AS participants
         FROM runs r WHERE r.presentation_id = ? ORDER BY r.started_at DESC`,
      [id],
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      participants: Number(r.participants),
    }));
  });

  app.post('/api/runs/:id/command', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const parsed = hostCommand.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültiger Befehl' });
    const cmd = parsed.data;
    try {
      await withRunLock(id, async () => {
        const run = await loadRunState(db, id);
        if (!run) throw new CommandError('Durchführung nicht gefunden');
        if (run.ended) throw new CommandError('Diese Durchführung ist beendet');
        const slides = await loadSlides(db, run.presentationId);

        if (cmd.action === 'post-status') {
          const result = await exec(db, 'UPDATE posts SET status = ? WHERE id = ? AND run_id = ?', [cmd.status, cmd.postId, id]);
          if (result.affectedRows === 0) throw new CommandError('Beitrag nicht gefunden');
          // Beantwortet, ausgeblendet oder zurückgestellt: nicht mehr groß auf dem Beamer
          if (cmd.status !== 'visible' && run.state.spotlight === cmd.postId) {
            await saveRunState(db, id, { ...run.state, spotlight: null });
          }
          return;
        }
        if (cmd.action === 'clear-responses') {
          if (!slides.some((s) => s.id === cmd.slideId)) throw new CommandError('Folie nicht gefunden');
          await transaction(db, async (conn) => {
            await exec(conn, 'DELETE FROM responses WHERE run_id = ? AND slide_id = ?', [id, cmd.slideId]);
            await exec(conn, 'DELETE FROM posts WHERE run_id = ? AND slide_id = ?', [id, cmd.slideId]);
          });
          const state = structuredClone(run.state);
          delete state.quiz[cmd.slideId];
          delete state.sentence[cmd.slideId];
          await saveRunState(db, id, state);
          return;
        }
        if (cmd.action === 'quiz-start') {
          const slide = slides.find((s) => s.id === cmd.slideId);
          if (slide?.type !== 'quiz') throw new CommandError('Keine Quizfrage');
          const next = applyCommand(
            run.state,
            cmd,
            slides.map((s) => s.id),
          );
          const q = next.quiz[cmd.slideId]!;
          q.closesAt = q.openedAt! + slide.config.timeLimit * 1000;
          await saveRunState(db, id, next);
          return;
        }
        if (cmd.action === 'spotlight' && cmd.postId !== null) {
          const post = await one<{ id: number }>(db, "SELECT id FROM posts WHERE id = ? AND run_id = ? AND status = 'visible'", [
            cmd.postId,
            id,
          ]);
          if (!post) throw new CommandError('Nur freigegebene, offene Beiträge können eingeblendet werden');
        }
        await saveRunState(
          db,
          id,
          applyCommand(
            run.state,
            cmd,
            slides.map((s) => s.id),
            Date.now(),
            new Map(slides.map((s) => [s.id, buildSteps(s)])),
          ),
        );
      });
    } catch (err) {
      if (err instanceof CommandError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    live.notify(id, true);
    return { ok: true };
  });

  app.post('/api/runs/:id/end', host, async (request) => {
    const { id } = idParam.parse(request.params);
    await exec(db, 'UPDATE runs SET ended_at = UTC_TIMESTAMP(3), code = NULL WHERE id = ? AND ended_at IS NULL', [id]);
    const run = await one<{ handout_token: string | null }>(db, 'SELECT handout_token FROM runs WHERE id = ?', [id]);
    live.end(id, run?.handout_token ? `/h/${run.handout_token}` : null);
    return { ok: true };
  });

  /** Folien und Ergebnisse für Teilnehmende freigeben (eigener, zufälliger Link) oder zurückziehen. */
  app.post('/api/runs/:id/handout', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    const token = enabled ? randomBytes(24).toString('base64url') : null;
    const result = await exec(
      db,
      enabled
        ? 'UPDATE runs SET handout_token = COALESCE(handout_token, ?) WHERE id = ?'
        : 'UPDATE runs SET handout_token = ? WHERE id = ?',
      [token, id],
    );
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Durchführung nicht gefunden' });
    live.notify(id, true);
    const run = await one<{ handout_token: string | null }>(db, 'SELECT handout_token FROM runs WHERE id = ?', [id]);
    return { handoutUrl: run?.handout_token ? `/h/${run.handout_token}` : null };
  });

  app.post('/api/runs/:id/display-token', host, async (request) => {
    const { id } = idParam.parse(request.params);
    await exec(db, 'UPDATE runs SET display_token = ? WHERE id = ?', [randomBytes(24).toString('base64url'), id]);
    live.dropDisplays(id);
    live.notify(id, true);
    return { ok: true };
  });

  app.delete('/api/runs/:id', host, async (request) => {
    const { id } = idParam.parse(request.params);
    live.end(id);
    await exec(db, 'DELETE FROM runs WHERE id = ?', [id]);
    return { ok: true };
  });

  /** Vollständige Ergebnisse aller Folien – für das Archiv nach dem Vortrag. */
  app.get('/api/runs/:id/results', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const data = await runResults(db, id);
    if (!data) return reply.code(404).send({ error: 'Durchführung nicht gefunden' });
    return data;
  });

  app.get('/api/runs/:id/export.csv', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const csv = await exportCsv(db, id);
    if (csv === null) return reply.code(404).send({ error: 'Durchführung nicht gefunden' });
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="ergebnisse-${id}.csv"`);
    return csv;
  });
}

export async function runResults(db: Db, runId: number) {
  const run = await one<{ id: number; presentation_id: number; title: string; state: string; started_at: Date; ended_at: Date | null }>(
    db,
    `SELECT r.id, r.presentation_id, p.title, r.state, r.started_at, r.ended_at
       FROM runs r JOIN presentations p ON p.id = r.presentation_id WHERE r.id = ?`,
    [runId],
  );
  if (!run) return null;
  const state = json<RunState>(run.state);
  const slides = await loadSlides(db, run.presentation_id);
  const responses = await query<{ slide_id: number; payload: string; round: number }>(
    db,
    'SELECT slide_id, payload, round FROM responses WHERE run_id = ?',
    [runId],
  );
  const posts = await query<{
    id: number;
    slide_id: number;
    author_name: string | null;
    text: string;
    column_index: number | null;
    status: string;
    votes: number;
  }>(
    db,
    'SELECT id, slide_id, author_name, text, column_index, status, votes FROM posts WHERE run_id = ? ORDER BY votes DESC, created_at',
    [runId],
  );
  const participants = (await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM participants WHERE run_id = ?', [runId]))?.n ?? 0;

  return {
    id: run.id,
    presentationId: run.presentation_id,
    title: run.title,
    startedAt: run.started_at,
    endedAt: run.ended_at,
    participants: Number(participants),
    slides: slides.map((slide) => {
      const own = responses.filter((r) => r.slide_id === slide.id);
      // Satz-Spiel: Ergebnis ist der gebaute Satz, nicht die letzte Runde.
      const relevant = slide.type === 'sentence' ? own.filter((r) => r.round === sentenceState(state, slide.id).round) : own;
      return {
        id: slide.id,
        type: slide.type,
        typeLabel: SLIDE_TYPE_LABELS[slide.type],
        headline: slideHeadline(slide),
        config: slide.config,
        results: computeResults(
          slide,
          relevant.map((r) => json(r.payload)),
        ),
        responses: isPostType(slide.type) ? posts.filter((p) => p.slide_id === slide.id).length : own.length,
        posts: posts
          .filter((p) => p.slide_id === slide.id)
          .map((p) => ({ id: p.id, authorName: p.author_name, text: p.text, column: p.column_index, status: p.status, votes: p.votes })),
        sentence: slide.type === 'sentence' ? sentenceText(slide, state) : null,
        quiz: slide.type === 'quiz' ? effectiveQuiz(state, slide.id, Date.now()) : null,
      };
    }),
  };
}

/**
 * Öffentliche Freigabe einer Durchführung: Folien und zusammengefasste Ergebnisse.
 * Bewusst ohne Freitexte, Namen, Fragen, Kommentare und Rangliste – was einzelne
 * Personen geschrieben haben, gehört nicht in einen weitergegebenen Link.
 */
export async function handoutData(db: Db, token: string) {
  const run = await one<{ id: number }>(db, 'SELECT id FROM runs WHERE handout_token = ?', [token]);
  if (!run) return null;
  const data = await runResults(db, run.id);
  if (!data) return null;
  const brandRow = await one<BrandRow>(
    db,
    `SELECT ${BRAND_COLUMNS} FROM runs r JOIN presentations p ON p.id = r.presentation_id LEFT JOIN brands b ON b.id = p.brand_id WHERE r.id = ?`,
    [run.id],
  );
  const slides: HandoutSlide[] = data.slides.flatMap((s, position): HandoutSlide[] => {
    if (s.type === 'image') {
      const c = s.config as SlideConfigs['image'];
      return [{ type: 'image', title: c.title, image: assetUrl(c.asset), width: c.width, height: c.height }];
    }
    if (s.type === 'content') {
      const c = s.config as SlideConfigs['content'];
      return [{ type: 'content', title: c.title, body: c.body }];
    }
    if (s.type === 'sentence') {
      // Nur Sätze, an die wirklich Wörter angehängt wurden
      const start = sentenceStart((s.config as SlideConfigs['sentence']).start);
      return s.sentence && s.sentence !== start ? [{ type: 'sentence', headline: s.headline, sentence: s.sentence }] : [];
    }
    if (!s.results || s.results.voters === 0) return [];
    if (!['choice', 'scale', 'wordcloud', 'ranking', 'quiz', 'feedback'].includes(s.type)) return []; // Inhalte einzelner Personen
    const results = s.results.type === 'feedback' ? { ...s.results, comments: [] } : s.results;
    return [{ type: 'results', slide: { id: s.id, type: s.type, position, config: s.config } as PublicSlide, results }];
  });
  const result: HandoutData = {
    title: data.title,
    date: data.startedAt.toISOString(),
    brand: brandRow ? brandView(brandRow) : null,
    slides,
  };
  return result;
}
