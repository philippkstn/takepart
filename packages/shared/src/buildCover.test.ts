import { describe, expect, it } from 'vitest';
import { buildExitEffectOf, pathMatchesBox } from './index.ts';

/**
 * Einfarbige Rechtecke mit Ausgangs-Animation (z. B. ein weißes Rechteck, das
 * zum Aufdecken hinausfliegt): Das PDF zeichnet sie immer mit. Beim Rendern
 * wird genau diese Zeichnung weggelassen und durch eine Abdeckung ersetzt.
 *
 * Was schiefgehen kann:
 *  - ein größerer Hintergrund (z. B. die ganze Folie) gilt als das Rechteck und verschwindet
 *  - ein kleineres Element darin (Text, Linie) gilt als das Rechteck
 *  - ein gleich großes, aber verschobenes Rechteck gilt als das Rechteck
 *  - das Rechteck selbst wird wegen Rundung/Kontur oder des Import-Rands (einige Pixel) nicht erkannt
 *  - Ausgangs-Effekte bekommen die Richtung vertauscht (Hinausfliegen nach rechts ≠ von rechts)
 */

const W = 1000;
const H = 500;
/** Rechteck in Pixeln als „Pfad“ */
const rect = (x: number, y: number, w: number, h: number) => (px: number, py: number) => px >= x && px <= x + w && py >= y && py <= y + h;
const box = { x: 0.36, y: 0.11, w: 0.32, h: 0.08 }; // 360,55 – 680,95

describe('pathMatchesBox', () => {
  it('erkennt das Rechteck selbst, auch mit 1–2 px Abweichung', () => {
    expect(pathMatchesBox(rect(360, 55, 320, 40), box, W, H)).toBe(true);
    expect(pathMatchesBox(rect(361, 56, 318, 38), box, W, H)).toBe(true);
    expect(pathMatchesBox(rect(359, 54, 322, 42), box, W, H)).toBe(true);
    // Box mit Import-Rand (Kontur + Kantenglättung) ist rundum 5 px größer als die gezeichnete Form
    expect(pathMatchesBox(rect(365, 60, 310, 30), box, W, H)).toBe(true);
  });

  it('verwechselt es nicht mit einem größeren Hintergrund', () => {
    expect(pathMatchesBox(rect(0, 0, 1000, 500), box, W, H)).toBe(false);
    expect(pathMatchesBox(rect(340, 40, 360, 70), box, W, H)).toBe(false);
  });

  it('verwechselt es nicht mit kleineren Elementen darin', () => {
    expect(pathMatchesBox(rect(400, 65, 100, 20), box, W, H)).toBe(false);
    expect(pathMatchesBox(() => false, box, W, H)).toBe(false);
  });

  it('verwechselt es nicht mit einem verschobenen Rechteck gleicher Größe', () => {
    expect(pathMatchesBox(rect(400, 55, 320, 40), box, W, H)).toBe(false);
  });
});

describe('buildExitEffectOf', () => {
  it('Hinausfliegen: Untertyp ist die Richtung, in die die Form verschwindet', () => {
    expect(buildExitEffectOf('2', '2', null)).toBe('out-right');
    expect(buildExitEffectOf('2', '8', null)).toBe('out-left');
    expect(buildExitEffectOf('2', '1', null)).toBe('out-top');
    expect(buildExitEffectOf('2', '4', null)).toBe('out-bottom');
  });

  it('Wischen, Verblassen und Verschwinden', () => {
    expect(buildExitEffectOf('22', '8', 'wipe(right)')).toBe('wipe-left');
    expect(buildExitEffectOf('10', null, 'fade')).toBe('fade');
    expect(buildExitEffectOf('1', null, null)).toBe('appear');
    expect(buildExitEffectOf('99', null, null)).toBe('fade');
    expect(buildExitEffectOf('23', '32', null)).toBe('zoom-out');
  });
});
