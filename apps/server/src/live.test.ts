import { describe, expect, it } from 'vitest';
import { inkAudience } from './live.ts';

type Input = Parameters<typeof inkAudience>[0];
const snap = (opts: { share?: boolean; type?: string | null; state?: Record<string, unknown> }): Input =>
  ({
    run: { shareSlides: opts.share ?? true, state: { leaderboard: false, ...opts.state } },
    current: opts.type === null ? null : { type: opts.type ?? 'image' },
  }) as unknown as Input;

describe('inkAudience', () => {
  it('Bildfolie mit „Folien auf Handys zeigen“', () => {
    expect(inkAudience(snap({}))).toBe(true);
  });
  it('nicht ohne Freigabe der Folien', () => {
    expect(inkAudience(snap({ share: false }))).toBe(false);
  });
  it('nicht auf anderen Folien', () => {
    expect(inkAudience(snap({ type: 'choice' }))).toBe(false);
    expect(inkAudience(snap({ type: null }))).toBe(false);
  });
  it('nicht bei Schwarzbild, Pause oder Rangliste', () => {
    expect(inkAudience(snap({ state: { blank: 'black' } }))).toBe(false);
    expect(inkAudience(snap({ state: { pause: { endsAt: 1, seconds: 60, question: null } } }))).toBe(false);
    expect(inkAudience(snap({ state: { leaderboard: true } }))).toBe(false);
  });
});
