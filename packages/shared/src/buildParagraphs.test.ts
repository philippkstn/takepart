import { describe, expect, it } from 'vitest';
import { paragraphBoxes, pathInsideBox, type TextRun } from './index.ts';

/**
 * „Absatzweise“ animierte Textfelder: Die PPTX nennt nur Absatz-Nummern, keine
 * Positionen. Die Lage jedes Absatzes kommt aus der Textebene des PDFs.
 *
 * Was schiefgehen kann:
 *  - Absätze werden falsch gezählt, weil Text außerhalb des Felds (Überschrift) mitzählt
 *  - ein umbrochener Absatz (zwei Zeilen) wird zu zwei Absätzen
 *  - leere Absätze verschieben die Zuordnung aller folgenden
 *  - Aufzählungszeichen als eigene Textstücke bringen die Zählung durcheinander
 *  - Boxen überlappen sich, sodass ein Aufdecken den nächsten Absatz mit aufdeckt
 *  - weicht der PDF-Text deutlich ab, entstehen falsche Boxen statt eines sicheren Rückzugs (null)
 */

const box = { x: 0.1, y: 0.3, w: 0.8, h: 0.6 };
/** Zeile als Textstück: Text, links, Grundlinie, Breite, Größe */
const run = (text: string, y: number, x = 0.12): TextRun => [text, x, y, 0.3, 0.04];

describe('paragraphBoxes', () => {
  const title = run('Überschrift', 0.15);

  it('findet drei einzeilige Absätze, übereinander und ohne Überlappung', () => {
    const boxes = paragraphBoxes([title, run('Erster Punkt', 0.4), run('Zweiter Punkt', 0.5), run('Dritter Punkt', 0.6)], box, [
      'Erster Punkt',
      'Zweiter Punkt',
      'Dritter Punkt',
    ]);
    expect(boxes).toHaveLength(3);
    const [a, b, c] = boxes.map((x) => x!);
    expect(a!.y).toBeLessThan(0.4);
    expect(a!.y + a!.h).toBeLessThanOrEqual(b!.y + 1e-9);
    expect(b!.y + b!.h).toBeLessThanOrEqual(c!.y + 1e-9);
    expect(c!.y + c!.h).toBeGreaterThan(0.6);
    // volle Breite des Felds – deckt auch Aufzählungszeichen ab
    expect(a!.x).toBeCloseTo(box.x);
    expect(a!.w).toBeCloseTo(box.w);
  });

  it('fasst einen umbrochenen Absatz zu einer Box zusammen', () => {
    const boxes = paragraphBoxes([run('Ein langer Absatz, der', 0.4), run('umbricht', 0.45), run('Zweiter', 0.55)], box, [
      'Ein langer Absatz, der umbricht',
      'Zweiter',
    ]);
    expect(boxes[0]!.y).toBeLessThan(0.4);
    expect(boxes[0]!.y + boxes[0]!.h).toBeGreaterThan(0.45);
    expect(boxes[1]!.y + boxes[1]!.h).toBeGreaterThan(0.55);
  });

  it('überspringt leere Absätze, ohne die Zuordnung zu verschieben', () => {
    const boxes = paragraphBoxes([run('Eins', 0.4), run('Drei', 0.55)], box, ['Eins', '', 'Drei']);
    expect(boxes[1]).toBeNull();
    expect(boxes[2]!.y + boxes[2]!.h).toBeGreaterThan(0.55);
    expect(boxes[2]!.y).toBeGreaterThan(0.4);
  });

  it('lässt Aufzählungszeichen als eigene Textstücke außen vor', () => {
    const boxes = paragraphBoxes([run('●', 0.4, 0.11), run('Eins', 0.4), run('●', 0.5, 0.11), run('Zwei', 0.5)], box, ['Eins', 'Zwei']);
    expect(boxes.every(Boolean)).toBe(true);
    expect(boxes[1]!.y + boxes[1]!.h).toBeGreaterThan(0.5);
  });

  it('gibt bei abweichendem Text nichts zurück statt falscher Boxen', () => {
    expect(paragraphBoxes([run('Ganz anderer Text', 0.4)], box, ['Eins', 'Zwei']).every((b) => b === null)).toBe(true);
  });
});

/**
 * Zeichnungen eines Elements, das per Ausgang verschwindet, beim Rendern auslassen:
 * nur Pfade, die ganz im Element liegen – nie Hintergründe oder Nachbarn.
 */
describe('pathInsideBox', () => {
  const W = 1000;
  const H = 500;
  const rect = (x: number, y: number, w: number, h: number) => (px: number, py: number) => px >= x && px <= x + w && py >= y && py <= y + h;
  const b = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }; // 200,100 – 600,300

  it('erkennt kleine Pfade im Element (z. B. Aufzählungszeichen)', () => {
    expect(pathInsideBox(rect(220, 140, 10, 10), b, W, H)).toBe(true);
  });

  it('lässt Hintergründe und übergreifende Formen in Ruhe', () => {
    expect(pathInsideBox(rect(0, 0, 1000, 500), b, W, H)).toBe(false);
    expect(pathInsideBox(rect(500, 200, 300, 50), b, W, H)).toBe(false);
  });

  it('lässt Pfade außerhalb in Ruhe', () => {
    expect(pathInsideBox(rect(700, 350, 20, 20), b, W, H)).toBe(false);
  });
});
