import { BOARD_MODES, BOARD_RIGHTS, CREATABLE_SLIDE_TYPES, parseConfig } from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_BRANDS, DEMO_SLIDES } from './demo.ts';

describe('Demo-Inhalte', () => {
  it('zeigen jeden anlegbaren Folientyp mindestens einmal (importierte Folien ausgenommen)', () => {
    const types = new Set(DEMO_SLIDES.map((s) => s.type));
    expect(CREATABLE_SLIDE_TYPES.filter((t) => !types.has(t))).toEqual([]);
  });

  it('zeigen jeden Schritt der Kartenwand, beide Darstellungen und alle Rechte-Stufen', () => {
    const boards = DEMO_SLIDES.filter((s) => s.type === 'board').map((s) => parseConfig('board', s.config));
    expect(new Set(boards.map((b) => b.mode))).toEqual(new Set(BOARD_MODES));
    expect(new Set(boards.filter((b) => b.mode === 'cluster').map((b) => b.layout))).toEqual(new Set(['wall', 'mindmap']));
    const rights = new Set(boards.filter((b) => b.mode === 'cluster' || b.mode === 'place').map((b) => b.rights));
    expect(rights).toEqual(new Set(BOARD_RIGHTS));
    expect(boards.some((b) => b.anytime)).toBe(true);
    expect(boards.some((b) => b.mode === 'rate' && b.scales.length === 1)).toBe(true);
    expect(boards.some((b) => b.mode === 'rate' && b.scales.length === 2)).toBe(true);
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
