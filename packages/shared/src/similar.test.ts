import { describe, expect, it } from 'vitest';
import { groupSimilar, jaccard, topicTokens } from './similar.ts';

describe('Ähnliche Themen', () => {
  it('normalisiert Groß-/Kleinschreibung, Umlaute, Satzzeichen und Stoppwörter', () => {
    expect(topicTokens('Die Kommunikation im Team!')).toEqual(topicTokens('kommunikation team'));
    expect(topicTokens('Die Kommunikation im Team!').size).toBe(2);
    expect(topicTokens('Größere Übergaben')).toEqual(topicTokens('groessere uebergaben'));
    expect(topicTokens('Meetings')).toEqual(topicTokens('Meeting'));
  });

  it('Jaccard: gleich, teilweise, leer', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });

  it('gruppiert ähnliche Texte über Durchführungen hinweg', () => {
    const clusters = groupSimilar([
      { text: 'Kommunikation im Team', source: 1 },
      { text: 'Team-Kommunikation', source: 2 },
      { text: 'kommunikation', source: 3 },
      { text: 'Zu viele Meetings', source: 1 },
      { text: 'Meetings', source: 2 },
      { text: 'Parkplätze', source: 1 },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.sources).toEqual([1, 2, 3]);
    expect(clusters[0]!.items.map((i) => i.text)).toContain('Team-Kommunikation');
    expect(clusters[1]!.label).toBe('Meetings');
  });

  it('ignoriert Themen, die nur in einer Durchführung vorkommen', () => {
    const clusters = groupSimilar([
      { text: 'Budget', source: 1 },
      { text: 'Budget', source: 1 },
      { text: 'Werkzeuge', source: 2 },
    ]);
    expect(clusters).toEqual([]);
  });

  it('trennt unähnliche Texte trotz gemeinsamem Wort', () => {
    const clusters = groupSimilar([
      { text: 'Neue Software für die Buchhaltung einführen', source: 1 },
      { text: 'Software', source: 2 },
    ]);
    expect(clusters).toEqual([]);
  });

  it('wählt den häufigsten Text als Überschrift', () => {
    const [c] = groupSimilar([
      { text: 'Onboarding', source: 1 },
      { text: 'onboarding', source: 2 },
      { text: 'Onboarding verbessern', source: 3 },
    ]);
    expect(c!.label.toLowerCase()).toBe('onboarding');
    expect(c!.sources).toHaveLength(3);
  });
});
