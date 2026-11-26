import { EDIT_CLIENT_PATTERN, type EditChange, type EditorPresence, type EditorServerMessage } from '@slides/shared';
import type { FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { exec, query, type Db } from './db.ts';
import type { LiveHub } from './live.ts';

/**
 * Gemeinsames Bearbeiten: Jeder offene Editor hält einen WebSocket
 * (`/ws?editor=<Präsentation>`). Darüber kommen nur Hinweise („Folie 12 hat sich
 * geändert“, wer gerade wo ist) – die Inhalte lädt der Editor per REST neu.
 * Anwesenheit ist flüchtig (nur an der Verbindung), wie die Live-Verbindungen.
 */

interface EditClient {
  ws: WebSocket;
  /** Kennung des Browser-Tabs (auch als Header `X-Edit-Client` bei REST-Aufrufen) */
  id: string;
  userId: number;
  name: string;
  slideId: number | null;
  alive?: boolean;
}

const MAX_EDITORS_PER_PRESENTATION = 50;
const PING_MS = 25_000;

export class EditHub {
  private rooms = new Map<number, Set<EditClient>>();
  /** Wie in `LiveHub`: hält Verbindungen hinter Proxys offen und räumt schlafende Laptops ab (sonst bliebe ihre Anwesenheit stehen) */
  private pinger = setInterval(() => {
    for (const room of this.rooms.values()) {
      for (const c of room) {
        if (c.alive === false) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }
  }, PING_MS);

  constructor() {
    this.pinger.unref();
  }

  attach(presentationId: number, client: EditClient): boolean {
    let room = this.rooms.get(presentationId);
    if (!room) {
      room = new Set();
      this.rooms.set(presentationId, room);
    }
    if (room.size >= MAX_EDITORS_PER_PRESENTATION) return false;
    room.add(client);
    client.alive = true;
    client.ws.on('pong', () => {
      client.alive = true;
    });
    client.ws.on('close', () => {
      room.delete(client);
      if (room.size === 0) this.rooms.delete(presentationId);
      else this.presence(presentationId);
    });
    client.ws.on('message', (raw: unknown) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: unknown; slideId?: unknown };
        if (msg.type !== 'focus') return;
        const slideId = typeof msg.slideId === 'number' && Number.isInteger(msg.slideId) ? msg.slideId : null;
        if (slideId === client.slideId) return;
        client.slideId = slideId;
        this.presence(presentationId);
      } catch {
        // Unlesbares ignorieren
      }
    });
    this.presence(presentationId);
    return true;
  }

  private send(client: EditClient, msg: EditorServerMessage) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  }

  private presence(presentationId: number) {
    const room = this.rooms.get(presentationId);
    if (!room) return;
    const editors: EditorPresence[] = [...room].map((c) => ({ id: c.id, name: c.name, slideId: c.slideId }));
    for (const c of room) this.send(c, { type: 'presence', editors, self: c.id });
  }

  changed(presentationId: number, change: EditChange) {
    const room = this.rooms.get(presentationId);
    if (!room) return;
    const msg = JSON.stringify({ type: 'changed', ...change } satisfies EditorServerMessage);
    for (const c of room) if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
  }

  /** Zugriff entzogen (Freigabe gelöscht) oder Präsentation gelöscht: Editoren schließen */
  revoke(presentationId: number, userId?: number) {
    const room = this.rooms.get(presentationId);
    if (!room) return;
    for (const c of room) {
      if (userId !== undefined && c.userId !== userId) continue;
      this.send(c, { type: 'gone' });
      c.ws.close(4004, 'Kein Zugriff mehr');
    }
  }

  close() {
    clearInterval(this.pinger);
    for (const room of this.rooms.values()) for (const c of room) c.ws.close(1001, 'Server fährt herunter');
    this.rooms.clear();
  }
}

/** Tab-Kennung aus dem Header (für „das war ich selbst“) */
export function editClientOf(request: FastifyRequest): string | null {
  const raw = request.headers['x-edit-client'];
  return typeof raw === 'string' && EDIT_CLIENT_PATTERN.test(raw) ? raw : null;
}

export interface Touch {
  /** Bearbeitende Person – `null` bei Änderungen ohne Konto (z. B. Hintergrund-Abgleich) */
  userId: number | null;
  username: string | null;
  client: string | null;
}

export function touchOf(request: FastifyRequest): Touch {
  return { userId: request.account?.id ?? null, username: request.account?.username ?? null, client: editClientOf(request) };
}

/**
 * Nach jeder inhaltlichen Änderung einer Präsentation: Zeitstempel setzen, merken
 * wer bearbeitet (für die nächste Version), laufende Durchführungen und offene
 * Editoren benachrichtigen.
 */
export async function touchPresentation(
  db: Db,
  live: LiveHub,
  edits: EditHub,
  presentationId: number,
  who: Touch,
  change: Omit<EditChange, 'by' | 'who'> = {},
) {
  await exec(db, 'UPDATE presentations SET updated_at = UTC_TIMESTAMP(3), edited_at = UTC_TIMESTAMP(3) WHERE id = ?', [presentationId]);
  if (who.userId !== null) {
    await exec(
      db,
      `INSERT INTO presentation_edits (presentation_id, user_id, edited_at) VALUES (?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE edited_at = VALUES(edited_at)`,
      [presentationId, who.userId],
    );
  }
  const runs = await query<{ id: number }>(db, 'SELECT id FROM runs WHERE presentation_id = ? AND ended_at IS NULL', [presentationId]);
  for (const r of runs) live.notify(r.id, true);
  edits.changed(presentationId, { by: who.client, who: who.username, ...change });
}
