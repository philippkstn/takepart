import {
  cardKey,
  finalLevels,
  groupKey,
  levelLabel,
  levelOrigin,
  parseBoardKey,
  type BoardConfig,
  type BoardResults,
  type BoardView,
  type PostView,
} from '@slides/shared';

/** Text eines Eintrags: Kartentext oder Gruppenüberschrift */
export function labelOf(key: string, posts: PostView[], board: Pick<BoardView, 'groups'>): string {
  const parsed = parseBoardKey(key);
  if (!parsed) return '';
  if (parsed.kind === 'group') return board.groups.find((g) => g.id === parsed.id)?.name ?? '';
  return posts.find((p) => p.id === parsed.id)?.text ?? '';
}

/** Sichtbare Karten nach Gruppe; `null` = Ablage (noch nicht eingeordnet) */
export function cardsByGroup(posts: PostView[]): Map<number | null, PostView[]> {
  const map = new Map<number | null, PostView[]>();
  for (const p of posts) {
    if (p.status !== 'visible') continue;
    const key = p.group ?? null;
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
}

/** Einträge nach Feld (`lane:cell`) und die noch nicht platzierten */
export function itemsByCell(board: BoardView): { cells: Map<string, string[]>; unplaced: string[] } {
  const cells = new Map<string, string[]>();
  const unplaced: string[] = [];
  for (const key of board.targets) {
    const place = board.places[key];
    if (!place) {
      unplaced.push(key);
      continue;
    }
    const id = `${place.lane}:${place.cell}`;
    cells.set(id, [...(cells.get(id) ?? []), key]);
  }
  return { cells, unplaced };
}

/**
 * Kurzform der endgültigen Einschätzung, z. B. „Nutzen L · Aufwand M (festgelegt)“ –
 * Festlegung der Moderation, Kennzeichnungen der Karten oder Durchschnitt der Stimmen.
 */
export function finalRatingText(
  config: Pick<BoardConfig, 'scales'>,
  view: Pick<BoardView, 'rated' | 'ratedFixed'>,
  results: Pick<BoardResults, 'ratings'> | null | undefined,
  key: string,
): string {
  const levels = finalLevels(config, view, results, key);
  return config.scales
    .map((s, i) => {
      const v = levels[i] ?? null;
      return `${s.label} ${levelLabel(s.levels, v)}${v !== null && levelOrigin(config, view, key, i) === 'fixed' ? ' (festgelegt)' : ''}`;
    })
    .join(' · ');
}

/** Summe der endgültigen Stufen – zum Sortieren (ohne Werte ganz unten) */
export function finalRatingScore(
  config: Pick<BoardConfig, 'scales'>,
  view: Pick<BoardView, 'rated'>,
  results: Pick<BoardResults, 'ratings'> | null | undefined,
  key: string,
): number {
  const levels = finalLevels(config, view, results, key);
  return levels.every((v) => v === null) ? -1 : levels.reduce<number>((a, b) => a + (b ?? 0), 0);
}

/** Anzahl Stimmen je Kriterium, das alle schätzen, z. B. „5 / 4“ */
export function voteCounts(
  config: Pick<BoardConfig, 'scales'>,
  results: Pick<BoardResults, 'ratings'> | null | undefined,
  key: string,
): string {
  return config.scales.flatMap((s, i) => (s.source === 'votes' ? [String(results?.ratings[key]?.n[i] ?? 0)] : [])).join(' / ');
}

/** Position eines Durchschnitts auf der Achse (0…1) */
export function axisPosition(levels: number, average: number | null): number {
  if (average === null || levels <= 1) return 0.5;
  return average / (levels - 1);
}

export { cardKey, groupKey };

/** Überschrift aus einem Kartentext: an einer Wortgrenze gekürzt statt mitten im Wort */
export function shortName(text: string, max = 80): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')} …`;
}
