import { brandInput, LOGO_MAX_BYTES, LOGO_TYPES, type BrandView } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireHost } from './auth.ts';
import { exec, one, query, type Db } from './db.ts';
import type { LiveHub } from './live.ts';

/**
 * Brandings: Name, Akzent- und Diagrammfarbe, optionales Logo. Eine Präsentation
 * kann eines haben (presentations.brand_id) – oder keines.
 *
 * Das Logo liegt als Datei in der Datenbank und wird über eine eigene URL
 * ausgeliefert, damit es nicht bei jedem Live-Update mitgeschickt wird.
 */

export interface BrandRow {
  brand_id: number | null;
  brand_name: string | null;
  brand_accent: string | null;
  brand_chart: string | null;
  brand_has_logo: number | null;
  brand_updated_at: Date | null;
}

/** SQL-Spalten für einen JOIN auf brands b */
export const BRAND_COLUMNS = `b.id AS brand_id, b.name AS brand_name, b.accent AS brand_accent, b.chart AS brand_chart,
  (b.logo IS NOT NULL) AS brand_has_logo, b.updated_at AS brand_updated_at`;

export function brandView(row: BrandRow): BrandView | null {
  if (!row.brand_id) return null;
  return {
    name: row.brand_name!,
    accent: row.brand_accent!,
    chart: row.brand_chart!,
    logoUrl: row.brand_has_logo ? `/api/brands/${row.brand_id}/logo?v=${row.brand_updated_at!.getTime()}` : null,
  };
}

const idParam = z.object({ id: z.coerce.number().int() });

export function brandRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  const host = { preHandler: requireHost(db) };

  /** Laufende Durchführungen mit diesem Branding neu zeichnen. */
  async function touch(brandId: number) {
    const runs = await query<{ id: number }>(
      db,
      'SELECT r.id FROM runs r JOIN presentations p ON p.id = r.presentation_id WHERE p.brand_id = ? AND r.ended_at IS NULL',
      [brandId],
    );
    for (const r of runs) live.notify(r.id, true);
  }

  app.get('/api/brands', host, async () => {
    const rows = await query<BrandRow & { used: number }>(
      db,
      `SELECT ${BRAND_COLUMNS}, (SELECT COUNT(*) FROM presentations p WHERE p.brand_id = b.id) AS used
         FROM brands b ORDER BY b.name`,
    );
    return rows.map((r) => ({ id: r.brand_id!, ...brandView(r)!, used: Number(r.used) }));
  });

  app.post('/api/brands', host, async (request) => {
    const body = brandInput.parse(request.body);
    const result = await exec(db, 'INSERT INTO brands (name, accent, chart) VALUES (?, ?, ?)', [body.name, body.accent, body.chart]);
    return { id: result.insertId };
  });

  app.patch('/api/brands/:id', host, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = brandInput.parse(request.body);
    await exec(db, 'UPDATE brands SET name = ?, accent = ?, chart = ? WHERE id = ?', [body.name, body.accent, body.chart, id]);
    await touch(id);
    return { ok: true };
  });

  app.delete('/api/brands/:id', host, async (request) => {
    const { id } = idParam.parse(request.params);
    const runs = await query<{ id: number }>(
      db,
      'SELECT r.id FROM runs r JOIN presentations p ON p.id = r.presentation_id WHERE p.brand_id = ? AND r.ended_at IS NULL',
      [id],
    );
    await exec(db, 'DELETE FROM brands WHERE id = ?', [id]);
    for (const r of runs) live.notify(r.id, true);
    return { ok: true };
  });

  // Logo als Data-URL (aus dem Dateiauswahl-Dialog), daher größeres Body-Limit nur hier.
  app.put('/api/brands/:id/logo', { ...host, bodyLimit: Math.ceil(LOGO_MAX_BYTES * 1.4) + 1024 }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { dataUrl } = z.object({ dataUrl: z.string() }).parse(request.body);
    const match = /^data:([a-z+/.-]+);base64,(.+)$/.exec(dataUrl);
    if (!match || !(LOGO_TYPES as readonly string[]).includes(match[1]!)) {
      return reply.code(400).send({ error: 'Bitte ein Logo als PNG, SVG, JPEG oder WebP hochladen' });
    }
    const data = Buffer.from(match[2]!, 'base64');
    if (data.length > LOGO_MAX_BYTES) return reply.code(400).send({ error: 'Das Logo ist zu groß (höchstens 512 KB)' });
    const result = await exec(db, 'UPDATE brands SET logo = ?, logo_type = ? WHERE id = ?', [data, match[1], id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Branding nicht gefunden' });
    await touch(id);
    return { ok: true };
  });

  app.delete('/api/brands/:id/logo', host, async (request) => {
    const { id } = idParam.parse(request.params);
    await exec(db, 'UPDATE brands SET logo = NULL, logo_type = NULL WHERE id = ?', [id]);
    await touch(id);
    return { ok: true };
  });

  /** Öffentlich: Beamer und Publikum laden das Logo. Die URL enthält eine Version, daher langes Caching. */
  app.get('/api/brands/:id/logo', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const row = await one<{ logo: Buffer | null; logo_type: string | null }>(db, 'SELECT logo, logo_type FROM brands WHERE id = ?', [id]);
    if (!row?.logo || !row.logo_type) return reply.code(404).send({ error: 'Kein Logo' });
    return (
      reply
        .header('Content-Type', row.logo_type)
        .header('Cache-Control', 'public, max-age=604800, immutable')
        // Ein SVG direkt aufgerufen darf kein Skript ausführen.
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(row.logo)
    );
  });
}
