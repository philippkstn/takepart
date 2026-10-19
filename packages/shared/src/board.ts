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
  if (config.targets === 'auto') return groupCount > 0 ? 'groups' : 'cards';
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
 * Einträge, die auf einer Folie platziert, gepunktet oder bewertet werden.
 * Mit `top` nur die N mit den meisten Punkten – dann in Punkte-Reihenfolge.
 */
export function boardTargets(
  config: Pick<BoardConfig, 'targets' | 'top'>,
  cards: { id: number }[],
  groups: { id: number }[],
  totals: Record<string, number>,
): string[] {
  const keys = targetKind(config, groups.length) === 'groups' ? groups.map((g) => groupKey(g.id)) : cards.map((c) => cardKey(c.id));
  if (config.top <= 0) return keys;
  return rankByDots(keys, totals).slice(0, config.top);
}

/** Durchschnitt (0-basierter Stufenindex) als Stufenname, z. B. 2,4 → „L“. */
export function levelLabel(levels: string[], average: number | null): string {
  if (average === null || levels.length === 0) return '–';
  const i = Math.min(levels.length - 1, Math.max(0, Math.round(average)));
  return levels[i]!;
}
