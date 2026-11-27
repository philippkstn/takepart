import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Ab dieser Strecke (px) wird aus einem Klick ein Ziehen */
const THRESHOLD = 5;
/** Randbereich der Liste (px), in dem beim Ziehen mitgescrollt wird */
const EDGE = 48;
/** Höchste Scroll-Geschwindigkeit je Bild (px) */
const MAX_SPEED = 18;

export interface SlideDrag {
  /** Folien, die gerade gezogen werden (eine oder die ganze Auswahl) */
  ids: number[];
  /** Einfügestelle: vor der wievielten Zeile der Liste (0 … Zeilenzahl) – Überschriften zählen als Zeilen */
  at: number;
}

/**
 * Folien in der Liste per Zeiger verschieben (Maus, Stift, Touch über den Griff).
 * Maus: die ganze Zeile ist ziehbar; Touch nur über den Griff (sonst ginge Scrollen verloren).
 * Die Liste scrollt am Rand mit; Escape bricht ab. Zeilen sind alle `li[data-row]` der
 * Liste (Folien und Abschnitts-Überschriften); `onDrop` bekommt die Einfügestelle
 * als Zeilenindex – die neue Reihenfolge baut die Liste beim Loslassen aus ihrem
 * dann aktuellen Stand (die Liste kann sich inzwischen ändern).
 */
export function useSlideDrag({ enabled, onDrop }: { enabled: boolean; onDrop: (ids: number[], at: number) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<SlideDrag | null>(null);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  /** Einfügestelle aus der Zeigerhöhe: Anzahl der Zeilen, deren Mitte darüber liegt */
  const indexAt = (y: number) => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>(':scope > li[data-row]') ?? [];
    let at = 0;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (y > r.top + r.height / 2) at++;
    }
    return at;
  };

  const start = useCallback(
    (e: ReactPointerEvent, ids: number[], fromHandle: boolean) => {
      if (!enabled || e.button !== 0 || ids.length === 0) return;
      if (e.pointerType !== 'mouse' && !fromHandle) return;
      // Mit Umschalt/⌘/Strg wird ausgewählt, nicht gezogen
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement;
      // Knöpfe in der Zeile (Menü, Einklappen …) nicht zum Ziehen nehmen
      if (!fromHandle && target.closest('[data-no-drag]')) return;
      cleanup.current?.();

      const startY = e.clientY;
      let y = startY;
      let active = false;
      let frame = 0;

      const scrollLoop = () => {
        const list = listRef.current?.closest<HTMLElement>('.slide-list');
        if (list) {
          const r = list.getBoundingClientRect();
          const speed =
            y < r.top + EDGE
              ? -Math.min(MAX_SPEED, ((r.top + EDGE - y) / EDGE) * MAX_SPEED)
              : y > r.bottom - EDGE
                ? Math.min(MAX_SPEED, ((y - (r.bottom - EDGE)) / EDGE) * MAX_SPEED)
                : 0;
          if (speed) {
            list.scrollTop += speed;
            setDrag((d) => d && { ...d, at: indexAt(y) });
          }
        }
        frame = requestAnimationFrame(scrollLoop);
      };

      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        y = ev.clientY;
        if (!active) {
          if (Math.abs(y - startY) < THRESHOLD) return;
          active = true;
          document.body.classList.add('is-dragging-slide');
          frame = requestAnimationFrame(scrollLoop);
        }
        ev.preventDefault();
        setDrag({ ids, at: indexAt(y) });
      };

      const finish = (commit: boolean) => {
        cleanup.current?.();
        if (!active || !commit) return;
        latest.current(ids, indexAt(y));
      };

      const up = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(true);
      const cancel = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(false);
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || !active) return;
        ev.preventDefault();
        finish(false);
      };
      // Klick nach dem Ziehen nicht als Auswahl werten
      const swallowClick = (ev: MouseEvent) => {
        if (active) {
          ev.stopPropagation();
          ev.preventDefault();
        }
      };

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
      window.addEventListener('click', swallowClick, true);
      cleanup.current = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key, true);
        // Der Klick folgt direkt auf pointerup – erst danach abmelden
        setTimeout(() => window.removeEventListener('click', swallowClick, true), 0);
        document.body.classList.remove('is-dragging-slide');
        setDrag(null);
        cleanup.current = null;
      };
    },
    [enabled],
  );

  return { listRef, drag, start };
}
