import { describe, expect, it } from 'vitest';
import { cleanTextRuns, textRuns } from './textLayer.ts';

// PDF-Seite 960×540 pt, gerendert mit Skalierung 2 (pdf.js: y nach unten gespiegelt)
const viewport = { width: 1920, height: 1080, scale: 2, transform: [2, 0, 0, -2, 0, 1080] };

describe('Textebene', () => {
  it('rechnet Position, Breite und Schriftgröße in Seiten-Anteile um', () => {
    const runs = textRuns([{ str: 'Titel', transform: [36, 0, 0, 36, 96, 440], width: 200 }], viewport);
    expect(runs).toEqual([['Titel', 0.1, 0.1852, 0.2083, 0.0667]]);
  });

  it('überspringt Leeres und gedrehten Text', () => {
    const runs = textRuns(
      [
        { str: '  ', transform: [12, 0, 0, 12, 0, 0], width: 10 },
        { str: 'schräg', transform: [0, 12, -12, 0, 100, 100], width: 40 },
        { hasEOL: true },
      ],
      viewport,
    );
    expect(runs).toEqual([]);
  });

  it('lässt beim Prüfen nur gültige Einträge durch', () => {
    expect(cleanTextRuns([['a', 0.1, 0.2, 0.3, 0.04], ['b', 'x', 0, 0, 0], 'kaputt', ['c', 9, 0, 0, 0]])).toEqual([['a', 0.1, 0.2, 0.3, 0.04]]);
    expect(cleanTextRuns(null)).toEqual([]);
  });
});
