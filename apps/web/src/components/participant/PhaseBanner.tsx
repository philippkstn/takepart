import { currentPhase, type Countdown } from '@slides/shared';
import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCountdown } from '../../lib/live.ts';
import { unlockAudio } from '../../lib/countdownSound.ts';
import { formatMinutes, formatRemaining } from '../Countdown.tsx';

/**
 * Phasen-Countdown auf dem Gerät der Teilnehmenden – auf jeder Folie, gut
 * sichtbar unter der Kopfzeile, damit Gruppen in Breakouts den Ablauf ohne
 * Beamer im Blick haben: aktuelle Phase, Restzeit, „Phase 2 von 3“ und was danach kommt.
 * Alles wird bei jedem Takt aus Serverzeit berechnet – nach einem verdeckten Tab
 * stimmt der Stand sofort wieder.
 */
export function PhaseBanner({ countdown, offset }: { countdown: Countdown | null; offset: number }) {
  const remaining = useCountdown(countdown?.endsAt ?? null, offset);
  const sound = useAudioUnlock(!!countdown?.phases?.length);
  if (!countdown || remaining === null) return null;
  const now = countdown.endsAt - remaining;
  const phase = currentPhase(countdown, now);
  if (!phase) return null;
  const left = Math.max(0, phase.endsAt - now);
  const progress = phase.done ? 1 : 1 - left / (phase.seconds * 1000);

  return (
    <section className={`phase-banner ${phase.done ? 'is-done' : ''}`} role="timer" aria-label="Phasen-Countdown">
      <div className="phase-banner-main">
        <div className="phase-banner-text">
          <span className="phase-banner-count small">
            {phase.done ? 'Alle Phasen vorbei' : `Phase ${phase.index + 1} von ${phase.count}`}
          </span>
          <strong className="phase-banner-label">{phase.done ? 'Die Zeit ist um' : phase.label}</strong>
        </div>
        {!phase.done && <span className="phase-banner-time tabular">{formatRemaining(left)}</span>}
      </div>
      <div
        className="phase-banner-progress"
        role="progressbar"
        aria-label="Fortschritt der Phase"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div style={{ transform: `scaleX(${progress})` }} />
      </div>
      {(phase.next && !phase.done) || sound.locked ? (
        <div className="phase-banner-foot small">
          <span className="grow">{phase.next && !phase.done && `Danach: ${formatMinutes(phase.next.seconds)} ${phase.next.label}`}</span>
          {sound.locked && !phase.done && (
            <button className="phase-banner-sound" onClick={sound.unlock}>
              <Volume2 aria-hidden size={14} /> Ton beim Wechsel
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Ton erst nach einer Interaktion: jede Berührung der Seite gibt ihn frei, solange Phasen laufen. */
function useAudioUnlock(active: boolean) {
  const [locked, setLocked] = useState(true);
  const unlock = () => void unlockAudio().then((ok) => setLocked(!ok));
  useEffect(() => {
    if (!active) return;
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [active]);
  return { locked, unlock };
}
