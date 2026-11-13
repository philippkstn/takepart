import { describe, expect, it } from 'vitest';
import { countLost, REJOIN_GRACE_MS, rejoinWanted } from './moderation.ts';

describe('Beitritts-Hinweis', () => {
  it('braucht mindestens zwei Personen und zehn Prozent', () => {
    expect(rejoinWanted(1, 5)).toBe(false);
    expect(rejoinWanted(2, 5)).toBe(true);
    expect(rejoinWanted(2, 40)).toBe(false);
    expect(rejoinWanted(4, 40)).toBe(true);
    expect(rejoinWanted(0, 0)).toBe(false);
  });

  it('zählt nur, wer länger als die Schonfrist weg und nicht wieder verbunden ist', () => {
    const now = 1_000_000;
    const left = new Map([
      [1, now - REJOIN_GRACE_MS - 1],
      [2, now - 1000],
      [3, now - REJOIN_GRACE_MS * 2],
    ]);
    expect(countLost(left, new Set(), now)).toBe(2);
    expect(countLost(left, new Set([3]), now)).toBe(1);
  });
});
