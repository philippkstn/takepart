import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accessTo, requireAccess, SHARE_ROLES } from './access.ts';
import { accountOf, requireHost } from './auth.ts';
import { exec, one, query, type Db } from './db.ts';
import type { EditHub } from './editing.ts';

/**
 * Präsentationen mit anderen Konten derselben Installation teilen (per
 * Benutzername). Nur der Eigentümer vergibt und entzieht Rollen; wer eine
 * geteilte Präsentation hat, kann sie selbst wieder abgeben.
 */
export function shareRoutes(app: FastifyInstance, db: Db, edits: EditHub) {
  const owner = requireAccess(db, 'presentation', 'owner');
  const idParam = z.object({ id: z.coerce.number().int() });

  app.get('/api/presentations/:id/shares', owner, async (request) => {
    const { id } = idParam.parse(request.params);
    const rows = await query<{ user_id: number; username: string; role: (typeof SHARE_ROLES)[number]; created_at: Date }>(
      db,
      `SELECT sh.user_id, u.username, sh.role, sh.created_at
         FROM presentation_shares sh JOIN users u ON u.id = sh.user_id
        WHERE sh.presentation_id = ? ORDER BY u.username`,
      [id],
    );
    return rows.map((r) => ({ userId: r.user_id, username: r.username, role: r.role, since: r.created_at }));
  });

  app.put('/api/presentations/:id/shares', owner, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ username: z.string().trim().min(1).max(100), role: z.enum(SHARE_ROLES) }).parse(request.body);
    const user = await one<{ id: number; username: string }>(db, 'SELECT id, username FROM users WHERE username = ?', [body.username]);
    if (!user) return reply.code(404).send({ error: 'Kein Konto mit diesem Benutzernamen. Bitte die Schreibweise prüfen.' });
    if (user.id === accountOf(request).id) return reply.code(400).send({ error: 'Die Präsentation gehört dir schon' });
    await exec(
      db,
      `INSERT INTO presentation_shares (presentation_id, user_id, role) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      [id, user.id, body.role],
    );
    // Offene Editoren der Person laden ihre Rechte neu
    edits.changed(id, { by: null, who: null, slides: [] });
    return { userId: user.id, username: user.username, role: body.role };
  });

  /** Freigabe entziehen – durch den Eigentümer oder die Person selbst („Nicht mehr teilen“) */
  app.delete('/api/presentations/:id/shares/:userId', { preHandler: requireHost(db) }, async (request, reply) => {
    const params = z
      .object({ id: z.coerce.number().int(), userId: z.union([z.literal('me'), z.coerce.number().int()]) })
      .parse(request.params);
    const me = accountOf(request).id;
    const { id } = params;
    const userId = params.userId === 'me' ? me : params.userId;
    const access = await accessTo(db, 'presentation', id, me);
    if (!access) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    if (access.role !== 'owner' && userId !== me)
      return reply.code(403).send({ error: 'Freigaben verwaltet nur, wem die Präsentation gehört' });
    await exec(db, 'DELETE FROM presentation_shares WHERE presentation_id = ? AND user_id = ?', [id, userId]);
    edits.revoke(id, userId);
    return { ok: true };
  });
}
