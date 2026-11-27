import {
  ALL_GOAL_ITEMS,
  BUILTIN_BLOCKS,
  goalItemHint,
  goalItemKey,
  goalItemLabel,
  searchGoalItems,
  SLIDE_GOALS,
  SLIDE_TYPE_LABELS,
  type BatchSlide,
  type GoalItem,
  type Slide,
  type SlideType,
} from '@slides/shared';
import {
  ArrowLeft,
  ChevronRight,
  DoorOpen,
  GraduationCap,
  Lightbulb,
  List,
  MessageCircleQuestion,
  Presentation,
  Search,
  UsersRound,
  Vote,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SlideIcon } from '../slideIcons.tsx';
import { BuiltinBlockList } from './BlockPicker.tsx';
import { TypeSketch } from './TypeSketch.tsx';

/**
 * Auswahl des Folientyps im Einfügen-Dialog: zuerst das Ziel (`SLIDE_GOALS` aus
 * shared), dann die passenden Folientypen mit Mini-Vorschau und darunter die
 * passenden Bausteine. „Alle Folientypen“ zeigt die vollständige Liste, die Suche
 * geht über alle Typen. Tastatur: Pfeiltasten wandern zwischen den Einträgen,
 * Escape führt zurück.
 */

const GOAL_ICONS: Record<string, LucideIcon> = {
  arrive: DoorOpen,
  collect: Lightbulb,
  quiz: GraduationCap,
  decide: Vote,
  questions: MessageCircleQuestion,
  workshop: UsersRound,
  show: Presentation,
};

type View = { kind: 'goals' } | { kind: 'goal'; id: string } | { kind: 'all' };

export function TypePicker({
  onPick,
  onInsert,
  slides,
  disabled,
  board,
}: {
  onPick: (type: SlideType, config?: unknown) => void;
  /** Bausteine unter einem Ziel einfügen (wie im Reiter „Bausteine“) */
  onInsert: (slides: BatchSlide[]) => void;
  slides: Slide[];
  disabled: boolean;
  /** Wand, mit der neue Kartenwand-Schritte weiterarbeiten */
  board: string;
}) {
  const [view, setView] = useState<View>({ kind: 'goals' });
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const viewKey = view.kind === 'goal' ? `goal:${view.id}` : view.kind;
  const shown = useRef(viewKey);

  // Nach jedem Wechsel der Ansicht den ersten Eintrag fokussieren (beim Öffnen bleibt die Suche fokussiert)
  useEffect(() => {
    if (shown.current === viewKey) return;
    shown.current = viewKey;
    root.current?.querySelector<HTMLElement>('[data-pick]')?.focus();
  }, [viewKey]);

  const pick = (item: GoalItem) => (item.type === 'board' ? onPick('board', { mode: item.mode, board }) : onPick(item.type));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
        search.current?.focus();
      } else if (view.kind !== 'goals') setView({ kind: 'goals' });
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const target = e.target as HTMLElement;
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'];
    if (!keys.includes(e.key)) return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[data-pick]:not(:disabled)') ?? [])];
    if (target === search.current) {
      if (e.key === 'ArrowDown' && items[0]) {
        e.preventDefault();
        items[0].focus();
      }
      return;
    }
    const at = items.indexOf(target);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? at + 1 : at - 1;
    if (next < 0) search.current?.focus();
    else items[Math.min(next, items.length - 1)]?.focus();
  };

  const results = query.trim() ? searchGoalItems(query) : null;
  const goal = view.kind === 'goal' ? SLIDE_GOALS.find((g) => g.id === view.id) : undefined;

  return (
    <div ref={root} className="type-picker anim-rise" onKeyDown={onKeyDown}>
      <label className="type-search">
        <Search size={16} aria-hidden />
        <input
          ref={search}
          className="input"
          type="search"
          autoFocus
          placeholder="Folientyp suchen …"
          aria-label="Folientyp suchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {results ? (
        results.length > 0 ? (
          <ItemGrid items={results} disabled={disabled} onPick={pick} />
        ) : (
          <p className="small muted type-picker-label">Kein Folientyp passt zu „{query.trim()}“.</p>
        )
      ) : view.kind === 'goals' ? (
        <div className="goal-list">
          <span className="label type-picker-label">Was möchtest du erreichen?</span>
          {SLIDE_GOALS.map((g) => {
            const Icon = GOAL_ICONS[g.id] ?? Lightbulb;
            return (
              <button key={g.id} className="type-option goal-option" data-pick onClick={() => setView({ kind: 'goal', id: g.id })}>
                <span className="slide-type-icon">
                  <Icon size={18} aria-hidden />
                </span>
                <span className="grow">
                  <strong>{g.label}</strong>
                  <span className="small faint" style={{ display: 'block' }}>
                    {g.description}
                  </span>
                </span>
                <ChevronRight size={16} className="faint" aria-hidden />
              </button>
            );
          })}
          <button className="type-option goal-option goal-all" data-pick onClick={() => setView({ kind: 'all' })}>
            <span className="slide-type-icon">
              <List size={18} aria-hidden />
            </span>
            <span className="grow">
              <strong>Alle Folientypen</strong>
              <span className="small faint" style={{ display: 'block' }}>
                Die vollständige Liste, ohne Umweg über ein Ziel
              </span>
            </span>
            <ChevronRight size={16} className="faint" aria-hidden />
          </button>
        </div>
      ) : (
        <>
          <div className="goal-head">
            <button className="btn btn-small btn-ghost" onClick={() => setView({ kind: 'goals' })}>
              <ArrowLeft size={16} aria-hidden /> Ziele
            </button>
            <span className="grow">
              <strong>{goal?.label ?? 'Alle Folientypen'}</strong>
              {goal && <span className="small faint goal-head-text">{goal.description}</span>}
            </span>
          </div>
          {goal ? (
            <>
              <ItemGrid items={goal.items} disabled={disabled} onPick={pick} />
              {goal.blocks.length > 0 && (
                <>
                  <span className="label type-picker-label">Passende Bausteine</span>
                  <BuiltinBlockList
                    blocks={goal.blocks.flatMap((id) => BUILTIN_BLOCKS.filter((b) => b.id === id))}
                    slides={slides}
                    disabled={disabled}
                    onInsert={onInsert}
                  />
                </>
              )}
            </>
          ) : (
            <AllTypes disabled={disabled} onPick={pick} />
          )}
        </>
      )}
    </div>
  );
}

/** Folientypen eines Ziels (oder Suchtreffer) als Karten mit Mini-Vorschau */
function ItemGrid({ items, disabled, onPick }: { items: GoalItem[]; disabled: boolean; onPick: (item: GoalItem) => void }) {
  return (
    <div className="type-cards">
      {items.map((item) => {
        const key = goalItemKey(item);
        return (
          <button key={key} className="type-card" data-pick disabled={disabled} onClick={() => onPick(item)}>
            <TypeSketch itemKey={key} />
            <strong>{goalItemLabel(item)}</strong>
            <span className="small faint">
              {item.type === 'board' && `${SLIDE_TYPE_LABELS.board} · `}
              {goalItemHint(item)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Bisherige vollständige Liste für Erfahrene */
function AllTypes({ disabled, onPick }: { disabled: boolean; onPick: (item: GoalItem) => void }) {
  const plain = ALL_GOAL_ITEMS.filter((i) => i.type !== 'board');
  const board = ALL_GOAL_ITEMS.filter((i) => i.type === 'board');
  const row = (item: GoalItem) => (
    <button key={goalItemKey(item)} className="type-option" data-pick onClick={() => onPick(item)} disabled={disabled}>
      <span className="slide-type-icon">
        <SlideIcon type={item.type} />
      </span>
      <span>
        <strong>{goalItemLabel(item)}</strong>
        <span className="small faint" style={{ display: 'block' }}>
          {goalItemHint(item)}
        </span>
      </span>
    </button>
  );
  return (
    <>
      {plain.map(row)}
      <span className="label type-picker-label">Workshop: {SLIDE_TYPE_LABELS.board}</span>
      {board.map(row)}
    </>
  );
}
