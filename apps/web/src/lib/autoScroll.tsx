import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

/** Pause oben und unten, bevor es weitergeht */
const PAUSE_MS = 3500;
/** Lesetempo beim Scrollen */
const PX_PER_SECOND = 40;

/**
 * Ergebnisse, die nicht auf die Bühne passen, langsam durchscrollen: oben
 * verweilen, nach unten gleiten, unten verweilen, zurück nach oben – in einer
 * Schleife, solange der Inhalt zu hoch ist. Bei reduzierter Bewegung springt die
 * Ansicht seitenweise statt zu gleiten.
 */
export function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let timer = 0;
    let stopped = false;
    const overflow = () => el.scrollHeight - el.clientHeight;

    const wait = (ms: number, next: () => void) => {
      timer = window.setTimeout(next, ms);
    };
    const toTop = () => {
      el.scrollTop = 0;
      wait(PAUSE_MS, down);
    };
    const down = () => {
      if (stopped) return;
      if (overflow() <= 4) return wait(PAUSE_MS, down);
      if (reduced) {
        // Seitenweise springen
        const next = Math.min(overflow(), el.scrollTop + el.clientHeight * 0.8);
        el.scrollTop = next;
        return wait(PAUSE_MS, next >= overflow() - 1 ? toTop : down);
      }
      let last = performance.now();
      // Eigene Position: scrollTop wird auf ganze Pixel gerundet, kleine Schritte gingen verloren
      let pos = el.scrollTop;
      const step = (now: number) => {
        if (stopped) return;
        pos = Math.min(overflow(), pos + ((now - last) / 1000) * PX_PER_SECOND);
        el.scrollTop = pos;
        last = now;
        if (el.scrollTop >= overflow() - 1) return wait(PAUSE_MS, toTop);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    wait(PAUSE_MS, down);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);
  return ref;
}

/** Säulen: Mindestbreite je Säule in em – darunter wird die Beschriftung unlesbar */
const MIN_PILLAR_EM = 4.5;
/** Mehr Säulen nebeneinander sind nicht mehr lesbar – dann bleibt die Liste und scrollt */
const MAX_PILLARS = 6;

/**
 * Balken nebeneinander statt scrollen: Passt eine Balkenliste (direkt im
 * Container) nicht in die Höhe, werden die Balken zu Säulen nebeneinander mit
 * kleiner Beschriftung darunter (`data-layout="columns"`, Layout in
 * `stage.css`). Bei mehr als `MAX_PILLARS` Balken oder zu wenig Breite bleibt
 * die Liste untereinander und scrollt automatisch. Gerechnet wird immer vom
 * Ausgangszustand, damit die eigene Änderung beim nächsten Messen dasselbe
 * Ergebnis liefert.
 */
function useBarColumns(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      delete el.dataset.layout;
      const n = el.querySelector(':scope > .bars')?.children.length ?? 0;
      if (n < 2 || n > MAX_PILLARS || el.scrollHeight - el.clientHeight <= 4) return;
      const width = el.clientWidth / (parseFloat(getComputedStyle(el).fontSize) || 16);
      if (width / n >= MIN_PILLAR_EM) el.dataset.layout = 'columns';
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    // Ergebnisse erscheinen oft erst nach dem Container (aufgedeckt, Quiz aufgelöst)
    const mutation = new MutationObserver(schedule);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref]);
}

/** Ergebnisbereich der Bühne, der bei Überlänge Balken nebeneinander setzt und sonst automatisch scrollt */
export function ScrollingResults({ className = 'stage-results', children }: { className?: string; children: ReactNode }) {
  const ref = useAutoScroll<HTMLDivElement>();
  useBarColumns(ref);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
