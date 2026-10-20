import { MAX_PHASES, scheduleInput, type SlideSchedule } from '@slides/shared';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';

/** Phase im Formular: Minuten als Text, damit das Feld leer sein darf */
interface PhaseDraft {
  label: string;
  minutes: string;
}

function toBody(planned: string, phases: PhaseDraft[], autoCountdown: boolean) {
  return scheduleInput.safeParse({
    plannedMinutes: planned.trim() ? Number(planned) : null,
    phases: phases.map((p) => ({ label: p.label, minutes: Number(p.minutes) })),
    autoCountdown,
  });
}

/**
 * Ablaufplan einer Folie – für alle Folientypen gleich: geplante Dauer,
 * Phasen für den Countdown und Auto-Start beim Öffnen der Folie. Speichert
 * verzögert wie die Sprechernotizen.
 */
export function ScheduleFields({
  slideId,
  initial,
  onSaved,
}: {
  slideId: number;
  initial: SlideSchedule;
  onSaved: (schedule: SlideSchedule) => void;
}) {
  const [planned, setPlanned] = useState(initial.plannedMinutes?.toString() ?? '');
  const [phases, setPhases] = useState<PhaseDraft[]>(initial.phases.map((p) => ({ label: p.label, minutes: String(p.minutes) })));
  const [auto, setAuto] = useState(initial.autoCountdown);
  const [state, setState] = useState<'idle' | 'pending' | 'saved' | 'error' | 'invalid'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<SlideSchedule | null>(null);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  const save = async (body: SlideSchedule) => {
    try {
      await api(`/api/slides/${slideId}`, { method: 'PATCH', body });
      setState('saved');
      savedRef.current(body);
    } catch {
      setState('error');
    }
  };

  const update = (next: { planned?: string; phases?: PhaseDraft[]; auto?: boolean }) => {
    const p = next.planned ?? planned;
    const ph = next.phases ?? phases;
    const a = next.auto ?? auto;
    if (next.planned !== undefined) setPlanned(p);
    if (next.phases !== undefined) setPhases(ph);
    if (next.auto !== undefined) setAuto(a);
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const parsed = toBody(p, ph, a);
    if (!parsed.success) {
      pending.current = null;
      setState('invalid');
      setMessage(parsed.error.issues[0]?.message ?? 'Ungültige Eingabe');
      return;
    }
    setMessage(null);
    const body: SlideSchedule = {
      plannedMinutes: parsed.data.plannedMinutes ?? null,
      phases: parsed.data.phases ?? [],
      autoCountdown: parsed.data.autoCountdown ?? false,
    };
    pending.current = body;
    setState('pending');
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      pending.current = null;
      void save(body);
    }, 600);
  };

  // Beim Wechsel der Folie Ausstehendes sofort speichern
  useEffect(
    () => () => {
      if (timer.current !== undefined && pending.current) {
        window.clearTimeout(timer.current);
        const body = pending.current;
        void api(`/api/slides/${slideId}`, { method: 'PATCH', body })
          .then(() => savedRef.current(body))
          .catch(() => {});
      }
    },
    [slideId],
  );

  const phaseTotal = phases.reduce((sum, p) => sum + (Number(p.minutes) || 0), 0);
  const status =
    state === 'pending'
      ? 'Speichert …'
      : state === 'saved'
        ? 'Gespeichert'
        : state === 'error'
          ? 'Nicht gespeichert'
          : state === 'invalid'
            ? message
            : 'nur für dich sichtbar';

  return (
    <div className="field schedule-fields">
      <span className="row-between">
        Ablaufplan
        <span className="faint" style={{ fontWeight: 500 }} role={state === 'invalid' ? 'alert' : undefined}>
          {status}
        </span>
      </span>
      <div className="row schedule-row">
        <label className="row small" style={{ gap: 6 }}>
          Geplante Dauer
          <input
            className="input minutes-input"
            type="number"
            min={1}
            max={600}
            step={1}
            inputMode="numeric"
            placeholder={phaseTotal > 0 ? String(phaseTotal) : '–'}
            value={planned}
            onChange={(e) => update({ planned: e.target.value })}
            aria-label="Geplante Dauer (Min.)"
          />
          Min.
        </label>
        <label className="switch small">
          <input type="checkbox" checked={auto} onChange={(e) => update({ auto: e.target.checked })} />
          Countdown beim Öffnen der Folie automatisch starten
        </label>
      </div>
      {phases.length > 0 && (
        <ol className="phase-edit">
          {phases.map((p, i) => (
            <li key={i}>
              <span className="faint tabular small">{i + 1}.</span>
              <input
                className="input"
                value={p.label}
                maxLength={60}
                placeholder={`Phase ${i + 1}, z. B. Rollenwechsel`}
                aria-label={`Bezeichnung Phase ${i + 1}`}
                onChange={(e) => update({ phases: phases.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              />
              <input
                className="input minutes-input"
                type="number"
                min={1}
                max={240}
                step={1}
                inputMode="numeric"
                value={p.minutes}
                aria-label={`Minuten Phase ${i + 1}`}
                onChange={(e) => update({ phases: phases.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)) })}
              />
              <span className="small muted">Min.</span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Phase ${i + 1} entfernen`}
                onClick={() => update({ phases: phases.filter((_, j) => j !== i) })}
              >
                <X />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="row small muted" style={{ gap: 10 }}>
        {phases.length < MAX_PHASES && (
          <button type="button" className="btn btn-small" onClick={() => update({ phases: [...phases, { label: '', minutes: '10' }] })}>
            <Plus /> Phase
          </button>
        )}
        <span>
          {phases.length > 0
            ? `Phasen zusammen ${phaseTotal} Min. – laufen im Countdown nacheinander ab.`
            : 'Phasen: z. B. 15 Min. Gespräch, 15 Min. Rollenwechsel, 10 Min. Karten schreiben.'}
        </span>
      </div>
    </div>
  );
}
