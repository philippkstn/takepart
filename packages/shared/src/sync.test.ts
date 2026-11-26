import { describe, expect, it } from 'vitest';
import { planSync, type SyncPage, type SyncSlide } from './index.ts';

/**
 * Abgleich einer mit Google Slides verknüpften Präsentation: Die Seiten des
 * aktuellen Exports werden den vorhandenen Bildfolien zugeordnet.
 *
 * Was schiefgehen kann:
 *  - unveränderter Foliensatz erzeugt Einfügungen/Löschungen statt nur neuer Bilder
 *  - eine neue Seite in der Mitte landet vor einer Abstimmung, die zur vorigen Folie gehört
 *  - eine angehängte Seite landet hinter den interaktiven Schlussfolien statt hinter der letzten Bildfolie
 *  - in Google gelöschte Seiten bleiben stehen – oder es werden Folien gelöscht, die nie aus Google kamen
 *  - in Google umsortierte Seiten werden gelöscht und neu angelegt (Notizen/Ergebnisse weg)
 *  - erste Verknüpfung eines früher per PDF importierten Decks ordnet nicht zu, weil Kennungen fehlen
 *  - leere oder doppelte Überschriften paaren falsche Folien
 *  - mehrere neue Seiten hintereinander geraten in falsche Reihenfolge
 */

const img = (id: number, title: string, sourceKey: string | null = null): SyncSlide => ({ id, type: 'image', title, sourceKey });
const poll = (id: number): SyncSlide => ({ id, type: 'poll', title: 'Abstimmung', sourceKey: null });
const page = (key: string | null, title: string): SyncPage => ({ key, title });

describe('planSync', () => {
  const linked = [img(1, 'Start', 'p1'), img(2, 'Ziele', 'p2'), poll(10), img(3, 'Ende', 'p3'), poll(11)];

  it('ersetzt bei unverändertem Foliensatz nur die Bilder', () => {
    const plan = planSync(linked, [page('p1', 'Start'), page('p2', 'Ziele'), page('p3', 'Ende')]);
    expect(plan).toEqual({
      replace: [
        { slideId: 1, page: 0 },
        { slideId: 2, page: 1 },
        { slideId: 3, page: 2 },
      ],
      insert: [],
      remove: [],
      unmatched: [],
    });
  });

  it('fügt eine neue Seite in der Mitte vor der nächsten zugeordneten Folie ein (hinter der Abstimmung)', () => {
    const plan = planSync(linked, [page('p1', 'Start'), page('p2', 'Ziele'), page('p9', 'Neu'), page('p3', 'Ende')]);
    expect(plan.insert).toEqual([{ page: 2, before: 3 }]);
    expect(plan.remove).toEqual([]);
  });

  it('hängt neue Seiten am Ende direkt hinter die letzte Bildfolie, in ihrer Reihenfolge', () => {
    const plan = planSync(linked, [page('p1', 'Start'), page('p2', 'Ziele'), page('p3', 'Ende'), page('p8', 'A'), page('p9', 'B')]);
    expect(plan.insert).toEqual([
      { page: 3, after: 3 },
      { page: 4, after: 3 },
    ]);
  });

  it('entfernt in Google gelöschte Seiten, aber nie Folien ohne Google-Kennung', () => {
    const slides = [...linked, img(4, 'Eigenes Bild')];
    const plan = planSync(slides, [page('p1', 'Start'), page('p3', 'Ende')]);
    expect(plan.remove).toEqual([2]);
    expect(plan.unmatched).toEqual([4]);
  });

  it('ordnet umsortierte Seiten über die Kennung an Ort und Stelle zu', () => {
    const plan = planSync(linked, [page('p3', 'Ende'), page('p1', 'Start'), page('p2', 'Ziele')]);
    expect(plan.replace).toEqual([
      { slideId: 1, page: 1 },
      { slideId: 2, page: 2 },
      { slideId: 3, page: 0 },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('ordnet beim ersten Verknüpfen ohne Kennungen bei gleicher Anzahl der Reihe nach zu, auch mit geänderten Überschriften', () => {
    const plan = planSync([img(1, 'Alt'), poll(10), img(2, 'Zwei')], [page('p1', 'Neu'), page('p2', 'Zwei!')]);
    expect(plan.replace).toEqual([
      { slideId: 1, page: 0 },
      { slideId: 2, page: 1 },
    ]);
  });

  it('ordnet ohne Kennungen bei anderer Anzahl über die Überschriften zu und behält Unzugeordnetes', () => {
    const plan = planSync(
      [img(1, 'Start'), img(2, 'Weg'), img(3, 'Ende')],
      [page('a', 'Start'), page('b', 'Mitte'), page('c', 'Ende'), page('d', 'Danke')],
    );
    expect(plan.replace).toEqual([
      { slideId: 1, page: 0 },
      { slideId: 3, page: 2 },
    ]);
    expect(plan.insert).toEqual([
      { page: 1, before: 3 },
      { page: 3, after: 3 },
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.unmatched).toEqual([2]);
  });

  it('paart leere Überschriften nie und doppelte nur der Reihe nach', () => {
    const plan = planSync([img(1, ''), img(2, 'Teil'), img(3, 'Teil')], [page(null, ''), page(null, 'Teil')]);
    expect(plan.replace).toEqual([{ slideId: 2, page: 1 }]);
    expect(plan.insert).toEqual([{ page: 0, before: 2 }]);
    expect(plan.unmatched).toEqual([1, 3]);
  });

  it('legt ohne jede Zuordnung alles am Ende an', () => {
    const plan = planSync([poll(10)], [page('p1', 'A'), page('p2', 'B')]);
    expect(plan.insert).toEqual([
      { page: 0, end: true },
      { page: 1, end: true },
    ]);
  });
});
