import type { HostCommand, HostView } from '@slides/shared';
import { Coffee, Square } from 'lucide-react';
import { CountdownBadge } from '../../components/Countdown.tsx';
import { isBoolean, usePref } from '../../lib/prefs.ts';
import '../../components/pause.css';

const DURATIONS = [5, 10, 15, 20, 30];

const formatAverage = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Pausenmodus im Steuerpult: starten (mit Dauer, optional Energie-Frage),
 * während der Pause Restzeit, „bereit“, Energie, Verlängern und Beenden.
 * Taste Z startet eine 10-Minuten-Pause bzw. beendet sie (presenterKeys.ts).
 */
export function PauseControl({ view, offset, command }: { view: HostView; offset: number; command: (cmd: HostCommand) => Promise<void> }) {
  const [question, setQuestion] = usePref('pause-question', true, isBoolean);
  const pause = view.pause;
  const stats = view.pauseStats;

  if (pause) {
    const answers = stats ? stats.energy.reduce((a, b) => a + b, 0) : 0;
    const max = stats ? Math.max(1, ...stats.energy) : 1;
    return (
      <span className="row pause-control">
        <CountdownBadge countdown={pause} offset={offset} className="pill" />
        {stats && (
          <span className="pause-stat" title="„Ich bin wieder da“ gemeldet / verbunden">
            bereit <strong className="tabular">{stats.ready}</strong> von <span className="tabular">{stats.connected}</span>
          </span>
        )}
        {stats && pause.question && (
          <span
            className="pause-stat"
            title={`Energie 1–5: ${stats.energy.map((n, i) => `${i + 1}: ${n}`).join(', ')}`}
            aria-label={
              stats.energyAverage === null
                ? 'Energie: noch keine Antworten'
                : `Energie im Schnitt ${formatAverage(stats.energyAverage)} von 5, ${answers} Antworten`
            }
          >
            Energie{' '}
            {stats.energyAverage === null ? (
              <span className="faint">–</span>
            ) : (
              <>
                <strong className="tabular">Ø {formatAverage(stats.energyAverage)}</strong>
                <span className="pause-bars" aria-hidden>
                  {stats.energy.map((n, i) => (
                    <span key={i} style={{ height: `${(n / max) * 100}%` }} />
                  ))}
                </span>
                <span className="faint tabular">({answers})</span>
              </>
            )}
          </span>
        )}
        <button className="btn btn-small" onClick={() => void command({ action: 'pause-extend', seconds: 300 })} title="Fünf Minuten mehr">
          +5 Min.
        </button>
        <button className="btn btn-small btn-ink" onClick={() => void command({ action: 'pause-end' })} title="Pause beenden (Taste Z)">
          <Square /> Pause beenden
        </button>
      </span>
    );
  }

  const start = (minutes: number) => void command({ action: 'pause-start', seconds: Math.round(minutes * 60), question });
  return (
    <span className="row pause-control">
      <label className="row" title="Pausenansicht auf Beamer und Handys (Taste Z: 10 Minuten)">
        <Coffee size={16} aria-hidden />
        <select
          className="select select-small"
          value=""
          aria-label="Pause starten"
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') {
              const input = window.prompt('Wie viele Minuten Pause?', '15');
              const minutes = input ? Number(input.replace(',', '.')) : NaN;
              if (minutes >= 1 && minutes <= 240) start(minutes);
            } else if (v) start(Number(v));
          }}
        >
          <option value="">Pause starten …</option>
          {DURATIONS.map((m) => (
            <option key={m} value={m}>
              {m} Minuten
            </option>
          ))}
          <option value="custom">Eigene Dauer …</option>
        </select>
      </label>
      <label className="row small" style={{ gap: 4 }} title="Auf den Handys fragen: Wie ist deine Energie? (1–5)">
        <input type="checkbox" checked={question} onChange={(e) => setQuestion(e.target.checked)} /> Energie-Frage
      </label>
    </span>
  );
}
