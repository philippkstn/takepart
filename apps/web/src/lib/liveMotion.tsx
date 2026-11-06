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
