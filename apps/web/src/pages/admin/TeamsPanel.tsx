import type { HostCommand, HostView, TeamMember } from '@slides/shared';
import { Shuffle, UserPlus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

type Cmd = (cmd: HostCommand) => Promise<void>;
type TeamsSlide = Extract<NonNullable<HostView['slide']>, { type: 'teams' }>;

/**
 * Gruppen bilden im Steuerpult: Anzahl oder Größe wählen, auf Wunsch nach
 * Kennzeichnung mischen, Nachzügler verteilen und einzelne Personen verschieben.
 */
export function TeamsPanel({ view, command, busy }: { view: HostView; command: Cmd; busy: boolean }) {
  const slide = view.slide as TeamsSlide;
  const teams = view.teams ?? { groups: [], unassigned: [], unnamed: 0 };
  const { tags } = slide.config;
  const [mode, setMode] = useState<'count' | 'size'>('size');
  const [n, setN] = useState(2);
  const [mix, setMix] = useState(tags.length > 0);
  const [guest, setGuest] = useState('');
  const [guestTag, setGuestTag] = useState<number | null>(null);
  const named = teams.unassigned.length + teams.groups.reduce((sum, g) => sum + g.members.length, 0);
  const made = teams.groups.length > 0;
  const tagOf = (m: TeamMember) => (m.tag === null ? null : (tags[m.tag] ?? null));

  const make = () => {
    if (made && !window.confirm('Gruppen neu mischen? Die bisherige Einteilung geht verloren.')) return;
    void command({ action: 'teams-make', slideId: slide.id, mode, n, mix });
  };
  const addGuest = async (e: FormEvent) => {
    e.preventDefault();
    if (guest.trim().length < 2) return;
    await command({ action: 'teams-add', slideId: slide.id, name: guest.trim(), tag: guestTag });
    setGuest('');
  };
  const move = (m: TeamMember, team: number | null) =>
    m.id !== undefined && void command({ action: 'teams-move', slideId: slide.id, participantId: m.id, team });

  const person = (m: TeamMember, current: number | null) => (
    <li key={m.id} className="mod-item">
      <div className="mod-text">
        <span>
          {m.name}
          {tagOf(m) && <span className="faint"> · {tagOf(m)}</span>}
        </span>
      </div>
      {made && (
        <select
          className="select select-small"
          aria-label={`${m.name} verschieben`}
          value={current ?? ''}
          disabled={busy}
          onChange={(e) => move(m, e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">ohne Gruppe</option>
          {teams.groups.map((g, i) => (
            <option key={i} value={i}>
              {g.name}
            </option>
          ))}
        </select>
      )}
    </li>
  );

  return (
    <div className="stack">
      <div className="row-between">
        <h3>Gruppen bilden</h3>
        <span className="pill tabular">
          {named} mit Namen{teams.unnamed > 0 && ` · ${teams.unnamed} ohne`}
        </span>
      </div>

      <div className="stack-s">
        <div className="row">
          <div className="segmented" role="group" aria-label="Einteilen nach">
            <button aria-pressed={mode === 'size'} onClick={() => setMode('size')}>
              Gruppengröße
            </button>
            <button aria-pressed={mode === 'count'} onClick={() => setMode('count')}>
              Anzahl Gruppen
            </button>
          </div>
          <select className="select select-small" value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Zahl">
            {Array.from({ length: mode === 'size' ? 9 : 19 }, (_, i) => i + 2).map((v) => (
              <option key={v} value={v}>
                {mode === 'size' ? `je ${v} Personen` : `${v} Gruppen`}
              </option>
            ))}
          </select>
        </div>
        {tags.length > 0 && (
          <label className="switch small">
            <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
            Nach Kennzeichnung mischen ({tags.join(', ')})
          </label>
        )}
        <div className="row">
          <button className="btn btn-primary btn-small" disabled={busy || named === 0} onClick={make}>
            <Shuffle /> {made ? 'Neu mischen' : 'Gruppen bilden'}
          </button>
          {made && teams.unassigned.length > 0 && (
            <button className="btn btn-small" disabled={busy} onClick={() => command({ action: 'teams-fill', slideId: slide.id })}>
              <UserPlus /> {teams.unassigned.length} Nachzügler verteilen
            </button>
          )}
        </div>
        {mode === 'size' && <p className="small faint">Bleibt jemand übrig, wird eine Gruppe größer – niemand bleibt allein.</p>}
        {teams.unnamed > 0 && (
          <p className="small faint">
            {teams.unnamed} {teams.unnamed === 1 ? 'Person hat' : 'Personen haben'} noch keinen Namen eingegeben und wird erst danach
            eingeteilt.
          </p>
        )}
      </div>

      <form className="stack-s" onSubmit={addGuest}>
        <span className="label">Person ohne Handy hinzufügen</span>
        <div className="row">
          <input
            className="input grow"
            value={guest}
            maxLength={40}
            placeholder="Name"
            onChange={(e) => setGuest(e.target.value)}
            aria-label="Name der Person ohne Handy"
          />
          {tags.length > 0 && (
            <select
              className="select select-small"
              value={guestTag ?? ''}
              aria-label="Kennzeichnung"
              onChange={(e) => setGuestTag(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">ohne Angabe</option>
              {tags.map((t, i) => (
                <option key={i} value={i}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-small" disabled={busy || guest.trim().length < 2}>
            <UserPlus /> Hinzufügen
          </button>
        </div>
        {made && <p className="small faint">Kommt in die kleinste Gruppe – danach bei Bedarf verschieben.</p>}
      </form>

      {teams.groups.map((g, i) => (
        <div key={i} className="stack-s">
          <span className="label">
            {g.name} ({g.members.length})
          </span>
          <ul className="mod-list">{g.members.map((m) => person(m, i))}</ul>
        </div>
      ))}

      {teams.unassigned.length > 0 && (
        <div className="stack-s">
          <span className="label">{made ? `Ohne Gruppe (${teams.unassigned.length})` : `Mit Namen (${teams.unassigned.length})`}</span>
          <ul className="mod-list">{teams.unassigned.map((m) => person(m, null))}</ul>
        </div>
      )}

      {made && (
        <div className="row panel-footer">
          <button
            className="btn btn-small btn-danger"
            disabled={busy}
            onClick={() => window.confirm('Einteilung verwerfen?') && command({ action: 'teams-clear', slideId: slide.id })}
          >
            <X /> Einteilung verwerfen
          </button>
        </div>
      )}
    </div>
  );
}
