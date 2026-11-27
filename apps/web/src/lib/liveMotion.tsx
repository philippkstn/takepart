import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/** Gleiche Kurve wie `--ease` in index.css */
export const EASE = [0.2, 0.8, 0.2, 1] as const;

/**
 * Zahl, die bei neuen Antworten vom alten zum neuen Wert zählt, statt zu springen.
 * Ohne Bewegung (prefers-reduced-motion) steht sofort der neue Wert da.
 */
export function AnimatedNumber({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: decimals }));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.5, ease: EASE });
    return () => controls.stop();
  }, [value, reduce, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}

/**
 * Solange ein Ergebnis gerade erscheint (Klasse `is-entering`): Nur dann läuft das Einwachsen
 * aus der Grundlinie. Danach steht keine Animation mehr am Element – sonst startete sie bei
 * jeder Stilumstellung (z. B. Nachmessen der Säulen auf der Bühne) neu und der Balken wüchse
 * bei jeder Stimme wieder von null. Länger als Dauer + größte Staffelung (700 + 8 × 60 ms).
 */
export function useEntering(ms = 1400): boolean {
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setEntering(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return entering;
}

/**
 * Klassenname für einen kurzen Puls, sobald ein Wert steigt (neue Stimme). Zwei
 * abwechselnde Klassen mit gleicher Animation, damit sie bei jeder Stimme neu startet,
 * ohne das Element neu aufzubauen (sonst ginge die Breiten-Überblendung verloren).
 * Beim ersten Anzeigen pulst nichts.
 */
export function useBump(value: number): string {
  const prev = useRef(value);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (value > prev.current) setCount((c) => c + 1);
    prev.current = value;
  }, [value]);
  return count === 0 ? '' : count % 2 ? 'is-bump-a' : 'is-bump-b';
}
