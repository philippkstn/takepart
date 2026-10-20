import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { accountOf, requireHost } from './auth.ts';
import { one, type Db } from './db.ts';

/**
 * Jedes Konto sieht und ändert nur seine eigenen Präsentationen samt Folien,
 * Bildern und Durchführungen – und nur seine eigenen Brandings. Fremde Objekte
 * antworten wie nicht vorhandene (404), damit sich nichts erraten lässt.
 */

const OWNED = {
  presentation: ['SELECT 1 AS ok FROM presentations WHERE id = ? AND user_id = ?', 'Präsentation nicht gefunden'],
  slide: [
    'SELECT 1 AS ok FROM slides s JOIN presentations p ON p.id = s.presentation_id WHERE s.id = ? AND p.user_id = ?',
    'Folie nicht gefunden',
  ],
  run: [
    'SELECT 1 AS ok FROM runs r JOIN presentations p ON p.id = r.presentation_id WHERE r.id = ? AND p.user_id = ?',
    'Durchführung nicht gefunden',
  ],
  asset: [
    'SELECT 1 AS ok FROM assets a JOIN presentations p ON p.id = a.presentation_id WHERE a.public_id = ? AND p.user_id = ?',
    'Bild nicht gefunden',
  ],
  brand: ['SELECT 1 AS ok FROM brands WHERE id = ? AND user_id = ?', 'Branding nicht gefunden'],
} as const;

export type OwnedKind = keyof typeof OWNED;

export async function owns(db: Db, kind: OwnedKind, key: string | number, userId: number): Promise<boolean> {
  return !!(await one<{ ok: number }>(db, OWNED[kind][0], [key, userId]));
}

/** preHandler: angemeldet und Eigentümer des Objekts aus dem Pfad-Parameter `param` */
export function requireOwner(db: Db, kind: OwnedKind, param = 'id'): { preHandler: preHandlerAsyncHookHandler[] } {
  const check = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = (request.params as Record<string, string | undefined>)[param];
    if (!key || !(await owns(db, kind, key, accountOf(request).id))) {
      return reply.code(404).send({ error: OWNED[kind][1] });
    }
  };
  return { preHandler: [requireHost(db), check] };
}
