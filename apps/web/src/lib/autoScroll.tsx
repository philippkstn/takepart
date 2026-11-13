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

/** Kleinster Maßstab der Wortwolke – darunter wäre sie auf dem Beamer nicht mehr lesbar */
const MIN_CLOUD_SCALE = 0.2;
/** Wörter wachsen animiert (CloudWord, 500 ms) – danach noch einmal am Endstand messen */
const CLOUD_SETTLE_MS = 650;

/**
 * Wortwolke passt immer: Eine direkt enthaltene `.wordcloud` (bzw. `selector`,
 * z. B. die Wolke im Satz-Spiel) wird über
 * `--cloud-scale` (stage.css) so weit verkleinert, dass nichts scrollt – per
 * Intervallschachtelung zwischen `MIN_CLOUD_SCALE` und 1, gerechnet immer vom
 * vollen Maßstab, damit sie auch wieder wächst, wenn Wörter wegfallen oder die
 * Fläche größer wird. Die Wortgrößen sind em-relativ, der Maßstab wirkt sofort.
 */
export function useCloudFit(ref: RefObject<HTMLElement | null>, selector = ':scope > .wordcloud') {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let timer = 0;
    const fits = () => el.scrollHeight - el.clientHeight <= 1 && el.scrollWidth - el.clientWidth <= 1;
    const fit = () => {
      el.style.removeProperty('--cloud-scale');
      if (!el.querySelector(selector) || fits()) return;
      let lo = MIN_CLOUD_SCALE;
      let hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        el.style.setProperty('--cloud-scale', String(mid));
        if (fits()) lo = mid;
        else hi = mid;
      }
      el.style.setProperty('--cloud-scale', String(lo));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = requestAnimationFrame(fit);
      timer = window.setTimeout(fit, CLOUD_SETTLE_MS);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    // Kinder, Text und `title` (trägt die Häufigkeit – ändert sich, wenn nur Zahlen wachsen);
    // die Animation der Schriftgröße (style-Attribut) löst nichts aus
    const mutation = new MutationObserver(schedule);
    mutation.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] });
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref, selector]);
}

/** Spaltenbreite in CSS-Pixeln, aus der sich die Spaltenzahl im dichten Modus ergibt */
const DENSE_COLUMN_PX = 440;
/** Spaltenzahl, für die die normale Kartengröße gedacht ist – mehr Spalten verkleinern im selben Verhältnis */
const DENSE_BASE_COLUMNS = 3;

/**
 * Dichter Modus für Karten, Beiträge, Gruppen und Felder: Passt der Inhalt nicht
 * auf die Bühne, setzt `ScrollingResults` `data-dense` und `--stage-cols` (2–5
 * Spalten nach der echten Breite in CSS-Pixeln – großer Beamer, mehr Spalten).
 * `--cols-scale` verkleinert die Schrift im selben Verhältnis, damit die Karten in
 * Pixeln etwa gleich groß bleiben. Passt es dann immer noch nicht, scrollt der
 * Bereich (useAutoScroll). Gerechnet wird immer vom normalen Zustand aus.
 */
function useDenseGrid(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let timer = 0;
    const fit = () => {
      const cols = Math.min(5, Math.max(2, Math.round(el.clientWidth / DENSE_COLUMN_PX)));
      el.style.setProperty('--stage-cols', String(cols));
      el.style.setProperty('--cols-scale', String(Math.min(1, DENSE_BASE_COLUMNS / cols)));
      delete el.dataset.dense;
      if (el.scrollHeight - el.clientHeight > 4) el.dataset.dense = '';
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = requestAnimationFrame(fit);
      // Neue Beiträge blenden animiert ein – danach am Endstand messen
      timer = window.setTimeout(fit, CLOUD_SETTLE_MS);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    const mutation = new MutationObserver(schedule);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref]);
}

/**
 * Ergebnisbereich der Bühne: setzt bei Überlänge Balken nebeneinander,
 * verkleinert Wortwolken bis sie passen, verdichtet Karten auf 2–5 Spalten und
 * scrollt erst dann automatisch. Nichts auf der Bühne wird abgeschnitten.
 */
export function ScrollingResults({ className = 'stage-results', children }: { className?: string; children: ReactNode }) {
  const ref = useAutoScroll<HTMLDivElement>();
  useBarColumns(ref);
  useCloudFit(ref);
  useDenseGrid(ref);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
