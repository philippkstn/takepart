/**
 * Gruppeneinteilung: zufällig, gleich große Gruppen (höchstens eine Person
 * Unterschied), auf Wunsch nach Kennzeichnung (z. B. Rolle) gemischt.
 */

export interface TeamPerson {
  id: number;
  tag: number | null;
}

export interface TeamOptions {
  /** count: n Gruppen · size: Gruppen à n Personen */
  mode: 'count' | 'size';
  n: number;
  /** Kennzeichnungen möglichst gleichmäßig auf die Gruppen verteilen */
  mix: boolean;
  /**
   * Töpfe: Kennzeichnung (Index als Text, `none` = ohne Angabe) → Topf. Gruppen
   * entstehen nur innerhalb eines Topfes – z. B. jede Kategorie für sich oder
   * Marketing mit IT zusammen, PNC getrennt. Ohne Angabe ein gemeinsamer Topf.
   */
  pools?: Record<string, number>;
}

export const poolKey = (tag: number | null) => (tag === null ? 'none' : String(tag));
const poolOf = (pools: Record<string, number> | undefined, tag: number | null) => pools?.[poolKey(tag)] ?? 0;

/** n Gruppen anteilig auf Töpfe verteilen (je Topf mindestens eine, höchstens so viele wie Personen) */
function splitCount(sizes: number[], n: number): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const counts = sizes.map((s) => Math.min(s, Math.max(1, Math.floor((n * s) / total))));
  let rest = n - counts.reduce((a, b) => a + b, 0);
  // Übrige Gruppen an die Töpfe mit dem größten Rest, solange dort genug Personen sind
  const order = sizes.map((s, i) => ({ i, r: (n * s) / total - Math.floor((n * s) / total) })).sort((a, b) => b.r - a.r);
  for (let k = 0; rest > 0 && k < order.length * 2; k++) {
    const { i } = order[k % order.length]!;
    if (counts[i]! < sizes[i]!) {
      counts[i]!++;
      rest--;
    }
  }
  return counts;
}

type Random = () => number;

function shuffle<T>(items: T[], random: Random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Wie viele Gruppen entstehen. Bei Gruppengröße bleibt niemand allein: Reste verteilen sich (7 à 2 → 3 Gruppen, eine zu dritt). */
export function teamCount(people: number, { mode, n }: Pick<TeamOptions, 'mode' | 'n'>): number {
  if (people === 0) return 0;
  if (mode === 'count') return Math.min(Math.max(1, n), people);
  return Math.max(1, Math.floor(people / Math.max(1, n)));
}

/**
 * Personen einteilen. Mit `mix` werden die Personen erst je Kennzeichnung
 * gemischt und dann reihum ausgeteilt – so landen gleiche Rollen in verschiedenen
 * Gruppen. Ohne `mix` einfach gemischt und reihum.
 */
export function makeTeams(people: TeamPerson[], options: TeamOptions, random: Random = Math.random): number[][] {
  if (options.pools && people.length > 0) {
    const byPool = new Map<number, TeamPerson[]>();
    for (const p of people) {
      const pool = poolOf(options.pools, p.tag);
      byPool.set(pool, [...(byPool.get(pool) ?? []), p]);
    }
    const lists = [...byPool.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
    const single = { ...options, pools: undefined };
    if (options.mode === 'size') return lists.flatMap((list) => makeTeams(list, single, random));
    const counts = splitCount(
      lists.map((l) => l.length),
      Math.max(options.n, lists.length),
    );
    return lists.flatMap((list, i) => makeTeams(list, { ...single, mode: 'count', n: counts[i]! }, random));
  }
  const count = teamCount(people.length, options);
  if (count === 0) return [];
  let order: TeamPerson[];
  if (options.mix) {
    const byTag = new Map<number | null, TeamPerson[]>();
    for (const p of people) byTag.set(p.tag, [...(byTag.get(p.tag) ?? []), p]);
    // Große Kennzeichnungen zuerst, damit sie sich über alle Gruppen verteilen
    order = shuffle([...byTag.values()], random)
      .sort((a, b) => b.length - a.length)
      .flatMap((list) => shuffle(list, random));
  } else {
    order = shuffle(people, random);
  }
  const teams: number[][] = Array.from({ length: count }, () => []);
  // Reihum austeilen; der Startpunkt ist zufällig, damit nicht immer Gruppe 1 die größere ist
  const offset = Math.floor(random() * count);
  order.forEach((p, i) => teams[(i + offset) % count]!.push(p.id));
  return teams;
}

/**
 * Neue Personen in die kleinsten Gruppen legen – bei Töpfen nur in Gruppen ihres
 * Topfes; bei Gleichstand dorthin, wo ihre Kennzeichnung am seltensten ist.
 */
export function fillTeams(
  teams: number[][],
  newcomers: TeamPerson[],
  tagOf: (id: number) => number | null,
  random: Random = Math.random,
  pools?: Record<string, number>,
): number[][] {
  if (teams.length === 0) return teams;
  const result = teams.map((t) => [...t]);
  for (const p of shuffle(newcomers, random)) {
    const mine = poolOf(pools, p.tag);
    const inPool = (t: number[]) => !pools || t.length === 0 || poolOf(pools, tagOf(t[0]!)) === mine;
    const candidates = result.map((_, i) => i).filter((i) => inPool(result[i]!));
    const pick = candidates.length > 0 ? candidates : result.map((_, i) => i);
    const score = (t: number[]) => t.length * 1000 + t.filter((id) => tagOf(id) === p.tag && p.tag !== null).length;
    let best = pick[0]!;
    for (const i of pick) if (score(result[i]!) < score(result[best]!)) best = i;
    result[best]!.push(p.id);
  }
  return result;
}
