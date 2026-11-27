import { slidePlannedMinutes, type SlideSchedule } from '@slides/shared';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { isBoolean, usePref } from '../../lib/prefs.ts';

/** Eintrag der Zusammenfassung; `false`/leer = Option steht auf dem Standard */
export type SummaryPart = string | false | null | undefined;

/**
 * Einklappbarer Bereich „Mehr Optionen“ im Folienformular: selten gebrauchte
 * Einstellungen (Erst aufdecken, Aufgabe, Ablaufplan …). Bewusst `<details>`:
 * Der Inhalt bleibt eingeklappt eingehängt (der Ablaufplan hält Entwürfe und
 * Speicher-Timer), und `<summary>` ist kein Formularfeld – lässt sich also auch
 * im gesperrten Formular (nur ansehen) aufklappen. Offen/zu merkt sich der Browser.
 */
export function MoreOptions({ summary, children }: { summary: SummaryPart[]; children: ReactNode }) {
  const [open, setOpen] = usePref('editor-more-options', false, isBoolean);
  const parts = summary.filter((p): p is string => typeof p === 'string' && p !== '');
  return (
    <details className="more-options" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <ChevronRight size={16} aria-hidden className="more-options-chevron" />
        <span>Mehr Optionen</span>
        {parts.length > 0 && <span className="more-options-summary small muted">{parts.join(' · ')}</span>}
      </summary>
      <div className="stack more-options-body">{children}</div>
    </details>
  );
}

/** Zusammenfassung des Ablaufplans einer Folie, z. B. „5 Min. · 3 Phasen · Countdown automatisch“ */
export function scheduleSummary(s: SlideSchedule | undefined): SummaryPart[] {
  if (!s) return [];
  const minutes = slidePlannedMinutes(s);
  return [
    minutes !== null && `${minutes} Min.`,
    s.phases.length > 0 && `${s.phases.length} ${s.phases.length === 1 ? 'Phase' : 'Phasen'}`,
    s.autoCountdown && 'Countdown automatisch',
  ];
}
