import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOwner } from './access.ts';
import { exec, one, query, type Conn, type Db } from './db.ts';

/**
 * Protokollnotizen der Moderation: je Durchführung und Folie, geschrieben live im
 * Steuerpult oder danach im Archiv/Fotoprotokoll. Getrennt von den vorbereiteten
 * Sprechernotizen (`slides.notes`). Sie erscheinen nur im Archiv, im
 * Fotoprotokoll und im geteilten Fotoprotokoll – nie bei Beamer oder Publikum,
 * deshalb ist auch kein `live.notify` nötig.
 */

export const MAX_NOTE_LENGTH = 10000;

export async function loadRunNotes(db: Conn, runId: number): Promise<Map<number, string>> {
  const rows = await query<{ slide_id: number; text: string }>(db, 'SELECT slide_id, text FROM run_notes WHERE run_id = ?', [runId]);
  return new Map(rows.map((r) => [r.slide_id, r.text]));
}

/** Notiz speichern; leerer Text löscht sie. */
export async function saveRunNote(db: Conn, runId: number, slideId: number, text: string) {
  const value = text.trim() ? text.replace(/\s+$/, '') : '';
  if (!value) {
    await exec(db, 'DELETE FROM run_notes WHERE run_id = ? AND slide_id = ?', [runId, slideId]);
    return;
  }
  await exec(
    db,
    `INSERT INTO run_notes (run_id, slide_id, text) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE text = VALUES(text)`,
    [runId, slideId, value],
  );
}

export function noteRoutes(app: FastifyInstance, db: Db) {
  const ownRun = requireOwner(db, 'run');

  app.get('/api/runs/:id/notes', ownRun, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    return Object.fromEntries(await loadRunNotes(db, id));
  });

  // Auch nach dem Ende der Durchführung erlaubt – das Protokoll entsteht oft danach.
  app.put('/api/runs/:id/notes/:slideId', ownRun, async (request, reply) => {
    const { id, slideId } = z.object({ id: z.coerce.number().int(), slideId: z.coerce.number().int() }).parse(request.params);
    const { text } = z.object({ text: z.string().max(MAX_NOTE_LENGTH) }).parse(request.body);
    const slide = await one<{ id: number }>(
      db,
      'SELECT s.id FROM slides s JOIN runs r ON r.presentation_id = s.presentation_id WHERE s.id = ? AND r.id = ?',
      [slideId, id],
    );
    if (!slide) return reply.code(404).send({ error: 'Folie nicht gefunden' });
    await saveRunNote(db, id, slideId, text);
    return { ok: true };
  });
}
