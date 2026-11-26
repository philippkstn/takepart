import { describe, expect, it } from 'vitest';
import { buildEffectOf } from './index.ts';

/**
 * Welcher Aufbau-Effekt aus einer PowerPoint-/Google-Slides-Animation wird.
 *
 * Was schiefgehen kann:
 *  - „Wischen“ wird zum Verblassen (der gemeldete Fehler)
 *  - die Richtung ist vertauscht: `wipe(down)` heißt „von oben“ – die Abdeckung muss oben zuerst verschwinden
 *  - ohne `filter` (manche Exporte) wird die Richtung nicht aus dem Untertyp gelesen
 *  - bekannte Effekte (Erscheinen, Hineinfliegen, Zoom) ändern sich
 *  - unbekannte Effekte führen zu einem ungültigen Wert statt Verblassen
 */
describe('buildEffectOf', () => {
  it('erkennt Wischen samt Richtung am Filter', () => {
    expect(buildEffectOf('22', '1', 'wipe(down)')).toBe('wipe-top');
    expect(buildEffectOf('22', '4', 'wipe(up)')).toBe('wipe-bottom');
    expect(buildEffectOf('22', '8', 'wipe(right)')).toBe('wipe-left');
    expect(buildEffectOf('22', '2', 'wipe(left)')).toBe('wipe-right');
  });

  it('liest die Richtung ohne Filter aus dem Untertyp', () => {
    expect(buildEffectOf('22', '1', null)).toBe('wipe-top');
    expect(buildEffectOf('22', '8', null)).toBe('wipe-left');
    expect(buildEffectOf('22', null, null)).toBe('wipe-bottom');
  });

  it('lässt die bisherigen Effekte unverändert', () => {
    expect(buildEffectOf('1', null, null)).toBe('appear');
    expect(buildEffectOf('2', '8', null)).toBe('fly-left');
    expect(buildEffectOf('2', '4', null)).toBe('fly-bottom');
    expect(buildEffectOf('53', null, null)).toBe('zoom');
    expect(buildEffectOf('10', null, 'fade')).toBe('fade');
  });

  it('macht aus Unbekanntem Verblassen', () => {
    expect(buildEffectOf('99', '3', 'checkerboard(across)')).toBe('fade');
    expect(buildEffectOf(null, null, null)).toBe('fade');
  });
});
