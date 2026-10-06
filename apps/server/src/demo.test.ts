import { parseConfig, SLIDE_TYPES } from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_BRANDS, DEMO_SLIDES } from './demo.ts';

describe('Demo-Inhalte', () => {
  it('zeigen jeden Folientyp mindestens einmal', () => {
    const types = new Set(DEMO_SLIDES.map((s) => s.type));
    expect([...SLIDE_TYPES].filter((t) => !types.has(t))).toEqual([]);
  });

  it('haben gültige Konfigurationen', () => {
    for (const s of DEMO_SLIDES) expect(() => parseConfig(s.type, s.config)).not.toThrow();
  });

  it('Brandings haben eindeutige Namen und gültige Farben', () => {
    expect(new Set(DEMO_BRANDS.map((b) => b.name)).size).toBe(DEMO_BRANDS.length);
    for (const b of DEMO_BRANDS) {
      expect(b.accent).toMatch(/^#[0-9A-F]{6}$/);
      expect(b.chart).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
