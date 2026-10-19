import {
  BOARD_MODE_LABELS,
  BOARD_RIGHTS,
  BOARD_RIGHTS_LABELS,
  cardKey,
  groupKey,
  targetKind,
  type BoardOp,
  type BoardResults,
  type HostCommand,
  type HostView,
  type PostView,
} from '@slides/shared';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, ListPlus, Maximize2, MessageSquareOff, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { cardsByGroup, itemsByCell, labelOf, ratingText } from '../../lib/board.ts';

type Cmd = (cmd: HostCommand) => Promise<void>;
type BoardHostSlide = Extract<NonNullable<HostView['slide']>, { type: 'board' }>;

/**
 * Steuerung einer Kartenwand: Gruppen anlegen und benennen, Karten einordnen
 * (auch per Drag & Drop in der Vorschau), Freigabe für Teilnehmende, Ergebnistabelle.
 */
export function BoardPanel({ view, command, busy, onClear }: { view: HostView; command: Cmd; busy: boolean; onClear: () => void }) {
  const slide = view.slide as BoardHostSlide;
  const board = view.board;
  if (!board) return null;
  const config = slide.config;
  const op = (o: BoardOp) => command({ action: 'board', slideId: slide.id, op: o });

  return (
    <div className="stack">
      <div className="row-between">
        <h3>{BOARD_MODE_LABELS[config.mode]}</h3>
        <span className="pill">{config.board}</span>
      </div>

      {(config.mode === 'cluster' || config.mode === 'place') && (
        <div className="stack-s">
          <span className="label">Teilnehmende dürfen</span>
          <div className="segmented board-rights" role="group" aria-label="Rechte der Teilnehmenden">
            {BOARD_RIGHTS.map((r) => (
              <button
                key={r}
                aria-pressed={board.rights === r}
                disabled={busy}
                onClick={() => command({ action: 'board-rights', slideId: slide.id, rights: r })}
              >
                {BOARD_RIGHTS_LABELS[r]}
              </button>
            ))}
          </div>
          {board.rights === 'all' && (
            <p className="small faint">Alle können Karten verschieben und ändern sowie Gruppen anlegen und umbenennen.</p>
          )}
        </div>
      )}

      {config.mode === 'cluster' && <ClusterControls view={view} op={op} command={command} />}
      {config.mode === 'place' && <PlaceControls view={view} op={op} />}
      {(config.mode === 'dots' || config.mode === 'rate') && <VoteSummary view={view} />}
      {config.mode === 'table' && <TableControls view={view} op={op} busy={busy} />}

      <div className="row panel-footer">
        <button className="btn btn-small btn-danger" onClick={onClear}>
          <MessageSquareOff />{' '}
          {config.mode === 'cluster' ? 'Gruppen auflösen' : config.mode === 'table' ? 'Tabelle leeren' : 'Zurücksetzen'}
        </button>
      </div>
    </div>
  );
}

function InlineForm({
  placeholder,
  cta,
  onSubmit,
  max = 120,
}: {
  placeholder: string;
  cta: string;
  onSubmit: (v: string) => void;
  max?: number;
}) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue('');
  };
  return (
    <form className="row board-inline-form" onSubmit={submit}>
      <input className="input grow" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn-small" disabled={!value.trim()}>
        <Plus /> {cta}
      </button>
    </form>
  );
}

function CardRow({
  post,
  view,
  op,
  command,
  children,
}: {
  post: PostView;
  view: HostView;
  op: (o: BoardOp) => void;
  command: Cmd;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(post.text);
  const spot = view.state.spotlight === post.id;
  const tags = view.slide?.type === 'board' ? view.slide.config.tags : [];
  return (
    <li className={`mod-item ${spot ? 'is-spot' : ''} ${post.status === 'hidden' ? 'is-hidden' : ''}`}>
      <div className="mod-text">
        {editing ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) op({ op: 'card-edit', postId: post.id, text: text.trim() });
              setEditing(false);
            }}
          >
            <input className="input grow" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} autoFocus />
            <button className="icon-btn" aria-label="Speichern">
              <Check />
            </button>
          </form>
        ) : (
          <span>{post.text}</span>
        )}
        <span className="post-meta">
          {post.column !== null && tags[post.column] && <span className="pill">{tags[post.column]}</span>}
          {post.status === 'hidden' && <span className="pill">ausgeblendet</span>}
        </span>
        {children}
      </div>
      <div className="mod-actions">
        {post.status === 'visible' && (
          <button
            className={`icon-btn ${spot ? 'active' : ''}`}
            title={spot ? 'Groß aus' : 'Groß zeigen'}
            aria-label={spot ? 'Groß aus' : 'Groß zeigen'}
            onClick={() => command({ action: 'spotlight', postId: spot ? null : post.id })}
          >
            <Maximize2 />
          </button>
        )}
        <button className="icon-btn" title="Text ändern" aria-label="Text ändern" onClick={() => setEditing((e) => !e)}>
          {editing ? <X /> : <Pencil />}
        </button>
        <button
          className="icon-btn"
          title={post.status === 'hidden' ? 'Wieder zeigen' : 'Ausblenden'}
          aria-label={post.status === 'hidden' ? 'Wieder zeigen' : 'Ausblenden'}
          onClick={() => command({ action: 'post-status', postId: post.id, status: post.status === 'hidden' ? 'visible' : 'hidden' })}
        >
          {post.status === 'hidden' ? <Eye /> : <EyeOff />}
        </button>
      </div>
    </li>
  );
}

/* ───────────── Clustern ───────────── */

function ClusterControls({ view, op, command }: { view: HostView; op: (o: BoardOp) => void; command: Cmd }) {
  const board = view.board!;
  const byGroup = cardsByGroup(view.posts);
  const hidden = view.posts.filter((p) => p.status === 'hidden');
  const unsorted = byGroup.get(null) ?? [];

  const groupSelect = (post: PostView) => (
    <select
      className="select select-small"
      aria-label="Gruppe"
      value={post.group ?? ''}
      onChange={(e) => op({ op: 'assign', postId: post.id, groupId: e.target.value ? Number(e.target.value) : null })}
    >
      <option value="">Ablage</option>
      {board.groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <p className="small faint">Karten in der Vorschau auf eine Gruppe ziehen – oder hier über die Auswahl einordnen.</p>
      <InlineForm placeholder="Überschrift der neuen Gruppe" cta="Gruppe" onSubmit={(name) => op({ op: 'group-add', name, postIds: [] })} />
      <InlineForm placeholder="Karte ergänzen" cta="Karte" max={300} onSubmit={(text) => op({ op: 'card-add', text, groupId: null })} />

      {unsorted.length > 0 && (
        <div className="stack-s">
          <span className="label">Ablage ({unsorted.length})</span>
          <ul className="mod-list">
            {unsorted.map((p) => (
              <CardRow key={p.id} post={p} view={view} op={op} command={command}>
                {groupSelect(p)}
              </CardRow>
            ))}
          </ul>
        </div>
      )}

      {board.groups.map((g, i) => (
        <div key={g.id} className="stack-s board-group-edit">
          <div className="row">
            <input
              className="input grow board-group-name"
              defaultValue={g.name}
              key={g.name}
              maxLength={120}
              aria-label="Überschrift"
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== g.name) op({ op: 'group-rename', groupId: g.id, name });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <span className="pill tabular">{g.cards}</span>
            <button
              className="icon-btn"
              aria-label="Nach vorn"
              disabled={i === 0}
              onClick={() => op({ op: 'group-move', groupId: g.id, delta: -1 })}
            >
              <ArrowUp />
            </button>
            <button
              className="icon-btn"
              aria-label="Nach hinten"
              disabled={i === board.groups.length - 1}
              onClick={() => op({ op: 'group-move', groupId: g.id, delta: 1 })}
            >
              <ArrowDown />
            </button>
            <button
              className="icon-btn"
              aria-label="Gruppe auflösen"
              title="Gruppe auflösen – Karten kommen zurück in die Ablage"
              onClick={() => window.confirm(`Gruppe „${g.name}“ auflösen?`) && op({ op: 'group-delete', groupId: g.id })}
            >
              <Trash2 />
            </button>
          </div>
          <ul className="mod-list">
            {(byGroup.get(g.id) ?? []).map((p) => (
              <CardRow key={p.id} post={p} view={view} op={op} command={command}>
                {groupSelect(p)}
              </CardRow>
            ))}
          </ul>
        </div>
      ))}

      {hidden.length > 0 && (
        <div className="stack-s">
          <span className="label">Ausgeblendet ({hidden.length})</span>
          <ul className="mod-list">
            {hidden.map((p) => (
              <CardRow key={p.id} post={p} view={view} op={op} command={command} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/* ───────────── Zuordnen ───────────── */

function PlaceControls({ view, op }: { view: HostView; op: (o: BoardOp) => void }) {
  const board = view.board!;
  const slide = view.slide as BoardHostSlide;
  const { lanes } = slide.config;
  const { unplaced } = itemsByCell(board);
  const options = lanes.flatMap((lane, l) =>
    lane.cells.map((cell, c) => ({ value: `${l}:${c}`, label: lane.title ? `${lane.title} · ${cell}` : cell })),
  );
  const row = (key: string) => {
    const place = board.places[key];
    return (
      <li key={key} className="mod-item">
        <div className="mod-text">
          <span>{labelOf(key, view.posts, board)}</span>
          <select
            className="select select-small"
            aria-label="Feld"
            value={place ? `${place.lane}:${place.cell}` : ''}
            onChange={(e) => {
              const [lane, cell] = e.target.value ? e.target.value.split(':').map(Number) : [null, null];
              op({ op: 'place', key, lane: lane ?? null, cell: cell ?? null });
            }}
          >
            <option value="">Ablage</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </li>
    );
  };
  return (
    <>
      <p className="small faint">
        {targetKind(slide.config, board.groups.length) === 'groups' ? 'Gruppen' : 'Karten'} in der Vorschau in ein Feld ziehen – oder hier
        auswählen.
      </p>
      {board.targets.length === 0 && <p className="muted small">Auf dieser Wand gibt es noch keine Einträge.</p>}
      {unplaced.length > 0 && (
        <div className="stack-s">
          <span className="label">Noch nicht eingeordnet ({unplaced.length})</span>
          <ul className="mod-list">{unplaced.map(row)}</ul>
        </div>
      )}
      {board.targets.length > unplaced.length && (
        <div className="stack-s">
          <span className="label">Eingeordnet ({board.targets.length - unplaced.length})</span>
          <ul className="mod-list">{board.targets.filter((k) => board.places[k]).map(row)}</ul>
        </div>
      )}
    </>
  );
}

/* ───────────── Punkte & Bewerten ───────────── */

function VoteSummary({ view }: { view: HostView }) {
  const board = view.board!;
  const slide = view.slide as BoardHostSlide;
  const results = view.results as BoardResults | null;
  if (board.targets.length === 0) return <p className="muted small">Auf dieser Wand gibt es noch keine Einträge.</p>;
  const dots = slide.config.mode === 'dots';
  const score = (key: string) =>
    dots ? (results?.dots[key] ?? 0) : (results?.ratings[key]?.average.reduce<number>((a, b) => a + (b ?? 0), 0) ?? -1);
  const sorted = [...board.targets].sort((a, b) => score(b) - score(a));
  return (
    <div className="stack-s">
      <span className="label">
        {view.answers} {view.answers === 1 ? 'Antwort' : 'Antworten'}
        {!view.resultsVisible && ' · Ergebnisse auf dem Beamer verborgen'}
      </span>
      <ol className="word-table">
        {sorted.map((key) => (
          <li key={key}>
            <span className="grow">{labelOf(key, view.posts, board)}</span>
            <span className="tabular faint">
              {dots ? `${results?.dots[key] ?? 0} P.` : ratingText(slide.config, results?.ratings[key])}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ───────────── Ergebnistabelle ───────────── */

function TableControls({ view, op, busy }: { view: HostView; op: (o: BoardOp) => void; busy: boolean }) {
  const board = view.board!;
  const slide = view.slide as BoardHostSlide;
  const [n, setN] = useState(3);
  const used = new Set(board.rows.map((r) => r.key));
  const kind = targetKind(slide.config, board.groups.length);
  const candidates = (
    kind === 'groups' ? board.groups.map((g) => groupKey(g.id)) : view.posts.filter((p) => p.status === 'visible').map((p) => cardKey(p.id))
  ).filter((k) => !used.has(k));
  const hasDots = Object.keys(board.totals).length > 0;

  return (
    <>
      <div className="row">
        <select className="select select-small" value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Anzahl">
          {[1, 2, 3, 4, 5, 6, 8, 10].map((v) => (
            <option key={v} value={v}>
              Top {v}
            </option>
          ))}
        </select>
        <button className="btn btn-small btn-primary" disabled={busy || !hasDots} onClick={() => op({ op: 'rows-top', n })}>
          <ListPlus /> Nach Punkten übernehmen
        </button>
      </div>
      {!hasDots && <p className="small faint">Noch keine Punkte auf dieser Wand – Zeilen einzeln hinzufügen.</p>}
      {candidates.length > 0 && (
        <select
          className="select select-small"
          value=""
          aria-label="Zeile hinzufügen"
          onChange={(e) => e.target.value && op({ op: 'row-add', key: e.target.value })}
        >
          <option value="">Zeile hinzufügen …</option>
          {candidates.map((k) => (
            <option key={k} value={k}>
              {labelOf(k, view.posts, board).slice(0, 80)}
            </option>
          ))}
        </select>
      )}
      {board.rows.map((r, i) => (
        <div key={r.key} className="card card-pad stack-s board-row-edit">
          <div className="row">
            <strong className="tabular">{i + 1}.</strong>
            <strong className="grow">{labelOf(r.key, view.posts, board)}</strong>
            {(board.totals[r.key] ?? 0) > 0 && <span className="pill tabular">{board.totals[r.key]} P.</span>}
            <button
              className="icon-btn"
              aria-label="Nach oben"
              disabled={i === 0}
              onClick={() => op({ op: 'row-move', key: r.key, delta: -1 })}
            >
              <ArrowUp />
            </button>
            <button
              className="icon-btn"
              aria-label="Nach unten"
              disabled={i === board.rows.length - 1}
              onClick={() => op({ op: 'row-move', key: r.key, delta: 1 })}
            >
              <ArrowDown />
            </button>
            <button className="icon-btn" aria-label="Zeile entfernen" onClick={() => op({ op: 'row-remove', key: r.key })}>
              <X />
            </button>
          </div>
          {slide.config.columns.map((col, j) => (
            <label key={j} className="field">
              <span>{col}</span>
              <input
                className="input"
                defaultValue={r.fields[j] ?? ''}
                key={`${r.key}-${j}-${r.fields[j] ?? ''}`}
                maxLength={300}
                onBlur={(e) => {
                  if (e.target.value.trim() === (r.fields[j] ?? '')) return;
                  const fields = slide.config.columns.map((_, k) => (k === j ? e.target.value.trim() : (r.fields[k] ?? '')));
                  op({ op: 'row-fields', key: r.key, fields });
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </label>
          ))}
        </div>
      ))}
    </>
  );
}
