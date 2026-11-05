import { describe, expect, it } from 'vitest';
import { alignPages, planNotes, type PptxSlideInfo } from './deck.ts';

const slides: PptxSlideInfo[] = [
  { notes: 'eins', hidden: false },
  { notes: 'VERSTECKT', hidden: true },
  { notes: 'drei', hidden: false },
  { notes: '', hidden: false },
];

describe('Notizen zuordnen', () => {
  it('PowerPoint-Export (ohne ausgeblendete Folien)', () => {
    const plan = planNotes(slides, 3);
    expect(plan.mode).toBe('visible-slides');
    expect(plan.pages.map((p) => p.notes)).toEqual(['eins', 'drei', '']);
    expect(plan.pages.every((p) => p.include)).toBe(true);
  });

  it('Google-Slides-Export (mit ausgeblendeten Folien): ausgeblendete werden übersprungen', () => {
    const plan = planNotes(slides, 4);
    expect(plan.mode).toBe('all-slides');
    expect(plan.pages.map((p) => p.include)).toEqual([true, false, true, true]);
    expect(plan.pages[2]!.notes).toBe('drei');
    expect(plan.pages[2]!.slide).toBe(slides[2]);
    expect(plan.skippedHidden).toBe(1);
  });

  it('auf Wunsch auch ausgeblendete Folien importieren', () => {
    const plan = planNotes(slides, 4, true);
    expect(plan.pages.every((p) => p.include)).toBe(true);
    expect(plan.skippedHidden).toBe(0);
  });

  it('ohne PPTX alle Seiten ohne Notizen', () => {
    expect(planNotes(null, 2)).toEqual({
      mode: 'none',
      pages: [
        { include: true, notes: '', slide: null },
        { include: true, notes: '', slide: null },
      ],
      skippedHidden: 0,
    });
  });

  it('passt nichts, wird der Reihe nach zugeordnet und gemeldet', () => {
    const plan = planNotes(slides, 5);
    expect(plan.mode).toBe('mismatch');
    expect(plan.pages.every((p) => p.slide === null)).toBe(true);
    expect(plan.pages.map((p) => p.notes)).toEqual(['eins', 'drei', '', '', '']);
  });
});

describe('Folienbilder aktualisieren: Seiten zuordnen', () => {
  it('ordnet bei gleicher Anzahl der Reihe nach zu', () => {
    expect(alignPages(['A', 'B'], ['X', 'Y'])).toEqual([0, 1]);
  });
  it('überspringt zusätzliche Seiten anhand der Überschriften', () => {
    expect(alignPages(['Start', 'Ende'], ['Start', 'Neu', 'ende'])).toEqual([0, 2]);
    expect(alignPages(['A', 'A', 'B'], ['A', 'X', 'A', 'B'])).toEqual([0, 2, 3]);
  });
  it('bricht ab, wenn eine Folie keine passende Seite hat', () => {
    expect(alignPages(['A', 'Fehlt'], ['A', 'B', 'C'])).toBeNull();
    expect(alignPages(['', 'B'], ['A', 'B', 'C'])).toBeNull();
  });
});
