import type { Countdown } from '@slides/shared';
import { Timer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCountdownMoments, type CountdownMoment } from '../../lib/countdownSound.ts';

/**
 * Hinweis auf dem Gerät der Teilnehmenden eine Minute vor Ende und bei Ablauf
 * des Countdowns – ohne Ton (den gibt es nur auf dem Beamer).
 */
export function CountdownAlert({ countdown, offset }: { countdown: Countdown | null; offset: number }) {
  const [moment, setMoment] = useState<CountdownMoment | null>(null);
  useCountdownMoments(countdown, offset, setMoment);

  // Ausblenden nach ein paar Sekunden – oder sofort, wenn der Timer beendet wird
  useEffect(() => {
    if (!moment) return;
    const t = window.setTimeout(() => setMoment(null), moment === 'warning' ? 6000 : 12000);
    return () => window.clearTimeout(t);
  }, [moment]);
  useEffect(() => {
    if (!countdown) setMoment(null);
  }, [countdown]);

  if (!moment) return null;
  return (
    <div className={`countdown-alert anim-pop ${moment === 'end' ? 'is-end' : ''}`} role="alert">
      <Timer aria-hidden />
      <div className="grow">
        <strong>{moment === 'warning' ? 'Noch 1 Minute' : 'Die Zeit ist um'}</strong>
        <div className="small">{moment === 'warning' ? 'Langsam zum Ende kommen.' : 'Bitte zum Abschluss kommen.'}</div>
      </div>
      <button className="icon-btn" aria-label="Schließen" onClick={() => setMoment(null)}>
        <X />
      </button>
    </div>
  );
}
