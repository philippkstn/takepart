import { describe, expect, it } from 'vitest';
import { carrySections, gapAt, listItems, moveSlides, stepGap, type SectionedSlide } from './index.ts';

/** Kurzschreibweise: Zahl = Folie ohne Abschnitt, [id, Titel] = Folie, an der ein Abschnitt beginnt */
const deck = (...items: (number | [number, string])[]): SectionedSlide[] =>
  items.map((it) => (typeof it === 'number' ? { id: it, section: null } : { id: it[0], section: it[1] }));

/** Ergebnis anwenden: neue Reihenfolge mit Abschnitten */
function apply(order: SectionedSlide[], result: ReturnType<typeof moveSlides>) {
  if (!result) return order;
  const titles = new Map(order.map((s) => [s.id, s.section]));
  for (const c of result.sections) titles.set(c.id, c.section);
  return result.ids.map((id) => ({ id, section: titles.get(id) ?? null }));
}

// Ankommen: 1 2 3 | Arbeit: 4 5 6 | Abschluss: 7 8
const workshop = deck([1, 'Ankommen'], 2, 3, [4, 'Arbeit'], 5, 6, [7, 'Abschluss'], 8);

describe('Folien verschieben mit Abschnitten', () => {
  it('ändert nichts, wenn der Block an seiner Stelle abgelegt wird', () => {
    expect(moveSlides(workshop, [5], { before: 5 })).toBeNull();
    expect(moveSlides(workshop, [5], { before: 6 })).toBeNull();
    expect(moveSlides(workshop, [5, 6], { before: 7 })).toBeNull();
    // Unter der eigenen Überschrift abgelegt: bleibt erste Folie des Abschnitts
    expect(moveSlides(workshop, [4], { before: 4, into: true })).toBeNull();
  });

  it('ignoriert unbekannte Folien und leere Auswahl', () => {
    expect(moveSlides(workshop, [], { before: 2 })).toBeNull();
    expect(moveSlides(workshop, [99], { before: 2 })).toBeNull();
  });

  it('hält eine verstreute Auswahl in ihrer Reihenfolge zusammen', () => {
    const r = moveSlides(workshop, [8, 2, 5], { before: null });
    expect(r?.ids).toEqual([1, 3, 4, 6, 7, 2, 5, 8]);
    expect(r?.sections).toEqual([]);
  });

  it('gibt den Abschnitt an die nächste Folie weiter, wenn dessen erste Folie allein wegzieht', () => {
    const after = apply(workshop, moveSlides(workshop, [4], { before: 8 }));
    expect(after).toEqual(deck([1, 'Ankommen'], 2, 3, [5, 'Arbeit'], 6, [7, 'Abschluss'], 4, 8));
  });

  it('nimmt den Abschnitt mit, wenn alle seine Folien gemeinsam ziehen', () => {
    const after = apply(workshop, moveSlides(workshop, [4, 5, 6], { before: null }));
    expect(after).toEqual(deck([1, 'Ankommen'], 2, 3, [7, 'Abschluss'], 8, [4, 'Arbeit'], 5, 6));
  });

  it('über einer Überschrift abgelegt, landet der Block am Ende des vorigen Abschnitts', () => {
    const after = apply(workshop, moveSlides(workshop, [8], { before: 4 }));
    expect(after).toEqual(deck([1, 'Ankommen'], 2, 3, 8, [4, 'Arbeit'], 5, 6, [7, 'Abschluss']));
  });

  it('unter einer Überschrift abgelegt, wird der Block erste Folie des Abschnitts', () => {
    const after = apply(workshop, moveSlides(workshop, [2], { before: 4, into: true }));
    expect(after).toEqual(deck([1, 'Ankommen'], 3, [2, 'Arbeit'], 4, 5, 6, [7, 'Abschluss'], 8));
  });

  it('ein ganzer Abschnitt unter eine fremde Überschrift überschreibt sie nicht', () => {
    const after = apply(workshop, moveSlides(workshop, [7, 8], { before: 4, into: true }));
    expect(after).toEqual(deck([1, 'Ankommen'], 2, 3, [7, 'Abschluss'], 8, [4, 'Arbeit'], 5, 6));
  });

  it('löst ein Ziel innerhalb der Auswahl auf die nächste nicht verschobene Folie auf', () => {
    // Erste Folie über die eigene Überschrift gezogen: rutscht ans Ende von „Ankommen“, „Arbeit“ beginnt bei 5
    const after = apply(workshop, moveSlides(workshop, [4], { before: 4 }));
    expect(after).toEqual(deck([1, 'Ankommen'], 2, 3, 4, [5, 'Arbeit'], 6, [7, 'Abschluss'], 8));
  });

  it('verschiebt Folien vor dem ersten Abschnitt ohne Überschriften anzufassen', () => {
    const lead = deck(1, 2, [3, 'Teil'], 4);
    expect(apply(lead, moveSlides(lead, [1], { before: 3 }))).toEqual(deck(2, 1, [3, 'Teil'], 4));
  });
});

describe('Abschnitte beim Löschen erhalten', () => {
  it('lässt Abschnitte unberührt, wenn keine erste Folie wegfällt', () => {
    expect(carrySections(workshop, [2, 5])).toEqual([]);
  });

  it('gibt den Titel an die nächste verbleibende Folie desselben Abschnitts', () => {
    expect(carrySections(workshop, [4])).toEqual([{ id: 5, section: 'Arbeit' }]);
    expect(carrySections(workshop, [4, 5])).toEqual([{ id: 6, section: 'Arbeit' }]);
  });

  it('lässt einen Abschnitt verschwinden, wenn alle seine Folien wegfallen', () => {
    expect(carrySections(workshop, [4, 5, 6])).toEqual([]);
  });

  it('überschreibt nie den Titel des folgenden Abschnitts', () => {
    expect(carrySections(deck([1, 'A'], [2, 'B'], 3), [1])).toEqual([]);
  });
});

describe('Liste mit eingeklappten Abschnitten', () => {
  it('zeigt Überschriften mit ihren Folien, eingeklappte ohne', () => {
    const items = listItems(workshop, [4]);
    expect(items.map((it) => (it.kind === 'section' ? `#${it.start}` : it.id))).toEqual(['#1', 1, 2, 3, '#4', '#7', 7, 8]);
    const arbeit = items.find((it) => it.kind === 'section' && it.start === 4);
    expect(arbeit).toMatchObject({ title: 'Arbeit', ids: [4, 5, 6], collapsed: true });
  });

  it('unterscheidet über und unter einer Überschrift', () => {
    const items = listItems(workshop, []);
    expect(gapAt(items, 4)).toEqual({ before: 4 }); // über „Arbeit“
    expect(gapAt(items, 5)).toEqual({ before: 4, into: true }); // darunter
    expect(gapAt(items, items.length)).toEqual({ before: null });
  });

  it('Alt+↑ an der Spitze eines Abschnitts schiebt nur hinter die Überschrift des vorigen', () => {
    const items = listItems(workshop, []);
    const after = apply(workshop, moveSlides(workshop, [4], stepGap(items, [4], -1)!));
    expect(after).toEqual(deck([1, 'Ankommen'], 2, 3, 4, [5, 'Arbeit'], 6, [7, 'Abschluss'], 8));
  });

  it('Alt+↓ am Ende eines Abschnitts macht die Folie zur ersten des nächsten', () => {
    const items = listItems(workshop, []);
    const after = apply(workshop, moveSlides(workshop, [6], stepGap(items, [6], 1)!));
    expect(after).toEqual(deck([1, 'Ankommen'], 2, 3, [4, 'Arbeit'], 5, [6, 'Abschluss'], 7, 8));
  });

  it('Alt+↓ überspringt einen eingeklappten Abschnitt als Ganzes', () => {
    const items = listItems(workshop, [4]);
    const after = apply(workshop, moveSlides(workshop, [3], stepGap(items, [3], 1)!));
    expect(after.map((s) => s.id)).toEqual([1, 2, 4, 5, 6, 3, 7, 8]);
  });

  it('am Rand gibt es keinen Schritt', () => {
    const lead = deck(1, [2, 'Teil'], 3);
    const items = listItems(lead, []);
    expect(stepGap(items, [1], -1)).toBeNull();
    expect(stepGap(items, [3], 1)).toBeNull();
  });

  it('Alt+↑ auf der ersten Folie des ersten Abschnitts stellt sie vor alle Abschnitte', () => {
    const items = listItems(workshop, []);
    const after = apply(workshop, moveSlides(workshop, [1], stepGap(items, [1], -1)!));
    expect(after.slice(0, 3)).toEqual(deck(1, [2, 'Ankommen'], 3));
  });
});
