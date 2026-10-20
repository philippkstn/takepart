import { randomBytes, randomInt } from 'node:crypto';
import {
  boardRights,
  groupKey,
  levelLabel,
  parseBoardKey,
  type BoardSummary,
  type HandoutBoardEntry,
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
  type SlideResults,
  type RunState,
} from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOwner } from './access.ts';
import { applyTeamsCommand, isTeamsCommand, teamName } from './teams.ts';
import { applyPauseCommand, endPause } from './pause.ts';
import { applyModerationCommand, isModerationCommand } from './moderation.ts';
import { applyBreakoutCommand } from './breakout.ts';
import { BRAND_COLUMNS, brandView, type BrandRow } from './brands.ts';
import { applyBoardOp, boardSummary, clearBoardSlide } from './board.ts';
import { exec, isDuplicateKey, json, one, query, transaction, type Db } from './db.ts';
import { CommandError } from './errors.ts';
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

export { CommandError };

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
      if (s.picker?.shown) s.picker = { ...s.picker, shown: false };
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
      endPause(s);
      break;
    case 'step': {
      // Wie in PowerPoint: erst die Animationen der Folie, dann die nächste Folie.
      // Zurück: erst Animationen zurücknehmen, dann die vorige Folie im Endzustand.
      s.blank = null;
      endPause(s);
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
      endPause(s);
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
    case 'countdown':
      s.countdown = cmd.seconds === null ? null : { endsAt: now + cmd.seconds * 1000, seconds: cmd.seconds };
      break;
    case 'team-done':
      assertSlide(cmd.slideId);
      applyBreakoutCommand(s, cmd, now);
      break;
    case 'callback':
      applyBreakoutCommand(s, cmd, now);
      break;
    case 'board-rights':
      assertSlide(cmd.slideId);
      s.boardRights = { ...s.boardRights, [cmd.slideId]: cmd.rights };
      break;
    case 'pause-start':
    case 'pause-extend':
    case 'pause-end':
      applyPauseCommand(s, cmd, now);
      break;
    case 'post-status':
    case 'clear-responses':
    case 'board':
      break;
  }
  return s;
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function runRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  const ownPresentation = requireOwner(db, 'presentation');
  const ownRun = requireOwner(db, 'run');
  const idParam = z.object({ id: z.coerce.number().int() });

  app.post('/api/presentations/:id/runs', ownPresentation, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const pres = await one<{ id: number }>(db, 'SELECT id FROM presentations WHERE id = ?', [id]);
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    // Probelauf und echte Durchführung laufen unabhängig nebeneinander – je eine pro Art.
    const { rehearsal } = z.object({ rehearsal: z.boolean().default(false) }).parse(request.body ?? {});
    const live_ = await one<{ id: number }>(db, 'SELECT id FROM runs WHERE presentation_id = ? AND ended_at IS NULL AND rehearsal = ?', [
      id,
      rehearsal ? 1 : 0,
    ]);
    if (live_) return { id: live_.id };
    const slides = await loadSlides(db, id);
    const state = initialRunState(slides[0]?.id ?? null);
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const result = await exec(db, 'INSERT INTO runs (presentation_id, code, display_token, state, rehearsal) VALUES (?, ?, ?, ?, ?)', [
          id,
          newCode(),
          randomBytes(24).toString('base64url'),
          JSON.stringify(state),
          rehearsal ? 1 : 0,
        ]);
        return { id: result.insertId };
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
    throw new Error('Kein freier Code gefunden');
  });

  app.get('/api/presentations/:id/runs', ownPresentation, async (request) => {
    const { id } = idParam.parse(request.params);
    const rows = await query<{
      id: number;
      code: string | null;
      started_at: Date;
      ended_at: Date | null;
      participants: number;
      rehearsal: number;
    }>(
      db,
      `SELECT r.id, r.code, r.started_at, r.ended_at, r.rehearsal,
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
      rehearsal: !!r.rehearsal,
    }));
  });

  /** Alle Probeläufe einer Präsentation löschen (auch einen laufenden). */
  app.delete('/api/presentations/:id/rehearsals', ownPresentation, async (request) => {
    const { id } = idParam.parse(request.params);
    const runs = await query<{ id: number }>(db, 'SELECT id FROM runs WHERE presentation_id = ? AND rehearsal = 1', [id]);
    for (const r of runs) live.end(r.id);
    await exec(db, 'DELETE FROM runs WHERE presentation_id = ? AND rehearsal = 1', [id]);
    return { deleted: runs.length };
  });

  app.post('/api/runs/:id/command', ownRun, async (request, reply) => {
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
        if (isTeamsCommand(cmd)) {
          const teamsSlide = slides.find((s) => s.id === cmd.slideId);
          if (teamsSlide?.type !== 'teams') throw new CommandError('Keine Folie zum Gruppenbilden');
          if (cmd.action === 'teams-add' && cmd.tag !== null && cmd.tag >= teamsSlide.config.tags.length)
            throw new CommandError('Unbekannte Kennzeichnung');
          await saveRunState(db, id, await applyTeamsCommand(db, id, run.state, cmd));
          return;
        }
        if (isModerationCommand(cmd)) {
          await saveRunState(db, id, await applyModerationCommand(db, id, run.state, slides, cmd));
          return;
        }
        if (cmd.action === 'board') {
          const slide = slides.find((s) => s.id === cmd.slideId);
          if (slide?.type !== 'board') throw new CommandError('Keine Kartenwand');
          await applyBoardOp(db, id, slides, slide, cmd.op);
          return;
        }
        if (cmd.action === 'clear-responses') {
          const slide = slides.find((s) => s.id === cmd.slideId);
          if (!slide) throw new CommandError('Folie nicht gefunden');
          if (slide.type === 'board') await clearBoardSlide(db, id, slide);
          await transaction(db, async (conn) => {
            await exec(conn, 'DELETE FROM responses WHERE run_id = ? AND slide_id = ?', [id, cmd.slideId]);
            // Kartenwand: Karten gehören zur Wand – nur das Sammeln löscht sie
            if (slide.type !== 'board' || slide.config.mode === 'collect')
              await exec(conn, 'DELETE FROM posts WHERE run_id = ? AND slide_id = ?', [id, cmd.slideId]);
          });
          const state = structuredClone(run.state);
          delete state.quiz[cmd.slideId];
          delete state.sentence[cmd.slideId];
          if (state.teams) delete state.teams[cmd.slideId];
          if (state.teamDone) delete state.teamDone[cmd.slideId];
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

  app.post('/api/runs/:id/end', ownRun, async (request) => {
    const { id } = idParam.parse(request.params);
    await exec(db, 'UPDATE runs SET ended_at = UTC_TIMESTAMP(3), code = NULL WHERE id = ? AND ended_at IS NULL', [id]);
    const run = await one<{ handout_token: string | null }>(db, 'SELECT handout_token FROM runs WHERE id = ?', [id]);
    live.end(id, run?.handout_token ? `/h/${run.handout_token}` : null);
    return { ok: true };
  });

  /** Folien und Ergebnisse für Teilnehmende freigeben (eigener, zufälliger Link) oder zurückziehen. */
  app.post('/api/runs/:id/handout', ownRun, async (request, reply) => {
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

  app.post('/api/runs/:id/display-token', ownRun, async (request) => {
    const { id } = idParam.parse(request.params);
    await exec(db, 'UPDATE runs SET display_token = ? WHERE id = ?', [randomBytes(24).toString('base64url'), id]);
    live.dropDisplays(id);
    live.notify(id, true);
    return { ok: true };
  });

  app.delete('/api/runs/:id', ownRun, async (request) => {
    const { id } = idParam.parse(request.params);
    live.end(id);
    await exec(db, 'DELETE FROM runs WHERE id = ?', [id]);
    return { ok: true };
  });

  /** Vollständige Ergebnisse aller Folien – für das Archiv nach dem Vortrag. */
  app.get('/api/runs/:id/results', ownRun, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const data = await runResults(db, id);
    if (!data) return reply.code(404).send({ error: 'Durchführung nicht gefunden' });
    return data;
  });

  app.get('/api/runs/:id/export.csv', ownRun, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const csv = await exportCsv(db, id);
    if (csv === null) return reply.code(404).send({ error: 'Durchführung nicht gefunden' });
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="ergebnisse-${id}.csv"`);
    return csv;
  });
}

/**
 * Kartenwand in der Freigabe: nur Gruppen (Überschriften) mit Zählungen, Feldern,
 * Punkten und Einschätzungen – nie die Texte einzelner Karten.
 */
function handoutBoard(config: SlideConfigs['board'], board: BoardSummary, results: SlideResults | null, headline: string): HandoutSlide[] {
  const { view } = board;
  const groupName = (key: string) => {
    const parsed = parseBoardKey(key);
    return parsed?.kind === 'group' ? (view.groups.find((g) => g.id === parsed.id) ?? null) : null;
  };
  const entry = (key: string): HandoutBoardEntry | null => {
    const g = groupName(key);
    if (!g) return null;
    const place = view.places[key];
    const rating = results?.type === 'board' ? results.ratings[key] : undefined;
    return {
      label: g.name,
      cards: g.cards,
      place: place ? [config.lanes[place.lane]?.title, config.lanes[place.lane]?.cells[place.cell]].filter(Boolean).join(' · ') : null,
      dots: config.mode === 'dots' && results?.type === 'board' ? (results.dots[key] ?? 0) : null,
      rating: rating ? config.scales.map((sc, i) => `${sc.label} ${levelLabel(sc.levels, rating.average[i] ?? null)}`).join(' · ') : null,
      fields: [],
    };
  };
  let keys: string[];
  switch (config.mode) {
    case 'collect':
      return [];
    case 'cluster':
      keys = view.groups.map((g) => groupKey(g.id));
      break;
    case 'table':
      keys = view.rows.map((r) => r.key);
      break;
    case 'dots': {
      const dots = results?.type === 'board' ? results.dots : {};
      keys = [...view.targets].sort((a, b) => (dots[b] ?? 0) - (dots[a] ?? 0));
      break;
    }
    default:
      keys = view.targets;
  }
  const entries = keys.flatMap((key) => {
    const e = entry(key);
    if (!e) return [];
    if (config.mode === 'table') e.fields = view.rows.find((r) => r.key === key)?.fields ?? [];
    return [e];
  });
  if (entries.length === 0) return [];
  return [{ type: 'board', headline, mode: config.mode, columns: config.mode === 'table' ? config.columns : [], entries }];
}

export async function runResults(db: Db, runId: number) {
  const run = await one<
    BrandRow & { id: number; presentation_id: number; title: string; state: string; started_at: Date; ended_at: Date | null }
  >(
    db,
    `SELECT r.id, r.presentation_id, p.title, r.state, r.started_at, r.ended_at, ${BRAND_COLUMNS}
       FROM runs r JOIN presentations p ON p.id = r.presentation_id LEFT JOIN brands b ON b.id = p.brand_id WHERE r.id = ?`,
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
  // Namen nur für die Gruppeneinteilung im Archiv (Host) – nie in der Freigabe
  const names = new Map(
    (await query<{ id: number; name: string }>(db, 'SELECT id, name FROM participants WHERE run_id = ? AND name IS NOT NULL', [runId])).map(
      (r) => [r.id, r.name],
    ),
  );

  return {
    id: run.id,
    presentationId: run.presentation_id,
    title: run.title,
    startedAt: run.started_at,
    endedAt: run.ended_at,
    participants: Number(participants),
    brand: brandView(run),
    slides: await Promise.all(
      slides.map(async (slide) => {
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
          board: slide.type === 'board' ? await boardSummary(db, runId, slides, slide, boardRights(state, slide)) : null,
          teams:
            slide.type === 'teams'
              ? (state.teams?.[slide.id] ?? []).map((ids, i) => ({
                  name: teamName(i),
                  members: ids.flatMap((id) => names.get(id) ?? []).sort((a, b) => a.localeCompare(b, 'de')),
                }))
              : null,
        };
      }),
    ),
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
    if (s.type === 'board') return s.board ? handoutBoard(s.config as SlideConfigs['board'], s.board, s.results, s.headline) : [];
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
