import type { TurnsDisplayView } from '@slides/shared';
import { AnimatePresence, motion } from 'motion/react';
import './turns-stage.css';

/**
 * Reihum auf der Bühne: auf Wunsch die ganze Reihenfolge als Liste (aktuelle Person
 * hervorgehoben, erledigte gedämpft); „Jetzt · Danach“ zeigt `TurnsBadge` in der
 * Statuszeile. Nur Namen, nie IDs. Liegt über der Folie, unter Pause und
 * Schwarzbild; Bewegung schaltet `MotionConfig reducedMotion="user"` ab.
 */
export function TurnsOverlay({ turns }: { turns: TurnsDisplayView | null | undefined }) {
  const current = turns && turns.current !== null ? turns.current : null;
  const shown = !!turns?.shown;
  const names = turns?.names ?? [];
  const columns = names.length > 18 ? 3 : names.length > 6 ? 2 : 1;

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
              <ol className={`turns-stage-list ${names.length > 27 ? 'is-dense' : ''}`}>
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
    </>
  );
}

/** „Jetzt · Danach“ in der Statuszeile der Bühne (neben dem Countdown) – verdeckt keine Inhalte. */
export function TurnsBadge({ turns }: { turns: TurnsDisplayView | null | undefined }) {
  if (!turns || turns.current === null || turns.shown) return null;
  const now = turns.names[turns.current];
  const next = turns.names[turns.current + 1];
  if (!now) return null;
  return (
    <span className="stage-turns" role="status">
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
    </span>
  );
}
