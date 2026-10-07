import type { InkEvent } from '@slides/shared';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { InkState } from '../lib/live.ts';
import './ink.css';

/*
 * Laserpointer und Zeichnen. Koordinaten sind auf die 16:9-Bühne normiert (0…1),
 * dadurch liegen Punkt und Striche im Steuerpult und auf dem Beamer exakt gleich.
 */

const W = 1600;
const H = 900;
/** Laserpunkt ausblenden, wenn er sich so lange nicht bewegt hat */
const POINTER_IDLE_MS = 2500;

export function InkOverlay({ ink }: { ink: InkState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!ink.pointer) return;
    const id = window.setTimeout(() => tick((n) => n + 1), POINTER_IDLE_MS + 50);
    return () => window.clearTimeout(id);
  }, [ink.pointer]);
  const pointer = ink.pointer && Date.now() - ink.pointer.at < POINTER_IDLE_MS ? ink.pointer : null;

  if (ink.strokes.length === 0 && !pointer) return null;
  return (
    <svg className="ink-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      {ink.strokes.map((s) => {
        const d = s.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x * W).toFixed(1)} ${(y * H).toFixed(1)}`).join(' ');
        const single = s.points.length === 1;
        return (
          <g key={s.id}>
            <path className="ink-halo" d={single ? `${d} l0.1 0` : d} />
            <path className="ink-stroke" d={single ? `${d} l0.1 0` : d} />
          </g>
        );
      })}
      {pointer && (
        <g className="ink-pointer" transform={`translate(${pointer.x * W} ${pointer.y * H})`}>
          <circle r="22" className="ink-pointer-glow" />
          <circle r="9" className="ink-pointer-dot" />
        </g>
      )}
    </svg>
  );
}

export type InkTool = 'none' | 'pointer' | 'pen';

/** Eingabefläche über der Vorschau im Steuerpult: Maus, Finger oder Stift. */
export function InkInput({ tool, send }: { tool: InkTool; send: (e: InkEvent) => void }) {
  const lastPointer = useRef(0);
  const stroke = useRef<{ id: string; pending: [number, number][]; timer: number | undefined } | null>(null);

  const position = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };

  // Aktuelle send-Funktion für das Aufräumen beim Schließen (nicht bei jedem Neuzeichnen)
  const sendRef = useRef(send);
  sendRef.current = send;

  const flush = (done: boolean) => {
    const s = stroke.current;
    if (!s) return;
    window.clearTimeout(s.timer);
    s.timer = undefined;
    while (s.pending.length > 0) {
      const chunk = s.pending.splice(0, 100);
      sendRef.current({ type: 'stroke', id: s.id, points: chunk, done: done && s.pending.length === 0 });
    }
    if (done) stroke.current = null;
  };

  // Nur beim Schließen: einen angefangenen Strich abschließen
  useEffect(() => () => flush(true), []);

  if (tool === 'none') return null;

  return (
    <div
      className={`ink-input ink-input-${tool}`}
      onPointerMove={(e) => {
        const [x, y] = position(e);
        if (tool === 'pointer') {
          const now = performance.now();
          if (now - lastPointer.current < 33) return; // ~30 Bilder/s reichen
          lastPointer.current = now;
          send({ type: 'pointer', x, y });
        } else if (stroke.current) {
          stroke.current.pending.push([x, y]);
          // In kleinen Paketen senden: flüssig, aber nicht jede Mausbewegung einzeln
          stroke.current.timer ??= window.setTimeout(() => flush(false), 40);
        }
      }}
      onPointerDown={(e) => {
        if (tool !== 'pen') return;
        e.currentTarget.setPointerCapture(e.pointerId);
        stroke.current = { id: Math.random().toString(36).slice(2, 12), pending: [position(e)], timer: undefined };
        flush(false);
      }}
      onPointerUp={() => flush(true)}
      onPointerCancel={() => flush(true)}
      onPointerLeave={() => {
        if (tool === 'pointer') send({ type: 'pointer-off' });
      }}
    />
  );
}
