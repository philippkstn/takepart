import { initialRunState, parseConfig, type Slide } from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { boardTags, buildBoardView, collectSlideIds, tableSlideBefore, targetsOf, type BoardCard, type BoardData, type BoardSlide } from './board.ts';
import { applyStartHidden } from './runs.ts';

const boardSlide = (id: number, config: Record<string, unknown>): BoardSlide => ({
  id,
  type: 'board',
  position: id,
  config: parseConfig('board', { board: 'Hindernisse', ...config }),
});

const card = (id: number, column: number | null, group: number | null, status: BoardCard['status'] = 'visible'): BoardCard => ({
  id,
  slideId: 1,
  participantId: 100 + id,
  text: `Karte ${id}`,
  column,
  group,
  team: null,
  status,
  votes: 0,
  createdAt: id,
});

const data = (patch: Partial<BoardData> = {}): BoardData => ({
  cards: [card(1, 3, 7), card(2, 3, 7), card(3, 1, 7), card(4, 0, 8), card(5, 2, 9), card(6, 3, 9, 'hidden')],
  groups: [
    { id: 7, name: 'Prozesse', position: 0, participantId: null },
    { id: 8, name: 'Tools', position: 1, participantId: null },
    { id: 9, name: 'Kunden', position: 2, participantId: null },
  ],
  places: [],
  totals: { g7: 3, g8: 3, g9: 1 },
  tags: ['S', 'M', 'L', 'XL'],
  tableRows: [],
  ...patch,
});

describe('Kartenwand: Ansicht', () => {
  it('zählt Kennzeichnungen je Gruppe (nur sichtbare Karten) und benennt Gleichstand', () => {
    const view = buildBoardView(boardSlide(2, { mode: 'cluster' }), data(), 'host');
    expect(view.tags).toEqual(['S', 'M', 'L', 'XL']);
    expect(view.tagCounts).toEqual({ g7: [0, 1, 0, 2], g8: [1, 0, 0, 0], g9: [0, 0, 1, 0] });
    expect(view.tied).toEqual(['g7', 'g8']);
    expect(view.chosen).toEqual({});
  });

  it('nennt auf der Punkte-Folie selbst keinen Gleichstand (entsteht erst aus ihrem Ergebnis)', () => {
    expect(buildBoardView(boardSlide(3, { mode: 'dots' }), data(), 'host').tied).toEqual([]);
  });

  it('Einordnen: Top N mit Gleichstand an der Grenze und Festlegungen der Moderation', () => {
    const slide = boardSlide(4, { mode: 'choose', top: 1 });
    const view = buildBoardView(
      slide,
      data({
        places: [
          { target: 'g7', lane: null, cell: null, position: 0, fields: ['0', '2'] },
          { target: 'g9', lane: null, cell: null, position: 0, fields: ['1'] },
          { target: 'g8', lane: null, cell: null, position: 0, fields: ['9'] },
        ],
      }),
      'host',
    );
    // g7 und g8 liegen mit 3 Punkten gleichauf – beide kommen mit
    expect(view.targets).toEqual(['g7', 'g8']);
    // g9 steht nicht zur Wahl, ungültige Indizes fallen weg
    expect(view.chosen).toEqual({ g7: [0, 2] });
  });

  it('Bewerten: Nutzen aus den Kennzeichnungen, Aufwand von der Moderation, Festlegungen', () => {
    const slide = boardSlide(5, {
      mode: 'rate',
      scales: [
        { label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'], source: 'tags' },
        { label: 'Aufwand', levels: ['S', 'M', 'L', 'XL'], source: 'host' },
      ],
    });
    const view = buildBoardView(
      slide,
      data({
        places: [
          // Aufwand für Prozesse festgelegt, Nutzen nicht
          { target: 'g7', lane: null, cell: null, position: 0, fields: ['', '2'] },
          // Nutzen der Kunden von der Moderation korrigiert
          { target: 'g9', lane: null, cell: null, position: 0, fields: ['0', ''] },
          // ungültige Stufe fällt weg
          { target: 'g8', lane: null, cell: null, position: 0, fields: ['', '9'] },
        ],
      }),
      'host',
    );
    expect(view.targets).toEqual(['g7', 'g8', 'g9']);
    // Prozesse: XL, XL, M → (3 + 3 + 1) / 3; Tools: S; Kunden: L (versteckte Karte zählt nicht), aber auf S festgelegt
    expect(view.rated).toEqual({ g7: [2.33, 2], g8: [0, null], g9: [0, null] });
    expect(view.ratedFixed).toEqual({ g7: [false, true], g9: [true, false] });
    // Andere Modi bekommen nichts
    expect(buildBoardView(boardSlide(6, { mode: 'dots' }), data(), 'host').rated).toEqual({});
  });

  it('nimmt mit „Zeilen der Ergebnistabelle“ die letzte Tabelle davor, in ihrer Reihenfolge', () => {
    const slides: Slide[] = [
      boardSlide(1, { mode: 'collect', tags: ['S', 'M', 'L', 'XL'] }),
      boardSlide(2, { mode: 'table' }),
      boardSlide(3, { mode: 'table' }),
      boardSlide(4, { mode: 'place', targets: 'table' }),
      boardSlide(5, { mode: 'table' }),
      boardSlide(6, { board: 'Andere', mode: 'table' }),
    ];
    expect(tableSlideBefore(slides, slides[3] as BoardSlide)?.id).toBe(3);
    expect(tableSlideBefore(slides, slides[1] as BoardSlide)).toBeNull();
    expect(boardTags(slides, 'Hindernisse')).toEqual(['S', 'M', 'L', 'XL']);
    expect(boardTags(slides, 'Andere')).toEqual([]);
    const config = (slides[3] as BoardSlide).config;
    // Zeilen auf nicht mehr vorhandene Einträge fallen weg
    expect(targetsOf(config, data({ tableRows: ['g9', 'g7', 'g99', 'c6'] }))).toEqual(['g9', 'g7']);
    expect(targetsOf(config, data())).toEqual([]);
  });
});

describe('Kartenwand: erst aufdecken', () => {
  const slides: Slide[] = [boardSlide(1, { mode: 'collect', startHidden: true }), boardSlide(2, { mode: 'cluster' })];

  it('verbirgt die Ergebnisse beim Betreten und zeigt sie beim Verlassen wieder', () => {
    const s = { ...initialRunState(2), slideId: 1 };
    applyStartHidden(s, slides, 2);
    expect(s.resultsVisible).toBe(false);
    s.slideId = 2;
    applyStartHidden(s, slides, 1);
    expect(s.resultsVisible).toBe(true);
  });

  it('lässt die Einstellung sonst unverändert', () => {
    const s = { ...initialRunState(2), resultsVisible: false };
    applyStartHidden(s, slides, 2);
    expect(s.resultsVisible).toBe(false);
    s.slideId = 1;
    s.resultsVisible = true;
    applyStartHidden(s, slides, 1);
    expect(s.resultsVisible).toBe(true);
  });
});

describe('Kartenwand: Parkplatz', () => {
  it('teilt die Karten aller Sammel-Folien einer Wand mit „jederzeit“', () => {
    const parking = boardSlide(1, { board: 'Parkplatz', anytime: true });
    const review = boardSlide(5, { board: 'Parkplatz', prompt: 'Was ist offen geblieben?' });
    const slides: Slide[] = [parking, boardSlide(2, {}), boardSlide(3, {}), review, boardSlide(6, { board: 'Parkplatz', mode: 'cluster' })];
    expect(collectSlideIds(slides, parking)).toEqual([1, 5]);
    expect(collectSlideIds(slides, review)).toEqual([1, 5]);
  });

  it('lässt Sammel-Folien ohne Parkplatz bei ihren eigenen Karten', () => {
    const first = boardSlide(2, {});
    const second = boardSlide(3, {});
    expect(collectSlideIds([first, second], second)).toEqual([3]);
  });
});
