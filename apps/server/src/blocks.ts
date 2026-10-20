import { customBlockInput, parseConfig, type BatchSlide, type CustomBlock } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { accountOf, requireHost } from './auth.ts';
import { exec, json, one, query, type Db } from './db.ts';

/**
 * Eigene Übungsbausteine je Konto: gespeicherte Folienfolgen (Typ, Konfiguration,
 * Notizen), die der Editor wie die eingebauten Bausteine einfügt. Die Folien
 * werden beim Speichern mit `parseConfig` geprüft – Bild-Folien sind nicht erlaubt.
 */
const MAX_BLOCKS_PER_ACCOUNT = 100;

export function blockRoutes(app: FastifyInstance, db: Db) {
  const host = { preHandler: requireHost(db) };

  app.get('/api/blocks', host, async (request) => {
    const rows = await query<{ id: number; name: string; slides: string }>(
      db,
      'SELECT id, name, slides FROM blocks WHERE user_id = ? ORDER BY name, id',
      [accountOf(request).id],
    );
    return rows.map((r): CustomBlock => ({ id: r.id, name: r.name, slides: json<BatchSlide[]>(r.slides) }));
  });

  app.post('/api/blocks', { ...host, bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const body = customBlockInput.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    let slides: BatchSlide[];
    try {
      slides = body.data.slides.map((s) => ({ type: s.type, config: parseConfig(s.type, s.config ?? {}), notes: s.notes }));
    } catch (err) {
      const message = err instanceof ZodError ? err.issues[0]?.message : err instanceof Error ? err.message : null;
      return reply.code(400).send({ error: message || 'Ungültige Folie' });
    }
    const userId = accountOf(request).id;
    const count = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM blocks WHERE user_id = ?', [userId]);
    if (Number(count?.n ?? 0) >= MAX_BLOCKS_PER_ACCOUNT)
      return reply.code(409).send({ error: `Höchstens ${MAX_BLOCKS_PER_ACCOUNT} eigene Bausteine` });
    const result = await exec(db, 'INSERT INTO blocks (user_id, name, slides) VALUES (?, ?, ?)', [
      userId,
      body.data.name,
      JSON.stringify(slides),
    ]);
    return { id: result.insertId };
  });

  app.delete('/api/blocks/:id', host, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const result = await exec(db, 'DELETE FROM blocks WHERE id = ? AND user_id = ?', [id, accountOf(request).id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Baustein nicht gefunden' });
    return { ok: true };
  });
}
