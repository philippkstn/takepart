import {
  BOARD_MODE_LABELS,
  cardKey,
  finalLevels,
  groupKey,
  hasVoteScale,
  levelLabel,
  levelOrigin,
  levelsText,
  ratingSourceNote,
  parseBoardKey,
  teamShort,
  type BoardOp,
  type BoardResults,
  type BoardView,
  type DisplayView,
  type PostView,
  type PublicSlide,
} from '@slides/shared';
import { EyeOff, Plus } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { axisPosition, cardsByGroup, itemsByCell, labelOf, shortName } from '../../lib/board.ts';
import { startDrag, useDropZone } from '../../lib/dnd.ts';
import { ScrollingResults } from '../../lib/autoScroll.tsx';
import { BarList } from '../Results.tsx';
import { BreakoutWall, doneSummary } from './Breakout.tsx';
import { TagChips, TieMark, tiedSet, topTieText } from './BoardMarks.tsx';
import { ChooseStage } from './Choose.tsx';
import './board.css';

type BoardSlide = Extract<PublicSlide, { type: 'board' }>;
type Config = BoardSlide['config'];

/**
 * Kartenwand auf der Bühne. Mit `onBoard` (nur Vorschau im Steuerpult) lassen sich
 * Karten und Gruppen per Drag & Drop einordnen; die Ablage ist dann immer zu sehen.
 */
export function BoardStage({ view, slide, onBoard }: { view: DisplayView; slide: BoardSlide; onBoard?: (op: BoardOp) => void }) {
  const config = slide.config;
  const board = view.board ?? emptyBoard(config);
  const ctx: Ctx = {
    view,
    config,
    board,
    onBoard,
    focus: view.spotlight?.id ?? null,
    tied: tiedSet(board, view.results as BoardResults | null),
  };
  const tie =
    config.top > 0 && config.mode !== 'collect' && config.mode !== 'cluster' && config.mode !== 'table'
      ? topTieText(board, config.top, config.targets)
      : null;
  // Bewerten: dezent benennen, woher die Werte kommen (nur wenn nicht alle von den Handys)
  const sourceNote = config.mode === 'rate' ? ratingSourceNote(config) : null;
  return (
    <>
      <div className="row-between stage-head-row">
        <div className="stage-head">
          <span className="stage-kicker">
            {BOARD_MODE_LABELS[config.mode]} · {config.board}
          </span>
          {config.prompt && <h1 className="stage-title board-title">{config.prompt}</h1>}
          {tie && <span className="board-tie-note">{tie}</span>}
          {sourceNote && <span className="board-tie-note">{sourceNote}</span>}
        </div>
        <Count ctx={ctx} />
      </div>
      <div className="board-body">
        <Body ctx={ctx} />
      </div>
    </>
  );
}

interface Ctx {
  view: DisplayView;
  config: Config;
  board: BoardView;
  onBoard?: (op: BoardOp) => void;
  focus: number | null;
  /** Einträge im Gleichstand nach Punkten */
  tied: Set<string>;
}

export function emptyBoard(config: Config): BoardView {
  return {
    name: config.board,
    mode: config.mode,
    groups: [],
    targets: [],
    places: {},
    rows: [],
    totals: {},
    rights: config.rights,
    tags: [],
    tagCounts: {},
    tied: [],
    chosen: {},
    rated: {},
    ratedFixed: {},
  };
}

function Count({ ctx }: { ctx: Ctx }) {
  const { view, config } = ctx;
  const n = view.answers;
  let text: string;
  if (config.mode === 'collect') text = `${n} ${n === 1 ? 'Person' : 'Personen'}`;
  else if (config.mode === 'rate' && !hasVoteScale(config)) {
    // Ohne Stimmen: wie viele Einträge schon vollständig eingeordnet sind
    const done = ctx.board.targets.filter((k) => finalLevels(config, ctx.board, null, k).every((v) => v !== null)).length;
    text = `${done} von ${ctx.board.targets.length} eingeordnet`;
  } else if (config.mode === 'dots' || config.mode === 'rate' || config.mode === 'choose')
    text = `${n} ${n === 1 ? 'Antwort' : 'Antworten'}`;
  else if (config.mode === 'table') text = `${ctx.board.rows.length} ${ctx.board.rows.length === 1 ? 'Thema' : 'Themen'}`;
  else text = `${n} ${n === 1 ? 'Karte' : 'Karten'}`;
  return (
    <span className="row" style={{ gap: '0.5em', flexWrap: 'nowrap' }}>
      {ctx.board.breakout && (
        <span className="stage-pill">
          <span className="tabular">{doneSummary(ctx.board.breakout)}</span>
        </span>
      )}
      <span className="stage-pill">
        <span className="tabular">{text}</span>
      </span>
    </span>
  );
}

function Body({ ctx }: { ctx: Ctx }) {
  switch (ctx.config.mode) {
    case 'collect':
      return <Collect ctx={ctx} />;
    case 'cluster':
      return ctx.config.layout === 'mindmap' ? <Mindmap ctx={ctx} /> : <ClusterWall ctx={ctx} />;
    case 'place':
      return <Place ctx={ctx} />;
    case 'dots':
      return <Dots ctx={ctx} />;
    case 'rate':
      return <Rate ctx={ctx} />;
    case 'choose':
      return (
        <ChooseStage
          slideId={ctx.view.slide?.id}
          config={ctx.config}
          board={ctx.board}
          posts={ctx.view.posts}
          results={ctx.view.results as BoardResults | null}
          tied={ctx.tied}
        />
      );
    case 'table':
      return <Table ctx={ctx} />;
  }
}

/* ───────────── Bausteine ───────────── */

/** Dichte nach Kartenzahl, damit auch volle Wände auf die Bühne passen */
const density = (n: number) => (n > 60 ? 'is-denser' : n > 28 ? 'is-dense' : '');

/** Karte oder Gruppe ziehbar machen (Maus, Stift und Touch) */
function dragProps(key: string, label: string, enabled: boolean) {
  if (!enabled) return {};
  return { 'data-draggable': true, onPointerDown: (e: React.PointerEvent) => startDrag(e, key, label) };
}

function Zone({
  onDrop,
  className,
  children,
  label,
}: {
  onDrop?: (key: string) => void;
  className: string;
  children: ReactNode;
  label?: string;
}) {
  const drop = useDropZone(onDrop);
  return (
    <div className={`${className} ${onDrop ? 'is-drop' : ''}`} aria-label={onDrop ? label : undefined} {...drop}>
      {children}
    </div>
  );
}

/**
 * Kartenliste, die sich selbst verkleinert, bis alle Karten in ihr Feld passen
 * (bis höchstens auf die Hälfte) – so bleibt auch ein volles Feld lesbar.
 */
function FitList({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let scale = 1;
      el.style.fontSize = '1em';
      while (el.scrollHeight > el.clientHeight + 1 && scale > 0.5) {
        scale -= 0.05;
        el.style.fontSize = `${scale}em`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  });
  return (
    <ul ref={ref} className="cluster-cards">
      {children}
    </ul>
  );
}

function Card({ post, ctx, tag = true }: { post: PostView; ctx: Ctx; tag?: boolean }) {
  // Auf späteren Folien der Wand gelten die Kennzeichnungen der Sammel-Folie
  const label = tag && post.column !== null ? (ctx.config.tags[post.column] ?? ctx.board.tags[post.column]) : undefined;
  // Herkunft aus der Gruppenarbeit (gruppenweises Sammeln), z. B. „G2“ – nicht beim Sammeln selbst (dort sind es Spalten)
  const team = ctx.config.mode !== 'collect' && post.team !== null && post.team !== undefined ? teamShort(post.team) : undefined;
  return (
    <li className={`board-card ${ctx.focus === post.id ? 'is-focus' : ''}`} {...dragProps(cardKey(post.id), post.text, !!ctx.onBoard)}>
      <span className="board-card-text">{post.text}</span>
      {(label || team) && (
        <span className="row" style={{ gap: '0.3em' }}>
          {label && <span className="board-tag">{label}</span>}
          {team && (
            <span className="board-tag" title={`aus Gruppe ${post.team! + 1}`}>
              {team}
            </span>
          )}
        </span>
      )}
    </li>
  );
}

/** Eintrag (Karte oder Gruppe) als kompakte Marke */
function Item({ itemKey, ctx, extra }: { itemKey: string; ctx: Ctx; extra?: ReactNode }) {
  const parsed = parseBoardKey(itemKey);
  const group = parsed?.kind === 'group' ? ctx.board.groups.find((g) => g.id === parsed.id) : undefined;
  return (
    <li
      className={`board-card ${group ? 'is-group' : ''} ${parsed?.kind === 'card' && ctx.focus === parsed.id ? 'is-focus' : ''}`}
      {...dragProps(itemKey, labelOf(itemKey, ctx.view.posts, ctx.board), !!ctx.onBoard)}
    >
      <span className="board-card-text">{labelOf(itemKey, ctx.view.posts, ctx.board)}</span>
      {group && <span className="board-tag tabular">{group.cards} Karten</span>}
      <TagChips board={ctx.board} itemKey={itemKey} />
      {ctx.tied.has(itemKey) && <TieMark />}
      {extra}
    </li>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <div className="stage-waiting">
      <EyeOff />
      <span>{children}</span>
    </div>
  );
}

/* ───────────── Sammeln ───────────── */

function Collect({ ctx }: { ctx: Ctx }) {
  const { view } = ctx;
  const breakout = ctx.board.breakout;
  if (!view.resultsVisible)
    return (
      <Waiting>
        {breakout
          ? 'Die Gruppen sammeln – die Karten erscheinen später an der Wand'
          : 'Karten werden geschrieben – sie erscheinen später an der Wand'}
      </Waiting>
    );
  // Neueste zuerst: bei vollen Wänden bleiben die frischen Karten sichtbar
  const posts = view.posts.filter((p) => p.status === 'visible').sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  // Gruppenweise gesammelt: Spalten je Arbeitsgruppe
  if (breakout)
    return (
      <BreakoutWall
        breakout={breakout}
        posts={posts}
        renderCards={(list) => (
          <FitList>
            {list.map((p) => (
              <Card key={p.id} post={p} ctx={ctx} />
            ))}
          </FitList>
        )}
      />
    );
  if (posts.length === 0) return <Waiting>Noch keine Karten</Waiting>;
  return (
    <ul className={`board-cards ${density(posts.length)}`}>
      {posts.map((p) => (
        <Card key={p.id} post={p} ctx={ctx} />
      ))}
    </ul>
  );
}

/* ───────────── Clustern ───────────── */

function useUnsorted(ctx: Ctx) {
  const groups = cardsByGroup(ctx.view.posts);
  const unsorted = groups.get(null) ?? [];
  // Ablage: auf dem Beamer nur auf Wunsch, im Steuerpult immer (zum Einordnen)
  const showUnsorted = ctx.config.showUnsorted || !!ctx.onBoard;
  return { groups, unsorted, showUnsorted };
}

function ClusterWall({ ctx }: { ctx: Ctx }) {
  const { board, onBoard } = ctx;
  const { groups, unsorted, showUnsorted } = useUnsorted(ctx);
  // Dichte nach der vollsten Gruppe – dort wird es zuerst eng
  const total = Math.max(0, ...[...groups.values()].map((list) => list.length)) * 3;
  const assign = (groupId: number | null) => (key: string) => {
    const parsed = parseBoardKey(key);
    if (parsed?.kind === 'card') onBoard?.({ op: 'assign', postId: parsed.id, groupId });
  };
  if (board.groups.length === 0 && !showUnsorted) return <Waiting>Gleich entstehen hier die ersten Gruppen</Waiting>;
  return (
    <div className={`cluster-wall ${density(total)}`}>
      {showUnsorted && (unsorted.length > 0 || onBoard) && (
        <Zone className="cluster-group is-unsorted" onDrop={onBoard && assign(null)} label="Ablage">
          <h2 className="cluster-name">
            Ablage <span className="faint tabular">{unsorted.length}</span>
            {onBoard && !ctx.config.showUnsorted && <span className="board-hint">nur im Steuerpult</span>}
          </h2>
          <FitList>
            {unsorted.map((p) => (
              <Card key={p.id} post={p} ctx={ctx} />
            ))}
          </FitList>
        </Zone>
      )}
      {board.groups.map((g) => (
        <Zone key={g.id} className="cluster-group" onDrop={onBoard && assign(g.id)} label={g.name}>
          <h2 className="cluster-name">
            {g.name} <span className="faint tabular">{g.cards}</span>
            <TagChips board={board} itemKey={groupKey(g.id)} />
          </h2>
          <FitList>
            {(groups.get(g.id) ?? []).map((p) => (
              <Card key={p.id} post={p} ctx={ctx} />
            ))}
          </FitList>
        </Zone>
      ))}
      {onBoard && (
        <Zone
          className="cluster-group is-new"
          label="Neue Gruppe"
          onDrop={(key) => {
            const parsed = parseBoardKey(key);
            if (parsed?.kind === 'card') {
              const text = ctx.view.posts.find((p) => p.id === parsed.id)?.text ?? 'Neue Gruppe';
              onBoard({ op: 'group-add', name: shortName(text), postIds: [parsed.id] });
            }
          }}
        >
          <span className="board-new">
            <Plus /> Karte hierher ziehen: neue Gruppe
          </span>
        </Zone>
      )}
    </div>
  );
}

function Mindmap({ ctx }: { ctx: Ctx }) {
  const { board, onBoard, config } = ctx;
  const { groups, unsorted, showUnsorted } = useUnsorted(ctx);
  const n = board.groups.length;
  const positions = board.groups.map((_, i) => {
    // Viele Gruppen: um einen halben Schritt gedreht, damit rechts und links keine zwei Knoten übereinander liegen
    const angle = -Math.PI / 2 + ((i + (n > 5 ? 0.5 : 0)) * 2 * Math.PI) / Math.max(1, n);
    // Ab sechs Gruppen weiter außen und kleiner, damit sich nichts überlappt
    return n > 5
      ? { x: 50 + 41 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) }
      : { x: 50 + 37 * Math.cos(angle), y: 50 + 38 * Math.sin(angle) };
  });
  const assign = (groupId: number | null) => (key: string) => {
    const parsed = parseBoardKey(key);
    if (parsed?.kind === 'card') onBoard?.({ op: 'assign', postId: parsed.id, groupId });
  };
  const maxCards = n > 5 ? 1 : 4;
  return (
    <div className="mindmap-wrap">
      <div className={`mindmap ${n > 5 ? 'is-many' : ''}`}>
        <svg className="mindmap-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {positions.map((p, i) => (
            <line key={i} x1="50" y1="50" x2={p.x} y2={p.y} />
          ))}
        </svg>
        <div className="mindmap-center">{config.prompt || config.board}</div>
        {board.groups.map((g, i) => {
          const cards = groups.get(g.id) ?? [];
          return (
            <div key={g.id} className="mindmap-node" style={{ left: `${positions[i]!.x}%`, top: `${positions[i]!.y}%` }}>
              <Zone className="cluster-group" onDrop={onBoard && assign(g.id)} label={g.name}>
                <h2 className="cluster-name">
                  {g.name} <span className="faint tabular">{g.cards}</span>
                  <TagChips board={board} itemKey={groupKey(g.id)} />
                </h2>
                <FitList>
                  {cards.slice(0, maxCards).map((p) => (
                    <Card key={p.id} post={p} ctx={ctx} tag={false} />
                  ))}
                  {cards.length > maxCards && <li className="board-more tabular">+ {cards.length - maxCards} weitere</li>}
                </FitList>
              </Zone>
            </div>
          );
        })}
      </div>
      {showUnsorted && (unsorted.length > 0 || onBoard) && (
        <Zone className="board-tray" onDrop={onBoard && assign(null)} label="Ablage">
          <span className="board-tray-label">Ablage</span>
          <ul className="board-tray-items">
            {unsorted.map((p) => (
              <Card key={p.id} post={p} ctx={ctx} tag={false} />
            ))}
          </ul>
          {onBoard && (
            <Zone
              className="board-tray-new"
              label="Neue Gruppe"
              onDrop={(key) => {
                const parsed = parseBoardKey(key);
                if (parsed?.kind === 'card') {
                  const text = ctx.view.posts.find((p) => p.id === parsed.id)?.text ?? 'Neue Gruppe';
                  onBoard({ op: 'group-add', name: shortName(text), postIds: [parsed.id] });
                }
              }}
            >
              <Plus /> Neue Gruppe
            </Zone>
          )}
        </Zone>
      )}
    </div>
  );
}

/* ───────────── Zuordnen ───────────── */

function Place({ ctx }: { ctx: Ctx }) {
  const { config, board, onBoard } = ctx;
  const { cells, unplaced } = itemsByCell(board);
  const withTitles = config.lanes.some((l) => l.title);
  const place = (lane: number | null, cell: number | null) => (key: string) => onBoard?.({ op: 'place', key, lane, cell });
  const showUnplaced = (config.showUnsorted || !!onBoard) && (unplaced.length > 0 || !!onBoard);
  return (
    <div className={`place ${density(board.targets.length)}`}>
      <div className={`place-grid ${config.yLabel ? 'has-y' : ''}`}>
        {config.yLabel && <span className="place-axis-y">{config.yLabel}</span>}
        <div className="place-lanes">
          {config.lanes.map((lane, l) => (
            <div
              key={l}
              className="place-lane"
              style={{ gridTemplateColumns: `${withTitles ? 'minmax(0, 6.5em) ' : ''}repeat(${lane.cells.length}, minmax(0, 1fr))` }}
            >
              {withTitles && <span className="place-lane-title">{lane.title}</span>}
              {lane.cells.map((cell, c) => {
                const items = cells.get(`${l}:${c}`) ?? [];
                return (
                  <Zone key={c} className="place-cell" onDrop={onBoard && place(l, c)} label={cell}>
                    <span className="place-cell-title">
                      {cell} {items.length > 0 && <span className="faint tabular">{items.length}</span>}
                    </span>
                    <FitList>
                      {items.map((key) => (
                        <Item key={key} itemKey={key} ctx={ctx} />
                      ))}
                    </FitList>
                  </Zone>
                );
              })}
            </div>
          ))}
        </div>
        {config.xLabel && <span className="place-axis-x">{config.xLabel}</span>}
      </div>
      {showUnplaced && (
        <Zone className="board-tray" onDrop={onBoard && place(null, null)} label="Ablage">
          <span className="board-tray-label">
            Ablage {onBoard && !config.showUnsorted && <span className="board-hint">nur im Steuerpult</span>}
          </span>
          <ul className="board-tray-items">
            {unplaced.map((key) => (
              <Item key={key} itemKey={key} ctx={ctx} />
            ))}
          </ul>
        </Zone>
      )}
    </div>
  );
}

/* ───────────── Punkte ───────────── */

/** Was zur Wahl steht, solange die Ergebnisse verborgen sind */
function TargetList({ ctx }: { ctx: Ctx }) {
  const { board } = ctx;
  if (board.targets.length === 0) return <Waiting>Noch keine Einträge auf dieser Wand</Waiting>;
  return (
    <ul className={`board-cards ${density(board.targets.length)}`}>
      {board.targets.map((key) => (
        <Item key={key} itemKey={key} ctx={ctx} />
      ))}
    </ul>
  );
}

function Dots({ ctx }: { ctx: Ctx }) {
  const results = ctx.view.results as BoardResults | null;
  if (!results || results.type !== 'board' || results.voters === 0) return <TargetList ctx={ctx} />;
  const items = [...ctx.board.targets].map((key, i) => ({ key, i, n: results.dots[key] ?? 0 })).sort((a, b) => b.n - a.n || a.i - b.i);
  const max = Math.max(1, ...items.map((e) => e.n));
  return (
    <ScrollingResults key={ctx.view.slide?.id} className="stage-results board-results">
      <BarList
        max={max}
        items={items.map((e) => ({
          key: e.key,
          label: labelOf(e.key, ctx.view.posts, ctx.board),
          value: e.n,
          display: `${e.n} ${e.n === 1 ? 'Punkt' : 'Punkte'}`,
          extra: <BarMarks ctx={ctx} itemKey={e.key} />,
        }))}
      />
    </ScrollingResults>
  );
}

/** Marken hinter dem Text eines Balkens: Verteilung der Kennzeichnungen und Gleichstand */
function BarMarks({ ctx, itemKey }: { ctx: Ctx; itemKey: string }) {
  if (!ctx.board.tagCounts[itemKey] && !ctx.tied.has(itemKey)) return null;
  return (
    <span className="bar-marks">
      <TagChips board={ctx.board} itemKey={itemKey} />
      {ctx.tied.has(itemKey) && <TieMark />}
    </span>
  );
}

/* ───────────── Bewerten ───────────── */

/**
 * Endgültige Stufen je Eintrag: Festlegung der Moderation, Kennzeichnungen der
 * Karten oder – solange das Ergebnis sichtbar ist – der Durchschnitt der Stimmen.
 */
function ratingLevels(ctx: Pick<Ctx, 'config' | 'board' | 'view'>): Map<string, (number | null)[]> {
  const results = ctx.view.results?.type === 'board' ? (ctx.view.results as BoardResults) : null;
  return new Map(ctx.board.targets.map((key) => [key, finalLevels(ctx.config, ctx.board, results, key)]));
}

function Rate({ ctx }: { ctx: Ctx }) {
  const { config, board, view } = ctx;
  const levels = ratingLevels(ctx);
  if (![...levels.values()].some((v) => v.some((x) => x !== null))) return <TargetList ctx={ctx} />;
  if (config.scales.length === 2) return <RatingMatrix ctx={ctx} levels={levels} />;
  const scale = config.scales[0]!;
  const results = view.results?.type === 'board' ? (view.results as BoardResults) : null;
  const items = board.targets
    .map((key, i) => ({ key, i, avg: levels.get(key)?.[0] ?? null }))
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || a.i - b.i);
  const detail = (key: string) => {
    const origin = levelOrigin(config, board, key, 0);
    if (origin === 'votes') return ` · ${results?.ratings[key]?.n[0] ?? 0}×`;
    return origin === 'fixed' ? ' · festgelegt' : '';
  };
  return (
    <ScrollingResults key={ctx.view.slide?.id} className="stage-results board-results">
      <BarList
        max={scale.levels.length}
        items={items.map((e) => ({
          key: e.key,
          label: labelOf(e.key, view.posts, board),
          value: e.avg === null ? 0 : e.avg + 1,
          display: e.avg === null ? '–' : `${levelLabel(scale.levels, e.avg)}${detail(e.key)}`,
          extra: <BarMarks ctx={ctx} itemKey={e.key} />,
        }))}
      />
    </ScrollingResults>
  );
}

/**
 * Zwei Kriterien: endgültige Stufen je Eintrag als Punkt, erstes Kriterium senkrecht,
 * zweites waagerecht. Einträge, denen auf einem Kriterium noch ein Wert fehlt
 * (z. B. Aufwand noch nicht von der Moderation eingetragen), stehen daneben.
 */
function RatingMatrix({ ctx, levels }: { ctx: Pick<Ctx, 'config' | 'board' | 'view'>; levels: Map<string, (number | null)[]> }) {
  const { config, board, view } = ctx;
  const [yScale, xScale] = config.scales as [(typeof config.scales)[0], (typeof config.scales)[0]];
  const complete = board.targets.filter((key) => levels.get(key)?.every((v) => v !== null));
  const missing = board.targets.filter((key) => !complete.includes(key));
  const points = complete.map((key, i) => {
    const v = levels.get(key)!;
    return {
      key,
      number: i + 1,
      x: axisPosition(xScale.levels.length, v[1]!),
      y: 1 - axisPosition(yScale.levels.length, v[0]!),
      text: levelsText(config, v),
    };
  });
  // Gleiche Positionen leicht auseinanderziehen
  const seen = new Map<string, number>();
  for (const p of points) {
    const id = `${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
    const k = seen.get(id) ?? 0;
    seen.set(id, k + 1);
    p.x += k * 0.035;
  }
  const pad = (v: number) => 6 + Math.min(1, Math.max(0, v)) * 88;
  // Fehlt allen dasselbe Kriterium, heißt die Liste „Noch ohne Aufwand“
  const lacking = config.scales.filter((_, i) => missing.every((key) => (levels.get(key)?.[i] ?? null) === null));
  const missingTitle = lacking.length === 1 ? `Noch ohne ${lacking[0]!.label}` : 'Noch nicht eingeschätzt';
  return (
    <div className="rating-matrix">
      <div className="rating-plot-wrap">
        <span className="place-axis-y">{yScale.label} ↑</span>
        <div className="rating-plot">
          {config.quadrants.map((q, i) => (
            <span key={i} className={`rating-quadrant q${i}`}>
              {q}
            </span>
          ))}
          {points.map((p) => (
            <span
              key={p.key}
              className="rating-point tabular"
              style={{ left: `${pad(p.x)}%`, top: `${pad(p.y)}%` }}
              title={`${labelOf(p.key, view.posts, board)}: ${p.text}`}
            >
              {p.number}
            </span>
          ))}
        </div>
        <span className="place-axis-x">{xScale.label} →</span>
      </div>
      <div className="rating-side">
        {points.length > 0 && (
          <ol className="rating-legend">
            {points.map((p) => (
              <li key={p.key}>
                <span className="rating-point is-static tabular">{p.number}</span>
                {/* Ohne Größen-Chips: die Werte stehen daneben, der Themenname braucht den Platz */}
                <span className="grow clamp">{labelOf(p.key, view.posts, board)}</span>
                <span className="faint">{p.text}</span>
              </li>
            ))}
          </ol>
        )}
        {missing.length > 0 && (
          <div className="rating-missing">
            <span className="rating-missing-title">{missingTitle}</span>
            <ul className="rating-legend">
              {missing.map((key) => {
                const v = levels.get(key)!;
                const known = config.scales.flatMap((s, i) => (v[i] === null ? [] : [`${s.label} ${levelLabel(s.levels, v[i]!)}`]));
                return (
                  <li key={key}>
                    <span className="grow clamp">{labelOf(key, view.posts, board)}</span>
                    {known.length > 0 && <span className="faint">{known.join(' · ')}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── Tabelle ───────────── */

function Table({ ctx }: { ctx: Ctx }) {
  const { config, board, view } = ctx;
  if (board.rows.length === 0) return <Waiting>Die Tabelle wird gleich gemeinsam gefüllt</Waiting>;
  return (
    <table className="board-table">
      <thead>
        <tr>
          <th className="tabular">Nr.</th>
          <th>Thema</th>
          {config.columns.map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {board.rows.map((r, i) => (
          <tr key={r.key}>
            <td className="tabular">{i + 1}</td>
            <td className="board-table-topic">
              <span className="clamp">{labelOf(r.key, view.posts, board)}</span>
              <span className="row" style={{ gap: '0.35em' }}>
                {(board.totals[r.key] ?? 0) > 0 && (
                  <span className="board-tag tabular">
                    {board.totals[r.key]} {board.totals[r.key] === 1 ? 'Punkt' : 'Punkte'}
                  </span>
                )}
                <TagChips board={board} itemKey={r.key} />
                {ctx.tied.has(r.key) && <TieMark />}
              </span>
            </td>
            {config.columns.map((_, j) => (
              <td key={j}>{r.fields[j] || <span className="faint">–</span>}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
