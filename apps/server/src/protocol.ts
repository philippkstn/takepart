import { randomBytes } from 'node:crypto';
import type { BoardSummary, SlideResults } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOwner } from './access.ts';
import { exec, one, type Db } from './db.ts';
import { runResults } from './runs.ts';
import { remapBoardKey } from './transfer.ts';

/**
 * Geteiltes Fotoprotokoll (`/p/:token`). Anders als die Folien-Freigabe (`/h/:token`)
 * enthält es bewusst Kartentexte, Freitexte, Gruppen und – wenn nicht abgewählt –
 * Namen (Gruppeneinteilung, Autorinnen und Autoren bei Q&A). Nie enthalten:
 * interne IDs (werden fortlaufend neu nummeriert), Tokens, Codes, ausgeblendete
 * oder nicht freigegebene Beiträge, der Link selbst.
 */

type RunResults = NonNullable<Awaited<ReturnType<typeof runResults>>>;
type ResultSlide = RunResults['slides'][number];
type IdMap = Map<number, number>;

function remapRecord<T>(record: Record<string, T>, map: (key: string) => string | null): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const next = map(key);
    if (next !== null) out[next] = value;
  }
  return out;
}

/** Kartenwand ohne interne IDs: Karten und Gruppen bekommen laufende Nummern, Schlüssel werden umgeschrieben. */
function publicBoard(board: BoardSummary, results: SlideResults | null): { board: BoardSummary; results: SlideResults | null } {
  const cards = board.cards.filter((c) => c.status === 'visible');
  const posts: IdMap = new Map(cards.map((c, i) => [c.id, i + 1]));
  const groups: IdMap = new Map(board.view.groups.map((g, i) => [g.id, i + 1]));
  const key = (k: string) => remapBoardKey(k, posts, groups);
  const { view } = board;
  return {
    board: {
      view: {
        ...view,
        groups: view.groups.map((g) => ({ ...g, id: groups.get(g.id)! })),
        targets: view.targets.flatMap((k) => key(k) ?? []),
        places: remapRecord(view.places, key),
        rows: view.rows.flatMap((r) => {
          const k = key(r.key);
          return k ? [{ ...r, key: k }] : [];
        }),
        totals: remapRecord(view.totals, key),
        tagCounts: remapRecord(view.tagCounts, key),
        tied: view.tied.flatMap((k) => key(k) ?? []),
        chosen: remapRecord(view.chosen, key),
      },
      cards: cards.map((c) => ({
        ...c,
        id: posts.get(c.id)!,
        authorName: null,
        group: c.group === null || c.group === undefined ? null : (groups.get(c.group) ?? null),
      })),
    },
    results:
      results?.type === 'board'
        ? {
            ...results,
            dots: remapRecord(results.dots, key),
            ratings: remapRecord(results.ratings, key),
            picks: remapRecord(results.picks, key),
          }
        : results,
  };
}

/** Daten des Fotoprotokolls für den geteilten Link. `names = false` lässt Personennamen weg. */
export function publicProtocol(data: RunResults, names: boolean) {
  const slides = data.slides.map((s: ResultSlide, i) => {
    const board = s.board ? publicBoard(s.board, s.results) : null;
    const posts = s.posts
      .filter((p) => p.status === 'visible' || p.status === 'answered')
      .map((p, j) => ({ ...p, id: j + 1, authorName: names ? p.authorName : null }));
    return {
      id: i + 1,
      type: s.type,
      typeLabel: s.typeLabel,
      headline: s.headline,
      config: s.config,
      note: s.note,
      results: board ? board.results : s.results,
      responses: s.responses,
      posts,
      sentence: s.sentence,
      board: board?.board ?? null,
      teams: s.teams
        ? s.teams.map((t) => (names ? { name: t.name, members: t.members } : { name: t.name, members: [], size: t.members.length }))
        : null,
    };
  });
  return {
    title: data.title,
    startedAt: data.startedAt,
    endedAt: data.endedAt,
    participants: data.participants,
    brand: data.brand,
    names,
    slides,
  };
}

export async function protocolData(db: Db, token: string) {
  const run = await one<{ id: number; protocol_names: number }>(db, 'SELECT id, protocol_names FROM runs WHERE protocol_token = ?', [
    token,
  ]);
  if (!run) return null;
  const data = await runResults(db, run.id);
  return data ? publicProtocol(data, !!run.protocol_names) : null;
}

export function protocolRoutes(app: FastifyInstance, db: Db) {
  /** Fotoprotokoll teilen (eigener, zufälliger Link) oder zurückziehen. */
  app.post('/api/runs/:id/protocol-share', requireOwner(db, 'run'), async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const body = z.object({ enabled: z.boolean(), names: z.boolean().default(true) }).parse(request.body);
    const result = body.enabled
      ? await exec(db, 'UPDATE runs SET protocol_token = COALESCE(protocol_token, ?), protocol_names = ? WHERE id = ?', [
          randomBytes(24).toString('base64url'),
          body.names ? 1 : 0,
          id,
        ])
      : await exec(db, 'UPDATE runs SET protocol_token = NULL, protocol_names = 1 WHERE id = ?', [id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Durchführung nicht gefunden' });
    const run = await one<{ protocol_token: string | null; protocol_names: number }>(
      db,
      'SELECT protocol_token, protocol_names FROM runs WHERE id = ?',
      [id],
    );
    return { protocol: run?.protocol_token ? { url: `/p/${run.protocol_token}`, names: !!run.protocol_names } : null };
  });

  app.get('/api/protocol/:token', async (request, reply) => {
    const { token } = z.object({ token: z.string().max(64) }).parse(request.params);
    const data = await protocolData(db, token);
    if (!data) return reply.code(404).send({ error: 'Dieses Protokoll ist nicht (mehr) geteilt' });
    reply.header('Cache-Control', 'no-store');
    return data;
  });
}
