import type { Countdown } from '@slides/shared';
import { Timer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { playEnd, playPhase, useCountdownMoments, type CountdownMoment } from '../../lib/countdownSound.ts';
import { momentText } from '../countdownText.ts';

/**
 * Hinweis auf dem Gerät der Teilnehmenden eine Minute vor Ende, beim
 * Phasenwechsel und bei Ablauf des Countdowns. Ton und Vibration nur bei
 * Phasen (Gruppenarbeit, oft ohne Blick auf den Beamer).
 */
export function CountdownAlert({ countdown, offset }: { countdown: Countdown | null; offset: number }) {
  const [moment, setMoment] = useState<CountdownMoment | null>(null);
  useCountdownMoments(countdown, offset, (m) => {
    setMoment(m);
    // Gruppenarbeit ohne Beamer: Phasenwechsel und Ende deutlich machen – Vibration
    // und (falls freigegeben, siehe PhaseBanner) ein Ton
    if (countdown?.phases?.length && m.kind !== 'warning') {
      try {
        navigator.vibrate?.(m.kind === 'end' ? [300, 150, 300] : [200, 100, 200]);
      } catch {
        // nicht überall erlaubt
      }
      if (m.kind === 'phase') playPhase();
      else playEnd();
    }
  });

  // Ausblenden nach ein paar Sekunden – oder sofort, wenn der Timer beendet wird
  useEffect(() => {
    if (!moment) return;
    const t = window.setTimeout(() => setMoment(null), moment.kind === 'warning' ? 6000 : 12000);
    return () => window.clearTimeout(t);
  }, [moment]);
  useEffect(() => {
    if (!countdown) setMoment(null);
  }, [countdown]);

  if (!moment) return null;
  const text = momentText(moment);
  return (
    <div
      key={`${moment.kind}:${moment.phase?.index ?? 0}`}
      className={`countdown-alert anim-pop ${moment.kind === 'end' ? 'is-end' : ''} ${moment.kind === 'phase' ? 'is-phase' : ''}`}
      role="alert"
    >
      <Timer aria-hidden />
      <div className="grow">
        <strong>{text.title}</strong>
        <div className="small">{text.detail}</div>
      </div>
      <button className="icon-btn" aria-label="Schließen" onClick={() => setMoment(null)}>
        <X />
      </button>
    </div>
  );
}
