import { createHash } from 'node:crypto';
import { buildsConfig, parseConfig } from '@slides/shared';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAccess } from './access.ts';
import { exec, json, one, query, transaction, type Conn, type Db } from './db.ts';
import { touchOf, touchPresentation, type EditHub } from './editing.ts';
import type { LiveHub } from './live.ts';
import { insertSlide, renumber } from './presentations.ts';
import { keepSections } from './sections.ts';
import { snapshotVersion } from './versions.ts';

/**
 * Verknüpfung mit Google Slides über den Freigabelink („Jeder mit dem Link“).
 *
 * Der Server holt PDF und PPTX von Google (im Browser verhindert CORS das) und
 * erkennt Änderungen an der Prüfsumme des PDFs – das ist bei unverändertem
 * Foliensatz bytegleich, die PPTX nicht. Gerendert wird weiterhin im Browser
 * (keine PDF-Software auf dem Server): Editor und Steuerpult laden die Dateien
 * über `/source/file/…`, rendern wie beim Import und schicken das Ergebnis an
 * `/source/apply`. Der Hintergrund-Abgleich prüft nur und meldet „neue Fassung“.
 *
 * Nie während einer laufenden Durchführung (Bilder wechselten mitten im Vortrag).
 */

const FILE_ID = /^[A-Za-z0-9_-]{20,100}$/;
const MAX_BYTES = 150 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
const ALLOWED_HOSTS = (host: string) => host === 'docs.google.com' || host.endsWith('.googleusercontent.com');
/** Hintergrund-Prüfung höchstens so oft je Präsentation */
const CHECK_EVERY_MINUTES = 30;

export class SourceError extends Error {}

/** Google-Kennung aus einem Freigabe- oder Bearbeitungslink */
export function googleFileId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return FILE_ID.test(url.trim()) ? url.trim() : null;
  }
  if (parsed.hostname !== 'docs.google.com') return null;
  const m = /^\/presentation\/(?:u\/\d+\/)?d\/([^/]+)/.exec(parsed.pathname);
  if (!m || m[1] === 'e') return null;
  return FILE_ID.test(m[1]!) ? m[1]! : null;
}

export const googleUrl = (fileId: string) => `https://docs.google.com/presentation/d/${fileId}/edit`;

/** Export von Google holen – nur von Google-Hosts, mit Zeit- und Größengrenze */
export async function fetchGoogleExport(fileId: string, format: 'pdf' | 'pptx'): Promise<Buffer> {
  if (!FILE_ID.test(fileId)) throw new SourceError('Ungültige Google-Kennung');
  let url = `https://docs.google.com/presentation/d/${fileId}/export/${format}`;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop < 6; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'TakePart' } });
    } catch {
      throw new SourceError('Google Slides ist gerade nicht erreichbar');
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel();
      if (!next) throw new SourceError('Google Slides hat unerwartet geantwortet');
      const target = new URL(next, url);
      // Anmeldeseite statt Datei: nicht öffentlich geteilt
      if (target.hostname === 'accounts.google.com') throw notShared();
      if (target.protocol !== 'https:' || !ALLOWED_HOSTS(target.hostname)) throw new SourceError('Google Slides hat unerwartet umgeleitet');
      url = target.toString();
      continue;
    }
    if (res.status === 404) throw new SourceError('Diese Präsentation gibt es bei Google nicht (mehr). Bitte den Link prüfen.');
    if (res.status === 401 || res.status === 403) throw notShared();
    if (!res.ok || !res.body) throw new SourceError(`Google Slides antwortet mit Fehler ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw tooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_BYTES) throw tooLarge();
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    // Am Inhalt prüfen: nicht geteilte Präsentationen liefern oft eine HTML-Seite mit Status 200
    const ok = format === 'pdf' ? data.subarray(0, 5).toString('latin1') === '%PDF-' : data[0] === 0x50 && data[1] === 0x4b;
    if (!ok) throw notShared();
    return data;
  }
  throw new SourceError('Google Slides leitet zu oft um');
}

const notShared = () =>
  new SourceError(
    'Google gibt die Präsentation nicht heraus. Bitte in Google Slides unter „Freigeben“ „Jeder mit dem Link“ einstellen ' +
      '(und Herunterladen für Betrachter nicht sperren).',
  );
const tooLarge = () => new SourceError('Die Präsentation ist zu groß (höchstens 150 MB)');

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

interface SourceRow {
  kind: string;
  file_id: string;
  auto_sync: number;
  synced_hash: string | null;
  synced_at: Date | null;
  remote_hash: string | null;
  checked_at: Date | null;
  error: string | null;
}

export interface SourceInfo {
  kind: 'google';
  url: string;
  autoSync: boolean;
  syncedHash: string | null;
  syncedAt: Date | null;
  checkedAt: Date | null;
  /** Seit dem letzten Abgleich hat sich bei Google etwas geändert (oder es gab noch keinen) */
  changed: boolean;
  error: string | null;
}

export async function sourceInfo(db: Conn, presentationId: number): Promise<SourceInfo | null> {
  const row = await one<SourceRow>(db, 'SELECT * FROM presentation_sources WHERE presentation_id = ?', [presentationId]);
  if (!row) return null;
  return {
    kind: 'google',
    url: googleUrl(row.file_id),
    autoSync: !!row.auto_sync,
    syncedHash: row.synced_hash,
    syncedAt: row.synced_at,
    checkedAt: row.checked_at,
    changed: !row.synced_hash || (!!row.remote_hash && row.remote_hash !== row.synced_hash),
    error: row.error,
  };
}

/** Bei Google nachsehen, ob sich etwas geändert hat; speichert Prüfsumme bzw. Fehler */
async function checkSource(db: Db, presentationId: number): Promise<{ changed: boolean; error: string | null } | null> {
  const row = await one<SourceRow>(db, 'SELECT * FROM presentation_sources WHERE presentation_id = ?', [presentationId]);
  if (!row) return null;
  try {
    const hash = sha256(await fetchGoogleExport(row.file_id, 'pdf'));
    await exec(
      db,
      'UPDATE presentation_sources SET remote_hash = ?, checked_at = UTC_TIMESTAMP(3), error = NULL WHERE presentation_id = ?',
      [hash, presentationId],
    );
    return { changed: hash !== row.synced_hash, error: null };
  } catch (err) {
    const message = err instanceof SourceError ? err.message : 'Abruf bei Google fehlgeschlagen';
    await exec(db, 'UPDATE presentation_sources SET checked_at = UTC_TIMESTAMP(3), error = ? WHERE presentation_id = ?', [
      message.slice(0, 300),
      presentationId,
    ]);
    return { changed: false, error: message };
  }
}

/**
 * Hintergrund: verknüpfte Präsentationen mit automatischem Abgleich, die in den
 * letzten 60 Tagen bearbeitet oder durchgeführt wurden, alle CHECK_EVERY_MINUTES
 * prüfen. Meldet offenen Editoren, wenn es eine neue Fassung gibt.
 */
export async function checkSources(db: Db, edits: EditHub, log: FastifyBaseLogger): Promise<void> {
  const due = await query<{ presentation_id: number; remote_hash: string | null }>(
    db,
    `SELECT s.presentation_id, s.remote_hash FROM presentation_sources s JOIN presentations p ON p.id = s.presentation_id
      WHERE s.auto_sync = 1
        AND (s.checked_at IS NULL OR s.checked_at < UTC_TIMESTAMP(3) - INTERVAL ${CHECK_EVERY_MINUTES} MINUTE)
        AND p.updated_at > UTC_TIMESTAMP(3) - INTERVAL 60 DAY
      ORDER BY s.checked_at IS NOT NULL, s.checked_at
      LIMIT 10`,
  );
  for (const s of due) {
    const result = await checkSource(db, s.presentation_id).catch((err: unknown) => {
      log.warn({ err }, 'Google-Abgleich fehlgeschlagen');
      return null;
    });
    if (result?.changed) edits.changed(s.presentation_id, { by: null, who: null, source: true, slides: [] });
  }
}

const applyItem = z.object({
  asset: z.string(),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
  title: z.string().max(200).default(''),
  notes: z.string().max(20000).default(''),
  builds: buildsConfig.optional(),
  sourceKey: z.string().max(100).nullable().default(null),
  /** Prüfsumme des gerenderten Seitenbilds samt Notizen (vom Browser) */
  pageHash: z.string().length(64).nullable().default(null),
});

export function googleRoutes(app: FastifyInstance, db: Db, live: LiveHub, edits: EditHub) {
  const edit = requireAccess(db, 'presentation', 'edit');
  const idParam = z.object({ id: z.coerce.number().int() });
  const notify = (request: Parameters<typeof touchOf>[0], id: number) =>
    edits.changed(id, { by: touchOf(request).client, who: touchOf(request).username, source: true, slides: [] });

  /** Verknüpfen (oder Link ändern) – prüft gleich, ob Google die Präsentation herausgibt */
  app.put('/api/presentations/:id/source', edit, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ url: z.string().trim().min(1).max(500), autoSync: z.boolean().default(true) }).parse(request.body);
    const fileId = googleFileId(body.url);
    if (!fileId) {
      return reply.code(400).send({
        error:
          'Das ist kein Link auf eine Google-Slides-Präsentation (docs.google.com/presentation/d/…). Veröffentlichte Links (/d/e/…) funktionieren nicht.',
      });
    }
    let hash: string;
    try {
      hash = sha256(await fetchGoogleExport(fileId, 'pdf'));
    } catch (err) {
      if (err instanceof SourceError) return reply.code(422).send({ error: err.message });
      throw err;
    }
    const previous = await one<{ file_id: string }>(db, 'SELECT file_id FROM presentation_sources WHERE presentation_id = ?', [id]);
    await exec(
      db,
      `INSERT INTO presentation_sources (presentation_id, kind, file_id, auto_sync, remote_hash, checked_at)
       VALUES (?, 'google', ?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE kind = 'google', file_id = VALUES(file_id), auto_sync = VALUES(auto_sync),
         remote_hash = VALUES(remote_hash), checked_at = VALUES(checked_at), error = NULL,
         synced_hash = IF(file_id = VALUES(file_id), synced_hash, NULL)`,
      [id, fileId, body.autoSync ? 1 : 0, hash],
    );
    // Andere Präsentation verknüpft: alte Kennungen passen nicht mehr
    if (previous && previous.file_id !== fileId) await exec(db, 'UPDATE slides SET source_key = NULL WHERE presentation_id = ?', [id]);
    notify(request, id);
    return sourceInfo(db, id);
  });

  app.patch('/api/presentations/:id/source', edit, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { autoSync } = z.object({ autoSync: z.boolean() }).parse(request.body);
    const result = await exec(db, 'UPDATE presentation_sources SET auto_sync = ? WHERE presentation_id = ?', [autoSync ? 1 : 0, id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Keine Verknüpfung' });
    notify(request, id);
    return sourceInfo(db, id);
  });

  /** Verknüpfung lösen – die Folien bleiben */
  app.delete('/api/presentations/:id/source', edit, async (request) => {
    const { id } = idParam.parse(request.params);
    await exec(db, 'DELETE FROM presentation_sources WHERE presentation_id = ?', [id]);
    await exec(db, 'UPDATE slides SET source_key = NULL WHERE presentation_id = ?', [id]);
    notify(request, id);
    return { ok: true };
  });

  app.post(
    '/api/presentations/:id/source/check',
    { ...edit, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const result = await checkSource(db, id);
      if (!result) return reply.code(404).send({ error: 'Keine Verknüpfung' });
      notify(request, id);
      return sourceInfo(db, id);
    },
  );

  /** PDF oder PPTX für den Abgleich im Browser; die Prüfsumme des PDFs steht im Header */
  app.get(
    '/api/presentations/:id/source/file/:format',
    { ...edit, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id, format } = z.object({ id: z.coerce.number().int(), format: z.enum(['pdf', 'pptx']) }).parse(request.params);
      const row = await one<{ file_id: string }>(db, 'SELECT file_id FROM presentation_sources WHERE presentation_id = ?', [id]);
      if (!row) return reply.code(404).send({ error: 'Keine Verknüpfung' });
      let data: Buffer;
      try {
        data = await fetchGoogleExport(row.file_id, format);
      } catch (err) {
        if (err instanceof SourceError) return reply.code(422).send({ error: err.message });
        throw err;
      }
      if (format === 'pdf') {
        reply.header('X-Source-Hash', sha256(data));
        await exec(
          db,
          'UPDATE presentation_sources SET remote_hash = ?, checked_at = UTC_TIMESTAMP(3), error = NULL WHERE presentation_id = ?',
          [sha256(data), id],
        );
      }
      return reply
        .header('Cache-Control', 'no-store')
        .type(format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        .send(data);
    },
  );

  /**
   * Ergebnis des Abgleichs anwenden (alles oder nichts). `baseHash` ist der Stand,
   * von dem der Browser ausging – hat inzwischen jemand anderes abgeglichen, 409.
   * Entfernt werden nur Bildfolien ohne Ergebnisse; die übrigen bleiben und werden gemeldet.
   */
  app.post('/api/presentations/:id/source/apply', { ...edit, bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        baseHash: z.string().length(64).nullable(),
        hash: z.string().length(64),
        replace: z.array(applyItem.extend({ slideId: z.number().int() })).max(300),
        /** Unveränderte Seiten: nur Kennung nachtragen (z. B. beim ersten Verknüpfen) */
        keys: z
          .array(z.object({ slideId: z.number().int(), sourceKey: z.string().max(100).nullable() }))
          .max(300)
          .default([]),
        insert: z
          .array(
            applyItem.extend({
              before: z.number().int().optional(),
              after: z.number().int().optional(),
            }),
          )
          .max(300),
        remove: z.array(z.number().int()).max(300),
      })
      .parse(request.body);

    const live_ = await one<{ id: number }>(
      db,
      'SELECT id FROM runs WHERE presentation_id = ? AND ended_at IS NULL AND rehearsal = 0 LIMIT 1',
      [id],
    );
    if (live_) return reply.code(409).send({ error: 'Während einer Durchführung wird nicht abgeglichen – danach wieder' });

    const assets = new Set(
      (await query<{ public_id: string }>(db, 'SELECT public_id FROM assets WHERE presentation_id = ?', [id])).map((r) => r.public_id),
    );
    if (
      [...body.replace, ...body.insert].some((it) => !assets.has(it.asset) || (it.builds?.startImage && !assets.has(it.builds.startImage)))
    ) {
      return reply.code(400).send({ error: 'Unbekanntes Folienbild' });
    }

    const current = await one<{ synced_hash: string | null }>(
      db,
      'SELECT synced_hash FROM presentation_sources WHERE presentation_id = ?',
      [id],
    );
    if (!current) return reply.code(404).send({ error: 'Keine Verknüpfung' });
    if (current.synced_hash !== body.baseHash) {
      return reply.code(409).send({ error: 'Die Präsentation wurde gerade schon abgeglichen' });
    }
    // Version nur, wenn sich an den Folien etwas ändert
    if (body.replace.length + body.insert.length + body.remove.length + body.keys.length > 0) {
      await snapshotVersion(db, id, 'google', touchOf(request));
    }

    type Result = { kept: number[] } | { error: string; status: number };
    const result = await transaction(db, async (conn: Conn): Promise<Result> => {
      // Erneut unter Sperre prüfen: zwei Editoren könnten gleichzeitig abgleichen
      const locked = await one<{ synced_hash: string | null }>(
        conn,
        'SELECT synced_hash FROM presentation_sources WHERE presentation_id = ? FOR UPDATE',
        [id],
      );
      if (!locked || locked.synced_hash !== body.baseHash) return { error: 'Die Präsentation wurde gerade schon abgeglichen', status: 409 };
      const rows = await query<{ id: number; type: string; config: string }>(
        conn,
        'SELECT id, type, config FROM slides WHERE presentation_id = ? ORDER BY position, id FOR UPDATE',
        [id],
      );
      const images = new Map(rows.filter((r) => r.type === 'image').map((r) => [r.id, json<Record<string, unknown>>(r.config)]));
      if ([...body.replace.map((r) => r.slideId), ...body.keys.map((k) => k.slideId), ...body.remove].some((sid) => !images.has(sid))) {
        return { error: 'Die Folien haben sich inzwischen geändert – bitte erneut abgleichen', status: 409 };
      }

      for (const it of body.replace) {
        const config = parseConfig('image', {
          ...images.get(it.slideId)!,
          asset: it.asset,
          width: it.width,
          height: it.height,
          title: it.title.trim().slice(0, 200),
          builds: it.builds,
        });
        // Google ist die Quelle: Notizen kommen von dort, sobald dort welche stehen
        await exec(
          conn,
          `UPDATE slides SET config = ?, source_key = ?, source_hash = ?, notes = IF(? = '', notes, ?), rev = rev + 1 WHERE id = ?`,
          [JSON.stringify(config), it.sourceKey, it.pageHash, it.notes, it.notes, it.slideId],
        );
      }

      for (const k of body.keys) await exec(conn, 'UPDATE slides SET source_key = ? WHERE id = ?', [k.sourceKey, k.slideId]);

      // Löschen nur ohne Ergebnisse
      const withResults = new Set(
        body.remove.length === 0
          ? []
          : (
              await query<{ slide_id: number }>(
                conn,
                `SELECT slide_id FROM run_notes WHERE slide_id IN (?)
                 UNION SELECT slide_id FROM responses WHERE slide_id IN (?)
                 UNION SELECT slide_id FROM posts WHERE slide_id IN (?)`,
                [body.remove, body.remove, body.remove],
              )
            ).map((r) => r.slide_id),
      );
      const drop = body.remove.filter((sid) => !withResults.has(sid));
      if (drop.length > 0) {
        // Abschnitte gehen an die nächste verbleibende Folie, statt mit der Google-Seite zu verschwinden
        await keepSections(conn, id, drop);
        await exec(conn, 'DELETE FROM slides WHERE id IN (?)', [drop]);
      }

      const order = rows.map((r) => r.id).filter((sid) => !drop.includes(sid));
      const lastAfter = new Map<number, number>();
      for (const it of body.insert) {
        const created = await insertSlide(
          conn,
          id,
          0,
          'image',
          { asset: it.asset, width: it.width, height: it.height, title: it.title.trim().slice(0, 200), builds: it.builds },
          it.notes,
        );
        const newId = created.insertId;
        await exec(conn, 'UPDATE slides SET source_key = ?, source_hash = ? WHERE id = ?', [it.sourceKey, it.pageHash, newId]);
        let at = order.length;
        if (it.before !== undefined && order.includes(it.before)) at = order.indexOf(it.before);
        else if (it.after !== undefined && order.includes(it.after)) {
          // Mehrere Seiten hinter derselben Folie bleiben in ihrer Reihenfolge
          const anchor = lastAfter.get(it.after) ?? it.after;
          at = order.indexOf(anchor) + 1;
          lastAfter.set(it.after, newId);
        }
        order.splice(at, 0, newId);
      }
      await renumber(conn, order);
      await exec(
        conn,
        'UPDATE presentation_sources SET synced_hash = ?, synced_at = UTC_TIMESTAMP(3), error = NULL WHERE presentation_id = ?',
        [body.hash, id],
      );
      return { kept: [...withResults] };
    });
    if ('error' in result) return reply.code(result.status).send({ error: result.error });
    await touchPresentation(db, live, edits, id, touchOf(request), { structure: true, source: true });
    return { ok: true, kept: result.kept, source: await sourceInfo(db, id) };
  });
}
