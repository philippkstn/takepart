import { AnimatePresence, motion } from 'motion/react';
import './pick.css';

/**
 * Zufallsauswahl auf dem Beamer: der gezogene Name groß über der Folie.
 * Kurze Einblendung (≤ 600 ms); `MotionConfig reducedMotion="user"` der Bühne
 * schaltet Bewegung bei prefers-reduced-motion ab.
 */
export function PickOverlay({ name }: { name: string | null | undefined }) {
  return (
    <AnimatePresence>
      {name && (
        <motion.div
          className="spotlight pick-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            key={name}
            className="spotlight-card pick-card"
            initial={{ scale: 0.9, y: 18, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <span className="spotlight-kicker">Du bist dran</span>
            <span className="pick-name">{name}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
