import { currentPhase, type Countdown } from '@slides/shared';
import { Timer } from 'lucide-react';
import { useCountdown } from '../lib/live.ts';

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Minuten aus Sekunden, für „danach: 10 Min. …“ */
export function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 1 ? `${m} Min.` : `${seconds} Sek.`;
}

/**
 * Restzeit des Countdowns – auf Beamer, Handy und im Steuerpult gleich. Bei
 * Phasen: Restzeit und Bezeichnung der aktuellen Phase.
 */
export function CountdownBadge({ countdown, offset, className = '' }: { countdown: Countdown | null; offset: number; className?: string }) {
  const remaining = useCountdown(countdown?.endsAt ?? null, offset);
  if (!countdown || remaining === null) return null;
  const done = remaining <= 0;
  const phase = currentPhase(countdown, countdown.endsAt - remaining);
  const phaseLeft = phase ? Math.max(0, phase.endsAt - (countdown.endsAt - remaining)) : remaining;
  return (
    <span
      className={`countdown-badge ${done ? 'is-done' : ''} ${className}`}
      role="timer"
      aria-live="off"
      title={phase ? `Phase ${phase.index + 1} von ${phase.count}: ${phase.label}` : undefined}
    >
      <Timer aria-hidden />
      {phase && !done && (
        <span className="countdown-phase">
          {phase.label} <span className="countdown-phase-count tabular">{`${phase.index + 1}/${phase.count}`}</span>
        </span>
      )}
      <span className="tabular">{done ? 'Zeit ist um' : formatRemaining(phaseLeft)}</span>
    </span>
  );
}
