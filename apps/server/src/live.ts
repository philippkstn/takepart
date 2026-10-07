import type { ServerMessage } from '@slides/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { Db } from './db.ts';
import { effectiveQuiz, loadSnapshot } from './snapshot.ts';
import { displayView, hostView, participantView } from './views.ts';

/**
 * Live-Verteilung über WebSockets.
 *
 * Jede Änderung ruft `notify(runId)`. Gesendet wird höchstens alle BROADCAST_MS
 * (die erste Änderung sofort, weitere gebündelt), damit 300 Teilnehmende, die
 * gleichzeitig abstimmen, nicht 300 Snapshots auslösen. Der Zustand selbst liegt
 * in der Datenbank – nach einem Neustart verbinden sich alle neu und bekommen
 * ihn wieder.
 */

const BROADCAST_MS = 250;
const PING_MS = 25_000;
/** Obergrenzen gegen das massenhafte Öffnen von Verbindungen */
const MAX_CONNECTIONS_PER_RUN = 6000;
const MAX_CONNECTIONS_PER_PARTICIPANT = 5;

type Client =
  | { ws: WebSocket; role: 'participant'; participantId: number; alive: boolean }
  | { ws: WebSocket; role: 'display' | 'host'; alive: boolean };

interface Room {
  clients: Set<Client>;
  lastSent: number;
  timer: NodeJS.Timeout | null;
  running: boolean;
  again: boolean;
  quizTimer: NodeJS.Timeout | null;
}

export class LiveHub {
  private rooms = new Map<number, Room>();
  private pinger: NodeJS.Timeout;

  private db: Db;
  private log: FastifyBaseLogger;

  constructor(db: Db, log: FastifyBaseLogger) {
    this.db = db;
    this.log = log;
    // Pings halten die Verbindung durch den Apache-Proxy offen und finden tote Sockets.
    this.pinger = setInterval(() => {
      for (const room of this.rooms.values()) {
        for (const client of room.clients) {
          if (!client.alive) {
            client.ws.terminate();
            continue;
          }
          client.alive = false;
          client.ws.ping();
        }
      }
    }, PING_MS);
  }

  close() {
    clearInterval(this.pinger);
    for (const room of this.rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
      if (room.quizTimer) clearTimeout(room.quizTimer);
      for (const c of room.clients) c.ws.close(1001, 'Server startet neu');
    }
  }

  private room(runId: number): Room {
    let room = this.rooms.get(runId);
    if (!room) {
      room = { clients: new Set(), lastSent: 0, timer: null, running: false, again: false, quizTimer: null };
      this.rooms.set(runId, room);
    }
    return room;
  }

  /** Meldet false, wenn eine Obergrenze erreicht ist – dann wird die Verbindung nicht aufgenommen. */
  attach(runId: number, client: Client): boolean {
    const room = this.room(runId);
    if (room.clients.size >= MAX_CONNECTIONS_PER_RUN) return false;
    if (client.role === 'participant') {
      let own = 0;
      for (const c of room.clients) if (c.role === 'participant' && c.participantId === client.participantId) own++;
      if (own >= MAX_CONNECTIONS_PER_PARTICIPANT) return false;
    }
    room.clients.add(client);
    client.ws.on('pong', () => (client.alive = true));
    client.ws.on('close', () => {
      room.clients.delete(client);
      if (room.clients.size === 0 && !room.timer) {
        if (room.quizTimer) clearTimeout(room.quizTimer);
        this.rooms.delete(runId);
      } else {
        this.notify(runId); // Teilnehmerzahl aktualisieren
      }
    });
    client.ws.on('error', () => client.ws.terminate());
    this.notify(runId, true);
    return true;
  }

  /** Neue Daten für eine Durchführung – gebündelt verschicken. */
  notify(runId: number, immediate = false) {
    const room = this.rooms.get(runId);
    if (!room) return;
    if (room.running) {
      room.again = true;
      return;
    }
    if (room.timer) return;
    const wait = immediate ? 0 : Math.max(0, room.lastSent + BROADCAST_MS - Date.now());
    room.timer = setTimeout(() => {
      room.timer = null;
      void this.broadcast(runId, room);
    }, wait);
  }

  /** Alle Verbindungen einer beendeten Durchführung informieren und schließen. */
  end(runId: number) {
    const room = this.rooms.get(runId);
    if (!room) return;
    const msg = JSON.stringify({ type: 'ended' } satisfies ServerMessage);
    for (const c of room.clients) {
      if (c.role === 'host') continue;
      c.ws.send(msg);
      c.ws.close(1000, 'Beendet');
    }
    this.notify(runId);
  }

  /** Beamer-Verbindungen trennen (z. B. nach neuem Anzeige-Link). */
  dropDisplays(runId: number) {
    const room = this.rooms.get(runId);
    if (!room) return;
    for (const c of room.clients) if (c.role === 'display') c.ws.close(4001, 'Anzeige-Link ungültig');
  }

  private async broadcast(runId: number, room: Room) {
    room.running = true;
    room.again = false;
    try {
      const snap = await loadSnapshot(this.db, runId);
      if (!snap) return;
      const participantIds = new Set<number>();
      for (const c of room.clients) if (c.role === 'participant') participantIds.add(c.participantId);
      const participants = participantIds.size;

      let display: string | null = null;
      let host: string | null = null;
      for (const c of room.clients) {
        if (c.ws.readyState !== c.ws.OPEN) continue;
        let msg: string;
        if (c.role === 'participant') {
          msg = JSON.stringify({ type: 'view', view: participantView(snap, c.participantId) } satisfies ServerMessage);
        } else if (c.role === 'display') {
          msg = display ??= JSON.stringify({ type: 'view', view: displayView(snap, participants) } satisfies ServerMessage);
        } else {
          msg = host ??= JSON.stringify({ type: 'view', view: hostView(snap, participants) } satisfies ServerMessage);
        }
        c.ws.send(msg);
      }
      this.scheduleQuizClose(runId, room, snap);
    } catch (err) {
      this.log.error({ err, runId }, 'Broadcast fehlgeschlagen');
    } finally {
      room.lastSent = Date.now();
      room.running = false;
      if (room.again) this.notify(runId);
    }
  }

  /** Wenn bei einer Quizfrage die Zeit abläuft, allen den geschlossenen Zustand schicken. */
  private scheduleQuizClose(runId: number, room: Room, snap: NonNullable<Awaited<ReturnType<typeof loadSnapshot>>>) {
    if (room.quizTimer) {
      clearTimeout(room.quizTimer);
      room.quizTimer = null;
    }
    const slide = snap.current;
    if (!slide || slide.type !== 'quiz') return;
    const q = effectiveQuiz(snap.run.state, slide.id, Date.now());
    if (q.phase !== 'open' || q.closesAt === null) return;
    room.quizTimer = setTimeout(() => this.notify(runId, true), q.closesAt - Date.now() + 50);
  }
}
