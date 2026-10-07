import type { InkEvent, InkStroke, ServerMessage } from '@slides/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * In Produktion liefert derselbe Prozess Seite und WebSocket aus. In der Entwicklung
 * geht der WebSocket direkt an die API (:3000) – der Vite-Proxy verliert beim
 * gleichzeitigen Aufbau mit Vites eigenem HMR-Socket gelegentlich Verbindungen.
 */
function wsBase(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.DEV ? `${proto}//${location.hostname}:3000` : `${proto}//${location.host}`;
}

export type LiveStatus = 'connecting' | 'open' | 'reconnecting' | 'ended' | 'rejected';

/** Laserpointer und Zeichnungen auf der aktuellen Folie (nur Beamer und Steuerpult) */
export interface InkState {
  strokes: InkStroke[];
  pointer: { x: number; y: number; at: number } | null;
}

function applyInk(state: InkState, event: InkEvent): InkState {
  switch (event.type) {
    case 'pointer':
      return { ...state, pointer: { x: event.x, y: event.y, at: Date.now() } };
    case 'pointer-off':
      return { ...state, pointer: null };
    case 'clear':
      return { ...state, strokes: [] };
    case 'stroke': {
      const existing = state.strokes.find((s) => s.id === event.id);
      if (!existing) return { ...state, strokes: [...state.strokes, { id: event.id, points: event.points }] };
      return {
        ...state,
        strokes: state.strokes.map((s) => (s.id === event.id ? { ...s, points: [...s.points, ...event.points] } : s)),
      };
    }
  }
}

/**
 * Live-Verbindung mit automatischem Neuaufbau. Der Server schickt nach jedem
 * (Wieder-)Verbinden den vollständigen Zustand, deshalb geht beim Neuaufbau
 * nichts verloren – etwa wenn während des Vortrags ein Deployment läuft.
 */
export function useLive<V>(query: string | null): {
  view: V | null;
  status: LiveStatus;
  offset: number;
  ink: InkState;
  /** Nur für Hosts: Laserpointer/Zeichnen senden */
  sendInk: (event: InkEvent) => void;
  handoutUrl: string | null;
} {
  const [view, setView] = useState<V | null>(null);
  const [ink, setInk] = useState<InkState>({ strokes: [], pointer: null });
  const [handoutUrl, setHandoutUrl] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sendInk = useCallback((event: InkEvent) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }, []);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [offset, setOffset] = useState(0);
  const attempt = useRef(0);

  useEffect(() => {
    if (!query) return;
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let openTimeout: number | undefined;
    let stopped = false;

    const connect = () => {
      const socket = new WebSocket(`${wsBase()}/ws?${query}`);
      ws = socket;
      socketRef.current = socket;
      // Hängt der Aufbau (Proxy, Funkloch), neu versuchen statt ewig zu warten.
      openTimeout = window.setTimeout(() => {
        if (socket.readyState === WebSocket.CONNECTING) socket.close();
      }, 6000);
      socket.onopen = () => {
        window.clearTimeout(openTimeout);
        attempt.current = 0;
        setStatus('open');
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        if (msg.type === 'view') {
          setOffset(msg.view.serverTime - Date.now());
          setView(msg.view as V);
        } else if (msg.type === 'ended') {
          stopped = true;
          setHandoutUrl(msg.handoutUrl ?? null);
          setStatus('ended');
        } else if (msg.type === 'ink') {
          setInk((s) => applyInk(s, msg.event));
        } else if (msg.type === 'ink-state') {
          setInk({ strokes: msg.strokes, pointer: null });
        }
      };
      socket.onclose = (event) => {
        window.clearTimeout(openTimeout);
        if (stopped || socket !== ws) return;
        // 4xxx: vom Server bewusst abgelehnt (Token ungültig, beendet) – nicht endlos neu versuchen.
        if (event.code >= 4000 && event.code < 4100) {
          setStatus('rejected');
          return;
        }
        setStatus('reconnecting');
        const delay = Math.min(10_000, 500 * 2 ** attempt.current) + Math.random() * 500;
        attempt.current++;
        timer = window.setTimeout(connect, delay);
      };
    };

    const onVisible = () => {
      // Handy war im Standby: sofort neu verbinden statt auf den Backoff zu warten.
      if (document.visibilityState === 'visible' && ws && ws.readyState === WebSocket.CLOSED && !stopped) {
        window.clearTimeout(timer);
        attempt.current = 0;
        connect();
      }
    };

    setStatus('connecting');
    // Verzögert, damit ein sofortiges Aufräumen (React StrictMode) keine halb offene Verbindung hinterlässt.
    timer = window.setTimeout(connect, 0);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(openTimeout);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
    };
  }, [query]);

  return { view, status, offset, ink, sendInk, handoutUrl };
}

/** Restzeit bis zu einem Server-Zeitpunkt, sekündlich aktualisiert. */
export function useCountdown(until: number | null, offset: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [until]);
  if (until === null) return null;
  return Math.max(0, until - (now + offset));
}
