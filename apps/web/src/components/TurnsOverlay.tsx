import type { TurnsDisplayView } from '@slides/shared';
import { AnimatePresence, motion } from 'motion/react';
import './turns-stage.css';

/**
 * Reihum auf der Bühne: eine dezente Leiste „Jetzt: Anna · Danach: Ben“, solange
 * jemand dran ist; auf Wunsch die ganze Reihenfolge als Liste (aktuelle Person
 * hervorgehoben, erledigte gedämpft). Nur Namen, nie IDs. Liegt über der Folie,
 * unter Pause und Schwarzbild; Bewegung schaltet `MotionConfig reducedMotion="user"` ab.
 */
export function TurnsOverlay({ turns }: { turns: TurnsDisplayView | null | undefined }) {
  const current = turns && turns.current !== null ? turns.current : null;
  const now = current !== null ? turns!.names[current] : undefined;
  const next = current !== null ? turns!.names[current + 1] : undefined;
  const shown = !!turns?.shown;
  const names = turns?.names ?? [];
  const columns = names.length > 24 ? 3 : names.length > 10 ? 2 : 1;

  return (
    <>
      <AnimatePresence>
        {shown && (
          <motion.div
            className="spotlight turns-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <motion.div
              className={`spotlight-card turns-card cols-${columns}`}
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <span className="spotlight-kicker">Reihenfolge</span>
              <ol className={`turns-stage-list ${names.length > 16 ? 'is-dense' : ''}`}>
                {names.map((name, i) => {
                  const state = current === null ? '' : i === current ? 'is-current' : i < current ? 'is-done' : '';
                  return (
                    <li key={`${i}-${name}`} className={state} aria-current={i === current ? 'true' : undefined}>
                      <span className="turns-stage-pos tabular">{i + 1}</span>
                      <span className="turns-stage-name">{name}</span>
                    </li>
                  );
                })}
              </ol>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!shown && now && (
          <motion.div
            className="turns-bar"
            role="status"
            initial={{ opacity: 0, y: '40%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <span className="turns-bar-label">Jetzt</span>
            <strong className="turns-bar-name">{now}</strong>
            {next && (
              <>
                <span className="turns-bar-sep" aria-hidden>
                  ·
                </span>
                <span className="turns-bar-label">Danach</span>
                <span className="turns-bar-name">{next}</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
