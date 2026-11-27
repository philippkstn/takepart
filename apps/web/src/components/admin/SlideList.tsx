import {
  SECTION_MAX,
  SLIDE_TYPE_LABELS,
  assetThumbUrl,
  gapAt,
  listItems,
  moveSlides,
  plannedTotal,
  slideHeadline,
  stepGap,
  type SectionChange,
  type SectionedSlide,
  type Slide,
  type SlideGap,
} from '@slides/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Pencil, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { usePref } from '../../lib/prefs.ts';
import { SlideIcon } from '../slideIcons.tsx';
import { useToast } from '../ui.tsx';
import { useSlideDrag } from './useSlideDrag.ts';
import type { SlideSelection } from './useSlideSelection.ts';

/** Was das Kontextmenü einer Folie aus der Liste braucht */
export interface SlideMenuRequest {
  slideId: number;
  x: number;
  y: number;
  above?: number;
  /** Folien, auf die sich Duplizieren/Löschen/Baustein beziehen (Auswahl oder nur diese) */
  ids: number[];
  /** Block eine Zeile nach oben/unten – `null` am Rand */
  moveUp: (() => void) | null;
  moveDown: (() => void) | null;
  /** Beginnt an der Folie ein Abschnitt? Dann umbenennen statt neu beginnen */
  sectionTitle: string | null;
}

const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');

export const initials = (name: string) =>
  name.startsWith('du (')
    ? 'Du'
    : name
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join('') || '?';

/**
 * Folienliste des Editors: Abschnitte (einklappbar, umbenennbar), Mehrfachauswahl,
 * Ziehen (auch der ganzen Auswahl oder eines Abschnitts über seine Überschrift) und
 * Tastatur (↑/↓ wählen, Umschalt+↑/↓ erweitern, Alt+↑/↓ verschieben, Entf löschen,
 * ⌘/Strg+D duplizieren, Escape hebt die Auswahl auf).
 */
export function SlideList({
  presentationId,
  slides,
  sections,
  plannedOf,
  selectedId,
  selection,
  onSelect,
  canEdit,
  othersOn,
  editingSection,
  onEditingSection,
  onMenu,
  onReorder,
  onRemove,
  onDuplicate,
  asideProps,
  children,
}: {
  presentationId: number;
  slides: Slide[];
  /** Abschnittstitel je Folien-ID (Folie, an der er beginnt) */
  sections: Record<string, string>;
  plannedOf: (slideId: number) => number | null;
  selectedId: number | null;
  selection: SlideSelection;
  onSelect: (slideId: number) => void;
  canEdit: boolean;
  othersOn: (slideId: number) => string[];
  /** Folie, an der gerade ein Abschnitt benannt wird (neu oder umbenennen) */
  editingSection: number | null;
  onEditingSection: (slideId: number | null) => void;
  onMenu: (request: SlideMenuRequest) => void;
  onReorder: (ids: number[], sections: SectionChange[]) => void;
  onRemove: (slideIds: number[]) => void;
  onDuplicate: (slideIds: number[]) => void;
  /** Für das Ablegen von PDF-Dateien und Klassen der Seitenleiste */
  asideProps?: HTMLAttributes<HTMLElement>;
  /** Knöpfe unter der Liste */
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [collapsedPref, setCollapsed] = usePref<number[]>(`editor-sections:${presentationId}`, [], isIdList);
  const order: SectionedSlide[] = slides.map((s) => ({ id: s.id, section: sections[s.id] ?? null }));
  // Nur Abschnitte, die es noch gibt
  const collapsed = collapsedPref.filter((id) => sections[id]);
  const items = listItems(order, collapsed);
  const byId = new Map(slides.map((s) => [s.id, s]));
  const numberOf = new Map(slides.map((s, i) => [s.id, i + 1]));
  /** Abschnitt (Start-ID) jeder Folie */
  const sectionOf = new Map<number, number>();
  for (const it of items) if (it.kind === 'section') for (const id of it.ids) sectionOf.set(id, it.start);

  const expand = (start: number | undefined) => {
    if (start !== undefined && collapsed.includes(start)) setCollapsed(collapsed.filter((id) => id !== start));
  };
  // Landet die Auswahl in einem eingeklappten Abschnitt (Tastatur, neue Folie …), klappt er auf
  const lastSelected = useRef(selectedId);
  useEffect(() => {
    if (lastSelected.current === selectedId) return;
    lastSelected.current = selectedId;
    if (selectedId !== null) expand(sectionOf.get(selectedId));
  });

  const move = (ids: number[], gap: SlideGap | null) => {
    if (!gap || !canEdit) return;
    const result = moveSlides(order, ids, gap);
    if (!result) return;
    onReorder(result.ids, result.sections);
    // Abgelegt in einem eingeklappten Abschnitt: aufklappen, damit die Folien sichtbar bleiben
    const titles = new Map(order.map((s) => [s.id, s.section]));
    for (const c of result.sections) titles.set(c.id, c.section);
    const firstAt = Math.min(...ids.map((id) => result.ids.indexOf(id)).filter((i) => i >= 0));
    const start = result.ids
      .slice(0, firstAt + 1)
      .reverse()
      .find((id) => titles.get(id));
    expand(start);
  };

  const dragging = useSlideDrag({
    enabled: canEdit,
    onDrop: (ids, at) => {
      // Eine nicht ausgewählte Folie gezogen: danach ist sie die Auswahl
      if (!ids.every((id) => selection.has(id))) {
        if (ids.length === 1) onSelect(ids[0]!);
        else selection.select(ids);
      }
      move(ids, gapAt(items, at));
    },
  });
  const drag = dragging.drag;
  /** Zeigt die Einfügelinie nur, wo das Ablegen etwas ändert */
  const dropAt = drag && moveSlides(order, drag.ids, gapAt(items, drag.at)) ? drag.at : null;

  /** Ziehen beginnen: eine ausgewählte Folie nimmt die ganze Auswahl mit */
  const startDrag = (e: ReactPointerEvent, slideId: number, fromHandle: boolean) =>
    dragging.start(e, selection.has(slideId) ? selection.ids : [slideId], fromHandle);

  const focusRow = (id: number) =>
    requestAnimationFrame(() => dragging.listRef.current?.querySelector<HTMLElement>(`li[data-slide-id="${id}"] .slide-item`)?.focus());

  const visible = items.flatMap((it) => (it.kind === 'slide' ? [it.id] : []));

  const onKey = (e: ReactKeyboardEvent, slideId: number) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      e.preventDefault();
      if (e.altKey) {
        move(selection.has(slideId) ? selection.ids : [slideId], stepGap(items, selection.has(slideId) ? selection.ids : [slideId], dir));
        focusRow(slideId);
        return;
      }
      const next = visible[visible.indexOf(slideId) + dir];
      if (next === undefined) return;
      if (e.shiftKey) selection.range(next);
      else onSelect(next);
      focusRow(next);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
      e.preventDefault();
      onRemove(selection.has(slideId) ? selection.ids : [slideId]);
    } else if (e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey) && canEdit) {
      e.preventDefault();
      onDuplicate(selection.has(slideId) ? selection.ids : [slideId]);
    } else if (e.key === 'Escape' && selection.multi) {
      e.preventDefault();
      selection.clear();
    }
  };

  /** Abschnitt beginnen, umbenennen oder entfernen (`null`) – sofort in der Liste, dann gespeichert */
  const saveSection = async (slideId: number, title: string | null) => {
    const key = ['presentation', presentationId];
    queryClient.setQueryData<{ sections?: Record<string, string> }>(key, (p) => {
      if (!p) return p;
      const next = { ...p.sections };
      if (title) next[slideId] = title;
      else delete next[slideId];
      return { ...p, sections: next };
    });
    try {
      await api(`/api/slides/${slideId}/section`, { method: 'PUT', body: { section: title } });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
    await queryClient.invalidateQueries({ queryKey: key });
  };

  const openMenu = (slideId: number, pos: { x: number; y: number; above?: number }) => {
    // Rechtsklick in der Auswahl behält sie; sonst gilt nur diese Folie
    const ids = selection.has(slideId) ? selection.ids : [slideId];
    if (!selection.has(slideId)) onSelect(slideId);
    const up = stepGap(items, ids, -1);
    const down = stepGap(items, ids, 1);
    onMenu({
      slideId,
      ...pos,
      ids,
      moveUp: up && moveSlides(order, ids, up) ? () => move(ids, up) : null,
      moveDown: down && moveSlides(order, ids, down) ? () => move(ids, down) : null,
      sectionTitle: sections[slideId] ?? null,
    });
  };

  /** Menü unter einem Knopf öffnen */
  const below = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4, above: r.top - 4 };
  };

  const rowClass = (index: number, extra: string[]) =>
    [...extra, dropAt === index ? 'drop-before' : '', dropAt === items.length && index === items.length - 1 ? 'drop-after' : '']
      .filter(Boolean)
      .join(' ');

  return (
    <aside {...asideProps} className={`slide-list card ${asideProps?.className ?? ''}`}>
      <ol ref={dragging.listRef} aria-label="Folien">
        {items.map((it, index) => {
          if (it.kind === 'section') {
            const minutes = plannedTotal(it.ids.map(plannedOf));
            const dragged = !!drag && it.ids.every((id) => drag.ids.includes(id));
            return (
              <li
                key={`section-${it.start}`}
                data-row
                className={rowClass(index, ['slide-section', dragged ? 'is-dragging' : ''])}
                onPointerDown={(e) => editingSection !== it.start && dragging.start(e, it.ids, false)}
              >
                {editingSection === it.start ? (
                  <SectionNameInput
                    initial={it.title}
                    onDone={(title) => {
                      onEditingSection(null);
                      if (title && title !== it.title) void saveSection(it.start, title);
                    }}
                  />
                ) : (
                  <>
                    <button
                      className="icon-btn slide-section-toggle"
                      data-no-drag
                      aria-expanded={!it.collapsed}
                      aria-label={it.collapsed ? `Abschnitt „${it.title}“ aufklappen` : `Abschnitt „${it.title}“ einklappen`}
                      onClick={() => setCollapsed(it.collapsed ? collapsed.filter((id) => id !== it.start) : [...collapsed, it.start])}
                    >
                      {it.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      className="slide-section-title"
                      title="Klick wählt alle Folien des Abschnitts, Doppelklick benennt ihn um"
                      onClick={() => selection.select(it.ids)}
                      onDoubleClick={() => canEdit && onEditingSection(it.start)}
                    >
                      <span className="grow">{it.title}</span>
                      <span className="small faint tabular">
                        {it.ids.length} {it.ids.length === 1 ? 'Folie' : 'Folien'}
                        {minutes > 0 && ` · ${minutes} Min.`}
                      </span>
                    </button>
                    {canEdit && (
                      <span className="slide-section-actions" data-no-drag>
                        <button
                          className="icon-btn"
                          aria-label={`Abschnitt „${it.title}“ umbenennen`}
                          title="Umbenennen"
                          onClick={() => onEditingSection(it.start)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Abschnitt „${it.title}“ entfernen`}
                          title="Abschnitt entfernen – die Folien bleiben"
                          onClick={() => {
                            expand(it.start);
                            void saveSection(it.start, null);
                          }}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          }
          const s = byId.get(it.id)!;
          const n = numberOf.get(s.id)!;
          const planned = plannedOf(s.id);
          const others = othersOn(s.id);
          const isSelected = selection.has(s.id);
          return [
            // Neuer Abschnitt wird gerade benannt: Eingabe als Überschrift über der Folie
            editingSection === s.id && !sections[s.id] && (
              <li key={`new-section-${s.id}`} className="slide-section is-new">
                <SectionNameInput
                  initial=""
                  onDone={(title) => {
                    onEditingSection(null);
                    if (title) void saveSection(s.id, title);
                  }}
                />
              </li>
            ),
            <li
              key={s.id}
              data-row
              data-slide-id={s.id}
              className={rowClass(index, [
                isSelected ? 'is-selected' : '',
                isSelected && selection.multi && s.id === selectedId ? 'is-focus' : '',
                drag?.ids.includes(s.id) ? 'is-dragging' : '',
              ])}
              onPointerDown={(e) => startDrag(e, s.id, false)}
              onContextMenu={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                openMenu(s.id, { x: e.clientX, y: e.clientY });
              }}
            >
              {canEdit && (
                <span
                  className="slide-grip"
                  aria-hidden
                  title="Ziehen zum Verschieben"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    startDrag(e, s.id, true);
                  }}
                >
                  <GripVertical size={14} />
                </span>
              )}
              <button
                className="slide-item"
                onClick={(e) => selection.click(s.id, e)}
                onKeyDown={(e) => onKey(e, s.id)}
                aria-current={s.id === selectedId ? 'true' : undefined}
                aria-selected={selection.multi ? isSelected : undefined}
                aria-keyshortcuts={canEdit ? 'Alt+ArrowUp Alt+ArrowDown Delete' : undefined}
              >
                <span className="slide-num tabular">{n}</span>
                {s.type === 'image' ? (
                  <img className="slide-thumb" src={assetThumbUrl(s.config.asset)} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="slide-type-icon">
                    <SlideIcon type={s.type} />
                  </span>
                )}
                <span className="slide-item-text">
                  <span className="slide-item-type">
                    {SLIDE_TYPE_LABELS[s.type]}
                    {planned !== null && <span className="tabular"> · {planned} Min.</span>}
                  </span>
                  <span className="slide-item-title">{slideHeadline(s) || <em className="faint">ohne Titel</em>}</span>
                </span>
                {others.length > 0 && (
                  <span className="slide-presence" title={`Gerade hier: ${others.join(', ')}`}>
                    {others.map((name) => (
                      <span key={name} className="editor-chip is-small" aria-hidden>
                        {initials(name)}
                      </span>
                    ))}
                  </span>
                )}
              </button>
              {canEdit && (
                <button
                  className="icon-btn slide-more"
                  data-no-drag
                  aria-label={`Aktionen für Folie ${n}`}
                  title="Aktionen"
                  onClick={(e) => openMenu(s.id, below(e.currentTarget))}
                >
                  <MoreHorizontal size={16} />
                </button>
              )}
            </li>,
          ];
        })}
      </ol>
      {canEdit && slides.length > 1 && (
        <p className="slide-list-hint small faint">
          {selection.multi
            ? `${selection.ids.length} ausgewählt · ziehen oder Alt + ↑/↓ verschiebt alle`
            : 'Zum Verschieben ziehen oder Alt + ↑/↓ · Umschalt/⌘ wählt mehrere'}
        </p>
      )}
      {children}
    </aside>
  );
}

/** Eingabe für den Namen eines Abschnitts: Enter/Verlassen speichert, Escape bricht ab */
function SectionNameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <input
      className="input slide-section-input"
      autoFocus
      maxLength={SECTION_MAX}
      value={value}
      placeholder="Name des Abschnitts, z. B. Ankommen"
      aria-label="Name des Abschnitts"
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(value.trim() || null);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(value.trim() || null)}
    />
  );
}
