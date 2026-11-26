import { describe, expect, it } from 'vitest';
import { diffVersions, type VersionSlide, type VersionSnapshot } from './index.ts';

/**
 * Änderungen zwischen zwei Versionen für die Zeitleiste.
 *
 * Was schiefgehen kann:
 *  - unveränderte Versionen zeigen Änderungen (z. B. wegen Schlüsselreihenfolge im JSON)
 *  - geänderte Felder werden nicht benannt, oder Notizen/Ablaufplan fehlen
 *  - neue oder gelöschte Folien fehlen, gelöschte ohne Titel (der steht nur in der älteren Version)
 *  - eine eingefügte Folie markiert alle nachfolgenden als „verschoben“
 *  - zwei vertauschte Folien erscheinen nicht als verschoben
 *  - Titel-/Einstellungsänderungen der Präsentation fehlen
 *  - die erste Version (ohne Vorgänger) listet alle Folien als neu
 */

const slide = (id: number, title: string, extra: Record<string, unknown> = {}): VersionSlide => ({
  id,
  type: 'content',
  config: { title, body: '', ...extra },
  notes: '',
  schedule: { plannedMinutes: null, phases: [], autoCountdown: false },
  sourceKey: null,
});
const snap = (slides: VersionSlide[], title = 'Vortrag'): VersionSnapshot => ({
  v: 1,
  presentation: { title, brandId: null, shareSlides: true, targetMinutes: null },
  slides,
});

describe('diffVersions', () => {
  const base = snap([slide(1, 'Start'), slide(2, 'Mitte'), slide(3, 'Ende')]);

  it('findet bei gleichem Inhalt nichts, auch bei anderer Schlüsselreihenfolge', () => {
    const same = snap([{ ...slide(1, 'Start'), config: { body: '', title: 'Start' } }, slide(2, 'Mitte'), slide(3, 'Ende')]);
    expect(diffVersions(base, same)).toEqual({ initial: false, meta: [], slides: [] });
  });

  it('benennt geänderte Felder, Notizen und Ablaufplan', () => {
    const next = snap([
      slide(1, 'Start neu'),
      { ...slide(2, 'Mitte'), notes: 'Hinweis' },
      { ...slide(3, 'Ende'), schedule: { plannedMinutes: 5, phases: [], autoCountdown: false } },
    ]);
    expect(diffVersions(base, next).slides).toEqual([
      { id: 1, type: 'content', title: 'Start neu', kind: 'changed', fields: ['title'] },
      { id: 2, type: 'content', title: 'Mitte', kind: 'changed', fields: ['notes'] },
      { id: 3, type: 'content', title: 'Ende', kind: 'changed', fields: ['schedule'] },
    ]);
  });

  it('meldet neue und gelöschte Folien – gelöschte mit Titel aus der älteren Version', () => {
    const next = snap([slide(1, 'Start'), slide(4, 'Neu'), slide(3, 'Ende')]);
    expect(diffVersions(base, next).slides).toEqual([
      { id: 4, type: 'content', title: 'Neu', kind: 'added', fields: [] },
      { id: 2, type: 'content', title: 'Mitte', kind: 'removed', fields: [] },
    ]);
  });

  it('markiert beim Einfügen nicht alle folgenden Folien als verschoben', () => {
    const next = snap([slide(9, 'Davor'), slide(1, 'Start'), slide(2, 'Mitte'), slide(3, 'Ende')]);
    expect(diffVersions(base, next).slides.map((s) => s.kind)).toEqual(['added']);
  });

  it('erkennt verschobene Folien, auch zusammen mit Änderungen', () => {
    expect(diffVersions(base, snap([slide(2, 'Mitte'), slide(3, 'Ende'), slide(1, 'Start')])).slides).toEqual([
      { id: 1, type: 'content', title: 'Start', kind: 'moved', fields: ['position'] },
    ]);
    expect(diffVersions(base, snap([slide(2, 'Mitte'), slide(3, 'Ende'), slide(1, 'Los')])).slides).toEqual([
      { id: 1, type: 'content', title: 'Los', kind: 'changed', fields: ['title', 'position'] },
    ]);
  });

  it('meldet Änderungen an der Präsentation selbst', () => {
    expect(diffVersions(base, snap(base.slides, 'Neuer Titel')).meta).toEqual(['title']);
  });

  it('listet für die erste Version nichts als Änderung', () => {
    expect(diffVersions(null, base)).toEqual({ initial: true, meta: [], slides: [] });
  });
});
