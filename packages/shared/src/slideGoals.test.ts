import { describe, expect, it } from 'vitest';
import { BUILTIN_BLOCKS } from './blocks.ts';
import { ALL_GOAL_ITEMS, goalItemKey, goalItemLabel, searchGoalItems, SLIDE_GOALS } from './slideGoals.ts';
import { BOARD_MODES, CREATABLE_SLIDE_TYPES } from './slides.ts';

describe('Ziele im Einfügen-Dialog', () => {
  it('lassen keinen Folientyp und keinen Wand-Schritt unauffindbar', () => {
    const offered = new Set(SLIDE_GOALS.flatMap((g) => g.items.map(goalItemKey)));
    for (const type of CREATABLE_SLIDE_TYPES) if (type !== 'board') expect(offered).toContain(type);
    for (const mode of BOARD_MODES) expect(offered).toContain(`board:${mode}`);
  });

  it('verweisen nur auf vorhandene Bausteine', () => {
    const ids = new Set(BUILTIN_BLOCKS.map((b) => b.id));
    for (const goal of SLIDE_GOALS) for (const id of goal.blocks) expect(ids).toContain(id);
  });

  it('haben eindeutige Kennungen und keinen Typ doppelt im selben Ziel', () => {
    expect(new Set(SLIDE_GOALS.map((g) => g.id)).size).toBe(SLIDE_GOALS.length);
    for (const goal of SLIDE_GOALS) {
      expect(goal.items.length).toBeGreaterThan(0);
      expect(new Set(goal.items.map(goalItemKey)).size).toBe(goal.items.length);
    }
  });

  it('Suche findet jeden Typ über seinen Namen, unabhängig von Groß-/Kleinschreibung', () => {
    for (const item of ALL_GOAL_ITEMS) {
      expect(searchGoalItems(goalItemLabel(item).toUpperCase()).map(goalItemKey)).toContain(goalItemKey(item));
    }
  });

  it('Suche findet über den Namen eines Ziels alle seine Typen, auch mit „ue“ statt „ü“', () => {
    const umlaut = (s: string) => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    for (const goal of SLIDE_GOALS) {
      const words = goal.label.split(/\s+/).filter((w) => w.length > 1);
      const found = searchGoalItems(umlaut(words.join(' '))).map(goalItemKey);
      for (const item of goal.items) expect(found).toContain(goalItemKey(item));
    }
  });

  it('Suche: leere Eingabe und Unsinn liefern nichts, jeder Treffer nur einmal', () => {
    expect(searchGoalItems('')).toEqual([]);
    expect(searchGoalItems('   ')).toEqual([]);
    expect(searchGoalItems('xyzqqq')).toEqual([]);
    for (const item of ALL_GOAL_ITEMS) {
      const keys = searchGoalItems(goalItemLabel(item)).map(goalItemKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
