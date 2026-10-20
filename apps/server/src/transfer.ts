import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';
import { parseConfig, SLIDE_TYPES, type RunState, type SlideType } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOwner } from './access.ts';
import { newPublicId } from './assets.ts';
import { accountOf, requireHost } from './auth.ts';
import { exec, json, one, query, transaction, type Conn, type Db } from './db.ts';

/**
 * Präsentationen als Datei exportieren und wieder importieren – mit Folien,
 * Sprechernotizen, Bildern, Branding und allen Durchführungen samt Antworten,
 * Beiträgen und Kartenwand. Format: gzip-komprimiertes JSON (`.takepart`).
 *
 * Nie exportiert: Teilnehmer-Tokens, Codes, Anzeige- und Freigabe-Links – sie
 * sind Zugriffsrechte. Importierte Durchführungen sind immer beendet; alle IDs
 * werden neu vergeben und die Verweise darauf (Live-Zustand, Kartenschlüssel)
 * umgeschrieben.
 */

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

export const FORMAT = 'takepart';
export const FORMAT_VERSION = 1;
/** Bilder liegen base64-kodiert in der Datei; große Foliensätze brauchen Platz. */
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;

const id = z.number().int().nonnegative();
const date = z.string().nullable();
const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Ungültige Bilddaten');

const fileSchema = z.object({
  format: z.literal(FORMAT, { error: 'Das ist keine TakePart-Datei' }),
  version: z.number().int().max(FORMAT_VERSION, { error: 'Die Datei stammt aus einer neueren TakePart-Version' }),
  presentation: z.object({
    title: z.string().trim().min(1).max(200),
    shareSlides: z.boolean(),
    targetMinutes: z.number().int().min(1).max(600).nullable(),
  }),
  brand: z
    .object({
      name: z.string().trim().min(1).max(100),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      chart: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      logo: base64.nullable(),
      logoType: z.string().max(40).nullable(),
    })
    .nullable(),
  assets: z.array(
    z.object({
      id: z.string(),
      mime: z.string().max(40),
      width: z.number().int().min(1).max(10000),
      height: z.number().int().min(1).max(10000),
      data: base64,
      thumb: base64.nullable(),
      thumbMime: z.string().max(40).nullable(),
    }),
  ),
  slides: z.array(z.object({ id, type: z.enum(SLIDE_TYPES), config: z.unknown(), notes: z.string().max(20000).nullable() })).max(1000),
  runs: z.array(
    z.object({
      startedAt: date,
      endedAt: date,
      state: z.record(z.string(), z.unknown()),
      participants: z.array(z.object({ id, name: z.string().max(60).nullable(), createdAt: date })),
      groups: z.array(
        z.object({
          id,
          board: z.string().max(60),
          name: z.string().max(120),
          position: z.number().int(),
          participantId: id.nullable(),
          createdAt: date,
        }),
      ),
      posts: z.array(
        z.object({
          id,
          slideId: id,
          participantId: id.nullable(),
          authorName: z.string().max(60).nullable(),
          text: z.string().max(500),
          columnIndex: z.number().int().min(0).max(255).nullable(),
          groupId: id.nullable(),
          status: z.enum(['pending', 'visible', 'hidden', 'answered']),
          votes: z.number().int().nonnegative(),
          createdAt: date,
        }),
      ),
      votes: z.array(z.object({ postId: id, participantId: id })),
      responses: z.array(
        z.object({ slideId: id, participantId: id, round: z.number().int(), payload: z.unknown(), createdAt: date, updatedAt: date }),
      ),
      places: z.array(
        z.object({
          slideId: id,
          target: z.string().max(12),
          lane: z.number().int().min(0).max(255).nullable(),
          cell: z.number().int().min(0).max(255).nullable(),
          position: z.number().int(),
          fields: z.array(z.string()).nullable(),
        }),
      ),
    }),
  ),
});

export type ExportFile = z.infer<typeof fileSchema>;
type IdMap = Map<number, number>;

/** Kartenschlüssel `c<postId>` / `g<groupId>` auf die neuen IDs umschreiben; null, wenn es das Ziel nicht mehr gibt. */
export function remapBoardKey(key: string, posts: IdMap, groups: IdMap): string | null {
  const match = /^([cg])(\d+)$/.exec(key);
  if (!match) return null;
  const next = (match[1] === 'c' ? posts : groups).get(Number(match[2]));
  return next ? `${match[1]}${next}` : null;
}

function remapKeys<T>(record: Record<string, T> | undefined, map: (key: string) => string | null): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    const next = map(key);
    if (next !== null) out[next] = value;
  }
  return out;
}

/** Live-Zustand einer Durchführung auf neue Folien- und Beitrags-IDs umschreiben. */
export function remapState(state: RunState, slides: IdMap, posts: IdMap): RunState {
  const slideKey = (key: string) => {
    const next = slides.get(Number(key));
    return next ? String(next) : null;
  };
  return {
    ...state,
    slideId: state.slideId === null ? null : (slides.get(state.slideId) ?? null),
    spotlight: state.spotlight === null ? null : (posts.get(state.spotlight) ?? null),
    locked: (state.locked ?? []).flatMap((sid) => slides.get(sid) ?? []),
    quiz: remapKeys(state.quiz, slideKey),
    sentence: remapKeys(state.sentence, slideKey),
    build: state.build ? remapKeys(state.build, slideKey) : undefined,
    boardRights: state.boardRights ? remapKeys(state.boardRights, slideKey) : undefined,
    // Beendete Durchführung: keine laufenden Anzeigen übernehmen
    countdown: null,
    blank: null,
  };
}

/** Antworten der Kartenwand (Punkte, Einschätzungen) verweisen auf Karten und Gruppen. */
export function remapPayload(payload: unknown, posts: IdMap, groups: IdMap): unknown {
  if (typeof payload !== 'object' || payload === null) return payload;
  const p = payload as { dots?: Record<string, number>; ratings?: Record<string, unknown> };
  if (!p.dots && !p.ratings) return payload;
  const key = (k: string) => remapBoardKey(k, posts, groups);
  return { ...p, ...(p.dots && { dots: remapKeys(p.dots, key) }), ...(p.ratings && { ratings: remapKeys(p.ratings, key) }) };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** ISO-Zeit aus der Datei → DATETIME für MariaDB (UTC); ungültige Angaben werden „jetzt“ */
const sqlDate = (value: string | null) => {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

export async function exportPresentation(db: Db, presentationId: number): Promise<ExportFile> {
  const pres = await one<{ title: string; share_slides: number; target_minutes: number | null; brand_id: number | null }>(
    db,
    'SELECT title, share_slides, target_minutes, brand_id FROM presentations WHERE id = ?',
    [presentationId],
  );
  if (!pres) throw new Error('Präsentation nicht gefunden');
  const brand = pres.brand_id
    ? await one<{ name: string; accent: string; chart: string; logo: Buffer | null; logo_type: string | null }>(
        db,
        'SELECT name, accent, chart, logo, logo_type FROM brands WHERE id = ?',
        [pres.brand_id],
      )
    : undefined;
  const assets = await query<{
    public_id: string;
    mime: string;
    width: number;
    height: number;
    data: Buffer;
    thumb: Buffer | null;
    thumb_mime: string | null;
  }>(db, 'SELECT public_id, mime, width, height, data, thumb, thumb_mime FROM assets WHERE presentation_id = ? ORDER BY id', [
    presentationId,
  ]);
  const slides = await query<{ id: number; type: SlideType; config: string; notes: string | null }>(
    db,
    'SELECT id, type, config, notes FROM slides WHERE presentation_id = ? ORDER BY position, id',
    [presentationId],
  );
  const runs = await query<{ id: number; state: string; started_at: Date; ended_at: Date | null }>(
    db,
    'SELECT id, state, started_at, ended_at FROM runs WHERE presentation_id = ? ORDER BY started_at',
    [presentationId],
  );

  const runData: ExportFile['runs'] = [];
  for (const run of runs) {
    const participants = await query<{ id: number; name: string | null; created_at: Date }>(
      db,
      'SELECT id, name, created_at FROM participants WHERE run_id = ? ORDER BY id',
      [run.id],
    );
    const groups = await query<{
      id: number;
      board: string;
      name: string;
      position: number;
      participant_id: number | null;
      created_at: Date;
    }>(db, 'SELECT id, board, name, position, participant_id, created_at FROM board_groups WHERE run_id = ? ORDER BY id', [run.id]);
    const posts = await query<{
      id: number;
      slide_id: number;
      participant_id: number | null;
      author_name: string | null;
      text: string;
      column_index: number | null;
      group_id: number | null;
      status: 'pending' | 'visible' | 'hidden' | 'answered';
      votes: number;
      created_at: Date;
    }>(
      db,
      `SELECT id, slide_id, participant_id, author_name, text, column_index, group_id, status, votes, created_at
         FROM posts WHERE run_id = ? ORDER BY id`,
      [run.id],
    );
    const votes = await query<{ post_id: number; participant_id: number }>(
      db,
      'SELECT v.post_id, v.participant_id FROM post_votes v JOIN posts p ON p.id = v.post_id WHERE p.run_id = ?',
      [run.id],
    );
    const responses = await query<{
      slide_id: number;
      participant_id: number;
      round: number;
      payload: string;
      created_at: Date;
      updated_at: Date;
    }>(db, 'SELECT slide_id, participant_id, round, payload, created_at, updated_at FROM responses WHERE run_id = ? ORDER BY id', [run.id]);
    const places = await query<{
      slide_id: number;
      target: string;
      lane: number | null;
      cell: number | null;
      position: number;
      fields: string | null;
    }>(db, 'SELECT slide_id, target, lane, cell, position, fields FROM board_places WHERE run_id = ?', [run.id]);
    runData.push({
      startedAt: iso(run.started_at),
      endedAt: iso(run.ended_at),
      state: json<Record<string, unknown>>(run.state),
      participants: participants.map((p) => ({ id: p.id, name: p.name, createdAt: iso(p.created_at) })),
      groups: groups.map((g) => ({
        id: g.id,
        board: g.board,
        name: g.name,
        position: g.position,
        participantId: g.participant_id,
        createdAt: iso(g.created_at),
      })),
      posts: posts.map((p) => ({
        id: p.id,
        slideId: p.slide_id,
        participantId: p.participant_id,
        authorName: p.author_name,
        text: p.text,
        columnIndex: p.column_index,
        groupId: p.group_id,
        status: p.status,
        votes: Number(p.votes),
        createdAt: iso(p.created_at),
      })),
      votes: votes.map((v) => ({ postId: v.post_id, participantId: v.participant_id })),
      responses: responses.map((r) => ({
        slideId: r.slide_id,
        participantId: r.participant_id,
        round: r.round,
        payload: json(r.payload),
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      })),
      places: places.map((p) => ({
        slideId: p.slide_id,
        target: p.target,
        lane: p.lane,
        cell: p.cell,
        position: p.position,
        fields: p.fields ? json<string[]>(p.fields) : null,
      })),
    });
  }

  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    presentation: { title: pres.title, shareSlides: !!pres.share_slides, targetMinutes: pres.target_minutes },
    brand: brand
      ? {
          name: brand.name,
          accent: brand.accent,
          chart: brand.chart,
          logo: brand.logo?.toString('base64') ?? null,
          logoType: brand.logo_type,
        }
      : null,
    assets: assets.map((a) => ({
      id: a.public_id,
      mime: a.mime,
      width: a.width,
      height: a.height,
      data: a.data.toString('base64'),
      thumb: a.thumb?.toString('base64') ?? null,
      thumbMime: a.thumb_mime,
    })),
    slides: slides.map((s) => ({ id: s.id, type: s.type, config: json(s.config), notes: s.notes })),
    runs: runData,
  };
}

export class ImportError extends Error {}

/** Branding des importierenden Kontos mit gleichem Namen und gleichen Farben wiederverwenden, sonst anlegen. */
async function importBrand(conn: Conn, userId: number, brand: NonNullable<ExportFile['brand']>): Promise<number> {
  const existing = await one<{ id: number }>(conn, 'SELECT id FROM brands WHERE user_id = ? AND name = ? AND accent = ? AND chart = ?', [
    userId,
    brand.name,
    brand.accent,
    brand.chart,
  ]);
  if (existing) return existing.id;
  const logo = brand.logo && brand.logoType ? Buffer.from(brand.logo, 'base64') : null;
  const result = await exec(conn, 'INSERT INTO brands (user_id, name, accent, chart, logo, logo_type) VALUES (?, ?, ?, ?, ?, ?)', [
    userId,
    brand.name,
    brand.accent,
    brand.chart,
    logo,
    logo ? brand.logoType : null,
  ]);
  return result.insertId;
}

export async function importPresentation(db: Db, userId: number, file: ExportFile): Promise<number> {
  return transaction(db, async (conn) => {
    const brandId = file.brand ? await importBrand(conn, userId, file.brand) : null;
    const pres = await exec(
      conn,
      'INSERT INTO presentations (user_id, title, brand_id, share_slides, target_minutes) VALUES (?, ?, ?, ?, ?)',
      [userId, file.presentation.title, brandId, file.presentation.shareSlides ? 1 : 0, file.presentation.targetMinutes],
    );
    const presentationId = pres.insertId;

    // Bilder bekommen neue Kennungen – sie sind zugleich Zugriffsrechte.
    const assets = new Map<string, string>();
    for (const a of file.assets) {
      const publicId = newPublicId();
      await exec(
        conn,
        'INSERT INTO assets (presentation_id, public_id, mime, width, height, data, thumb, thumb_mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          presentationId,
          publicId,
          a.mime,
          a.width,
          a.height,
          Buffer.from(a.data, 'base64'),
          a.thumb ? Buffer.from(a.thumb, 'base64') : null,
          a.thumb ? a.thumbMime : null,
        ],
      );
      assets.set(a.id, publicId);
    }

    const slides: IdMap = new Map();
    for (const [position, s] of file.slides.entries()) {
      let config: Record<string, unknown>;
      try {
        const raw = s.config as Record<string, unknown>;
        config = parseConfig(s.type, s.type === 'image' ? { ...raw, asset: assets.get(String(raw?.asset)) } : raw);
      } catch {
        throw new ImportError(`Folie ${position + 1} ist ungültig`);
      }
      const result = await exec(conn, 'INSERT INTO slides (presentation_id, position, type, config, notes) VALUES (?, ?, ?, ?, ?)', [
        presentationId,
        position,
        s.type,
        JSON.stringify(config),
        s.notes || null,
      ]);
      slides.set(s.id, result.insertId);
    }

    for (const run of file.runs) {
      const startedAt = sqlDate(run.startedAt);
      // Vorläufiger Zustand – die Beitrags-IDs für das Rampenlicht kennen wir erst nach den Beiträgen.
      const result = await exec(
        conn,
        'INSERT INTO runs (presentation_id, code, display_token, state, started_at, ended_at) VALUES (?, NULL, ?, ?, ?, ?)',
        // Lief sie beim Export noch, gilt sie jetzt als beendet.
        [presentationId, randomBytes(24).toString('base64url'), '{}', startedAt, sqlDate(run.endedAt)],
      );
      const runId = result.insertId;

      const participants: IdMap = new Map();
      for (const p of run.participants) {
        const r = await exec(conn, 'INSERT INTO participants (run_id, token, name, created_at) VALUES (?, ?, ?, ?)', [
          runId,
          randomBytes(24).toString('base64url').slice(0, 32),
          p.name,
          sqlDate(p.createdAt),
        ]);
        participants.set(p.id, r.insertId);
      }
      const person = (pid: number | null) => (pid === null ? null : (participants.get(pid) ?? null));

      const groups: IdMap = new Map();
      for (const g of run.groups) {
        const r = await exec(
          conn,
          'INSERT INTO board_groups (run_id, board, name, position, participant_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [runId, g.board, g.name, g.position, person(g.participantId), sqlDate(g.createdAt)],
        );
        groups.set(g.id, r.insertId);
      }

      const posts: IdMap = new Map();
      for (const p of run.posts) {
        const slideId = slides.get(p.slideId);
        if (!slideId) continue;
        const r = await exec(
          conn,
          `INSERT INTO posts (run_id, slide_id, participant_id, author_name, text, column_index, group_id, status, votes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            runId,
            slideId,
            person(p.participantId),
            p.authorName,
            p.text,
            p.columnIndex,
            p.groupId === null ? null : (groups.get(p.groupId) ?? null),
            p.status,
            p.votes,
            sqlDate(p.createdAt),
          ],
        );
        posts.set(p.id, r.insertId);
      }

      for (const v of run.votes) {
        const postId = posts.get(v.postId);
        const participantId = participants.get(v.participantId);
        if (postId && participantId) {
          await exec(conn, 'INSERT IGNORE INTO post_votes (post_id, participant_id) VALUES (?, ?)', [postId, participantId]);
        }
      }

      for (const r of run.responses) {
        const slideId = slides.get(r.slideId);
        const participantId = participants.get(r.participantId);
        if (!slideId || !participantId) continue;
        await exec(
          conn,
          'INSERT IGNORE INTO responses (run_id, slide_id, participant_id, round, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            runId,
            slideId,
            participantId,
            r.round,
            JSON.stringify(remapPayload(r.payload, posts, groups)),
            sqlDate(r.createdAt),
            sqlDate(r.updatedAt),
          ],
        );
      }

      for (const p of run.places) {
        const slideId = slides.get(p.slideId);
        const target = remapBoardKey(p.target, posts, groups);
        if (!slideId || !target) continue;
        await exec(
          conn,
          'INSERT IGNORE INTO board_places (run_id, slide_id, target, lane, cell, position, fields) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [runId, slideId, target, p.lane, p.cell, p.position, p.fields ? JSON.stringify(p.fields) : null],
        );
      }

      const state = remapState(run.state as unknown as RunState, slides, posts);
      await exec(conn, 'UPDATE runs SET state = ? WHERE id = ?', [JSON.stringify(state), runId]);
    }
    return presentationId;
  });
}

/** Dateiname ohne Zeichen, die Betriebssysteme oder der Header nicht mögen */
function fileName(title: string): string {
  const safe = title
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${safe || 'praesentation'}.takepart`;
}

export function transferRoutes(app: FastifyInstance, db: Db) {
  // Ohne eigenes Limit am Parser: das große Limit gilt nur für die Import-Route.
  app.addContentTypeParser(['application/gzip', 'application/octet-stream'], { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.get('/api/presentations/:id/export', requireOwner(db, 'presentation'), async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const data = await exportPresentation(db, id);
    const body = await gzip(JSON.stringify(data));
    const name = fileName(data.presentation.title);
    return reply
      .header('Content-Type', 'application/gzip')
      .header(
        'Content-Disposition',
        `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      )
      .header('Cache-Control', 'no-store')
      .send(body);
  });

  app.post(
    '/api/presentations/import',
    // Anmeldung schon vor dem Hochladen prüfen, damit Fremde keine 200 MB schicken können.
    { onRequest: requireHost(db), bodyLimit: MAX_IMPORT_BYTES, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const raw = request.body;
      if (!Buffer.isBuffer(raw)) return reply.code(415).send({ error: 'Bitte eine .takepart-Datei hochladen' });
      let parsed: unknown;
      try {
        // gzip erkennt man an den ersten beiden Bytes; unkomprimiertes JSON geht auch.
        const text = raw[0] === 0x1f && raw[1] === 0x8b ? await gunzip(raw, { maxOutputLength: MAX_UNPACKED_BYTES }) : raw;
        parsed = JSON.parse(text.toString('utf8'));
      } catch {
        return reply.code(400).send({ error: 'Die Datei lässt sich nicht lesen' });
      }
      const file = fileSchema.safeParse(parsed);
      if (!file.success) {
        const issue = file.error.issues[0];
        const own = issue && ['format', 'version'].includes(String(issue.path[0]));
        return reply.code(400).send({ error: own ? issue.message : 'Die Datei ist beschädigt oder unvollständig' });
      }
      try {
        const id = await importPresentation(db, accountOf(request).id, file.data);
        return { id };
      } catch (err) {
        if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );
}
