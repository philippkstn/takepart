import { TURN_SOURCES, type HostCommand, type HostView, type TurnSource } from '@slides/shared';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, RotateCcw, UserPlus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import './turns.css';

type Cmd = (cmd: HostCommand) => Promise<void>;

const SOURCE_LABELS: Record<TurnSource, string> = {
  joined: 'nach Beitritt',
  random: 'zufällig',
  board: 'nach erster Karte',
};

/**
 * Reihum: feste Redereihenfolge für die ganze Durchführung. Erzeugen (Beitritt,
 * Zufall, erste Karte auf einer Wand), umsortieren, weiterschalten und auf dem
 * Beamer zeigen. Die Reihenfolge bleibt beim Blättern stehen.
 */
export function TurnsPanel({ view, command, busy }: { view: HostView; command: Cmd; busy: boolean }) {
  const turns = view.turnsHost;
  const [source, setSource] = useState<TurnSource>('joined');
  const [board, setBoard] = useState(turns.boards[0] ?? '');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const has = turns.order.length > 0;
  const current = turns.current;

  // Wand gelöscht oder umbenannt: erste vorhandene wählen
  useEffect(() => {
    if (!turns.boards.includes(board)) setBoard(turns.boards[0] ?? '');
    if (source === 'board' && turns.boards.length === 0) setSource('joined');
  }, [turns.boards, board, source]);

  const make = () => {
    if (has && !window.confirm('Neue Reihenfolge erzeugen? Die bisherige wird ersetzt.')) return;
    void command({ action: 'turns-make', source, board: source === 'board' ? board : '' });
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) return;
    void command({ action: 'turns-add', name: n }).then(() => {
      setName('');
      setAdding(false);
    });
  };

  return (
    <div className="control-group turns-panel" role="group" aria-label="Reihum">
      <div className="turns-head">
        <span className="control-group-label">Reihum</span>
        {has && (
          <span className="small faint tabular">
            {current === null ? `${turns.order.length} Personen` : `${current + 1} von ${turns.order.length}`}
          </span>
        )}
      </div>

      <div className="turns-row">
        <select
          className="select select-small"
          value={source}
          onChange={(e) => setSource(e.target.value as TurnSource)}
          aria-label="Wie die Reihenfolge entsteht"
        >
          {TURN_SOURCES.filter((s) => s !== 'board' || turns.boards.length > 0).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        {source === 'board' && (
          <select className="select select-small" value={board} onChange={(e) => setBoard(e.target.value)} aria-label="Wand">
            {turns.boards.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-small" onClick={make} disabled={busy || (source === 'board' && !board)}>
          {has ? 'Neu erzeugen' : 'Reihenfolge erzeugen'}
        </button>
      </div>

      {has && (
        <>
          <div className="turns-row">
            <button
              className="btn btn-small"
              onClick={() => command({ action: 'turns-step', delta: -1 })}
              disabled={busy || current === null || current === 0}
              aria-label="Vorige Person"
            >
              <ChevronLeft /> Zurück
            </button>
            <button
              className="btn btn-small btn-ink"
              onClick={() => command({ action: 'turns-step', delta: 1 })}
              disabled={busy}
            >
              {current === null ? 'Runde starten' : current === turns.order.length - 1 ? 'Runde beenden' : 'Weiter'} <ChevronRight />
            </button>
            {current !== null && (
              <button className="btn btn-small" onClick={() => command({ action: 'turns-go', index: null })} disabled={busy}>
                Runde beenden
              </button>
            )}
            <button
              className={`btn btn-small ${turns.shown ? 'btn-ink' : ''}`}
              onClick={() => command({ action: 'turns-show', visible: !turns.shown })}
              disabled={busy}
              aria-pressed={turns.shown}
              title="Ganze Reihenfolge groß auf dem Beamer"
            >
              {turns.shown ? <EyeOff /> : <Eye />} {turns.shown ? 'Liste ausblenden' : 'Liste auf Beamer'}
            </button>
            <button
              className="icon-btn"
              onClick={() => window.confirm('Reihenfolge löschen?') && void command({ action: 'turns-clear' })}
              disabled={busy}
              title="Reihenfolge löschen"
              aria-label="Reihenfolge löschen"
            >
              <RotateCcw />
            </button>
          </div>

          <ol className="turns-list">
            {turns.order.map((p, i) => {
              const state = current === null ? '' : i === current ? 'is-current' : i < current ? 'is-done' : '';
              return (
                <li key={p.id} className={state}>
                  <span className="turns-pos tabular" aria-hidden>
                    {i + 1}
                  </span>
                  <span className={`presence-dot ${p.online ? 'is-online' : ''}`} title={p.online ? 'verbunden' : 'getrennt'} />
                  <button
                    className="turns-name"
                    onClick={() => command({ action: 'turns-go', index: i === current ? null : i })}
                    disabled={busy}
                    aria-current={i === current ? 'true' : undefined}
                    title={i === current ? 'Ist dran – Klick: niemand ist dran' : 'Ist jetzt dran'}
                  >
                    {p.name}
                    {i === current && <span className="turns-badge">dran</span>}
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => command({ action: 'turns-move', participantId: p.id, delta: -1 })}
                    disabled={busy || i === 0}
                    aria-label={`${p.name} nach oben`}
                  >
                    <ChevronUp />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => command({ action: 'turns-move', participantId: p.id, delta: 1 })}
                    disabled={busy || i === turns.order.length - 1}
                    aria-label={`${p.name} nach unten`}
                  >
                    <ChevronDown />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => command({ action: 'turns-remove', participantId: p.id })}
                    disabled={busy}
                    aria-label={`${p.name} aus der Reihenfolge nehmen`}
                    title="Aus der Reihenfolge nehmen"
                  >
                    <X />
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="turns-row">
        {turns.missing > 0 && (
          <button
            className="btn btn-small"
            onClick={() => command({ action: 'turns-fill' })}
            disabled={busy}
            title="Personen mit Namen, die noch nicht in der Reihenfolge stehen, hinten anhängen"
          >
            Fehlende anhängen ({turns.missing})
          </button>
        )}
        {adding ? (
          <form className="turns-add" onSubmit={add}>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Name"
              aria-label="Name der Person ohne Handy"
              autoFocus
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            />
            <button className="btn btn-small" disabled={busy || name.trim().length < 2}>
              Anhängen
            </button>
          </form>
        ) : (
          <button className="btn btn-small" onClick={() => setAdding(true)} disabled={busy} title="Person ohne Gerät hinten anhängen">
            <UserPlus /> Person ohne Handy
          </button>
        )}
      </div>
    </div>
  );
}
