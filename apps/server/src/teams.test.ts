import { fillTeams, makeTeams, teamCount, type TeamPerson } from '@slides/shared';
import { describe, expect, it } from 'vitest';

/** Wiederholbarer Zufall für die Tests */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}
const people = (n: number, tags: (number | null)[] = []): TeamPerson[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, tag: tags[i % (tags.length || 1)] ?? null }));

describe('Gruppen bilden', () => {
  it('teilt nach Anzahl gleichmäßig ein und verliert niemanden', () => {
    const teams = makeTeams(people(10), { mode: 'count', n: 3, mix: false }, seeded(1));
    expect(teams).toHaveLength(3);
    expect(teams.map((t) => t.length).sort()).toEqual([3, 3, 4]);
    expect(teams.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it('lässt bei Gruppengröße niemanden allein: 7 à 2 ergibt drei Gruppen, eine zu dritt', () => {
    expect(teamCount(7, { mode: 'size', n: 2 })).toBe(3);
    const teams = makeTeams(people(7), { mode: 'size', n: 2, mix: false }, seeded(2));
    expect(teams.map((t) => t.length).sort()).toEqual([2, 2, 3]);
    expect(teamCount(1, { mode: 'size', n: 3 })).toBe(1);
    expect(teamCount(3, { mode: 'count', n: 10 })).toBe(3);
  });

  it('verteilt Kennzeichnungen beim Mischen auf alle Gruppen', () => {
    // 4 Rollen à 3 Personen auf 3 Gruppen: jede Gruppe bekommt jede Rolle einmal
    const list = people(12, [0, 1, 2, 3]);
    const teams = makeTeams(list, { mode: 'count', n: 3, mix: true }, seeded(3));
    const tagOf = new Map(list.map((p) => [p.id, p.tag]));
    for (const t of teams) expect(new Set(t.map((id) => tagOf.get(id))).size).toBe(4);
  });

  it('legt Nachzügler in die kleinsten Gruppen, bevorzugt dorthin, wo ihre Rolle fehlt', () => {
    const tags = new Map<number, number | null>([
      [1, 0],
      [2, 1],
      [3, 0],
      [4, 1],
    ]);
    const filled = fillTeams([[1, 2], [3]], [{ id: 9, tag: 1 }], (id) => tags.get(id) ?? null, seeded(4));
    expect(filled).toEqual([
      [1, 2],
      [3, 9],
    ]);
  });
});
