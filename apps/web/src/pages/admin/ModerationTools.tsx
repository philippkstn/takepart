import { countActive, SIGNAL_KINDS, SIGNAL_LABELS, type HostCommand, type HostView } from '@slides/shared';
import { Check, Dices, Eye, EyeOff, RotateCcw, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useServerNow } from '../../lib/serverNow.ts';
import './moderation.css';

type Cmd = (cmd: HostCommand) => Promise<void>;

/**
 * Handzeichen im Kopf des Steuerpults: Zähler je Art. Aktive Arten sind
 * hervorgehoben (Rahmen, Schrift, Häkchen – nicht nur Farbe) und lassen sich mit
 * einem Klick quittieren. Signale erlöschen nach drei Minuten; gezählt wird
 * anhand der Ablaufzeitpunkte, damit das auch ohne neue Ansicht passiert.
 */
export function SignalsBar({ view, offset, command }: { view: HostView; offset: number; command: Cmd }) {
  const any = SIGNAL_KINDS.some((k) => view.signals[k].length > 0);
  const now = useServerNow(offset, any, 1000);
  return (
    <span className="signals-bar" role="group" aria-label="Handzeichen aus dem Publikum">
      {SIGNAL_KINDS.map((kind) => {
        const n = countActive(view.signals[kind], now);
        const label = SIGNAL_LABELS[kind];
        return n > 0 ? (
          <button
            key={kind}
            className="signal-count is-active"
            onClick={() => command({ action: 'signals-clear', kind })}
            title={`${label}: ${n} – Klick quittiert („gesehen“) und setzt zurück`}
            aria-label={`${label}: ${n}. Quittieren`}
          >
            <span>{label}</span>
            <strong className="tabular">{n}</strong>
            <Check aria-hidden />
          </button>
        ) : (
          <span key={kind} className="signal-count" title={`${label}: keine Handzeichen`}>
            <span>{label}</span>
            <span className="tabular">0</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Teilnehmerzahl mit aufklappbarer Anwesenheitsliste: wer mit Namen verbunden
 * oder getrennt ist, ab 20 Personen durchsuchbar.
 */
export function PresenceButton({ view }: { view: HostView }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const { people, unnamed } = view.presence;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const term = search.trim().toLocaleLowerCase('de');
  const shown = term ? people.filter((p) => p.name.toLocaleLowerCase('de').includes(term)) : people;
  const onlineNamed = people.filter((p) => p.online).length;

  return (
    <span className="presence" ref={ref}>
      <button
        className="pill presence-pill"
        title="Verbundene Teilnehmende – Klick zeigt, wer da ist"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Users /> <span className="tabular">{view.participants}</span>
      </button>
      {open && (
        <div className="presence-panel card" role="dialog" aria-label="Anwesenheit">
          <div className="presence-summary small muted">
            <span>
              <strong className="tabular">{view.participants}</strong> verbunden
            </span>
            <span className="tabular">
              {onlineNamed} / {people.length} mit Namen
            </span>
          </div>
          {people.length > 20 && (
            <input
              className="input"
              type="search"
              placeholder="Name suchen …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Name suchen"
              autoFocus
            />
          )}
          {people.length === 0 ? (
            <p className="small faint">Noch niemand hat einen Namen eingegeben.</p>
          ) : (
            <ul className="presence-list">
              {shown.map((p, i) => (
                <li key={`${p.name}-${i}`} className={p.online ? '' : 'is-offline'}>
                  <span className={`presence-dot ${p.online ? 'is-online' : ''}`} aria-hidden />
                  <span className="grow">{p.name}</span>
                  <span className="small faint">{p.online ? 'verbunden' : 'getrennt'}</span>
                </li>
              ))}
              {shown.length === 0 && <li className="small faint">Kein Treffer</li>}
            </ul>
          )}
          {unnamed.total > 0 && (
            <p className="small muted">
              Ohne Namen: <span className="tabular">{unnamed.total}</span>
              {' · '}
              <span className="tabular">{unnamed.online}</span> verbunden
            </p>
          )}
        </div>
      )}
    </span>
  );
}

/** Zufallsauswahl („Wer startet?“): ziehen ohne Wiederholung, optional aus einer Gruppe, auf Wunsch auf dem Beamer */
export function PickerControl({ view, command, busy }: { view: HostView; command: Cmd; busy: boolean }) {
  const picker = view.picker;
  const [team, setTeam] = useState<number | null>(null);
  // Einteilung hat sich geändert: Auswahl zurücksetzen
  const group = team !== null ? picker.groups[team] : undefined;
  useEffect(() => {
    if (team !== null && team >= picker.groups.length) setTeam(null);
  }, [team, picker.groups.length]);
  const remaining = group ? group.remaining : picker.remaining;

  return (
    <div className="control-group" role="group" aria-label="Zufallsauswahl">
      <span className="control-group-label">Zufall</span>
      <div className="control-group-items picker-items">
        {picker.groups.length > 0 && (
          <select
            className="select select-small"
            value={team ?? ''}
            onChange={(e) => setTeam(e.target.value === '' ? null : Number(e.target.value))}
            aria-label="Aus welcher Gruppe ziehen"
          >
            <option value="">Alle</option>
            {picker.groups.map((g, i) => (
              <option key={g.name} value={i}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn btn-small"
          onClick={() => command({ action: 'pick-draw', team })}
          disabled={busy || remaining === 0}
          title={`Zufällig eine Person mit Namen ziehen (noch ${remaining})`}
        >
          <Dices /> Ziehen
        </button>
        {picker.current && (
          <>
            <strong className="picker-name" title={picker.current}>
              {picker.current}
            </strong>
            <button
              className={`btn btn-small ${picker.shown ? 'btn-ink' : ''}`}
              onClick={() => command({ action: picker.shown ? 'pick-hide' : 'pick-show' })}
              disabled={busy}
            >
              {picker.shown ? <EyeOff /> : <Eye />} {picker.shown ? 'Ausblenden' : 'Auf Beamer'}
            </button>
          </>
        )}
        {picker.drawn > 0 && (
          <button
            className="icon-btn"
            onClick={() => command({ action: 'pick-reset' })}
            disabled={busy}
            title={`Neu starten – ${picker.drawn} bereits gezogen, alle wieder im Topf`}
            aria-label="Zufallsauswahl neu starten"
          >
            <RotateCcw />
          </button>
        )}
      </div>
      <span className="small faint tabular">
        {remaining === 0 && picker.drawn > 0 ? 'Alle gezogen – neu starten' : `noch ${remaining} im Topf`}
      </span>
    </div>
  );
}
