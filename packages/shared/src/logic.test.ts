import { describe, expect, it } from 'vitest';
import {
  boardResults,
  entryTagColumns,
  finalLevels,
  levelOrigin,
  ratingSourceNote,
  tagLevel,
  boardTargets,
  fakeResponse,
  groupTagCounts,
  leadingChoices,
  tagCountText,
  tieAtLimit,
  tagCounts,
  tiedKeys,
  dotTotals,
  levelLabel,
  parseBoardKey,
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
  defaultConfig,
  slideHeadline,
  SLIDE_TYPES,
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

describe('Kartenwand', () => {
  const board = (patch: Record<string, unknown>) => parseConfig('board', patch);

  it('zählt Punkte und begrenzt sie auf das Budget', () => {
    const config = board({ mode: 'dots', dots: 3, stack: true });
    expect(validateResponse('board', config, { dots: { g1: 2, g2: 1 } })).toEqual({ ok: true, value: { dots: { g1: 2, g2: 1 } } });
    expect(validateResponse('board', config, { dots: { g1: 4 } }).ok).toBe(false);
    expect(validateResponse('board', config, { dots: {} }).ok).toBe(false);
    expect(validateResponse('board', config, { dots: { x1: 1 } }).ok).toBe(false);
    const single = board({ mode: 'dots', dots: 3, stack: false });
    expect(validateResponse('board', single, { dots: { g1: 2 } }).ok).toBe(false);
  });

  it('prüft Bewertungen gegen die Stufen und wertet sie aus', () => {
    const config = board({
      mode: 'rate',
      scales: [
        { label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'] },
        { label: 'Aufwand', levels: ['S', 'M', 'L', 'XL'] },
      ],
    });
    expect(validateResponse('board', config, { ratings: { g1: [4, 0] } }).ok).toBe(false);
    expect(validateResponse('board', config, { ratings: { g1: [3] } }).ok).toBe(false);
    const ok = validateResponse('board', config, { ratings: { g1: [3, null], g2: [null, null] } });
    expect(ok).toEqual({ ok: true, value: { ratings: { g1: [3, null] } } });
    const r = boardResults(config, [{ ratings: { g1: [3, 0] } }, { ratings: { g1: [1, 2] } }]);
    expect(r.ratings.g1).toEqual({
      n: [2, 2],
      average: [2, 1],
      distribution: [
        [0, 1, 0, 1],
        [1, 0, 1, 0],
      ],
    });
    expect(levelLabel(['S', 'M', 'L', 'XL'], 2.4)).toBe('L');
  });

  it('Bewerten: Quelle je Kriterium – Standard „alle“, nur Stimmen-Kriterien nehmen Antworten an', () => {
    expect(board({ mode: 'rate' }).scales[0]!.source).toBe('votes');
    const legacy = board({ mode: 'rate', scales: [{ label: 'Nutzen', levels: ['S', 'M'] }] });
    expect(legacy.scales[0]).toEqual({ label: 'Nutzen', levels: ['S', 'M'], source: 'votes' });

    const mixed = board({
      mode: 'rate',
      scales: [
        { label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'], source: 'tags' },
        { label: 'Aufwand', levels: ['S', 'M', 'L', 'XL'], source: 'votes' },
      ],
    });
    // Werte für das Kennzeichnungs-Kriterium werden verworfen
    expect(validateResponse('board', mixed, { ratings: { g1: [3, 1], g2: [2, null] } })).toEqual({
      ok: true,
      value: { ratings: { g1: [null, 1] } },
    });
    // … und zählen in der Auswertung nicht (z. B. nach einer Umstellung der Quelle)
    expect(boardResults(mixed, [{ ratings: { g1: [3, 1] } }]).ratings.g1!.n).toEqual([0, 1]);

    const hostOnly = board({
      mode: 'rate',
      scales: [
        { label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'], source: 'tags' },
        { label: 'Aufwand', levels: ['S', 'M', 'L', 'XL'], source: 'host' },
      ],
    });
    expect(validateResponse('board', hostOnly, { ratings: { g1: [null, 1] } })).toEqual({
      ok: false,
      error: 'Auf dieser Folie bewertet die Moderation',
    });
    expect(fakeResponse('board', hostOnly, () => 0.5, ['g1'])).toBeNull();
    const fake = fakeResponse('board', mixed, () => 0.5, ['g1']) as { ratings: Record<string, (number | null)[]> };
    expect(fake.ratings.g1![0]).toBeNull();
    expect(ratingSourceNote(hostOnly)).toBe('Nutzen aus den Karten · Aufwand von der Moderation');
    expect(ratingSourceNote(board({ mode: 'rate' }))).toBeNull();
  });

  it('Bewerten: Stufe aus Kennzeichnungen und endgültige Werte', () => {
    // S, L, XL → (0 + 2 + 3) / 3; Kennzeichnungen über die Stufen hinaus zählen als höchste Stufe
    expect(tagLevel([0, 2, 3, null], 4)).toBe(1.67);
    expect(tagLevel([4, 1], 3)).toBe(1.5);
    expect(tagLevel([null], 4)).toBeNull();
    const cards = [
      { id: 1, column: 3, group: 7, status: 'visible' },
      { id: 2, column: 1, group: 7, status: 'visible' },
      { id: 3, column: 0, group: 7, status: 'hidden' },
      { id: 4, column: 2, group: null, status: 'visible' },
    ];
    expect(entryTagColumns('g7', cards)).toEqual([3, 1]);
    expect(entryTagColumns('c4', cards)).toEqual([2]);

    const config = board({
      mode: 'rate',
      scales: [
        { label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'], source: 'votes' },
        { label: 'Aufwand', levels: ['S', 'M', 'L', 'XL'], source: 'host' },
      ],
    });
    const results = { ratings: { g1: { n: [2, 0], average: [2.5, null], distribution: [] } } };
    const view = { rated: { g1: [null, 1], g2: [3, null] }, ratedFixed: { g1: [false, true], g2: [true, false] } };
    // Festlegung schlägt Stimmen, sonst Durchschnitt; Moderation ohne Festlegung bleibt leer
    expect(finalLevels(config, view, results, 'g1')).toEqual([2.5, 1]);
    expect(finalLevels(config, view, results, 'g2')).toEqual([3, null]);
    expect(finalLevels(config, view, null, 'g1')).toEqual([null, 1]);
    expect(levelOrigin(config, view, 'g2', 0)).toBe('fixed');
    expect(levelOrigin(config, view, 'g1', 0)).toBe('votes');
  });

  it('wählt Gruppen, sobald es welche gibt, und filtert die Top N nach Punkten', () => {
    const cards = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const config = board({ mode: 'rate', top: 0 });
    expect(boardTargets(config, cards, [], {})).toEqual(['c1', 'c2', 'c3']);
    expect(boardTargets(config, cards, [{ id: 7 }, { id: 8 }], {})).toEqual(['g7', 'g8']);
    const top = board({ mode: 'rate', top: 2, targets: 'cards' });
    expect(boardTargets(top, cards, [{ id: 7 }], { c3: 4, c1: 2, c2: 1 })).toEqual(['c3', 'c1']);
    // Gleichstand an der Grenze: beide kommen mit und werden als gleichauf benannt
    expect(boardTargets(top, cards, [{ id: 7 }], { c3: 4, c1: 1, c2: 1 })).toEqual(['c3', 'c1', 'c2']);
    expect(tiedKeys(['c3', 'c1', 'c2'], { c3: 4, c1: 1, c2: 1 })).toEqual(['c1', 'c2']);
    expect(boardTargets(board({ mode: 'place', targets: 'table' }), cards, [{ id: 7 }], {}, ['g7'])).toEqual(['g7']);
    expect(tagCounts([{ column: 0 }, { column: 3 }, { column: 3 }, { column: null }], 4)).toEqual([1, 0, 0, 2]);
    expect(dotTotals([{ dots: { g1: 2 } }, { dots: { g1: 1, g2: 3 } }, {}])).toEqual({ g1: 3, g2: 3 });
    expect(parseBoardKey('g12')).toEqual({ kind: 'group', id: 12 });
    expect(parseBoardKey('g0')).toBeNull();
  });

  it('prüft Einordnungen gegen die Kategorien und zählt Stimmen', () => {
    const config = board({ mode: 'choose', choices: ['Zeit', 'Qualität', 'Umsatz', 'Kunde'] });
    // Duplikate entfernt, sortiert, leere Einträge fallen weg
    expect(validateResponse('board', config, { picks: { g1: [2, 0, 2], g2: [] } })).toEqual({ ok: true, value: { picks: { g1: [0, 2] } } });
    expect(validateResponse('board', config, { picks: { g1: [4] } }).ok).toBe(false);
    expect(validateResponse('board', config, { picks: { g1: [] } }).ok).toBe(false);
    expect(validateResponse('board', config, { picks: {} }).ok).toBe(false);
    expect(validateResponse('board', config, { picks: { x1: [0] } }).ok).toBe(false);
    const single = board({ mode: 'choose', multi: false });
    expect(validateResponse('board', single, { picks: { g1: [0, 1] } }).ok).toBe(false);
    expect(validateResponse('board', single, { picks: { g1: [1, 1] } })).toEqual({ ok: true, value: { picks: { g1: [1] } } });
    // Punkte auf einer Einordnen-Folie zählen nicht
    expect(validateResponse('board', config, { dots: { g1: 1 } }).ok).toBe(false);

    const r = boardResults(config, [{ picks: { g1: [0, 2] } }, { picks: { g1: [2], g2: [3] } }]);
    expect(r.picks).toEqual({ g1: [1, 0, 2, 0], g2: [0, 0, 0, 1] });
    expect(r.voters).toBe(2);
    expect(leadingChoices(r.picks.g1, undefined)).toEqual({ indices: [2], fixed: false });
    expect(leadingChoices([1, 1, 0, 0], undefined)).toEqual({ indices: [0, 1], fixed: false });
    expect(leadingChoices(r.picks.g1, [1])).toEqual({ indices: [1], fixed: true });
    expect(leadingChoices(undefined, [])).toEqual({ indices: [], fixed: false });
  });

  it('erzeugt gültige Testantworten fürs Einordnen', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (const multi of [true, false]) {
      const config = board({ mode: 'choose', multi });
      for (let i = 0; i < 20; i++) {
        const raw = fakeResponse('board', config, random, ['g1', 'g2']);
        expect(validateResponse('board', config, raw).ok).toBe(true);
      }
    }
  });

  it('zeigt die Verteilung der Kennzeichnungen je Gruppe, große zuerst', () => {
    const cards = [
      { column: 3, group: 1 },
      { column: 3, group: 1 },
      { column: 1, group: 1 },
      { column: 0, group: 2 },
      { column: null, group: 2 },
      { column: 2, group: null },
    ];
    const counts = groupTagCounts(cards, [{ id: 1 }, { id: 2 }, { id: 3 }], 4);
    expect(counts).toEqual({ g1: [0, 1, 0, 2], g2: [1, 0, 0, 0] });
    expect(tagCountText(['S', 'M', 'L', 'XL'], counts.g1)).toBe('XL 2 · M 1');
    expect(tagCountText(['S', 'M', 'L', 'XL'], undefined)).toBe('');
    expect(groupTagCounts(cards, [{ id: 1 }], 0)).toEqual({});
  });

  it('benennt Gleichstand an der Grenze einer Top-N-Auswahl', () => {
    expect(tieAtLimit(5, 6)).toBe('Gleichstand auf Platz 5 – 6 Themen');
    expect(tieAtLimit(5, 5)).toBeNull();
    expect(tieAtLimit(0, 8)).toBeNull();
  });
});

describe('Folienüberschrift', () => {
  it('liefert für jeden Folientyp mit Standardwerten einen Text (kein Absturz)', () => {
    for (const type of SLIDE_TYPES) {
      if (type === 'image') continue; // braucht eine Bildkennung
      expect(typeof slideHeadline({ type, config: defaultConfig(type) } as never)).toBe('string');
    }
  });

  it('nimmt bei der Pausen-Folie den Titel, nicht den Schalter für die Energie-Frage', () => {
    expect(slideHeadline({ type: 'pause', config: { title: 'Kaffeepause', minutes: 10, question: true } })).toBe('Kaffeepause');
  });
});
