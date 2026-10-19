import {
  cardKey,
  groupKey,
  levelLabel,
  parseBoardKey,
  type BoardConfig,
  type BoardRating,
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

/** Kurzform einer Einschätzung, z. B. „Nutzen L · Aufwand M“ */
export function ratingText(config: Pick<BoardConfig, 'scales'>, rating: BoardRating | undefined): string {
  if (!rating) return '–';
  return config.scales.map((s, i) => `${s.label} ${levelLabel(s.levels, rating.average[i] ?? null)}`).join(' · ');
}

/** Position eines Durchschnitts auf der Achse (0…1) */
export function axisPosition(levels: number, average: number | null): number {
  if (average === null || levels <= 1) return 0.5;
  return average / (levels - 1);
}

export { cardKey, groupKey };
