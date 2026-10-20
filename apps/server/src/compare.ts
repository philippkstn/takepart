import type { SlideConfigs } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOwner } from './access.ts';
import { one, query, type Db } from './db.ts';
import { tableTopics } from './followup.ts';
import { runResults } from './runs.ts';

/**
 * Vergleich über die beendeten Durchführungen einer Präsentation (Workshop-Reihe):
 * Teilnehmende, je Kartenwand Gruppen und nicht eingeordnete Karten, und die
 * Ergebnistabellen. Ähnliche Themen gruppiert der Browser (`groupSimilar` aus
 * dem Shared-Paket), damit die Auswahl der Durchführungen sofort wirkt.
 */

export interface CompareBoard {
  name: string;
  groups: { name: string; cards: number }[];
  /** Sichtbare Karten ohne Gruppe */
  loose: string[];
}

export interface CompareTable {
  headline: string;
  board: string;
  columns: string[];
  rows: { label: string; fields: string[] }[];
}

export interface CompareRun {
  id: number;
  startedAt: Date;
  endedAt: Date | null;
  participants: number;
  boards: CompareBoard[];
  tables: CompareTable[];
}

export async function compareData(db: Db, presentationId: number) {
  const pres = await one<{ title: string }>(db, 'SELECT title FROM presentations WHERE id = ?', [presentationId]);
  if (!pres) return null;
  const runIds = await query<{ id: number }>(
    db,
    'SELECT id FROM runs WHERE presentation_id = ? AND ended_at IS NOT NULL ORDER BY started_at',
    [presentationId],
  );
  const runs: CompareRun[] = [];
  const boardNames: string[] = [];
  for (const { id } of runIds) {
    const data = await runResults(db, id);
    if (!data) continue;
    const boards = new Map<string, CompareBoard>();
    const tables: CompareTable[] = [];
    for (const s of data.slides) {
      if (s.type !== 'board' || !s.board) continue;
      const config = s.config as SlideConfigs['board'];
      if (!boardNames.includes(config.board)) boardNames.push(config.board);
      // Karten und Gruppen gehören zur Wand – die erste Folie genügt
      if (!boards.has(config.board)) {
        boards.set(config.board, {
          name: config.board,
          groups: s.board.view.groups.map((g) => ({ name: g.name, cards: g.cards })),
          loose: s.board.cards.filter((c) => c.status === 'visible' && (c.group ?? null) === null).map((c) => c.text),
        });
      }
      if (config.mode === 'table' && s.board.view.rows.length > 0) {
        tables.push({
          headline: s.headline,
          board: config.board,
          columns: config.columns,
          rows: tableTopics(config, s.board).map((t) => ({ label: t.label, fields: t.fields.map((f) => f.value) })),
        });
      }
    }
    runs.push({
      id: data.id,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      participants: data.participants,
      boards: [...boards.values()],
      tables,
    });
  }
  return { id: presentationId, title: pres.title, boards: boardNames, runs };
}

export function compareRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/presentations/:id/compare', requireOwner(db, 'presentation'), async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const data = await compareData(db, id);
    if (!data) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    return data;
  });
}
