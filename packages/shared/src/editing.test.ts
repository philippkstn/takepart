import { describe, expect, it } from 'vitest';
import { mergeConfig, sameValue } from './index.ts';

/**
 * Zwei Personen bearbeiten dieselbe Folie. Ausgangspunkt `base` ist der Stand,
 * den die speichernde Person zuletzt vom Server hatte, `mine` ihr Entwurf,
 * `theirs` der Stand, den inzwischen jemand anderes gespeichert hat.
 *
 * Was schiefgehen kann:
 *  - eine Änderung der anderen Person geht still verloren (verschiedene Felder)
 *  - zwei verschiedene Änderungen am selben Feld werden still überschrieben
 *  - gleiche Änderungen gelten fälschlich als Konflikt
 *  - Löschen eines Feldes geht verloren oder wird zum Konflikt, obwohl die andere Seite es nicht anfasste
 *  - verschachtelte Werte (Antwortoptionen) werden nach Referenz statt nach Inhalt verglichen,
 *    oder die Reihenfolge der Schlüssel in Objekten zählt als Änderung
 *  - wer nichts geändert hat, bekommt nicht genau den fremden Stand
 */
describe('mergeConfig', () => {
  const base = { question: 'Wie geht’s?', options: ['gut', 'schlecht'], multi: false };

  it('übernimmt Änderungen beider Seiten an verschiedenen Feldern', () => {
    const r = mergeConfig(base, { ...base, question: 'Wie geht es dir?' }, { ...base, multi: true });
    expect(r).toEqual({ merged: { question: 'Wie geht es dir?', options: ['gut', 'schlecht'], multi: true }, conflicts: [] });
  });

  it('meldet verschiedene Änderungen am selben Feld als Konflikt', () => {
    const r = mergeConfig(base, { ...base, question: 'A' }, { ...base, question: 'B' });
    expect(r.conflicts).toEqual(['question']);
  });

  it('wertet gleiche Änderungen nicht als Konflikt', () => {
    const r = mergeConfig(base, { ...base, options: ['gut', 'mittel'] }, { ...base, options: ['gut', 'mittel'] });
    expect(r).toEqual({ merged: { ...base, options: ['gut', 'mittel'] }, conflicts: [] });
  });

  it('behält ein gelöschtes Feld gelöscht, wenn die andere Seite es nicht änderte', () => {
    const { multi: _drop, ...mine } = base;
    const r = mergeConfig(base, mine, { ...base, question: 'B' });
    expect(r).toEqual({ merged: { question: 'B', options: ['gut', 'schlecht'] }, conflicts: [] });
  });

  it('meldet Löschen gegen Ändern als Konflikt', () => {
    const { multi: _drop, ...mine } = base;
    expect(mergeConfig(base, mine, { ...base, multi: true }).conflicts).toEqual(['multi']);
  });

  it('vergleicht verschachtelte Werte nach Inhalt, unabhängig von der Schlüsselreihenfolge', () => {
    const b = { board: { a: 1, b: [1, 2] } };
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    const r = mergeConfig(b, { board: { b: [1, 2], a: 1 } }, { board: { a: 2, b: [1, 2] } });
    expect(r).toEqual({ merged: { board: { a: 2, b: [1, 2] } }, conflicts: [] });
  });

  it('liefert ohne eigene Änderung genau den fremden Stand', () => {
    const theirs = { question: 'Neu', options: ['x'] };
    expect(mergeConfig(base, base, theirs)).toEqual({ merged: theirs, conflicts: [] });
  });
});
