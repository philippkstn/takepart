import { defaultConfig, parseConfig, SENTENCE_STARTERS, SLIDE_TYPES, type SlideType } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { requireHost } from './auth.ts';
import { BRAND_COLUMNS, brandView, type BrandRow } from './brands.ts';
import { exec, one, query, transaction, type Conn, type Db } from './db.ts';
import { DEMO_TITLE, insertDemoSlides } from './demo.ts';
import type { LiveHub } from './live.ts';
import { loadSlides } from './snapshot.ts';

const idParam = z.object({ id: z.coerce.number().int() });

/** Vorlage für eine neue Präsentation: Begrüßung mit Code, die beiden Satz-Spiele, Q&A, Feedback. */
const STARTER_SLIDES: { type: SlideType; config: unknown }[] = [
  { type: 'content', config: { title: 'Willkommen!', body: 'Mach mit – auf dem Handy oder im Browser.', showJoin: true } },
  ...SENTENCE_STARTERS.map((start) => ({ type: 'sentence' as const, config: { start } })),
  { type: 'qa', config: {} },
  { type: 'feedback', config: {} },
];

async function insertSlide(conn: Conn, presentationId: number, position: number, type: SlideType, config: unknown) {
  const parsed = parseConfig(type, config);
  return exec(conn, 'INSERT INTO slides (presentation_id, position, type, config) VALUES (?, ?, ?, ?)', [
    presentationId,
    position,
    type,
    JSON.stringify(parsed),
  ]);
}

export function presentationRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  const host = { preHandler: requireHost(db) };

  /** Laufende Durchführungen dieser Präsentation über Folienänderungen informieren. */
  async function touch(presentationId: number) {
    await exec(db, 'UPDATE presentations SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [presentationId]);
    const runs = await query<{ id: number }>(db, 'SELECT id FROM runs WHERE presentation_id = ? AND ended_at IS NULL', [presentationId]);
    for (const r of runs) live.notify(r.id, true);
  }

  app.get('/api/presentations', host, async () => {
    const rows = await query<{
      id: number;
      title: string;
      brand_name: string | null;
      updated_at: Date;
      slides: number;
      runs: number;
      live_run: number | null;
      live_code: string | null;
    }>(
      db,
      `SELECT p.id, p.title, p.updated_at, (SELECT b.name FROM brands b WHERE b.id = p.brand_id) AS brand_name,
              (SELECT COUNT(*) FROM slides s WHERE s.presentation_id = p.id) AS slides,
              (SELECT COUNT(*) FROM runs r WHERE r.presentation_id = p.id) AS runs,
              (SELECT r.id FROM runs r WHERE r.presentation_id = p.id AND r.ended_at IS NULL LIMIT 1) AS live_run,
              (SELECT r.code FROM runs r WHERE r.presentation_id = p.id AND r.ended_at IS NULL LIMIT 1) AS live_code
         FROM presentations p ORDER BY p.updated_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      brandName: r.brand_name,
      updatedAt: r.updated_at,
      slides: Number(r.slides),
      runs: Number(r.runs),
      liveRun: r.live_run ? { id: r.live_run, code: r.live_code } : null,
    }));
  });

  app.post('/api/presentations', host, async (request) => {
    const body = z.object({ title: z.string().trim().min(1).max(200), template: z.boolean().default(true) }).parse(request.body);
    const id = await transaction(db, async (conn) => {
      const result = await exec(conn, 'INSERT INTO presentations (title) VALUES (?)', [body.title]);
      if (body.template) {
        for (const [i, s] of STARTER_SLIDES.entries()) await insertSlide(conn, result.insertId, i, s.type, s.config);
      }
      return result.insertId;
    });
    return { id };
  });

  /** Neue Präsentation mit dem Demo-Foliensatz (alle Funktionen). */
  app.post('/api/presentations/demo', host, async () => {
    const id = await transaction(db, async (conn) => {
      const result = await exec(conn, 'INSERT INTO presentations (title) VALUES (?)', [DEMO_TITLE]);
      await insertDemoSlides(conn, result.insertId);
      return result.insertId;
    });
    return { id };
  });

  /** Demo-Folien in eine leere Präsentation laden. */
  app.post('/api/presentations/:id/demo-slides', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const pres = await one<{ id: number }>(db, 'SELECT id FROM presentations WHERE id = ?', [id]);
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    const added = await transaction(db, async (conn) => {
      const count = await one<{ n: number }>(conn, 'SELECT COUNT(*) AS n FROM slides WHERE presentation_id = ? FOR UPDATE', [id]);
      if (Number(count?.n ?? 0) > 0) return false;
      await insertDemoSlides(conn, id);
      return true;
    });
    if (!added) return reply.code(409).send({ error: 'Die Präsentation hat schon Folien' });
    await touch(id);
    return { ok: true };
  });

  app.get('/api/presentations/:id', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const pres = await one<BrandRow & { id: number; title: string; updated_at: Date }>(
      db,
      `SELECT p.id, p.title, p.updated_at, ${BRAND_COLUMNS}
         FROM presentations p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = ?`,
      [id],
    );
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    const liveRun = await one<{ id: number; code: string }>(
      db,
      'SELECT id, code FROM runs WHERE presentation_id = ? AND ended_at IS NULL LIMIT 1',
      [id],
    );
    return {
      id: pres.id,
      title: pres.title,
      brandId: pres.brand_id,
      brand: brandView(pres),
      updatedAt: pres.updated_at,
      slides: await loadSlides(db, id),
      liveRun: liveRun ?? null,
    };
  });

  app.patch('/api/presentations/:id', host, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ title: z.string().trim().min(1).max(200).optional(), brandId: z.number().int().nullable().optional() })
      .parse(request.body);
    if (body.title !== undefined) await exec(db, 'UPDATE presentations SET title = ? WHERE id = ?', [body.title, id]);
    if (body.brandId !== undefined) await exec(db, 'UPDATE presentations SET brand_id = ? WHERE id = ?', [body.brandId, id]);
    await touch(id);
    return { ok: true };
  });

  app.delete('/api/presentations/:id', host, async (request) => {
    const { id } = idParam.parse(request.params);
    const runs = await query<{ id: number }>(db, 'SELECT id FROM runs WHERE presentation_id = ?', [id]);
    for (const r of runs) live.end(r.id);
    await exec(db, 'DELETE FROM presentations WHERE id = ?', [id]);
    return { ok: true };
  });

  app.post('/api/presentations/:id/duplicate', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const pres = await one<{ title: string; brand_id: number | null }>(db, 'SELECT title, brand_id FROM presentations WHERE id = ?', [id]);
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    const slides = await loadSlides(db, id);
    const newId = await transaction(db, async (conn) => {
      const result = await exec(conn, 'INSERT INTO presentations (title, brand_id) VALUES (?, ?)', [
        `${pres.title} (Kopie)`.slice(0, 200),
        pres.brand_id,
      ]);
      for (const [i, s] of slides.entries()) await insertSlide(conn, result.insertId, i, s.type, s.config);
      return result.insertId;
    });
    return { id: newId };
  });

  app.post('/api/presentations/:id/slides', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ type: z.enum(SLIDE_TYPES), afterId: z.number().int().nullable().default(null), config: z.unknown().optional() })
      .parse(request.body);
    const pres = await one<{ id: number }>(db, 'SELECT id FROM presentations WHERE id = ?', [id]);
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });

    const slideId = await transaction(db, async (conn) => {
      const slides = await query<{ id: number }>(conn, 'SELECT id FROM slides WHERE presentation_id = ? ORDER BY position, id FOR UPDATE', [
        id,
      ]);
      const ids = slides.map((s) => s.id);
      const at = body.afterId === null ? ids.length : ids.indexOf(body.afterId) + 1 || ids.length;
      const result = await insertSlide(conn, id, at, body.type, body.config ?? defaultConfig(body.type));
      ids.splice(at, 0, result.insertId);
      for (const [i, sid] of ids.entries()) await exec(conn, 'UPDATE slides SET position = ? WHERE id = ?', [i, sid]);
      return result.insertId;
    });
    await touch(id);
    return { id: slideId };
  });

  app.patch('/api/slides/:id', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ config: z.unknown() }).parse(request.body);
    const slide = await one<{ presentation_id: number; type: SlideType }>(db, 'SELECT presentation_id, type FROM slides WHERE id = ?', [
      id,
    ]);
    if (!slide) return reply.code(404).send({ error: 'Folie nicht gefunden' });
    let config;
    try {
      config = parseConfig(slide.type, body.config);
    } catch (err) {
      const message = err instanceof ZodError ? err.issues[0]?.message : err instanceof Error ? err.message : null;
      return reply.code(400).send({ error: message || 'Ungültige Eingabe' });
    }
    await exec(db, 'UPDATE slides SET config = ? WHERE id = ?', [JSON.stringify(config), id]);
    await touch(slide.presentation_id);
    return { config };
  });

  app.delete('/api/slides/:id', host, async (request) => {
    const { id } = idParam.parse(request.params);
    const slide = await one<{ presentation_id: number }>(db, 'SELECT presentation_id FROM slides WHERE id = ?', [id]);
    if (!slide) return { ok: true };
    await exec(db, 'DELETE FROM slides WHERE id = ?', [id]);
    await touch(slide.presentation_id);
    return { ok: true };
  });

  app.post('/api/slides/:id/duplicate', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const slide = await one<{ presentation_id: number; type: SlideType; config: string }>(
      db,
      'SELECT presentation_id, type, config FROM slides WHERE id = ?',
      [id],
    );
    if (!slide) return reply.code(404).send({ error: 'Folie nicht gefunden' });
    const newId = await transaction(db, async (conn) => {
      const ids = (
        await query<{ id: number }>(conn, 'SELECT id FROM slides WHERE presentation_id = ? ORDER BY position, id FOR UPDATE', [
          slide.presentation_id,
        ])
      ).map((s) => s.id);
      const result = await insertSlide(conn, slide.presentation_id, 0, slide.type, JSON.parse(slide.config));
      ids.splice(ids.indexOf(id) + 1, 0, result.insertId);
      for (const [i, sid] of ids.entries()) await exec(conn, 'UPDATE slides SET position = ? WHERE id = ?', [i, sid]);
      return result.insertId;
    });
    await touch(slide.presentation_id);
    return { id: newId };
  });

  app.put('/api/presentations/:id/order', host, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ ids: z.array(z.number().int()) }).parse(request.body);
    const existing = (await query<{ id: number }>(db, 'SELECT id FROM slides WHERE presentation_id = ?', [id])).map((s) => s.id);
    if (existing.length !== body.ids.length || !body.ids.every((sid) => existing.includes(sid))) {
      return reply.code(400).send({ error: 'Folienliste passt nicht zur Präsentation' });
    }
    await transaction(db, async (conn) => {
      for (const [i, sid] of body.ids.entries()) await exec(conn, 'UPDATE slides SET position = ? WHERE id = ?', [i, sid]);
    });
    await touch(id);
    return { ok: true };
  });
}
