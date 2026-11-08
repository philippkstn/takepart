import type { HostCommand, HostView, InboxView } from '@slides/shared';
import { ArrowRight, Inbox } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ModItem } from './ModItem.tsx';

type Cmd = (cmd: HostCommand) => Promise<void>;

/**
 * Eingang im Kopf des Steuerpults: Parkplatz und jederzeit offene Fragen, egal
 * welche Folie gerade läuft. Der Zähler nennt, was seit dem letzten Öffnen neu ist.
 */
export function InboxButton({ view, command }: { view: HostView; command: Cmd }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const keys = view.inbox.flatMap((b) => b.posts.map((p) => `${b.slideId}:${p.id}`));
  // Was beim Laden schon da ist, gilt als gesehen
  const [seen, setSeen] = useState(() => new Set(keys));
  const unseen = keys.filter((k) => !seen.has(k)).length;

  useEffect(() => {
    if (open) setSeen(new Set(keys));
  }, [open, keys.join('|')]);

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

  if (view.inbox.length === 0) return null;
  const label = view.inbox.length > 1 ? 'Eingang' : view.inbox[0]!.kind === 'qa' ? 'Fragen' : 'Parkplatz';
  const pending = view.inbox.reduce((n, b) => n + b.posts.filter((p) => p.status === 'pending').length, 0);
  const total = view.inbox.reduce((n, b) => n + b.posts.filter((p) => p.status !== 'hidden').length, 0);

  return (
    <span className="presence" ref={ref}>
      <button
        className={`pill presence-pill ${unseen > 0 ? 'inbox-pill-new' : ''}`}
        title={`${label}: Parkplatz und Fragen von jeder Folie aus`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Inbox /> <span className="inbox-label">{label}</span>
        <span className="tabular">{total}</span>
        {unseen > 0 && <span className="inbox-new tabular">+{unseen}</span>}
      </button>
      {open && (
        <div className="presence-panel inbox-panel card" role="dialog" aria-label={label}>
          {pending > 0 && <p className="small muted">{pending === 1 ? 'Eine Frage wartet' : `${pending} Fragen warten`} auf Freigabe.</p>}
          <div className="inbox-boxes">
            {view.inbox.map((box) => (
              <InboxSection key={box.slideId} box={box} view={view} command={command} />
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

function InboxSection({ box, view, command }: { box: InboxView; view: HostView; command: Cmd }) {
  const [all, setAll] = useState(false);
  // Offenes zuerst (Freigabe), dann das Neueste oben
  const order = { pending: 0, visible: 1, answered: 2, hidden: 3 } as const;
  const posts = [...box.posts]
    .filter((p) => all || (p.status !== 'hidden' && p.status !== 'answered'))
    .sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt);
  const rest = box.posts.filter((p) => p.status === 'hidden' || p.status === 'answered').length;
  return (
    <section className="stack-s">
      <div className="inbox-head">
        <strong className="grow">{box.title}</strong>
        {box.here ? (
          <span className="small faint">wird gezeigt</span>
        ) : (
          <button
            className="btn btn-small"
            title="Diese Folie jetzt zeigen"
            disabled={view.run.ended}
            onClick={() => void command({ action: 'goto', slideId: box.slideId })}
          >
            Zeigen <ArrowRight />
          </button>
        )}
      </div>
      {posts.length === 0 ? (
        <p className="small faint">{box.kind === 'qa' ? 'Noch keine Fragen.' : 'Noch keine Karten.'}</p>
      ) : (
        <ul className="mod-list">
          {posts.map((p) => (
            <ModItem
              key={p.id}
              post={p}
              command={command}
              spotlight={view.state.spotlight}
              columns={box.tags.length > 0 ? box.tags : null}
              qa={box.kind === 'qa'}
              canSpotlight={box.here}
            />
          ))}
        </ul>
      )}
      {rest > 0 && (
        <button className="btn btn-small btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setAll(!all)}>
          {all ? 'Beantwortete und ausgeblendete verbergen' : `Beantwortete und ausgeblendete zeigen (${rest})`}
        </button>
      )}
    </section>
  );
}
