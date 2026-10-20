import { formatPlanDelta, planStatus, type HostCommand, type HostView } from '@slides/shared';
import { ListOrdered, Play } from 'lucide-react';
import { useEffect, useState } from 'react';

type Cmd = (cmd: HostCommand) => Promise<void>;

/**
 * Ablaufplan im Steuerpult: geplante Zeit der aktuellen Folie und Soll/Ist –
 * Summe der geplanten Minuten bis zur aktuellen Folie gegen die verstrichene
 * Vortragszeit. Nur Text, keine Farbe als einzige Information.
 */
export function PlanStatus({ view, offset }: { view: HostView; offset: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const planned = view.slides.map((s) => s.plannedMinutes ?? null);
  if (!planned.some((m) => m !== null) || view.slideIndex < 0) return null;
  const start = view.state.timerStartedAt ?? view.startedAt;
  const status = planStatus(planned, view.slideIndex, Math.max(0, now + offset - start));
  const current = planned[view.slideIndex];
  return (
    <span
      className="pill plan-status"
      title={`Plan: diese Folie von Minute ${status.before} bis ${status.through}${current ? ` (${current} Min.)` : ''}`}
    >
      <ListOrdered aria-hidden />
      <span className="tabular">
        {current ? `${current} Min. · ` : ''}
        {formatPlanDelta(status.delta)}
      </span>
    </span>
  );
}

/** Countdown der aktuellen Folie starten: ihre Phasen oder ihre geplante Dauer. */
export function SlideCountdownButton({ view, command }: { view: HostView; command: Cmd }) {
  const summary = view.slides.find((s) => s.id === view.slide?.id);
  if (!summary || !view.slide) return null;
  const phases = summary.phases ?? [];
  if (phases.length === 0 && !summary.plannedMinutes) return null;
  const label = phases.length > 0 ? `Phasen starten (${phases.length})` : `${summary.plannedMinutes} Min. starten`;
  const title =
    phases.length > 0
      ? phases.map((p, i) => `${i + 1}. ${p.label || `Phase ${i + 1}`} – ${p.minutes} Min.`).join('\n')
      : 'Geplante Dauer dieser Folie als Countdown';
  return (
    <button className="btn btn-small" title={title} onClick={() => void command({ action: 'countdown-slide', slideId: view.slide!.id })}>
      <Play /> {label}
    </button>
  );
}
