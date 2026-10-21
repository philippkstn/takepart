import type { BoardConfig } from './slides.ts';

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

/**
 * Die N Einträge mit den meisten Punkten. Liegt die Grenze in einem Gleichstand,
 * kommen alle gleichauf liegenden mit – entschieden wird nichts automatisch,
 * der Gleichstand wird nur benannt (`tiedKeys`).
 */
export function topByDots(keys: string[], totals: Record<string, number>, n: number): string[] {
  const ranked = rankByDots(keys, totals);
  if (n <= 0 || ranked.length <= n) return ranked;
  const limit = totals[ranked[n - 1]!] ?? 0;
  if (limit === 0) return ranked.slice(0, n);
  let end = n;
  while (end < ranked.length && (totals[ranked[end]!] ?? 0) === limit) end++;
  return ranked.slice(0, end);
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

/** Durchschnitt (0-basierter Stufenindex) als Stufenname, z. B. 2,4 → „L“. */
export function levelLabel(levels: string[], average: number | null): string {
  if (average === null || levels.length === 0) return '–';
  const i = Math.min(levels.length - 1, Math.max(0, Math.round(average)));
  return levels[i]!;
}
