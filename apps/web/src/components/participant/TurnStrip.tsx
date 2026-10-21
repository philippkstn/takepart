import type { MyTurnView } from '@slides/shared';
import { useEffect, useRef } from 'react';
import './turns.css';

/**
 * Reihum auf dem eigenen Gerät: eine schmale Zeile unter der Kopfzeile, nie über
 * Formularen. „Du bist dran“ hervorgehoben (mit kurzer Vibration beim Wechsel),
 * „als Nächstes“, sonst die eigene Nummer. Wer schon dran war, sieht nichts mehr.
 */
export function TurnStrip({ turn }: { turn: MyTurnView | null | undefined }) {
  const mine = !!turn && turn.current === turn.position;
  const was = useRef(mine);
  useEffect(() => {
    if (mine && !was.current && document.visibilityState === 'visible') navigator.vibrate?.([200, 100, 200]);
    was.current = mine;
  }, [mine]);

  if (!turn || (turn.current !== null && turn.current > turn.position)) return null;
  const next = turn.current !== null && turn.current + 1 === turn.position;
  return (
    <div className={`turn-strip ${mine ? 'is-mine' : ''}`} role="status">
      {mine ? (
        <strong>Du bist dran</strong>
      ) : next ? (
        <strong className="turn-strip-next">Du bist als Nächstes dran</strong>
      ) : (
        <span>
          Reihum: Du bist <strong className="tabular">Nr. {turn.position + 1}</strong> von <span className="tabular">{turn.of}</span>
        </span>
      )}
      {!mine && turn.current !== null && <span className="small muted tabular">gerade Nr. {turn.current + 1}</span>}
    </div>
  );
}
