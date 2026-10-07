import { describe, expect, it } from 'vitest';
import { planNotes, type PptxSlideInfo } from './deck.ts';

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
        { include: true, notes: '' },
        { include: true, notes: '' },
      ],
      skippedHidden: 0,
    });
  });

  it('passt nichts, wird der Reihe nach zugeordnet und gemeldet', () => {
    const plan = planNotes(slides, 5);
    expect(plan.mode).toBe('mismatch');
    expect(plan.pages.map((p) => p.notes)).toEqual(['eins', 'drei', '', '', '']);
  });
});
