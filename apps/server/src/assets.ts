import { randomBytes } from 'node:crypto';
import { assetId } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireHost } from './auth.ts';
import { exec, one, type Conn, type Db } from './db.ts';

/**
 * Bilder importierter Folien. Die Web-App rendert PDF-Seiten im Browser und lädt
 * jede Seite einzeln als WebP/JPEG/PNG hoch – auf dem Server läuft keine
 * PDF- oder Office-Software.
 *
 * Ausgeliefert wird über eine zufällige, nicht erratbare Kennung (public_id),
 * die zugleich die Zugriffskontrolle ist – wie beim Anzeige-Link. Beamer und
 * Handys der Teilnehmenden laden die Bilder ohne Anmeldung.
 */

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;

/** Bildformat an den ersten Bytes erkennen – der Content-Type allein reicht nicht. */
export function sniffImage(data: Buffer): (typeof IMAGE_TYPES)[number] | null {
  if (data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export const newPublicId = () => randomBytes(24).toString('base64url');

/** Bilder einer Präsentation entfernen, auf die keine Folie mehr verweist. */
export async function deleteOrphanAssets(conn: Conn, presentationId: number) {
  await exec(
    conn,
    `DELETE a FROM assets a
      WHERE a.presentation_id = ?
        AND a.created_at < UTC_TIMESTAMP(3) - INTERVAL 1 HOUR
        AND NOT EXISTS (
          SELECT 1 FROM slides s
           WHERE s.presentation_id = a.presentation_id AND s.type = 'image'
             AND JSON_VALUE(s.config, '$.asset') = a.public_id)`,
    [presentationId],
  );
}

/** Alle Bilder einer Präsentation in eine andere kopieren; liefert alte → neue Kennung. */
export async function copyAssets(conn: Conn, fromId: number, toId: number): Promise<Map<string, string>> {
  const rows = await conn.query<import('mysql2').RowDataPacket[]>('SELECT public_id FROM assets WHERE presentation_id = ?', [fromId]);
  const map = new Map<string, string>();
  for (const r of rows[0] as { public_id: string }[]) {
    const fresh = newPublicId();
    await exec(
      conn,
      `INSERT INTO assets (presentation_id, public_id, mime, width, height, data, thumb, thumb_mime)
       SELECT ?, ?, mime, width, height, data, thumb, thumb_mime FROM assets WHERE public_id = ?`,
      [toId, fresh, r.public_id],
    );
    map.set(r.public_id, fresh);
  }
  return map;
}

export function assetRoutes(app: FastifyInstance, db: Db) {
  const host = { preHandler: requireHost(db) };

  // Rohe Bilddaten als Body (nur für die Upload-Routen relevant; alle anderen erwarten JSON)
  app.addContentTypeParser([...IMAGE_TYPES], { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));

  const uploadQuery = z.object({ width: z.coerce.number().int().min(1).max(10000), height: z.coerce.number().int().min(1).max(10000) });

  app.post('/api/presentations/:id/assets', { ...host, bodyLimit: MAX_IMAGE_BYTES }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const { width, height } = uploadQuery.parse(request.query);
    const data = request.body;
    if (!Buffer.isBuffer(data)) return reply.code(415).send({ error: 'Bitte ein Bild (WebP, JPEG, PNG) senden' });
    const mime = sniffImage(data);
    if (!mime) return reply.code(415).send({ error: 'Unbekanntes Bildformat' });
    const pres = await one<{ id: number }>(db, 'SELECT id FROM presentations WHERE id = ?', [id]);
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    const publicId = newPublicId();
    await exec(db, 'INSERT INTO assets (presentation_id, public_id, mime, width, height, data) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      publicId,
      mime,
      width,
      height,
      data,
    ]);
    return { asset: publicId };
  });

  app.put('/api/assets/:asset/thumb', { ...host, bodyLimit: MAX_IMAGE_BYTES }, async (request, reply) => {
    const { asset } = z.object({ asset: assetId }).parse(request.params);
    const data = request.body;
    const mime = Buffer.isBuffer(data) ? sniffImage(data) : null;
    if (!Buffer.isBuffer(data) || !mime) return reply.code(415).send({ error: 'Unbekanntes Bildformat' });
    const result = await exec(db, 'UPDATE assets SET thumb = ?, thumb_mime = ? WHERE public_id = ?', [data, mime, asset]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Bild nicht gefunden' });
    return { ok: true };
  });

  const serve = (thumb: boolean) => async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const parsed = z.object({ asset: assetId }).safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: 'Nicht gefunden' });
    // Miniatur, falls vorhanden – sonst das volle Bild
    const row = await one<{ body: Buffer; type: string }>(
      db,
      thumb
        ? 'SELECT COALESCE(thumb, data) AS body, IF(thumb IS NULL, mime, thumb_mime) AS type FROM assets WHERE public_id = ?'
        : 'SELECT data AS body, mime AS type FROM assets WHERE public_id = ?',
      [parsed.data.asset],
    );
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    return reply
      .header('Content-Type', row.type)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .send(row.body);
  };
  app.get('/api/assets/:asset', serve(false));
  app.get('/api/assets/:asset/thumb', serve(true));
}
