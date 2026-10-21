import type { BoardResults } from './results.ts';
import type { BoardConfig } from './slides.ts';
import type { BoardView } from './state.ts';

/**
 * Kartenwand: Hilfsfunktionen für Einträge. Ein Eintrag ist eine Karte
 * (`c<id>`, ein Beitrag) oder eine Gruppe (`g<id>`). Punkte, Bewertungen,
 * Platzierungen und Tabellenzeilen verweisen über diese Schlüssel darauf.
 */

export type BoardTargetKind = 'cards' | 'groups';

export const cardKey = (id: number) => `c${id}`;
export const groupKey = (id: number) => `g${id}`;
export const BOARD_KEY = /^[cg][1-9]\d{0,9}$/;

export function parseBoardKey(key: string): { kind: 'card' | 'group'; id: number } | null {
  if (!BOARD_KEY.test(key)) return null;
  return { kind: key[0] === 'c' ? 'card' : 'group', id: Number(key.slice(1)) };
}

/** Worauf sich eine Folie bezieht: „automatisch“ heißt Gruppen, sobald es welche gibt. */
export function targetKind(config: Pick<BoardConfig, 'targets'>, groupCount: number): BoardTargetKind {
  if (config.targets === 'auto' || config.targets === 'table') return groupCount > 0 ? 'groups' : 'cards';
  return config.targets;
}

/** Punkte je Eintrag über alle Antworten (z. B. aller Punkte-Folien einer Wand). */
export function dotTotals(rows: { dots?: Record<string, number> }[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of rows) for (const [key, n] of Object.entries(r.dots ?? {})) if (n > 0) totals[key] = (totals[key] ?? 0) + n;
  return totals;
}

/** Nach Punkten sortieren; bei Gleichstand bleibt die ursprüngliche Reihenfolge. */
export function rankByDots(keys: string[], totals: Record<string, number>): string[] {
  return keys
    .map((key, i) => ({ key, i, n: totals[key] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((e) => e.key);
}

/** Höchstens so viele zusätzliche Einträge holt ein Gleichstand an der Grenze mit in die Auswahl */
export const MAX_TIE_EXTRA = 2;

/**
 * Die N Einträge mit den meisten Punkten. Liegt die Grenze in einem kleinen
 * Gleichstand (höchstens `MAX_TIE_EXTRA` mehr), kommen alle gleichauf liegenden
 * mit. Bei größerem Gleichstand (z. B. viele Karten mit je einem Punkt) bleibt
 * es bei N – entschieden wird nichts automatisch, der Gleichstand wird nur
 * benannt (`tiedKeys`, `tieAtLimit`).
 */
export function topByDots(keys: string[], totals: Record<string, number>, n: number): string[] {
  const ranked = rankByDots(keys, totals);
  if (n <= 0 || ranked.length <= n) return ranked;
  const limit = totals[ranked[n - 1]!] ?? 0;
  if (limit === 0) return ranked.slice(0, n);
  let end = n;
  while (end < ranked.length && (totals[ranked[end]!] ?? 0) === limit) end++;
  return ranked.slice(0, end - n > MAX_TIE_EXTRA ? n : end);
}

/** Einträge mit Punkten, die sich ihre Punktzahl mit mindestens einem anderen teilen. */
export function tiedKeys(keys: string[], totals: Record<string, number>): string[] {
  const count = new Map<number, number>();
  for (const key of keys) {
    const n = totals[key] ?? 0;
    if (n > 0) count.set(n, (count.get(n) ?? 0) + 1);
  }
  return keys.filter((key) => (count.get(totals[key] ?? 0) ?? 0) > 1);
}

/**
 * Einträge, die auf einer Folie platziert, gepunktet oder bewertet werden.
 * Mit `top` nur die N mit den meisten Punkten (bei Gleichstand an der Grenze
 * mehr) – dann in Punkte-Reihenfolge. `table` nimmt die übergebenen
 * Tabellenzeilen (Reihenfolge der Tabelle).
 */
export function boardTargets(
  config: Pick<BoardConfig, 'targets' | 'top'>,
  cards: { id: number }[],
  groups: { id: number }[],
  totals: Record<string, number>,
  tableRows: string[] = [],
): string[] {
  if (config.targets === 'table') return tableRows;
  const keys = targetKind(config, groups.length) === 'groups' ? groups.map((g) => groupKey(g.id)) : cards.map((c) => cardKey(c.id));
  if (config.top <= 0) return keys;
  return topByDots(keys, totals, config.top);
}

/** Verteilung der Kennzeichnungen (z. B. S–XL) über Karten: Anzahl je Kennzeichnung, Index wie `tags`. */
export function tagCounts(cards: { column: number | null }[], tagCount: number): number[] {
  const counts = Array.from({ length: tagCount }, () => 0);
  for (const c of cards) if (c.column !== null && c.column < tagCount) counts[c.column]!++;
  return counts;
}

/** Verteilung der Kennzeichnungen je Gruppe (`g<id>`); Gruppen ohne gekennzeichnete Karten fehlen. */
export function groupTagCounts(
  cards: { column: number | null; group?: number | null }[],
  groups: { id: number }[],
  tagCount: number,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (tagCount === 0) return out;
  for (const g of groups) {
    const counts = tagCounts(
      cards.filter((c) => c.group === g.id),
      tagCount,
    );
    if (counts.some((n) => n > 0)) out[groupKey(g.id)] = counts;
  }
  return out;
}

/**
 * Kurzform einer Verteilung, große Stufen zuerst (Kennzeichnungen sind meist
 * aufsteigend angelegt, z. B. S, M, L, XL) – nur Werte über null: „XL 3 · L 2 · M 1“.
 */
export function tagCountParts(tags: string[], counts: number[] | undefined): { tag: string; n: number }[] {
  if (!counts) return [];
  return tags
    .map((tag, i) => ({ tag, n: counts[i] ?? 0 }))
    .filter((e) => e.n > 0)
    .reverse();
}

export function tagCountText(tags: string[], counts: number[] | undefined): string {
  return tagCountParts(tags, counts)
    .map((e) => `${e.tag} ${e.n}`)
    .join(' · ');
}

/**
 * Gleichstand an der Grenze einer Top-N-Auswahl: liefert die Platzzahl, wenn
 * `topByDots` wegen Gleichstands mehr als N Einträge mitnimmt, sonst null.
 */
export function tieAtLimit(n: number, shown: number, moreTied = false): string | null {
  if (n <= 0) return null;
  if (shown > n) return `Gleichstand auf Platz ${n} – ${shown} Einträge`;
  return moreTied ? `Gleichstand auf Platz ${n} – weitere liegen gleichauf` : null;
}

/** Einordnen: gewählte Kategorien eines Eintrags – Festlegung der Moderation, sonst die meistgewählten. */
export function leadingChoices(counts: number[] | undefined, chosen: number[] | undefined): { indices: number[]; fixed: boolean } {
  if (chosen && chosen.length > 0) return { indices: chosen, fixed: true };
  const max = Math.max(0, ...(counts ?? []));
  if (max === 0) return { indices: [], fixed: false };
  return { indices: (counts ?? []).flatMap((n, i) => (n === max ? [i] : [])), fixed: false };
}

/** Durchschnitt (0-basierter Stufenindex) als Stufenname, z. B. 2,4 → „L“. */
export function levelLabel(levels: string[], average: number | null): string {
  if (average === null || levels.length === 0) return '–';
  const i = Math.min(levels.length - 1, Math.max(0, Math.round(average)));
  return levels[i]!;
}

/**
 * Bewerten aus Kennzeichnungen: Durchschnitt der Stufen-Indizes der gekennzeichneten
 * Karten (Kennzeichnung i ↔ Stufe i, auf die vorhandenen Stufen begrenzt), z. B.
 * S, L, XL bei S–XL → 1,67. Ohne gekennzeichnete Karte null.
 */
export function tagLevel(columns: (number | null | undefined)[], levelCount: number): number | null {
  const used = columns.filter((c): c is number => typeof c === 'number' && c >= 0);
  if (used.length === 0 || levelCount < 1) return null;
  const sum = used.reduce((a, c) => a + Math.min(c, levelCount - 1), 0);
  return Math.round((sum / used.length) * 100) / 100;
}

/** Kennzeichnungen (Spalten) der sichtbaren Karten eines Eintrags: bei einer Gruppe alle ihre Karten, sonst die Karte selbst */
export function entryTagColumns(
  key: string,
  cards: { id: number; column?: number | null; group?: number | null; status?: string }[],
): (number | null)[] {
  const parsed = parseBoardKey(key);
  if (!parsed) return [];
  const visible = cards.filter((c) => c.status === undefined || c.status === 'visible');
  const own = parsed.kind === 'group' ? visible.filter((c) => c.group === parsed.id) : visible.filter((c) => c.id === parsed.id);
  return own.map((c) => c.column ?? null);
}

/**
 * Bewerten: endgültige Stufe (0-basierter Durchschnitt) je Kriterium. Festlegungen der
 * Moderation und Werte aus Kennzeichnungen liefert die Ansicht (`rated`), Stimmen
 * kommen aus dem Ergebnis – das gibt es nur, solange es sichtbar ist.
 */
export function finalLevels(
  config: Pick<BoardConfig, 'scales'>,
  view: Pick<BoardView, 'rated'>,
  results: Pick<BoardResults, 'ratings'> | null | undefined,
  key: string,
): (number | null)[] {
  return config.scales.map((scale, i) => {
    const own = view.rated?.[key]?.[i];
    if (own !== null && own !== undefined) return own;
    return scale.source === 'votes' ? (results?.ratings[key]?.average[i] ?? null) : null;
  });
}

/** Woher der endgültige Wert eines Kriteriums kommt: Festlegung der Moderation oder die eingestellte Quelle */
export function levelOrigin(
  config: Pick<BoardConfig, 'scales'>,
  view: Pick<BoardView, 'ratedFixed'>,
  key: string,
  i: number,
): 'fixed' | 'votes' | 'tags' | 'host' {
  if (view.ratedFixed?.[key]?.[i]) return 'fixed';
  return config.scales[i]?.source ?? 'votes';
}

/** Kurzform endgültiger Stufen, z. B. „Nutzen L · Aufwand M“ (ohne Wert: „–“) */
export function levelsText(config: Pick<BoardConfig, 'scales'>, values: (number | null)[]): string {
  return config.scales.map((s, i) => `${s.label} ${levelLabel(s.levels, values[i] ?? null)}`).join(' · ');
}

/** Hinweis unter dem Titel, woher die Werte kommen – nur wenn nicht alle von den Handys kommen */
export function ratingSourceNote(config: Pick<BoardConfig, 'scales'>): string | null {
  if (config.scales.every((s) => s.source === 'votes')) return null;
  const from = { votes: 'von allen', tags: 'aus den Karten', host: 'von der Moderation' } as const;
  return config.scales.map((s) => `${s.label} ${from[s.source]}`).join(' · ');
}

/** Gibt es auf der Folie überhaupt etwas abzustimmen? (sonst ordnet allein die Moderation bzw. die Kennzeichnung ein) */
export const hasVoteScale = (config: Pick<BoardConfig, 'scales'>) => config.scales.some((s) => s.source === 'votes');
