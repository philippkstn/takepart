import {
  activeCallback,
  callbackHeadline,
  type BreakoutView,
  type Callback,
  type HostCommand,
  type HostView,
  type PostView,
} from '@slides/shared';
import { Check, Megaphone, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import './breakout.css';

/**
 * Breakout: Karten nach Arbeitsgruppen (Beamer und Steuerpult), Stand je Gruppe
 * und der Sammelruf „Alle zurück ins Plenum“.
 */

/** „3 von 5 Gruppen fertig“ */
export function doneSummary(breakout: BreakoutView): string {
  return `${breakout.done} von ${breakout.teams.length} ${breakout.teams.length === 1 ? 'Gruppe' : 'Gruppen'} fertig`;
}

/** Karten nach Arbeitsgruppe; Karten ohne Gruppe (z. B. später Beigetretene) in eigener Spalte */
export function cardsByTeam(posts: PostView[]): Map<number | null, PostView[]> {
  const map = new Map<number | null, PostView[]>();
  for (const p of posts) {
    if (p.status !== 'visible') continue;
    const key = p.team ?? null;
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return map;
}

/** Bühne: Spalten „Gruppe 1“, „Gruppe 2“ … nebeneinander */
export function BreakoutWall({
  breakout,
  posts,
  renderCards,
}: {
  breakout: BreakoutView;
  posts: PostView[];
  renderCards: (posts: PostView[]) => ReactNode;
}) {
  const byTeam = cardsByTeam(posts);
  const loose = byTeam.get(null) ?? [];
  return (
    <div className="cluster-wall breakout-wall">
      {breakout.teams.map((t) => (
        <section key={t.index} className={`cluster-group ${t.done ? 'is-done' : ''}`}>
          <h2 className="cluster-name breakout-name">
            <span>
              {t.name} <span className="faint tabular">{t.cards}</span>
            </span>
            {t.done && (
              <span className="breakout-done">
                <Check aria-hidden /> fertig
              </span>
            )}
          </h2>
          {renderCards(byTeam.get(t.index) ?? [])}
        </section>
      ))}
      {loose.length > 0 && (
        <section className="cluster-group is-unsorted">
          <h2 className="cluster-name">
            Ohne Gruppe <span className="faint tabular">{loose.length}</span>
          </h2>
          {renderCards(loose)}
        </section>
      )}
    </div>
  );
}

type Cmd = (cmd: HostCommand) => Promise<void>;

/** Steuerpult: Stand je Gruppe mit Karten; die Moderation kann „fertig“ auch selbst setzen */
export function BreakoutPanel({ view, breakout, command }: { view: HostView; breakout: BreakoutView; command: Cmd }) {
  const slideId = view.slide!.id;
  const byTeam = cardsByTeam(view.posts);
  const loose = byTeam.get(null) ?? [];
  return (
    <div className="stack-s">
      <div className="row-between">
        <span className="label">Gruppenarbeit</span>
        <span className={`pill ${breakout.done === breakout.teams.length && breakout.teams.length > 0 ? 'pill-good' : ''}`}>
          {doneSummary(breakout)}
        </span>
      </div>
      <ul className="breakout-list">
        {breakout.teams.map((t) => (
          <li key={t.index} className="breakout-item">
            <details>
              <summary className="row-between">
                <span>
                  <strong>{t.name}</strong>{' '}
                  <span className="small muted tabular">
                    · {t.members} {t.members === 1 ? 'Person' : 'Personen'} · {t.cards} {t.cards === 1 ? 'Karte' : 'Karten'}
                  </span>
                </span>
                <span className={`pill ${t.done ? 'pill-good' : ''}`}>{t.done ? `${t.name} fertig ✓` : 'arbeitet noch'}</span>
              </summary>
              <ul className="breakout-cards">
                {(byTeam.get(t.index) ?? []).map((p) => (
                  <li key={p.id}>{p.text}</li>
                ))}
                {(byTeam.get(t.index) ?? []).length === 0 && <li className="faint">Noch keine Karten</li>}
              </ul>
              <button
                className="btn btn-small"
                onClick={() => void command({ action: 'team-done', slideId, team: t.index, done: !t.done })}
              >
                {t.done ? 'Zurücknehmen' : 'Als fertig markieren'}
              </button>
            </details>
          </li>
        ))}
        {loose.length > 0 && (
          <li className="breakout-item">
            <details>
              <summary className="row-between">
                <strong>Ohne Gruppe</strong>
                <span className="small muted tabular">{loose.length} Karten</span>
              </summary>
              <ul className="breakout-cards">
                {loose.map((p) => (
                  <li key={p.id}>{p.text}</li>
                ))}
              </ul>
            </details>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Gibt es in dieser Durchführung schon eine Einteilung? Dann lohnt der Sammelruf. */
export const hasTeams = (view: HostView) => Object.values(view.state.teams ?? {}).some((t) => t.length > 0);

/**
 * Sammelruf „Alle zurück ins Plenum“ mit optionalem Text und Minuten. Die Minuten
 * starten zusätzlich den normalen Countdown (Host-Befehl `countdown`).
 */
export function CallbackControl({ view, command, offset }: { view: HostView; command: Cmd; offset: number }) {
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState(0);
  const active = useActiveCallback(view.callback, offset);
  if (active) {
    return (
      <span className="row">
        <span className="pill pill-accent" title={active.text || undefined}>
          <Megaphone /> {callbackHeadline(active)}
        </span>
        <button className="btn btn-small" onClick={() => void command({ action: 'callback', callback: null })}>
          <X /> Sammelruf beenden
        </button>
      </span>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await command({ action: 'callback', callback: { text: text.trim(), minutes: minutes || null } });
    if (minutes) await command({ action: 'countdown', seconds: minutes * 60 });
    setText('');
  };
  return (
    <form className="row callback-control" onSubmit={submit}>
      <input
        className="input input-small"
        value={text}
        maxLength={200}
        placeholder="Hinweis (optional)"
        aria-label="Hinweis zum Sammelruf"
        onChange={(e) => setText(e.target.value)}
      />
      <select className="select select-small" value={minutes} aria-label="Wann zurück" onChange={(e) => setMinutes(Number(e.target.value))}>
        <option value={0}>sofort</option>
        {[1, 2, 3, 5, 10].map((m) => (
          <option key={m} value={m}>
            in {m} Min.
          </option>
        ))}
      </select>
      <button className="btn btn-small">
        <Megaphone /> Alle zurück ins Plenum
      </button>
    </form>
  );
}

/** Läuft der Sammelruf noch? Blendet ihn zum Ablauf von selbst aus. */
export function useActiveCallback(callback: Callback | null | undefined, offset: number): Callback | null {
  const [, tick] = useState(0);
  const active = activeCallback(callback, Date.now() + offset);
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.max(0, active.until - (Date.now() + offset)) + 50);
    return () => window.clearTimeout(t);
  }, [active, offset]);
  return active;
}

/** Sammelruf auf der Bühne: oben mittig, damit er den Countdown-Hinweis unten nicht verdeckt */
export function StageCallback({ callback, offset }: { callback: Callback | null | undefined; offset: number }) {
  const active = useActiveCallback(callback, offset);
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={active.at}
          className="stage-callback"
          role="alert"
          initial={{ y: '-140%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-140%', opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Megaphone aria-hidden />
          <span className="stage-callback-text">
            <strong>{callbackHeadline(active)}</strong>
            {active.text && <span>{active.text}</span>}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
