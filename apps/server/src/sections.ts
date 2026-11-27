import { carrySections, sectionInput, type SectionChange } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accessOf, requireAccess } from './access.ts';
import { exec, one, query, type Conn, type Db } from './db.ts';
import { touchOf, touchPresentation, type EditHub } from './editing.ts';
import type { LiveHub } from './live.ts';

/**
 * Abschnitte der Folienliste (Spalte `slides.section`: Titel des Abschnitts, der
 * an dieser Folie beginnt). Gehört nicht zum `Slide`-Typ – erreicht nur Editor
 * und Steuerpult, nie Beamer oder Teilnehmende.
 */

/** Abschnittstitel je Folien-ID (nur Folien, an denen einer beginnt) */
export async function loadSections(db: Conn, presentationId: number): Promise<Map<number, string>> {
  const rows = await query<{ id: number; section: string }>(
    db,
    'SELECT id, section FROM slides WHERE presentation_id = ? AND section IS NOT NULL',
    [presentationId],
  );
  return new Map(rows.map((r) => [r.id, r.section]));
}

export async function applySections(conn: Conn, presentationId: number, changes: SectionChange[]) {
  for (const c of changes) {
    await exec(conn, 'UPDATE slides SET section = ? WHERE id = ? AND presentation_id = ?', [c.section, c.id, presentationId]);
  }
}

/**
 * Vor dem Löschen von Folien (in derselben Transaktion): Beginnt an einer
 * gelöschten Folie ein Abschnitt, übernimmt ihn die nächste verbleibende Folie
 * dieses Abschnitts – Abschnitte verschwinden nur mit ihrer letzten Folie.
 */
export async function keepSections(conn: Conn, presentationId: number, removed: number[]) {
  if (removed.length === 0) return;
  const order = await query<{ id: number; section: string | null }>(
    conn,
    'SELECT id, section FROM slides WHERE presentation_id = ? ORDER BY position, id FOR UPDATE',
    [presentationId],
  );
  await applySections(conn, presentationId, carrySections(order, removed));
}

/** Änderungen an Abschnitten zusammen mit der Reihenfolge (`PUT …/order`) */
export const sectionChanges = z.array(z.object({ id: z.number().int(), section: sectionInput })).max(1000);

export function sectionRoutes(app: FastifyInstance, db: Db, live: LiveHub, edits: EditHub) {
  const ownSlide = requireAccess(db, 'slide', 'edit');

  /** Abschnitt an dieser Folie beginnen, umbenennen oder entfernen (`null`/leer – die Folien bleiben) */
  app.put('/api/slides/:id/section', ownSlide, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const body = z.object({ section: sectionInput }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Ungültiger Abschnitt' });
    const slide = await one<{ section: string | null }>(db, 'SELECT section FROM slides WHERE id = ?', [id]);
    if (!slide) return reply.code(404).send({ error: 'Folie nicht gefunden' });
    if (slide.section !== body.data.section) {
      await exec(db, 'UPDATE slides SET section = ? WHERE id = ?', [body.data.section, id]);
      await touchPresentation(db, live, edits, accessOf(request).presentationId, touchOf(request), { structure: true });
    }
    return { section: body.data.section };
  });
}
