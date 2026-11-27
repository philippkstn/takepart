import { z } from 'zod';

/**
 * Abschnitte der Folienliste („Ankommen“, „Arbeitsphase 1“ …). Gespeichert als
 * Titel an der Folie, mit der ein Abschnitt beginnt (`slides.section`); er reicht
 * bis zur nächsten Folie mit eigenem Titel. Nur Editor und Steuerpult – nie Beamer
 * oder Teilnehmende.
 */

export const SECTION_MAX = 80;
/** Eingabe eines Abschnittstitels; leer = kein Abschnitt */
export const sectionInput = z
  .string()
  .trim()
  .max(SECTION_MAX)
  .nullable()
  .transform((v) => v || null);

export interface SectionedSlide {
  id: number;
  section: string | null;
}

export interface SectionChange {
  id: number;
  section: string | null;
}

/** Einfügestelle: vor Folie `before` (`null` = ans Ende); `into` = unter deren Überschrift, als neue erste Folie */
export interface SlideGap {
  before: number | null;
  into?: boolean;
}

export type SlideListItem =
  { kind: 'section'; start: number; title: string; ids: number[]; collapsed: boolean } | { kind: 'slide'; id: number };

/** Abschnitt jeder Folie: ID der Folie, an der er beginnt (`null` = vor dem ersten Abschnitt) */
function sectionStarts(order: SectionedSlide[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  let start: number | null = null;
  for (const s of order) {
    if (s.section) start = s.id;
    out.set(s.id, start);
  }
  return out;
}

/** Nur tatsächliche Änderungen gegenüber dem Ausgangsstand */
function netChanges(order: SectionedSlide[], titles: Map<number, string | null>): SectionChange[] {
  return order.filter((s) => (titles.get(s.id) ?? null) !== s.section).map((s) => ({ id: s.id, section: titles.get(s.id) ?? null }));
}

/**
 * Titel von Abschnitten weitergeben, deren erste Folie wegfällt (gelöscht oder
 * verschoben): an die nächste verbleibende Folie desselben Abschnitts. Fallen
 * alle seine Folien weg, bleibt der Titel, wo er war.
 */
function carry(order: SectionedSlide[], leaving: Set<number>, titles: Map<number, string | null>) {
  const starts = sectionStarts(order);
  for (const s of order) {
    if (!s.section || !leaving.has(s.id)) continue;
    const heir = order.find((o) => starts.get(o.id) === s.id && !leaving.has(o.id));
    if (!heir) continue;
    titles.set(heir.id, s.section);
    titles.set(s.id, null);
  }
}

/** Abschnitte erhalten, wenn Folien gelöscht werden: Änderungen für die verbleibenden Folien */
export function carrySections(order: SectionedSlide[], removed: number[]): SectionChange[] {
  const leaving = new Set(removed);
  const titles = new Map(order.map((s) => [s.id, s.section]));
  carry(order, leaving, titles);
  return netChanges(order, titles).filter((c) => !leaving.has(c.id));
}

/**
 * Folien (auch eine verstreute Auswahl) als zusammenhängenden Block an eine
 * Einfügestelle verschieben – in ihrer bisherigen Reihenfolge. Liefert neue
 * Reihenfolge und geänderte Abschnittstitel, `null` wenn sich nichts ändert.
 */
export function moveSlides(order: SectionedSlide[], moved: number[], gap: SlideGap): { ids: number[]; sections: SectionChange[] } | null {
  const movedSet = new Set(moved);
  const block = order.filter((s) => movedSet.has(s.id)).map((s) => s.id);
  if (block.length === 0) return null;
  const titles = new Map(order.map((s) => [s.id, s.section]));
  carry(order, movedSet, titles);

  // Ziel in der Auswahl: auf die nächste Folie dahinter, die bleibt
  let before = gap.before;
  if (before !== null && movedSet.has(before)) {
    const from = order.findIndex((s) => s.id === before);
    before = order.slice(from).find((s) => !movedSet.has(s.id))?.id ?? null;
  }
  const rest = order.filter((s) => !movedSet.has(s.id)).map((s) => s.id);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at < 0) return null;
  const ids = [...rest.slice(0, at), ...block, ...rest.slice(at)];

  // Unter einer Überschrift abgelegt: der Block beginnt den Abschnitt – außer er bringt einen eigenen mit
  const first = block[0]!;
  if (gap.into && before !== null && titles.get(before) && !titles.get(first)) {
    titles.set(first, titles.get(before)!);
    titles.set(before, null);
  }

  const sections = netChanges(order, titles);
  if (sections.length === 0 && ids.every((id, i) => id === order[i]!.id)) return null;
  return { ids, sections };
}

/** Zeilen der Folienliste: Überschriften und (in aufgeklappten Abschnitten) Folien */
export function listItems(order: SectionedSlide[], collapsed: Iterable<number>): SlideListItem[] {
  const closed = new Set(collapsed);
  const items: SlideListItem[] = [];
  let current: Extract<SlideListItem, { kind: 'section' }> | null = null;
  for (const s of order) {
    if (s.section) {
      current = { kind: 'section', start: s.id, title: s.section, ids: [], collapsed: closed.has(s.id) };
      items.push(current);
    }
    current?.ids.push(s.id);
    if (!current?.collapsed) items.push({ kind: 'slide', id: s.id });
  }
  return items;
}

/** Einfügestelle vor Zeile `index` der Liste (`items.length` = ans Ende) */
export function gapAt(items: SlideListItem[], index: number): SlideGap {
  const item = items[index];
  if (!item) return { before: null };
  if (item.kind === 'section') return { before: item.start };
  const prev = items[index - 1];
  return prev?.kind === 'section' && prev.start === item.id ? { before: item.id, into: true } : { before: item.id };
}

/** Alt+↑/↓: Einfügestelle eine Zeile über bzw. unter der Auswahl (`null` am Rand) */
export function stepGap(items: SlideListItem[], moved: number[], dir: -1 | 1): SlideGap | null {
  const set = new Set(moved);
  const rows = items.flatMap((it, i) => (it.kind === 'slide' && set.has(it.id) ? [i] : []));
  if (rows.length === 0) return null;
  if (dir < 0) {
    const i = rows[0]!;
    return i > 0 ? gapAt(items, i - 1) : null;
  }
  const j = rows.at(-1)!;
  return j + 1 < items.length ? gapAt(items, j + 2) : null;
}
