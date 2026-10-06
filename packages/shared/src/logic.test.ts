import { describe, expect, it } from 'vitest';
import {
  appendWord,
  buildSentence,
  countWords,
  leaderboard,
  parseConfig,
  quizPoints,
  rankingResults,
  scaleResults,
  topWords,
  validateResponse,
  validateSingleWord,
} from './index.ts';

describe('Wörter zählen', () => {
  it('fasst Groß-/Kleinschreibung und Satzzeichen zusammen und zeigt die häufigste Schreibweise', () => {
    const counts = countWords(['Server', 'server', 'Server!', 'brennt', '„brennt“', 'Kaffee']);
    expect(counts[0]).toEqual({ key: 'server', word: 'Server', count: 3 });
    expect(counts[1]).toEqual({ key: 'brennt', word: 'brennt', count: 2 });
    expect(counts[2]!.count).toBe(1);
  });

  it('erkennt Gleichstand', () => {
    const counts = countWords(['a', 'b', 'b', 'a', 'c']);
    expect(topWords(counts).map((w) => w.word)).toEqual(['a', 'b']);
  });

  it('lässt nur einzelne Wörter zu', () => {
    expect(validateSingleWord('  der  ')).toEqual({ ok: true, word: 'der' });
    expect(validateSingleWord('der Server').ok).toBe(false);
    expect(validateSingleWord('...').ok).toBe(false);
  });
});

describe('Satz-Spiel', () => {
  it('hängt Wörter an und entfernt Auslassungspunkte am Satzanfang', () => {
    const start = 'Ein Admin öffnet die Tür des Serverraums und sieht, dass...';
    expect(buildSentence(start, ['alles', 'brennt'])).toBe('Ein Admin öffnet die Tür des Serverraums und sieht, dass alles brennt');
  });

  it('hängt Satzzeichen ohne Leerzeichen an', () => {
    expect(appendWord('Es brennt', '!')).toBe('Es brennt!');
  });
});

describe('Quiz', () => {
  it('gibt 1000 Punkte für eine sofortige richtige Antwort und 500 kurz vor Schluss', () => {
    expect(quizPoints(true, 0, 20)).toBe(1000);
    expect(quizPoints(true, 20_000, 20)).toBe(500);
    expect(quizPoints(true, 99_000, 20)).toBe(500);
    expect(quizPoints(false, 0, 20)).toBe(0);
  });

  it('teilt Ränge bei Punktgleichstand', () => {
    const board = leaderboard([
      { participantId: 1, name: 'Ada', points: 900, correct: true },
      { participantId: 2, name: 'Bob', points: 900, correct: true },
      { participantId: 3, name: 'Cem', points: 0, correct: false },
      { participantId: 1, name: 'Ada', points: 600, correct: true },
    ]);
    expect(board.map((e) => [e.name, e.points, e.rank])).toEqual([
      ['Ada', 1500, 1],
      ['Bob', 900, 2],
      ['Cem', 0, 3],
    ]);
  });

  it('verlangt eine gültige richtige Antwort', () => {
    expect(() => parseConfig('quiz', { options: ['a', 'b'], correct: [5] })).toThrow();
    expect(parseConfig('quiz', { options: ['a', 'b'], correct: [1, 1] }).correct).toEqual([1]);
  });
});

describe('Auswertungen', () => {
  it('Ranking nach Borda', () => {
    const config = parseConfig('ranking', { options: ['A', 'B', 'C'] });
    const r = rankingResults(config, [{ order: [0, 1, 2] }, { order: [0, 2, 1] }]);
    expect(r.type === 'ranking' && r.items.map((i) => [i.index, i.score])).toEqual([
      [0, 100],
      [1, 25],
      [2, 25],
    ]);
  });

  it('Skala mit Durchschnitt', () => {
    const config = parseConfig('scale', { max: 5 });
    const r = scaleResults(config, [{ value: 5 }, { value: 4 }, { value: 3 }]);
    expect(r).toMatchObject({ voters: 3, average: 4, distribution: [0, 0, 1, 1, 1] });
  });

  it('prüft Antworten gegen die Konfiguration', () => {
    const choice = parseConfig('choice', { options: ['a', 'b', 'c'], multiple: false });
    expect(validateResponse('choice', choice, { choices: [0, 1] }).ok).toBe(false);
    expect(validateResponse('choice', choice, { choices: [2] })).toEqual({ ok: true, value: { choices: [2] } });
    const ranking = parseConfig('ranking', { options: ['a', 'b', 'c'] });
    expect(validateResponse('ranking', ranking, { order: [0, 0, 1] }).ok).toBe(false);
  });
});
