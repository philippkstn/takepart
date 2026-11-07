import {
  collectInk,
  displayMessage,
  emptyPendingInk,
  inkEvent,
  takeInk,
  type InkEvent,
  type InkStroke,
  type PendingInk,
  type ServerMessage,
} from '@slides/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { Db } from './db.ts';
import { effectiveQuiz, loadSnapshot, type Snapshot } from './snapshot.ts';
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
/** Laserpointer & Zeichnen: Obergrenzen gegen Überlastung */
const INK_MAX_MESSAGES_PER_SECOND = 80;
const INK_MAX_STROKES = 300;
const INK_MAX_POINTS_PER_STROKE = 3000;
/** Handys bekommen Laserpointer und Striche höchstens alle INK_PARTICIPANT_MS gesammelt (~12 Sendungen/s) */
const INK_PARTICIPANT_MS = 80;

type Client =
  | {
      ws: WebSocket;
      role: 'participant';
      participantId: number;
      alive: boolean;
      /** Tab verdeckt (Page Visibility) – bekommt dann keine Zeichnungen, beim Zurückkehren den Stand */
      hidden?: boolean;
    }
  | {
      ws: WebSocket;
      role: 'display' | 'host';
      alive: boolean;
      inkWindow?: number;
      inkCount?: number;
      /** Beamer-Fenster meldet, dass es verdeckt/minimiert ist (Page Visibility) – nur flüchtig */
      hidden?: boolean;
    };

interface Room {
  clients: Set<Client>;
  lastSent: number;
  timer: NodeJS.Timeout | null;
  running: boolean;
  again: boolean;
  quizTimer: NodeJS.Timeout | null;
  /**
   * Striche der aktuellen Folie. Bewusst nur im Speicher (die einzige Ausnahme von
   * „Live-Zustand liegt in der Datenbank“): flüchtig, gehen bei Folienwechsel und
   * Neustart verloren.
   */
  ink: {
    slideId: number | null;
    strokes: Map<string, [number, number][]>;
    /** Zeigen die Handys gerade die Folie, auf der gezeichnet wird? (siehe `inkAudience`) */
    audience: boolean;
    /** Für die Handys gesammelte Änderungen bis zur nächsten Sendung */
    pending: PendingInk;
    flushTimer: NodeJS.Timeout | null;
    lastFlush: number;
  };
}

/**
 * Laserpointer und Zeichnungen gehen nur an Handys, die dieselbe Bildfolie zeigen:
 * „Folien auf Handys zeigen“ an, Bildfolie, keine Rangliste, kein Schwarz-/Weißbild,
 * keine Pause.
 */
export function inkAudience(snap: Pick<Snapshot, 'run' | 'current'>): boolean {
  const state = snap.run.state;
  return snap.run.shareSlides && snap.current?.type === 'image' && !state.leaderboard && !state.blank && !state.pause;
}

const emptyInk = (slideId: number | null): Room['ink'] => ({
  slideId,
  strokes: new Map(),
  audience: false,
  pending: emptyPendingInk(),
  flushTimer: null,
  lastFlush: 0,
});

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
      if (room.ink.flushTimer) clearTimeout(room.ink.flushTimer);
      for (const c of room.clients) c.ws.close(1001, 'Server startet neu');
    }
  }

  private room(runId: number): Room {
    let room = this.rooms.get(runId);
    if (!room) {
      room = {
        clients: new Set(),
        lastSent: 0,
        timer: null,
        running: false,
        again: false,
        quizTimer: null,
        ink: emptyInk(null),
      };
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
        if (room.ink.flushTimer) clearTimeout(room.ink.flushTimer);
        this.rooms.delete(runId);
      } else {
        this.notify(runId); // Teilnehmerzahl aktualisieren
      }
    });
    client.ws.on('error', () => client.ws.terminate());
    if ((client.role !== 'participant' || room.ink.audience) && room.ink.strokes.size > 0) {
      client.ws.send(JSON.stringify({ type: 'ink-state', strokes: this.strokes(room) } satisfies ServerMessage));
    }
    this.notify(runId, true);
    return true;
  }

  private strokes(room: Room): InkStroke[] {
    return [...room.ink.strokes.entries()].map(([id, points]) => ({ id, points }));
  }

  /** Nachricht eines Hosts (Laserpointer/Zeichnen): prüfen, merken, an Beamer und Hosts weiterreichen. */
  ink(runId: number, sender: Client, raw: unknown) {
    if (sender.role !== 'host') return;
    const now = Date.now();
    if (!sender.inkWindow || now - sender.inkWindow >= 1000) {
      sender.inkWindow = now;
      sender.inkCount = 0;
    }
    if ((sender.inkCount = (sender.inkCount ?? 0) + 1) > INK_MAX_MESSAGES_PER_SECOND) return;

    let parsed: InkEvent;
    try {
      const result = inkEvent.safeParse(JSON.parse(String(raw)));
      if (!result.success) return;
      parsed = result.data;
    } catch {
      return;
    }
    const room = this.rooms.get(runId);
    if (!room) return;
    // Für die Handys nur, was der Server sich auch merkt (Obergrenzen je Strich)
    let forParticipants: InkEvent = parsed;
    if (parsed.type === 'clear') room.ink.strokes.clear();
    if (parsed.type === 'stroke') {
      const points = room.ink.strokes.get(parsed.id);
      if (points) {
        const added = parsed.points.slice(0, Math.max(0, INK_MAX_POINTS_PER_STROKE - points.length));
        points.push(...added);
        forParticipants = { ...parsed, points: added };
      } else if (room.ink.strokes.size < INK_MAX_STROKES) {
        room.ink.strokes.set(parsed.id, [...parsed.points]);
      } else {
        return;
      }
    }
    this.relayInk(room, { type: 'ink', event: parsed });
    if (room.ink.audience) {
      collectInk(room.ink.pending, forParticipants);
      this.scheduleInkFlush(room);
    }
  }

  /** Gesammelte Änderungen höchstens alle INK_PARTICIPANT_MS an die Handys – einmal serialisiert. */
  private scheduleInkFlush(room: Room) {
    if (room.ink.flushTimer) return;
    const ink = room.ink;
    const wait = Math.max(0, ink.lastFlush + INK_PARTICIPANT_MS - Date.now());
    ink.flushTimer = setTimeout(() => {
      ink.flushTimer = null;
      ink.lastFlush = Date.now();
      // Nach Folienwechsel gehört der Timer zu einem verworfenen Stand
      if (room.ink !== ink || !ink.audience) return;
      const events = takeInk(ink.pending);
      if (events.length > 0) this.sendParticipants(room, { type: 'ink-batch', events });
    }, wait);
  }

  /** Nachricht eines Handys: Sichtbarkeit des Tabs. Beim Zurückkehren bekommt es den aktuellen Stand. */
  participantMessage(runId: number, sender: Client, raw: unknown) {
    if (sender.role !== 'participant') return;
    let hidden: boolean;
    try {
      const result = displayMessage.safeParse(JSON.parse(String(raw)));
      if (!result.success) return;
      hidden = result.data.hidden;
    } catch {
      return;
    }
    if (sender.hidden === hidden) return;
    sender.hidden = hidden;
    const room = this.rooms.get(runId);
    if (hidden || !room || sender.ws.readyState !== sender.ws.OPEN) return;
    // Auch ohne Striche: Im verdeckten Tab kann ein Löschen verpasst worden sein
    const strokes = room.ink.audience ? this.strokes(room) : [];
    sender.ws.send(JSON.stringify({ type: 'ink-state', strokes } satisfies ServerMessage));
  }

  /** Nachricht eines Beamer-Fensters: Sichtbarkeit für die Anzeige im Steuerpult merken. */
  displayMessage(runId: number, sender: Client, raw: unknown) {
    if (sender.role !== 'display') return;
    let hidden: boolean;
    try {
      const result = displayMessage.safeParse(JSON.parse(String(raw)));
      if (!result.success) return;
      hidden = result.data.hidden;
    } catch {
      return;
    }
    if (sender.hidden === hidden) return;
    sender.hidden = hidden;
    this.notify(runId);
  }

  private relayInk(room: Room, message: ServerMessage) {
    const msg = JSON.stringify(message);
    for (const c of room.clients) if (c.role !== 'participant' && c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
  }

  /** An alle sichtbaren Handys – einmal serialisiert. */
  private sendParticipants(room: Room, message: ServerMessage) {
    const msg = JSON.stringify(message);
    for (const c of room.clients) if (c.role === 'participant' && !c.hidden && c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
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
  end(runId: number, handoutUrl: string | null = null) {
    const room = this.rooms.get(runId);
    if (!room) return;
    const msg = JSON.stringify({ type: 'ended', handoutUrl } satisfies ServerMessage);
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
      if (room.ink.slideId !== snap.run.state.slideId) {
        const hadInk = room.ink.strokes.size > 0;
        const { audience, flushTimer } = room.ink;
        if (flushTimer) clearTimeout(flushTimer);
        room.ink = { ...emptyInk(snap.run.state.slideId), audience };
        if (hadInk) {
          this.relayInk(room, { type: 'ink', event: { type: 'clear' } });
          if (audience) this.sendParticipants(room, { type: 'ink', event: { type: 'clear' } });
        }
      }
      // Handys zeigen die Folie nicht (mehr) bzw. wieder: leeren bzw. den Stand nachreichen
      const audience = inkAudience(snap);
      if (audience !== room.ink.audience) {
        room.ink.audience = audience;
        room.ink.pending = emptyPendingInk();
        if (!audience) this.sendParticipants(room, { type: 'ink-state', strokes: [] });
        else if (room.ink.strokes.size > 0) this.sendParticipants(room, { type: 'ink-state', strokes: this.strokes(room) });
      }
      const participantIds = new Set<number>();
      for (const c of room.clients) if (c.role === 'participant') participantIds.add(c.participantId);
      // Probelauf: simulierte Testteilnehmende zählen mit (sie haben keine Verbindung)
      const participants = participantIds.size + snap.run.fakeParticipants;
      const displays = { connected: 0, hidden: 0 };
      for (const c of room.clients) {
        if (c.role !== 'display' || c.ws.readyState !== c.ws.OPEN) continue;
        displays.connected++;
        if (c.hidden) displays.hidden++;
      }

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
          msg = host ??= JSON.stringify({
            type: 'view',
            view: hostView(snap, participants, participantIds, displays),
          } satisfies ServerMessage);
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
