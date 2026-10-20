import { ChevronDown, ChevronRight, FlaskConical, Radio, Trash2 } from 'lucide-react';
import { Link } from 'react-router';

interface RehearsalItem {
  id: number;
  startedAt: string;
  endedAt: string | null;
  participants: number;
}

/** Probeläufe im Editor: eigene, zuklappbare Gruppe unter den Durchführungen, mit „alle löschen“. */
export function RehearsalList({
  runs,
  open,
  onToggle,
  onRemoveAll,
}: {
  runs: RehearsalItem[];
  open: boolean;
  onToggle: () => void;
  onRemoveAll: () => void;
}) {
  if (runs.length === 0) return null;
  return (
    <div className="stack-s rehearsal-list">
      <div className="row-between">
        <button className="btn btn-ghost btn-small" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronDown /> : <ChevronRight />}
          <FlaskConical /> Probeläufe ({runs.length})
        </button>
        <button className="btn btn-ghost btn-small" onClick={onRemoveAll}>
          <Trash2 /> Alle löschen
        </button>
      </div>
      {open && (
        <ul className="run-list">
          {runs.map((r) => (
            <li key={r.id}>
              <span className="grow">
                <strong>{new Date(r.startedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
                <span className="small faint"> · Probelauf · {r.participants} Teilnehmende</span>
              </span>
              {r.endedAt ? (
                <Link className="btn btn-small" to={`/admin/runs/${r.id}`}>
                  Ergebnisse
                </Link>
              ) : (
                <Link className="btn btn-small" to={`/admin/live/${r.id}`}>
                  <Radio /> Läuft
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
