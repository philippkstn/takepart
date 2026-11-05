import { describe, expect, it } from 'vitest';
import { fitBuildBox, rotatedBounds, type Pixels } from './buildFit.ts';

/** Weißes Bild 1920×1080 mit schwarzen Rechtecken (Pixelkoordinaten, inklusive) */
function image(rects: [number, number, number, number][]): Pixels {
  const width = 1920;
  const height = 1080;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [l, t, r, b] of rects)
    for (let y = t; y <= b; y++)
      for (let x = l; x <= r; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  return { width, height, data };
}

const px = (v: number, size: number) => Math.round(v * size);

describe('Abdeckung an das Folienbild anpassen', () => {
  it('wächst, wenn Text unten aus seinem Kasten läuft', () => {
    // Kasten 400–800 × 300–400, Text reicht bis y = 420
    const fit = fitBuildBox(image([[420, 320, 780, 420]]), { x: 400 / 1920, y: 300 / 1080, w: 400 / 1920, h: 100 / 1080 });
    expect(fit.fill).toBe('#ffffff');
    expect(px(fit.box.y + fit.box.h, 1080)).toBeGreaterThan(420);
    // links/rechts/oben nur der feste Zuschlag
    expect(px(fit.box.x, 1920)).toBe(396);
  });

  it('wächst nicht in einen großen Nachbarn hinein', () => {
    // Rechts schließt eine breite Fläche direkt an – die gehört nicht zum Element
    const fit = fitBuildBox(image([[800, 300, 1400, 399]]), { x: 400 / 1920, y: 300 / 1080, w: 400 / 1920, h: 100 / 1080 });
    expect(px(fit.box.x + fit.box.w, 1920)).toBe(804);
  });

  it('lässt saubere Kästen bis auf den Zuschlag unverändert', () => {
    const fit = fitBuildBox(image([[450, 330, 700, 360]]), { x: 400 / 1920, y: 300 / 1080, w: 400 / 1920, h: 100 / 1080 });
    expect([px(fit.box.x, 1920), px(fit.box.y, 1080), px(fit.box.w, 1920), px(fit.box.h, 1080)]).toEqual([396, 296, 408, 108]);
    expect(fit.spread).toBe(0);
  });
});

describe('Gedrehte Elemente', () => {
  it('nimmt das umschließende Rechteck', () => {
    const r = rotatedBounds(0, 0, 200, 100, 90);
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(200);
    expect(r.x).toBeCloseTo(50);
    expect(r.y).toBeCloseTo(-50);
    expect(rotatedBounds(10, 20, 30, 40, 0)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
});
