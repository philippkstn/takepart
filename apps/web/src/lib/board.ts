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

/** Überschrift aus einem Kartentext: an einer Wortgrenze gekürzt statt mitten im Wort */
export function shortName(text: string, max = 80): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')} …`;
}
