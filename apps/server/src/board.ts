import {
  boardTargets,
  cardKey,
  dotTotals,
  groupKey,
  parseBoardKey,
  type BoardOp,
  type BoardRights,
  type BoardSummary,
  type BoardView,
  type PostStatus,
  type ResponsePayloads,
  type Slide,
  type SlideConfigs,
} from '@slides/shared';
import { exec, isDuplicateKey, json, one, query, transaction, type Conn, type Db } from './db.ts';
import { CommandError } from './errors.ts';

/**
 * Kartenwand: Karten sind Beiträge (posts) auf den Folien einer Wand, Gruppen
 * gelten für die ganze Wand (alle Folien mit demselben Namen), Platzierungen
 * und Tabellenzeilen je Folie. Alles liegt in der Datenbank.
 */

export type BoardSlide = Extract<Slide, { type: 'board' }>;

export interface BoardCard {
  id: number;
  slideId: number;
  participantId: number | null;
  text: string;
  column: number | null;
  group: number | null;
  /** Breakout: Arbeitsgruppe, in der die Karte gesammelt wurde */
  team: number | null;
  status: PostStatus;
  votes: number;
  createdAt: number;
}

export interface BoardGroup {
  id: number;
  name: string;
  position: number;
  /** Wer die Gruppe angelegt hat (null = Moderation) – nur für Rechte, nie in Ansichten */
  participantId: number | null;
}

export interface BoardPlace {
  target: string;
  lane: number | null;
  cell: number | null;
  position: number;
  fields: string[];
}

export interface BoardData {
  cards: BoardCard[];
  groups: BoardGroup[];
  places: BoardPlace[];
  /** Punkte aus den Punkte-Folien der Wand (ohne die aktuelle Folie) */
  totals: Record<string, number>;
}

/** Folien derselben Wand */
export function boardSlides(slides: Slide[], board: string): BoardSlide[] {
  return slides.filter((s): s is BoardSlide => s.type === 'board' && s.config.board === board);
}

/** Karten einer Sammel-Folie zählen nur dort; alle anderen Modi sehen die ganze Wand. */
function cardSlideIds(slides: Slide[], slide: BoardSlide): number[] {
  return slide.config.mode === 'collect' ? [slide.id] : boardSlides(slides, slide.config.board).map((s) => s.id);
}

export async function loadCards(db: Conn, runId: number, slideIds: number[]): Promise<BoardCard[]> {
  if (slideIds.length === 0) return [];
  const rows = await query<{
    id: number;
    slide_id: number;
    participant_id: number | null;
    text: string;
    column_index: number | null;
    group_id: number | null;
    team: number | null;
    status: PostStatus;
    votes: number;
    created_at: Date;
  }>(
    db,
    `SELECT id, slide_id, participant_id, text, column_index, group_id, team, status, votes, created_at
       FROM posts WHERE run_id = ? AND slide_id IN (?) ORDER BY created_at, id`,
    [runId, slideIds],
  );
  return rows.map((r) => ({
    id: r.id,
    slideId: r.slide_id,
    participantId: r.participant_id,
    text: r.text,
    column: r.column_index,
    group: r.group_id,
    team: r.team,
    status: r.status,
    votes: r.votes,
    createdAt: r.created_at.getTime(),
  }));
}

export async function loadGroups(db: Conn, runId: number, board: string): Promise<BoardGroup[]> {
  return query<BoardGroup>(
    db,
    'SELECT id, name, position, participant_id AS participantId FROM board_groups WHERE run_id = ? AND board = ? ORDER BY position, id',
    [runId, board],
  );
}

export async function loadPlaces(db: Conn, runId: number, slideId: number): Promise<BoardPlace[]> {
  const rows = await query<{ target: string; lane: number | null; cell: number | null; position: number; fields: string | null }>(
    db,
    'SELECT target, lane, cell, position, fields FROM board_places WHERE run_id = ? AND slide_id = ? ORDER BY position, target',
    [runId, slideId],
  );
  return rows.map((r) => ({ ...r, fields: r.fields ? json<string[]>(r.fields) : [] }));
}

/** Punkte aller Punkte-Folien der Wand, außer `exceptSlideId` (deren Ergebnis zeigt die Folie selbst). */
export async function loadTotals(db: Conn, runId: number, slides: Slide[], board: string, exceptSlideId?: number) {
  const ids = boardSlides(slides, board)
    .filter((s) => s.config.mode === 'dots' && s.id !== exceptSlideId)
    .map((s) => s.id);
  if (ids.length === 0) return {};
  const rows = await query<{ payload: string }>(db, 'SELECT payload FROM responses WHERE run_id = ? AND slide_id IN (?)', [runId, ids]);
  return dotTotals(rows.map((r) => json<ResponsePayloads['board']>(r.payload)));
}

export async function loadBoard(db: Conn, runId: number, slides: Slide[], slide: BoardSlide): Promise<BoardData> {
  const [cards, groups, places, totals] = await Promise.all([
    loadCards(db, runId, cardSlideIds(slides, slide)),
    loadGroups(db, runId, slide.config.board),
    loadPlaces(db, runId, slide.id),
    loadTotals(db, runId, slides, slide.config.board, slide.id),
  ]);
  return { cards, groups, places, totals };
}

/** Einträge der Folie – nur sichtbare Karten zählen. */
export function targetsOf(config: SlideConfigs['board'], data: Pick<BoardData, 'cards' | 'groups' | 'totals'>): string[] {
  return boardTargets(
    config,
    data.cards.filter((c) => c.status === 'visible'),
    data.groups,
    data.totals,
  );
}

/** Ansicht der Wand für die aktuelle Folie (für alle Rollen gleich; Karten kommen über `posts`). */
export function buildBoardView(slide: BoardSlide, data: BoardData, rights: BoardRights): BoardView {
  const config = slide.config;
  const visible = data.cards.filter((c) => c.status === 'visible');
  const targets = config.mode === 'place' || config.mode === 'dots' || config.mode === 'rate' ? targetsOf(config, data) : [];
  const valid = new Set([...visible.map((c) => cardKey(c.id)), ...data.groups.map((g) => groupKey(g.id))]);

  const places: BoardView['places'] = {};
  if (config.mode === 'place') {
    const allowed = new Set(targets);
    for (const p of data.places) {
      if (p.lane === null || p.cell === null || !allowed.has(p.target)) continue;
      if (p.lane >= config.lanes.length || p.cell >= config.lanes[p.lane]!.cells.length) continue;
      places[p.target] = { lane: p.lane, cell: p.cell };
    }
  }
  const rows =
    config.mode === 'table'
      ? data.places
          .filter((p) => valid.has(p.target))
          .map((p) => ({ key: p.target, fields: config.columns.map((_, i) => p.fields[i] ?? '') }))
      : [];

  return {
    name: config.board,
    mode: config.mode,
    groups: data.groups.map((g) => ({ id: g.id, name: g.name, cards: visible.filter((c) => c.group === g.id).length })),
    targets,
    places,
    rows,
    totals: data.totals,
    rights,
  };
}

/* ───────────── Moderation ───────────── */

async function groupOf(db: Conn, runId: number, board: string, groupId: number) {
  const g = await one<{ id: number }>(db, 'SELECT id FROM board_groups WHERE id = ? AND run_id = ? AND board = ?', [groupId, runId, board]);
  if (!g) throw new CommandError('Gruppe nicht gefunden');
  return g.id;
}

async function cardOf(db: Conn, runId: number, slides: Slide[], slide: BoardSlide, postId: number) {
  const ids = boardSlides(slides, slide.config.board).map((s) => s.id);
  const p = await one<{ id: number; participant_id: number | null }>(
    db,
    'SELECT id, participant_id FROM posts WHERE id = ? AND run_id = ? AND slide_id IN (?)',
    [postId, runId, ids],
  );
  if (!p) throw new CommandError('Karte nicht gefunden');
  return p;
}

async function assertTarget(db: Conn, runId: number, slides: Slide[], slide: BoardSlide, key: string) {
  const parsed = parseBoardKey(key);
  if (!parsed) throw new CommandError('Unbekannter Eintrag');
  if (parsed.kind === 'group') await groupOf(db, runId, slide.config.board, parsed.id);
  else await cardOf(db, runId, slides, slide, parsed.id);
}

/** Neue Gruppe ans Ende der Wand */
export async function addGroup(db: Conn, runId: number, board: string, name: string, participantId: number | null = null) {
  const max = await one<{ m: number | null }>(db, 'SELECT MAX(position) AS m FROM board_groups WHERE run_id = ? AND board = ?', [
    runId,
    board,
  ]);
  const result = await exec(db, 'INSERT INTO board_groups (run_id, board, name, position, participant_id) VALUES (?, ?, ?, ?, ?)', [
    runId,
    board,
    name,
    (max?.m ?? -1) + 1,
    participantId,
  ]);
  return result.insertId;
}

/** Eintrag in ein Feld legen oder (lane/cell null) zurück in die Ablage */
export async function placeTarget(db: Conn, runId: number, slide: BoardSlide, key: string, lane: number | null, cell: number | null) {
  if (lane === null || cell === null) {
    await exec(db, 'DELETE FROM board_places WHERE run_id = ? AND slide_id = ? AND target = ?', [runId, slide.id, key]);
    return;
  }
  const l = slide.config.lanes[lane];
  if (!l || cell >= l.cells.length) throw new CommandError('Unbekanntes Feld');
  await exec(
    db,
    `INSERT INTO board_places (run_id, slide_id, target, lane, cell) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE lane = VALUES(lane), cell = VALUES(cell)`,
    [runId, slide.id, key, lane, cell],
  );
}

async function addRow(db: Conn, runId: number, slideId: number, key: string) {
  const max = await one<{ m: number | null }>(db, 'SELECT MAX(position) AS m FROM board_places WHERE run_id = ? AND slide_id = ?', [
    runId,
    slideId,
  ]);
  try {
    await exec(db, 'INSERT INTO board_places (run_id, slide_id, target, position) VALUES (?, ?, ?, ?)', [
      runId,
      slideId,
      key,
      (max?.m ?? -1) + 1,
    ]);
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
}

/** Führt einen Moderationsbefehl auf einer Wand aus (Gruppen, Einordnen, Karten, Tabelle). */
export async function applyBoardOp(
  db: Db,
  runId: number,
  slides: Slide[],
  slide: BoardSlide,
  op: BoardOp,
  participantId: number | null = null,
) {
  const { board } = slide.config;
  switch (op.op) {
    case 'group-add': {
      await transaction(db, async (conn) => {
        const id = await addGroup(conn, runId, board, op.name, participantId);
        for (const postId of op.postIds) {
          await cardOf(conn, runId, slides, slide, postId);
          await exec(conn, 'UPDATE posts SET group_id = ? WHERE id = ?', [id, postId]);
        }
      });
      return;
    }
    case 'group-rename':
      await groupOf(db, runId, board, op.groupId);
      await exec(db, 'UPDATE board_groups SET name = ? WHERE id = ?', [op.name, op.groupId]);
      return;
    case 'group-delete':
      await groupOf(db, runId, board, op.groupId);
      // Karten fallen zurück in die Ablage (Fremdschlüssel setzt group_id auf NULL)
      await transaction(db, async (conn) => {
        await exec(conn, 'DELETE FROM board_places WHERE run_id = ? AND target = ?', [runId, groupKey(op.groupId)]);
        await exec(conn, 'DELETE FROM board_groups WHERE id = ?', [op.groupId]);
      });
      return;
    case 'group-move': {
      const groups = await loadGroups(db, runId, board);
      const i = groups.findIndex((g) => g.id === op.groupId);
      if (i < 0) throw new CommandError('Gruppe nicht gefunden');
      const j = i + op.delta;
      if (j < 0 || j >= groups.length) return;
      [groups[i], groups[j]] = [groups[j]!, groups[i]!];
      await transaction(db, async (conn) => {
        for (const [position, g] of groups.entries())
          await exec(conn, 'UPDATE board_groups SET position = ? WHERE id = ?', [position, g.id]);
      });
      return;
    }
    case 'assign':
      await cardOf(db, runId, slides, slide, op.postId);
      if (op.groupId !== null) await groupOf(db, runId, board, op.groupId);
      await exec(db, 'UPDATE posts SET group_id = ? WHERE id = ?', [op.groupId, op.postId]);
      return;
    case 'place':
      if (slide.config.mode !== 'place') throw new CommandError('Auf dieser Folie wird nicht zugeordnet');
      await assertTarget(db, runId, slides, slide, op.key);
      await placeTarget(db, runId, slide, op.key, op.lane, op.cell);
      return;
    case 'card-add': {
      if (op.groupId !== null) await groupOf(db, runId, board, op.groupId);
      // Ergänzte Karte gehört zur aktuellen Folie der Wand (von der Moderation: ohne Person)
      await exec(db, "INSERT INTO posts (run_id, slide_id, participant_id, text, group_id, status) VALUES (?, ?, ?, ?, ?, 'visible')", [
        runId,
        slide.id,
        participantId,
        op.text,
        op.groupId,
      ]);
      return;
    }
    case 'card-edit':
      await cardOf(db, runId, slides, slide, op.postId);
      await exec(db, 'UPDATE posts SET text = ? WHERE id = ?', [op.text, op.postId]);
      return;
    case 'row-add':
      await assertTarget(db, runId, slides, slide, op.key);
      await addRow(db, runId, slide.id, op.key);
      return;
    case 'row-remove':
      await exec(db, 'DELETE FROM board_places WHERE run_id = ? AND slide_id = ? AND target = ?', [runId, slide.id, op.key]);
      return;
    case 'row-move': {
      const rows = await loadPlaces(db, runId, slide.id);
      const i = rows.findIndex((r) => r.target === op.key);
      const j = i + op.delta;
      if (i < 0 || j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
      await transaction(db, async (conn) => {
        for (const [position, r] of rows.entries())
          await exec(conn, 'UPDATE board_places SET position = ? WHERE run_id = ? AND slide_id = ? AND target = ?', [
            position,
            runId,
            slide.id,
            r.target,
          ]);
      });
      return;
    }
    case 'rows-top': {
      const [cards, groups, totals] = await Promise.all([
        loadCards(
          db,
          runId,
          boardSlides(slides, board).map((s) => s.id),
        ),
        loadGroups(db, runId, board),
        loadTotals(db, runId, slides, board),
      ]);
      const top = targetsOf({ ...slide.config, top: op.n }, { cards, groups, totals });
      if (Object.keys(totals).length === 0) throw new CommandError('Auf dieser Wand wurden noch keine Punkte vergeben');
      const existing = await loadPlaces(db, runId, slide.id);
      await transaction(db, async (conn) => {
        // Bereits ausgefüllte Zeilen behalten ihre Felder
        for (const r of existing)
          if (!top.includes(r.target))
            await exec(conn, 'DELETE FROM board_places WHERE run_id = ? AND slide_id = ? AND target = ?', [runId, slide.id, r.target]);
        for (const [position, key] of top.entries())
          await exec(
            conn,
            `INSERT INTO board_places (run_id, slide_id, target, position) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE position = VALUES(position)`,
            [runId, slide.id, key, position],
          );
      });
      return;
    }
    case 'row-fields': {
      const fields = slide.config.columns.map((_, i) => op.fields[i] ?? '');
      const result = await exec(db, 'UPDATE board_places SET fields = ? WHERE run_id = ? AND slide_id = ? AND target = ?', [
        JSON.stringify(fields),
        runId,
        slide.id,
        op.key,
      ]);
      if (result.affectedRows === 0) throw new CommandError('Zeile nicht gefunden');
      return;
    }
  }
}

/** Antworten, Karten und Platzierungen einer Wand-Folie löschen; beim Clustern auch die Gruppen der Wand. */
export async function clearBoardSlide(db: Db, runId: number, slide: BoardSlide) {
  await transaction(db, async (conn) => {
    await exec(conn, 'DELETE FROM board_places WHERE run_id = ? AND slide_id = ?', [runId, slide.id]);
    if (slide.config.mode === 'cluster') {
      await exec(conn, 'DELETE FROM board_groups WHERE run_id = ? AND board = ?', [runId, slide.config.board]);
    }
  });
}

/** Wand einer Folie für Archiv und Freigabe */
export async function boardSummary(
  db: Conn,
  runId: number,
  slides: Slide[],
  slide: BoardSlide,
  rights: BoardRights,
): Promise<BoardSummary> {
  const data = await loadBoard(db, runId, slides, slide);
  return {
    view: buildBoardView(slide, data, rights),
    cards: data.cards.map((c) => ({
      id: c.id,
      text: c.text,
      authorName: null,
      column: c.column,
      status: c.status,
      votes: c.votes,
      createdAt: c.createdAt,
      group: c.group,
      team: c.team,
    })),
  };
}
