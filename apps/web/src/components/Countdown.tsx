import type { Countdown } from '@slides/shared';
import { Timer } from 'lucide-react';
import { useCountdown } from '../lib/live.ts';

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Restzeit des Countdowns – auf Beamer, Handy und im Steuerpult gleich. */
export function CountdownBadge({ countdown, offset, className = '' }: { countdown: Countdown | null; offset: number; className?: string }) {
  const remaining = useCountdown(countdown?.endsAt ?? null, offset);
  if (!countdown || remaining === null) return null;
  const done = remaining <= 0;
  return (
    <span className={`countdown-badge ${done ? 'is-done' : ''} ${className}`} role="timer" aria-live="off">
      <Timer aria-hidden />
      <span className="tabular">{done ? 'Zeit ist um' : formatRemaining(remaining)}</span>
    </span>
  );
}
