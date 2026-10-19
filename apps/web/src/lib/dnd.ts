import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Drag & Drop für Karten – mit Maus, Stift und Finger (Pointer Events statt
 * HTML5-Drag, das auf Handys nicht zuverlässig läuft). Ablageflächen melden
 * sich per `useDropZone` an und tragen `data-drop`; beim Loslassen bekommt die
 * Fläche unter dem Finger den Schlüssel der gezogenen Karte.
 */

const zones = new Map<string, (key: string) => void>();

/** Ablagefläche: Attribute für das Element (leer, wenn nichts abgelegt werden kann) */
export function useDropZone(onDrop?: (key: string) => void): { 'data-drop'?: string } {
  const id = useId();
  const latest = useRef(onDrop);
  latest.current = onDrop;
  const enabled = !!onDrop;
  useEffect(() => {
    if (!enabled) return;
    zones.set(id, (key) => latest.current?.(key));
    return () => {
      zones.delete(id);
    };
  }, [id, enabled]);
  return enabled ? { 'data-drop': id } : {};
}

const THRESHOLD = 6;

/** Zieht ab einer kleinen Bewegung eine Karte (Schlüssel `key`) mit Vorschau `label`. */
export function startDrag(e: ReactPointerEvent, key: string, label: string) {
  if (e.button !== 0) return;
  const handle = e.currentTarget as Element;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let over: Element | null = null;

  const setOver = (el: Element | null) => {
    if (el === over) return;
    over?.classList.remove('is-over');
    el?.classList.add('is-over');
    over = el;
  };

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      // Zeiger erst beim echten Ziehen übernehmen – ein einfacher Klick bleibt beim angeklickten Element
      // (z. B. zum Aufklappen gekürzter Karten); so kommt auch ein Loslassen außerhalb des Fensters an.
      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* ältere Browser: dann eben ohne */
      }
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = label.length > 80 ? `${label.slice(0, 80)} …` : label;
      document.body.appendChild(ghost);
      document.body.classList.add('is-dragging');
    }
    ev.preventDefault();
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
    setOver(document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop]') ?? null);
  };

  const end = (ev: { type: string }) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', end);
    window.removeEventListener('keydown', escape);
    if (!ghost) return;
    ghost.remove();
    document.body.classList.remove('is-dragging');
    const target = ev.type === 'pointerup' ? over : null;
    setOver(null);
    const zone = target instanceof HTMLElement ? target.dataset.drop : undefined;
    if (zone) zones.get(zone)?.(key);
    // Der Klick nach dem Loslassen soll die Karte nicht zusätzlich auswählen
    const swallow = (c: MouseEvent) => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  };

  // Escape oder Fensterwechsel bricht ab
  const escape = (k: KeyboardEvent) => {
    if (k.key === 'Escape') end({ type: 'cancel' });
  };

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
  window.addEventListener('keydown', escape);
}
