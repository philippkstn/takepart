import { randomBytes } from 'node:crypto';
import {
  boardOp,
  boardRights,
  cardEditInput,
  PARTICIPANT_BOARD_OPS,
  type ResponsePayloads,
  FINAL_RESPONSE_TYPES,
  isPostType,
  isResponseType,
  participantName,
  postInput,
  quizPoints,
  sentenceState,
  validateResponse,
  type QuizAnswer,
  type RunState,
} from '@slides/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exec, isDuplicateKey, json, one, transaction, type Db } from './db.ts';
import { applyBoardOp, collectSlideIds, loadBoard, targetsOf } from './board.ts';
import { teamForNewCard } from './breakout.ts';
import { CommandError } from './errors.ts';
import type { LiveHub } from './live.ts';
import { withRunLock } from './runs.ts';
import { pauseRoutes } from './pause.ts';
import { effectiveQuiz, loadSlides } from './snapshot.ts';

/**
 * Teilnehmende melden sich nicht an. Beim Beitritt bekommen sie ein zufälliges
 * Token (im Browser gespeichert), das sie für die Dauer der Durchführung
 * wiedererkennt – damit gibt es eine Stimme pro Gerät.
 */

export const PARTICIPANT_HEADER = 'x-participant';
const MAX_POSTS_PER_SLIDE = 20;
/** Schutz vor massenhaft angelegten Teilnehmenden (z. B. per Skript) */
const MAX_PARTICIPANTS_PER_RUN = 5000;
/** Codes durchprobieren bremsen: falsche Codes pro IP und Zeitfenster */
const MAX_FAILED_JOINS = 30;
const FAILED_JOIN_WINDOW_MS = 10 * 60 * 1000;
const failedJoins = new Map<string, { count: number; until: number }>();

function joinBlocked(ip: string): boolean {
  const entry = failedJoins.get(ip);
  if (!entry) return false;
  if (entry.until < Date.now()) {
    failedJoins.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED_JOINS;
}

function recordFailedJoin(ip: string) {
  const now = Date.now();
  if (failedJoins.size > 10_000) for (const [key, e] of failedJoins) if (e.until < now) failedJoins.delete(key);
  const entry = failedJoins.get(ip);
  if (!entry || entry.until < now) failedJoins.set(ip, { count: 1, until: now + FAILED_JOIN_WINDOW_MS });
  else entry.count++;
}
/** Toleranz für Netzlaufzeit beim Quiz-Zeitlimit */
const QUIZ_GRACE_MS = 1500;

export interface Participant {
  id: number;
  runId: number;
  name: string | null;
}

export async function participantByToken(db: Db, token: string | undefined): Promise<Participant | null> {
  if (!token || token.length !== 32) return null;
  const row = await one<{ id: number; run_id: number; name: string | null }>(
    db,
    'SELECT p.id, p.run_id, p.name FROM participants p JOIN runs r ON r.id = p.run_id WHERE p.token = ? AND r.ended_at IS NULL',
    [token],
  );
  return row ? { id: row.id, runId: row.run_id, name: row.name } : null;
}

export function participantRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  async function auth(request: FastifyRequest, reply: FastifyReply): Promise<Participant | null> {
    const header = request.headers[PARTICIPANT_HEADER];
    const p = await participantByToken(db, typeof header === 'string' ? header : undefined);
    if (!p) {
      void reply.code(401).send({ error: 'Bitte erneut beitreten – die Sitzung ist abgelaufen' });
      return null;
    }
    return p;
  }

  async function currentSlide(runId: number, slideId: number) {
    const run = await one<{ state: string; presentation_id: number }>(db, 'SELECT state, presentation_id FROM runs WHERE id = ?', [runId]);
    if (!run) return null;
    const state = json<RunState>(run.state);
    const slides = await loadSlides(db, run.presentation_id);
    const slide = slides.find((s) => s.id === slideId);
    // Parkplatz: Sammel-Folien mit „jederzeit“ nehmen auch Karten an, wenn sie nicht gezeigt werden.
    const anytime = slide?.type === 'board' && slide.config.mode === 'collect' && slide.config.anytime;
    if (state.slideId !== slideId && !anytime) return { error: 'Diese Folie ist nicht mehr aktiv' } as const;
    if (state.locked.includes(slideId)) return { error: 'Die Abstimmung ist geschlossen' } as const;
    if (!slide) return { error: 'Folie nicht gefunden' } as const;
    return { state, slide, slides } as const;
  }

  // Viele Teilnehmende sitzen hinter derselben Firmen-IP: Limits pro Token, nicht pro IP.
  const perParticipant = (max: number) => ({
    config: {
      rateLimit: {
        max,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => String(req.headers[PARTICIPANT_HEADER] ?? req.ip),
      },
    },
  });

  // Beitritt ist der Moment, in dem alle gleichzeitig kommen – oft über dieselbe Firmen-IP.
  app.post('/api/join', { config: { rateLimit: { max: 2000, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z.object({ code: z.string().trim(), token: z.string().optional() }).parse(request.body);
    if (joinBlocked(request.ip))
      return reply.code(429).send({ error: 'Zu viele falsche Codes – bitte in ein paar Minuten erneut versuchen' });
    const code = body.code.replace(/\D/g, '');
    const run = await one<{ id: number }>(db, 'SELECT id FROM runs WHERE code = ? AND ended_at IS NULL', [code]);
    if (!run) {
      recordFailedJoin(request.ip);
      return reply.code(404).send({ error: 'Diesen Code gibt es nicht (mehr)' });
    }

    const existing = await participantByToken(db, body.token);
    if (existing && existing.runId === run.id) return { runId: run.id, token: body.token, name: existing.name };

    const count = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM participants WHERE run_id = ?', [run.id]);
    if (Number(count?.n ?? 0) >= MAX_PARTICIPANTS_PER_RUN) {
      return reply.code(503).send({ error: 'Diese Präsentation ist voll' });
    }
    const token = randomBytes(24).toString('base64url');
    await exec(db, 'INSERT INTO participants (run_id, token) VALUES (?, ?)', [run.id, token]);
    return { runId: run.id, token, name: null };
  });

  pauseRoutes(app, db, live, { auth, rateLimit: perParticipant(30) });

  app.post('/api/p/name', perParticipant(20), async (request, reply) => {
    const p = await auth(request, reply);
    if (!p) return;
    const parsed = z.object({ name: participantName }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültiger Name' });
    await exec(db, 'UPDATE participants SET name = ? WHERE id = ?', [parsed.data.name, p.id]);
    live.notify(p.runId);
    return { name: parsed.data.name };
  });

  app.post('/api/p/respond', perParticipant(60), async (request, reply) => {
    const p = await auth(request, reply);
    if (!p) return;
    const body = z.object({ slideId: z.number().int(), payload: z.unknown() }).parse(request.body);
    const ctx = await currentSlide(p.runId, body.slideId);
    if (!ctx) return reply.code(404).send({ error: 'Nicht gefunden' });
    if ('error' in ctx) return reply.code(409).send({ error: ctx.error });
    const { slide, state } = ctx;
    if (!isResponseType(slide.type)) return reply.code(400).send({ error: 'Auf diese Folie kann man nicht so antworten' });

    const result = validateResponse(slide.type, slide.config as never, body.payload);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    let payload: unknown = result.value;
    let round = 1;

    if (slide.type === 'quiz') {
      const q = effectiveQuiz(state, slide.id, Date.now() - QUIZ_GRACE_MS);
      if (q.phase === 'ready') return reply.code(409).send({ error: 'Die Frage ist noch nicht gestartet' });
      if (q.phase !== 'open') return reply.code(409).send({ error: 'Die Zeit ist abgelaufen' });
      const choice = (result.value as { choice: number }).choice;
      const correct = slide.config.correct.includes(choice);
      const ms = Math.max(0, Date.now() - (q.openedAt ?? Date.now()));
      if (!p.name) return reply.code(409).send({ error: 'Bitte zuerst einen Namen eingeben' });
      payload = { choice, correct, ms, points: quizPoints(correct, ms, slide.config.timeLimit) } satisfies QuizAnswer;
    }
    if (slide.type === 'board') {
      // Nur Einträge, die auf dieser Folie zur Wahl stehen
      const allowed = new Set(targetsOf(slide.config, await loadBoard(db, p.runId, ctx.slides, slide)));
      const value = result.value as ResponsePayloads['board'];
      const keys = Object.keys(value.dots ?? value.ratings ?? value.picks ?? {});
      if (keys.some((k) => !allowed.has(k))) return reply.code(409).send({ error: 'Die Auswahl hat sich geändert – bitte noch einmal' });
    }
    if (slide.type === 'sentence') {
      const s = sentenceState(state, slide.id);
      if (s.done) return reply.code(409).send({ error: 'Der Satz ist fertig' });
      if (s.revealed) return reply.code(409).send({ error: 'Die Runde ist geschlossen – gleich geht es weiter' });
      round = s.round;
    }

    const final = (FINAL_RESPONSE_TYPES as readonly string[]).includes(slide.type);
    try {
      await exec(
        db,
        `INSERT INTO responses (run_id, slide_id, participant_id, round, payload) VALUES (?, ?, ?, ?, ?)` +
          (final ? '' : ' ON DUPLICATE KEY UPDATE payload = VALUES(payload)'),
        [p.runId, slide.id, p.id, round, JSON.stringify(payload)],
      );
    } catch (err) {
      if (isDuplicateKey(err)) return reply.code(409).send({ error: 'Du hast schon geantwortet' });
      throw err;
    }
    live.notify(p.runId);
    return { ok: true };
  });

  app.post('/api/p/posts', perParticipant(30), async (request, reply) => {
    const p = await auth(request, reply);
    if (!p) return;
    const body = z.object({ slideId: z.number().int() }).and(postInput).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    const ctx = await currentSlide(p.runId, body.data.slideId);
    if (!ctx) return reply.code(404).send({ error: 'Nicht gefunden' });
    if ('error' in ctx) return reply.code(409).send({ error: ctx.error });
    const { slide } = ctx;
    if (!isPostType(slide.type)) return reply.code(400).send({ error: 'Auf dieser Folie gibt es keine Beiträge' });

    if (slide.type === 'open' && body.data.text.length > slide.config.maxLength) {
      return reply.code(400).send({ error: `Höchstens ${slide.config.maxLength} Zeichen` });
    }
    let column: number | null = null;
    let team: number | null = null;
    if (slide.type === 'board') {
      // Gruppenweises Sammeln: Karte gehört zur Arbeitsgruppe der Person
      team = teamForNewCard(ctx.slides, slide, ctx.state, p.id);
      if (slide.config.mode !== 'collect') return reply.code(400).send({ error: 'Auf dieser Folie werden keine Karten gesammelt' });
      if (body.data.text.length > 300) return reply.code(400).send({ error: 'Höchstens 300 Zeichen' });
      // Beim Parkplatz zählen die Karten aller Sammel-Folien der Wand zusammen
      const own = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM posts WHERE run_id = ? AND slide_id IN (?) AND participant_id = ?', [
        p.runId,
        collectSlideIds(ctx.slides, slide),
        p.id,
      ]);
      if (Number(own?.n ?? 0) >= slide.config.maxCards) {
        return reply.code(429).send({ error: `Höchstens ${slide.config.maxCards} ${slide.config.maxCards === 1 ? 'Karte' : 'Karten'}` });
      }
      if (slide.config.tags.length > 0) {
        column = body.data.column ?? null;
        if (column !== null && column >= slide.config.tags.length) return reply.code(400).send({ error: 'Unbekannte Kennzeichnung' });
      }
    }
    if (slide.type === 'pinboard') {
      column = body.data.column ?? 0;
      if (column >= slide.config.columns.length) return reply.code(400).send({ error: 'Unbekannte Spalte' });
    }
    if (slide.type === 'qa' && !p.name) return reply.code(409).send({ error: 'Bitte zuerst deinen Namen eingeben' });

    const count = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM posts WHERE run_id = ? AND slide_id = ? AND participant_id = ?', [
      p.runId,
      slide.id,
      p.id,
    ]);
    if ((count?.n ?? 0) >= MAX_POSTS_PER_SLIDE) return reply.code(429).send({ error: 'Du hast hier schon sehr viel beigetragen' });

    const status = slide.type === 'qa' && slide.config.moderated ? 'pending' : 'visible';
    await exec(
      db,
      'INSERT INTO posts (run_id, slide_id, participant_id, author_name, text, column_index, team, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [p.runId, slide.id, p.id, slide.type === 'qa' ? p.name : null, body.data.text, column, team, status],
    );
    live.notify(p.runId);
    return { ok: true, status };
  });

  /** Eigene Karte einer Kartenwand ändern oder löschen – solange gesammelt wird. */
  async function ownCard(request: FastifyRequest, reply: FastifyReply) {
    const p = await auth(request, reply);
    if (!p) return null;
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const post = await one<{ slide_id: number }>(db, 'SELECT slide_id FROM posts WHERE id = ? AND run_id = ? AND participant_id = ?', [
      id,
      p.runId,
      p.id,
    ]);
    if (!post) return (void reply.code(404).send({ error: 'Karte nicht gefunden' }), null);
    const ctx = await currentSlide(p.runId, post.slide_id);
    if (!ctx) return (void reply.code(404).send({ error: 'Nicht gefunden' }), null);
    if ('error' in ctx) return (void reply.code(409).send({ error: ctx.error }), null);
    if (ctx.slide.type !== 'board' || ctx.slide.config.mode !== 'collect') {
      return (void reply.code(400).send({ error: 'Diese Karte lässt sich hier nicht ändern' }), null);
    }
    return { p, id, slide: ctx.slide };
  }

  app.patch('/api/p/posts/:id', perParticipant(60), async (request, reply) => {
    const ctx = await ownCard(request, reply);
    if (!ctx) return;
    const body = cardEditInput.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    const column = body.data.column ?? null;
    if (column !== null && column >= ctx.slide.config.tags.length) return reply.code(400).send({ error: 'Unbekannte Kennzeichnung' });
    await exec(db, 'UPDATE posts SET text = ?, column_index = ? WHERE id = ?', [body.data.text, column, ctx.id]);
    live.notify(ctx.p.runId);
    return { ok: true };
  });

  app.delete('/api/p/posts/:id', perParticipant(60), async (request, reply) => {
    const ctx = await ownCard(request, reply);
    if (!ctx) return;
    await exec(db, 'DELETE FROM posts WHERE id = ?', [ctx.id]);
    live.notify(ctx.p.runId);
    return { ok: true };
  });

  /**
   * Teilnehmende arbeiten an der Wand mit – nur wenn freigegeben: „own“ erlaubt,
   * die eigenen Karten einzuordnen, „all“ das gemeinsame Bearbeiten der ganzen Wand.
   */
  app.post('/api/p/board', perParticipant(120), async (request, reply) => {
    const p = await auth(request, reply);
    if (!p) return;
    const body = z.object({ slideId: z.number().int(), op: boardOp }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    const { op } = body.data;
    const ctx = await currentSlide(p.runId, body.data.slideId);
    if (!ctx) return reply.code(404).send({ error: 'Nicht gefunden' });
    if ('error' in ctx) return reply.code(409).send({ error: ctx.error });
    const { slide, state } = ctx;
    if (slide.type !== 'board' || (slide.config.mode !== 'cluster' && slide.config.mode !== 'place')) {
      return reply.code(400).send({ error: 'Hier kann nichts verschoben werden' });
    }
    const rights = boardRights(state, slide);
    if (rights === 'host') return reply.code(403).send({ error: 'Die Moderation ordnet die Karten' });
    if (!(PARTICIPANT_BOARD_OPS as readonly string[]).includes(op.op))
      return reply.code(403).send({ error: 'Das darf nur die Moderation' });

    if (rights === 'own') {
      const isOwn = async (postId: number) =>
        !!(await one(db, 'SELECT id FROM posts WHERE id = ? AND run_id = ? AND participant_id = ?', [postId, p.runId, p.id]));
      const ownGroup = async (groupId: number) =>
        !!(await one(db, 'SELECT id FROM board_groups WHERE id = ? AND run_id = ? AND participant_id = ?', [groupId, p.runId, p.id]));
      const allowed =
        (op.op === 'assign' && (await isOwn(op.postId))) ||
        (op.op === 'card-edit' && (await isOwn(op.postId))) ||
        (op.op === 'group-rename' && (await ownGroup(op.groupId))) ||
        (op.op === 'place' && op.key.startsWith('c') && (await isOwn(Number(op.key.slice(1))))) ||
        (op.op === 'group-add' && op.postIds.length > 0 && (await Promise.all(op.postIds.map(isOwn))).every(Boolean));
      if (!allowed) return reply.code(403).send({ error: 'Du kannst nur deine eigenen Karten und Gruppen bearbeiten' });
    }
    try {
      await withRunLock(p.runId, () =>
        op.op === 'card-add'
          ? applyBoardOp(db, p.runId, ctx.slides, slide, op, p.id)
          : op.op === 'group-add'
            ? applyBoardOp(db, p.runId, ctx.slides, slide, op, p.id)
            : applyBoardOp(db, p.runId, ctx.slides, slide, op),
      );
    } catch (err) {
      if (err instanceof CommandError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    live.notify(p.runId);
    return { ok: true };
  });

  app.post('/api/p/posts/:id/vote', perParticipant(120), async (request, reply) => {
    const p = await auth(request, reply);
    if (!p) return;
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const post = await one<{ slide_id: number; status: string }>(db, 'SELECT slide_id, status FROM posts WHERE id = ? AND run_id = ?', [
      id,
      p.runId,
    ]);
    if (!post || post.status !== 'visible') return reply.code(404).send({ error: 'Beitrag nicht gefunden' });
    const ctx = await currentSlide(p.runId, post.slide_id);
    if (!ctx) return reply.code(404).send({ error: 'Nicht gefunden' });
    if ('error' in ctx) return reply.code(409).send({ error: ctx.error });
    const votable = ctx.slide.type === 'qa' || (ctx.slide.type === 'brainstorm' && ctx.slide.config.allowVotes);
    if (!votable) return reply.code(400).send({ error: 'Hier kann nicht abgestimmt werden' });

    const voted = await transaction(db, async (conn) => {
      const removed = await exec(conn, 'DELETE FROM post_votes WHERE post_id = ? AND participant_id = ?', [id, p.id]);
      if (removed.affectedRows > 0) {
        await exec(conn, 'UPDATE posts SET votes = GREATEST(votes, 1) - 1 WHERE id = ?', [id]);
        return false;
      }
      await exec(conn, 'INSERT INTO post_votes (post_id, participant_id) VALUES (?, ?)', [id, p.id]);
      await exec(conn, 'UPDATE posts SET votes = votes + 1 WHERE id = ?', [id]);
      return true;
    });
    live.notify(p.runId);
    return { voted };
  });
}
