import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { accountOf, requireHost } from './auth.ts';
import { one, type Db } from './db.ts';

/**
 * Zugriff auf Präsentationen samt Folien, Bildern und Durchführungen.
 *
 * Jede Präsentation gehört einem Konto (`user_id`). Der Eigentümer kann sie mit
 * anderen Konten teilen (`presentation_shares`):
 *   view  – ansehen, für sich duplizieren
 *   edit  – zusätzlich Folien bearbeiten
 *   host  – zusätzlich Durchführungen starten, steuern und das Archiv sehen
 *   owner – zusätzlich löschen, teilen, Branding wählen
 *
 * Ohne jeden Zugriff antworten Routen wie bei nicht vorhandenen Objekten (404),
 * damit sich nichts erraten lässt; mit zu kleiner Rolle 403.
 * Brandings bleiben Sache des eigenen Kontos.
 */

export const ROLES = ['view', 'edit', 'host', 'owner'] as const;
export type Role = (typeof ROLES)[number];
export type ShareRole = Exclude<Role, 'owner'>;
export const SHARE_ROLES = ['view', 'edit', 'host'] as const satisfies readonly ShareRole[];

const RANK: Record<Role, number> = { view: 1, edit: 2, host: 3, owner: 4 };
export const atLeast = (role: Role | null | undefined, min: Role) => !!role && RANK[role] >= RANK[min];

/** Wie die Präsentation zu einem Objekt gefunden wird */
const PRESENTATION_OF = {
  presentation: ['?', 'Präsentation nicht gefunden'],
  slide: ['(SELECT presentation_id FROM slides WHERE id = ?)', 'Folie nicht gefunden'],
  run: ['(SELECT presentation_id FROM runs WHERE id = ?)', 'Durchführung nicht gefunden'],
  asset: ['(SELECT presentation_id FROM assets WHERE public_id = ?)', 'Bild nicht gefunden'],
} as const;

export type AccessKind = keyof typeof PRESENTATION_OF;

export interface Access {
  presentationId: number;
  ownerId: number;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    access?: Access;
  }
}

/** Rolle eines Kontos für das Objekt – `null`, wenn es nicht existiert oder nicht geteilt ist. */
export async function accessTo(db: Db, kind: AccessKind, key: string | number, userId: number): Promise<Access | null> {
  const row = await one<{ id: number; user_id: number; role: ShareRole | null }>(
    db,
    `SELECT p.id, p.user_id, sh.role
       FROM presentations p
       LEFT JOIN presentation_shares sh ON sh.presentation_id = p.id AND sh.user_id = ?
      WHERE p.id = ${PRESENTATION_OF[kind][0]}`,
    [userId, key],
  );
  if (!row) return null;
  const role: Role | null = row.user_id === userId ? 'owner' : row.role;
  return role ? { presentationId: row.id, ownerId: row.user_id, role } : null;
}

export async function hasAccess(db: Db, kind: AccessKind, key: string | number, userId: number, min: Role): Promise<boolean> {
  return atLeast((await accessTo(db, kind, key, userId))?.role, min);
}

/**
 * preHandler: angemeldet und mindestens Rolle `min` für das Objekt aus dem
 * Pfad-Parameter `param`. Legt das Ergebnis in `request.access` ab.
 */
export function requireAccess(db: Db, kind: AccessKind, min: Role, param = 'id'): { preHandler: preHandlerAsyncHookHandler[] } {
  const check = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = (request.params as Record<string, string | undefined>)[param];
    const access = key ? await accessTo(db, kind, key, accountOf(request).id) : null;
    if (!access) return reply.code(404).send({ error: PRESENTATION_OF[kind][1] });
    if (!atLeast(access.role, min)) return reply.code(403).send({ error: 'Dafür fehlen dir die Rechte an dieser Präsentation' });
    request.access = access;
  };
  return { preHandler: [requireHost(db), check] };
}

export function accessOf(request: FastifyRequest): Access {
  if (!request.access) throw new Error('requireAccess fehlt');
  return request.access;
}

/** Brandings gehören immer genau einem Konto */
export async function ownsBrand(db: Db, brandId: number, userId: number): Promise<boolean> {
  return !!(await one<{ ok: number }>(db, 'SELECT 1 AS ok FROM brands WHERE id = ? AND user_id = ?', [brandId, userId]));
}

export function requireBrandOwner(db: Db, param = 'id'): { preHandler: preHandlerAsyncHookHandler[] } {
  const check = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = Number((request.params as Record<string, string | undefined>)[param]);
    if (!Number.isInteger(key) || !(await ownsBrand(db, key, accountOf(request).id))) {
      return reply.code(404).send({ error: 'Branding nicht gefunden' });
    }
  };
  return { preHandler: [requireHost(db), check] };
}
