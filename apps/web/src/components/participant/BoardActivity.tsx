import {
  BOARD_MODE_LABELS,
  cardKey,
  type BoardOp,
  type ParkingView,
  type ParticipantView,
  type PostView,
  type PublicSlide,
  type ResponsePayloads,
} from '@slides/shared';
import { Check, Hourglass, Lock, Minus, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { cardsByGroup, labelOf } from '../../lib/board.ts';
import { useToast } from '../ui.tsx';

type BoardSlide = Extract<PublicSlide, { type: 'board' }>;
type Config = BoardSlide['config'];

function useSend(token: string) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const send = async (path: string, body: unknown, method?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await api(path, { body, participant: token, method });
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { send, busy };
}

function Head({ config }: { config: Config }) {
  return (
    <div className="stack-s anim-rise">
      <span className="p-kicker">
        {BOARD_MODE_LABELS[config.mode]} · {config.board}
      </span>
      {config.prompt && <h1 className="p-question">{config.prompt}</h1>}
    </div>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="info-box">
      {icon}
      <div>{children}</div>
    </div>
  );
}

/** Kartenwand auf dem Handy – je nach Modus sammeln, einordnen, punkten oder bewerten. */
export function BoardActivity({ view, slide, token }: { view: ParticipantView; slide: BoardSlide; token: string }) {
  const config = slide.config;
  return (
    <div className="stack">
      <Head config={config} />
      {config.mode === 'collect' && <Collect view={view} slide={slide} token={token} />}
      {(config.mode === 'cluster' || config.mode === 'place') && <Arrange view={view} slide={slide} token={token} />}
      {config.mode === 'dots' && <Dots view={view} slide={slide} token={token} />}
      {config.mode === 'rate' && <Rate view={view} slide={slide} token={token} />}
      {config.mode === 'table' && <TableView view={view} slide={slide} />}
    </div>
  );
}

/* ───────────── Karten schreiben ───────────── */

export function CardComposer({
  slideId,
  tags,
  remaining,
  token,
  placeholder = 'Eine Idee pro Karte …',
}: {
  slideId: number;
  tags: string[];
  remaining: number;
  token: string;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [tag, setTag] = useState<number | null>(null);
  const { send, busy } = useSend(token);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await send('/api/p/posts', { slideId, text, column: tag ?? undefined })) setText('');
  };
  if (remaining <= 0) return <Note icon={<Check size={20} />}>Alle Karten geschrieben. Du kannst sie unten noch ändern.</Note>;
  return (
    <form className="compose" onSubmit={submit}>
      {tags.length > 0 && (
        <div className="segmented" role="group" aria-label="Kennzeichnung" style={{ flexWrap: 'wrap', justifySelf: 'start' }}>
          {tags.map((t, i) => (
            <button type="button" key={i} aria-pressed={tag === i} onClick={() => setTag(tag === i ? null : i)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={300}
        rows={3}
      />
      <div className="row-between">
        <span className="char-count tabular">
          noch {remaining} {remaining === 1 ? 'Karte' : 'Karten'}
        </span>
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          Karte anheften <Send />
        </button>
      </div>
    </form>
  );
}

/** Eigene Karte: ändern oder löschen, solange gesammelt wird */
export function OwnCard({ post, tags, token, editable }: { post: PostView; tags: string[]; token: string; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(post.text);
  const [tag, setTag] = useState<number | null>(post.column);
  const { send, busy } = useSend(token);
  if (editing) {
    return (
      <li className="post board-own">
        <form
          className="compose grow"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send(`/api/p/posts/${post.id}`, { text, column: tag }, 'PATCH')) setEditing(false);
          }}
        >
          {tags.length > 0 && (
            <div className="segmented" role="group" aria-label="Kennzeichnung" style={{ flexWrap: 'wrap', justifySelf: 'start' }}>
              {tags.map((t, i) => (
                <button type="button" key={i} aria-pressed={tag === i} onClick={() => setTag(tag === i ? null : i)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <textarea className="textarea" value={text} maxLength={300} rows={3} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="row">
            <button className="btn btn-primary btn-small" disabled={busy || !text.trim()}>
              <Check /> Speichern
            </button>
            <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className={`post ${post.status === 'hidden' ? 'is-pending' : ''}`}>
      <div className="post-body">
        <span className="post-text">{post.text}</span>
        <span className="post-meta">
          {post.column !== null && tags[post.column] && <span className="pill">{tags[post.column]}</span>}
          {post.status === 'hidden' && <span className="pill pill-warn">Von der Moderation ausgeblendet</span>}
        </span>
      </div>
      {editable && (
        <span className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
          <button className="icon-btn" aria-label="Karte ändern" onClick={() => setEditing(true)}>
            <Pencil />
          </button>
          <button
            className="icon-btn"
            aria-label="Karte löschen"
            disabled={busy}
            onClick={() => window.confirm('Karte löschen?') && send(`/api/p/posts/${post.id}`, undefined, 'DELETE')}
          >
            <Trash2 />
          </button>
        </span>
      )}
    </li>
  );
}

function Collect({ view, slide, token }: { view: ParticipantView; slide: BoardSlide; token: string }) {
  const { tags } = slide.config;
  return (
    <>
      {view.locked ? (
        <Note icon={<Lock size={20} />}>Die Sammelphase ist beendet.</Note>
      ) : (
        <CardComposer slideId={slide.id} tags={tags} remaining={view.board?.remaining ?? 0} token={token} />
      )}
      {view.posts.length > 0 && (
        <div className="stack-s">
          <span className="label">Deine Karten ({view.posts.length})</span>
          <ul className="post-list">
            {view.posts.map((p) => (
              <OwnCard key={p.id} post={p} tags={tags} token={token} editable={!view.locked} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/* ───────────── Clustern & Zuordnen ───────────── */

function Arrange({ view, slide, token }: { view: ParticipantView; slide: BoardSlide; token: string }) {
  const board = view.board!;
  const config = slide.config;
  const { send, busy } = useSend(token);
  const op = (o: BoardOp) => send('/api/p/board', { slideId: slide.id, op: o });
  const rights = view.locked ? 'host' : board.rights;
  const all = rights === 'all';

  if (rights === 'host') {
    const own = view.posts.filter((p) => p.mine);
    return (
      <>
        <Note icon={<Hourglass size={20} />}>
          {view.locked ? 'Die Wand ist geschlossen.' : 'Die Moderation ordnet die Karten – schau auf die Präsentation.'}
        </Note>
        {config.mode === 'cluster' && own.length > 0 && (
          <div className="stack-s">
            <span className="label">Deine Karten</span>
            <ul className="post-list">
              {own.map((p) => (
                <li key={p.id} className="post">
                  <div className="post-body">
                    <span className="post-text">{p.text}</span>
                    <span className="post-meta">
                      <span className="pill">{board.groups.find((g) => g.id === p.group)?.name ?? 'noch nicht eingeordnet'}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  if (config.mode === 'place') {
    const options = config.lanes.flatMap((lane, l) =>
      lane.cells.map((cell, c) => ({ value: `${l}:${c}`, label: lane.title ? `${lane.title} · ${cell}` : cell })),
    );
    // Gemeinsam: alle Einträge der Folie (Karten oder Gruppen), sonst nur eigene Karten
    const ownKeys = new Set(view.posts.filter((p) => p.mine).map((p) => cardKey(p.id)));
    const keys = all ? board.targets : board.targets.filter((k) => ownKeys.has(k));
    if (keys.length === 0) return <Note icon={<Hourglass size={20} />}>Hier gibt es für dich nichts einzuordnen.</Note>;
    return (
      <div className="stack-s">
        <span className="label">{all ? 'Alle Einträge – wähle das passende Feld' : 'Deine Karten – wähle das passende Feld'}</span>
        <ul className="post-list">
          {keys.map((key) => {
            const place = board.places[key];
            return (
              <li key={key} className="post board-arrange">
                <span className="post-text">{labelOf(key, view.posts, board)}</span>
                <select
                  className="select"
                  aria-label="Feld"
                  disabled={busy}
                  value={place ? `${place.lane}:${place.cell}` : ''}
                  onChange={(e) => {
                    const [lane, cell] = e.target.value ? e.target.value.split(':').map(Number) : [null, null];
                    void op({ op: 'place', key, lane: lane ?? null, cell: cell ?? null });
                  }}
                >
                  <option value="">Noch nicht eingeordnet</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return <ClusterEditor view={view} op={op} busy={busy} all={all} />;
}

/** Clustern auf dem Handy: Karte antippen, dann Gruppe wählen oder neue Gruppe anlegen. */
function ClusterEditor({
  view,
  op,
  busy,
  all,
}: {
  view: ParticipantView;
  op: (o: BoardOp) => Promise<boolean>;
  busy: boolean;
  all: boolean;
}) {
  const board = view.board!;
  const byGroup = cardsByGroup(view.posts);
  const [selected, setSelected] = useState<number | null>(null);
  const [newGroup, setNewGroup] = useState('');
  const [newCard, setNewCard] = useState('');
  const [editing, setEditing] = useState<{ kind: 'card' | 'group'; id: number; text: string } | null>(null);
  const card = view.posts.find((p) => p.id === selected) ?? null;

  const moveTo = async (groupId: number | null) => {
    if (selected === null) return;
    if (await op({ op: 'assign', postId: selected, groupId })) setSelected(null);
  };
  const createGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!newGroup.trim()) return;
    // Eigene Rechte: eine neue Gruppe entsteht immer mit der gewählten Karte
    if (await op({ op: 'group-add', name: newGroup.trim(), postIds: selected !== null ? [selected] : [] })) {
      setNewGroup('');
      setSelected(null);
    }
  };
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.text.trim()) return;
    const ok =
      editing.kind === 'card'
        ? await op({ op: 'card-edit', postId: editing.id, text: editing.text.trim() })
        : await op({ op: 'group-rename', groupId: editing.id, name: editing.text.trim() });
    if (ok) setEditing(null);
  };

  const cardItem = (p: PostView) => (
    <li key={p.id}>
      {editing?.kind === 'card' && editing.id === p.id ? (
        <form className="row board-edit" onSubmit={saveEdit}>
          <input
            className="input grow"
            value={editing.text}
            maxLength={300}
            autoFocus
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          <button className="icon-btn" aria-label="Speichern">
            <Check />
          </button>
          <button type="button" className="icon-btn" aria-label="Abbrechen" onClick={() => setEditing(null)}>
            <X />
          </button>
        </form>
      ) : (
        <div className={`board-chip ${selected === p.id ? 'is-selected' : ''}`}>
          <button className="board-chip-main" aria-pressed={selected === p.id} onClick={() => setSelected(selected === p.id ? null : p.id)}>
            {p.text}
            {p.mine && <span className="pill">Von dir</span>}
          </button>
          {all && (
            <button className="icon-btn" aria-label="Karte ändern" onClick={() => setEditing({ kind: 'card', id: p.id, text: p.text })}>
              <Pencil />
            </button>
          )}
        </div>
      )}
    </li>
  );

  return (
    <div className="stack">
      <p className="small muted">
        {all
          ? 'Ihr ordnet gemeinsam: Karte antippen, dann die passende Gruppe wählen. Überschriften und Karten lassen sich ändern.'
          : 'Ordne deine Karten ein: Karte antippen, dann die passende Gruppe wählen.'}
      </p>

      {card && (
        <div className="card card-pad stack-s board-move anim-rise">
          <span className="label">„{card.text.slice(0, 60)}“ verschieben nach</span>
          <div className="board-targets">
            {board.groups.map((g) => (
              <button key={g.id} className="btn btn-small" disabled={busy || card.group === g.id} onClick={() => moveTo(g.id)}>
                {g.name}
              </button>
            ))}
            {card.group !== null && card.group !== undefined && (
              <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => moveTo(null)}>
                Zurück in die Ablage
              </button>
            )}
          </div>
          <form className="row" onSubmit={createGroup}>
            <input
              className="input grow"
              value={newGroup}
              maxLength={120}
              placeholder="… oder neue Gruppe"
              onChange={(e) => setNewGroup(e.target.value)}
            />
            <button className="btn btn-small" disabled={busy || !newGroup.trim()}>
              <Plus /> Anlegen
            </button>
          </form>
        </div>
      )}

      {(byGroup.get(null)?.length ?? 0) > 0 && (
        <section className="stack-s">
          <span className="label">Noch nicht eingeordnet</span>
          <ul className="board-chips">{byGroup.get(null)!.map(cardItem)}</ul>
        </section>
      )}

      {board.groups.map((g) => {
        const cards = byGroup.get(g.id) ?? [];
        return (
          <section key={g.id} className="board-group">
            {editing?.kind === 'group' && editing.id === g.id ? (
              <form className="row board-edit" onSubmit={saveEdit}>
                <input
                  className="input grow"
                  value={editing.text}
                  maxLength={120}
                  autoFocus
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                />
                <button className="icon-btn" aria-label="Speichern">
                  <Check />
                </button>
                <button type="button" className="icon-btn" aria-label="Abbrechen" onClick={() => setEditing(null)}>
                  <X />
                </button>
              </form>
            ) : (
              <h3 className="row-between">
                <span>
                  {g.name} <span className="faint tabular">{g.cards}</span>
                </span>
                {all && (
                  <button
                    className="icon-btn"
                    aria-label="Überschrift ändern"
                    onClick={() => setEditing({ kind: 'group', id: g.id, text: g.name })}
                  >
                    <Pencil />
                  </button>
                )}
              </h3>
            )}
            {cards.length > 0 ? (
              <ul className="board-chips">{cards.map(cardItem)}</ul>
            ) : (
              !all && <p className="small faint">Weitere Karten an der Wand</p>
            )}
          </section>
        );
      })}

      {all && (
        <div className="stack-s">
          {!card && (
            <form className="row" onSubmit={createGroup}>
              <input
                className="input grow"
                value={newGroup}
                maxLength={120}
                placeholder="Neue Gruppe"
                onChange={(e) => setNewGroup(e.target.value)}
              />
              <button className="btn btn-small" disabled={busy || !newGroup.trim()}>
                <Plus /> Gruppe
              </button>
            </form>
          )}
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (newCard.trim() && (await op({ op: 'card-add', text: newCard.trim(), groupId: null }))) setNewCard('');
            }}
          >
            <input
              className="input grow"
              value={newCard}
              maxLength={300}
              placeholder="Karte ergänzen"
              onChange={(e) => setNewCard(e.target.value)}
            />
            <button className="btn btn-small" disabled={busy || !newCard.trim()}>
              <Plus /> Karte
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ───────────── Punkte ───────────── */

function Dots({ view, slide, token }: { view: ParticipantView; slide: BoardSlide; token: string }) {
  const board = view.board!;
  const own = view.response as ResponsePayloads['board'] | null;
  const [dots, setDots] = useState<Record<string, number>>(own?.dots ?? {});
  const [editing, setEditing] = useState(!own);
  const { send, busy } = useSend(token);
  const { dots: budget, stack } = slide.config;
  const used = Object.values(dots).reduce((a, b) => a + b, 0);
  const left = budget - used;
  const change = (key: string, d: number) =>
    setDots((s) => {
      const n = Math.max(0, (s[key] ?? 0) + d);
      return { ...s, [key]: n };
    });
  const submit = async () => {
    if (await send('/api/p/respond', { slideId: slide.id, payload: { dots } })) setEditing(false);
  };
  if (board.targets.length === 0) return <Note icon={<Hourglass size={20} />}>Noch gibt es nichts zu bepunkten.</Note>;
  if (own && !editing) {
    return (
      <div className="done-box">
        <span className="check">
          <Check />
        </span>
        <div className="grow">
          <strong>Deine Punkte kleben.</strong>
          <ul className="small muted board-done-list">
            {Object.entries(own.dots ?? {}).map(([k, n]) => (
              <li key={k}>
                {n}× {labelOf(k, view.posts, board)}
              </li>
            ))}
          </ul>
        </div>
        {!view.locked && (
          <button className="btn btn-small" onClick={() => setEditing(true)}>
            Ändern
          </button>
        )}
      </div>
    );
  }
  if (view.locked) return <Note icon={<Lock size={20} />}>Die Abstimmung ist geschlossen.</Note>;
  return (
    <>
      <div className="board-budget" aria-live="polite">
        <span className="board-budget-dots" aria-hidden>
          {Array.from({ length: budget }, (_, i) => (
            <span key={i} className={i < left ? 'is-left' : ''} />
          ))}
        </span>
        <span>
          noch <strong className="tabular">{left}</strong> von {budget} {budget === 1 ? 'Punkt' : 'Punkten'}
        </span>
      </div>
      <ul className="board-vote-list">
        {board.targets.map((key) => {
          const n = dots[key] ?? 0;
          return (
            <li key={key} className={n > 0 ? 'is-on' : ''}>
              <span className="grow">{labelOf(key, view.posts, board)}</span>
              <span className="board-stepper">
                <button className="icon-btn" aria-label="Punkt entfernen" disabled={n === 0} onClick={() => change(key, -1)}>
                  <Minus />
                </button>
                <span className="tabular board-stepper-n">{n}</span>
                <button
                  className="icon-btn"
                  aria-label="Punkt kleben"
                  disabled={left === 0 || (!stack && n >= 1)}
                  onClick={() => change(key, 1)}
                >
                  <Plus />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <button className="btn btn-primary btn-large" onClick={submit} disabled={busy || used === 0}>
        Punkte abgeben <Send />
      </button>
    </>
  );
}

/* ───────────── Bewerten ───────────── */

function Rate({ view, slide, token }: { view: ParticipantView; slide: BoardSlide; token: string }) {
  const board = view.board!;
  const own = view.response as ResponsePayloads['board'] | null;
  const { scales } = slide.config;
  const [ratings, setRatings] = useState<Record<string, (number | null)[]>>(own?.ratings ?? {});
  const [editing, setEditing] = useState(!own);
  const { send, busy } = useSend(token);
  const set = (key: string, scale: number, level: number) =>
    setRatings((r) => {
      const values = r[key] ?? scales.map(() => null);
      return { ...r, [key]: values.map((v, i) => (i === scale ? (v === level ? null : level) : v)) };
    });
  const rated = Object.values(ratings).filter((v) => v.some((x) => x !== null)).length;
  const submit = async () => {
    if (await send('/api/p/respond', { slideId: slide.id, payload: { ratings } })) setEditing(false);
  };
  if (board.targets.length === 0) return <Note icon={<Hourglass size={20} />}>Noch gibt es nichts einzuschätzen.</Note>;
  if (own && !editing) {
    return (
      <div className="done-box">
        <span className="check">
          <Check />
        </span>
        <div className="grow">
          <strong>Danke für deine Einschätzung!</strong>
          <div className="small muted">
            {Object.keys(own.ratings ?? {}).length} von {board.targets.length} eingeschätzt
          </div>
        </div>
        {!view.locked && (
          <button className="btn btn-small" onClick={() => setEditing(true)}>
            Ändern
          </button>
        )}
      </div>
    );
  }
  if (view.locked) return <Note icon={<Lock size={20} />}>Die Bewertung ist geschlossen.</Note>;
  return (
    <>
      <p className="small muted">Schätze relativ ein – was du nicht beurteilen kannst, lässt du leer.</p>
      <ul className="board-rate-list">
        {board.targets.map((key) => (
          <li key={key} className="card card-pad stack-s">
            <strong>{labelOf(key, view.posts, board)}</strong>
            {scales.map((scale, s) => (
              <div key={s} className="board-rate-row">
                <span className="small muted">{scale.label}</span>
                <div className="segmented" role="radiogroup" aria-label={scale.label}>
                  {scale.levels.map((level, l) => (
                    <button
                      key={l}
                      role="radio"
                      aria-checked={ratings[key]?.[s] === l}
                      aria-pressed={ratings[key]?.[s] === l}
                      onClick={() => set(key, s, l)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <button className="btn btn-primary btn-large" onClick={submit} disabled={busy || rated === 0}>
        Einschätzung abgeben ({rated}/{board.targets.length}) <Send />
      </button>
    </>
  );
}

/* ───────────── Tabelle ───────────── */

function TableView({ view, slide }: { view: ParticipantView; slide: BoardSlide }) {
  const board = view.board!;
  if (board.rows.length === 0) return <Note icon={<Hourglass size={20} />}>Die Tabelle wird gerade gemeinsam gefüllt.</Note>;
  return (
    <ol className="board-table-list">
      {board.rows.map((r, i) => (
        <li key={r.key} className="card card-pad stack-s">
          <strong>
            {i + 1}. {labelOf(r.key, view.posts, board)}
          </strong>
          <dl>
            {slide.config.columns.map((c, j) => (
              <div key={j}>
                <dt>{c}</dt>
                <dd>{r.fields[j] || '–'}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ol>
  );
}

/* ───────────── Parkplatz ───────────── */

/** Jederzeit offene Sammel-Folien (z. B. Parkplatz) – erreichbar von jeder Folie aus. */
export function ParkingButton({ parking, token }: { parking: ParkingView[]; token: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (parking.length === 0) return null;
  const current = parking.find((p) => p.slideId === open) ?? null;
  return (
    <>
      <div className="parking-bar">
        {parking.map((p) => (
          <button key={p.slideId} className="btn parking-btn" onClick={() => setOpen(p.slideId)}>
            <Plus /> {p.title}
            {p.mine.length > 0 && <span className="pill tabular">{p.mine.length}</span>}
          </button>
        ))}
      </div>
      {current && (
        <div className="sheet-backdrop" onClick={() => setOpen(null)}>
          <div
            className="sheet card card-pad stack anim-rise"
            role="dialog"
            aria-label={current.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row-between">
              <h2>{current.title}</h2>
              <button className="icon-btn" aria-label="Schließen" onClick={() => setOpen(null)}>
                <X />
              </button>
            </div>
            <CardComposer
              slideId={current.slideId}
              tags={current.tags}
              remaining={current.remaining}
              token={token}
              placeholder="Deine Idee …"
            />
            {current.mine.length > 0 && (
              <ul className="post-list">
                {current.mine.map((p) => (
                  <OwnCard key={p.id} post={p} tags={current.tags} token={token} editable />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
