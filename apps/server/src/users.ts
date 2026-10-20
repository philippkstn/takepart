import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accountOf, createAccount, DUPLICATE_USERNAME, passwordInput, requireAdmin, usernameInput } from './auth.ts';
import { exec, isDuplicateKey, one, query, transaction, type Db } from './db.ts';
import type { LiveHub } from './live.ts';
import { hashPassword } from './password.ts';

/**
 * Kontoverwaltung für Admins: Konten anlegen (mit Startpasswort – Passkeys fügt
 * jedes Konto danach selbst hinzu), Passwort zurücksetzen, Admin-Recht, löschen.
 * Präsentationen sind privat: auch Admins sehen nur ihre eigenen.
 */

const idParam = z.object({ id: z.coerce.number().int() });

export function userRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  const admin = { preHandler: requireAdmin(db) };

  const countAdmins = async () => Number((await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'))?.n ?? 0);

  app.get('/api/users', admin, async () => {
    const rows = await query<{
      id: number;
      username: string;
      is_admin: number;
      has_password: number;
      passkeys: number;
      presentations: number;
      created_at: Date;
      last_login_at: Date | null;
    }>(
      db,
      `SELECT u.id, u.username, u.is_admin, (u.password_hash IS NOT NULL) AS has_password, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM credentials c WHERE c.user_id = u.id) AS passkeys,
              (SELECT COUNT(*) FROM presentations p WHERE p.user_id = u.id) AS presentations
         FROM users u ORDER BY u.username`,
    );
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      isAdmin: !!r.is_admin,
      hasPassword: !!r.has_password,
      passkeys: Number(r.passkeys),
      presentations: Number(r.presentations),
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    }));
  });

  app.post('/api/users', admin, async (request, reply) => {
    const body = z.object({ username: usernameInput, password: passwordInput, isAdmin: z.boolean().default(false) }).parse(request.body);
    const passwordHash = await hashPassword(body.password);
    try {
      const id = await transaction(db, (conn) => createAccount(conn, { username: body.username, passwordHash, isAdmin: body.isAdmin }));
      return { id };
    } catch (err) {
      if (isDuplicateKey(err)) return reply.code(409).send({ error: DUPLICATE_USERNAME });
      throw err;
    }
  });

  app.patch('/api/users/:id', admin, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ password: passwordInput.optional(), isAdmin: z.boolean().optional() }).parse(request.body);
    const user = await one<{ is_admin: number }>(db, 'SELECT is_admin FROM users WHERE id = ?', [id]);
    if (!user) return reply.code(404).send({ error: 'Konto nicht gefunden' });
    if (body.isAdmin === false && user.is_admin && (await countAdmins()) <= 1) {
      return reply.code(400).send({ error: 'Es muss mindestens einen Admin geben' });
    }
    if (body.isAdmin !== undefined) await exec(db, 'UPDATE users SET is_admin = ? WHERE id = ?', [body.isAdmin ? 1 : 0, id]);
    if (body.password !== undefined) {
      await exec(db, 'UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.password), id]);
      // Neues Passwort von außen: alle Sitzungen dieses Kontos beenden (die eigene bleibt).
      if (id !== accountOf(request).id) await exec(db, 'DELETE FROM host_sessions WHERE user_id = ?', [id]);
    }
    return { ok: true };
  });

  app.delete('/api/users/:id', admin, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (id === accountOf(request).id) return reply.code(400).send({ error: 'Das eigene Konto kann nicht gelöscht werden' });
    // Präsentationen, Durchführungen, Brandings, Passkeys und Sitzungen gehen per Fremdschlüssel mit.
    const runs = await query<{ id: number }>(
      db,
      'SELECT r.id FROM runs r JOIN presentations p ON p.id = r.presentation_id WHERE p.user_id = ? AND r.ended_at IS NULL',
      [id],
    );
    for (const r of runs) live.end(r.id);
    const result = await exec(db, 'DELETE FROM users WHERE id = ?', [id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Konto nicht gefunden' });
    return { ok: true };
  });
}
