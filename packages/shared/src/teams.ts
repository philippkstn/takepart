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

/** Neue Personen in die kleinsten Gruppen legen – bei Gleichstand dorthin, wo ihre Kennzeichnung am seltensten ist. */
export function fillTeams(
  teams: number[][],
  newcomers: TeamPerson[],
  tagOf: (id: number) => number | null,
  random: Random = Math.random,
): number[][] {
  if (teams.length === 0) return teams;
  const result = teams.map((t) => [...t]);
  for (const p of shuffle(newcomers, random)) {
    const score = (t: number[]) => t.length * 1000 + t.filter((id) => tagOf(id) === p.tag && p.tag !== null).length;
    let best = 0;
    for (let i = 1; i < result.length; i++) if (score(result[i]!) < score(result[best]!)) best = i;
    result[best]!.push(p.id);
  }
  return result;
}
