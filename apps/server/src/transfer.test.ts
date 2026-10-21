import { initialRunState, type RunState } from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { remapBoardKey, remapPayload, remapState } from './transfer.ts';

const slides = new Map([
  [10, 110],
  [11, 111],
]);
const posts = new Map([[5, 905]]);
const groups = new Map([[7, 707]]);

describe('Import: Verweise umschreiben', () => {
  it('schreibt Kartenschlüssel auf neue Karten und Gruppen um', () => {
    expect(remapBoardKey('c5', posts, groups)).toBe('c905');
    expect(remapBoardKey('g7', posts, groups)).toBe('g707');
    expect(remapBoardKey('c6', posts, groups)).toBeNull();
    expect(remapBoardKey('x1', posts, groups)).toBeNull();
  });

  it('schreibt Folien- und Beitrags-IDs im Live-Zustand um und beendet laufende Anzeigen', () => {
    const state: RunState = {
      ...initialRunState(10),
      spotlight: 5,
      locked: [10, 99],
      quiz: { '11': { phase: 'closed', openedAt: 1, closesAt: 2, revealed: true } },
      sentence: { '10': { words: ['a'], round: 1, revealed: false, done: false } },
      build: { '11': 2, '99': 1 },
      boardRights: { '10': 'all' },
      countdown: { endsAt: 1, seconds: 60 },
      blank: 'black',
    };
    const next = remapState(state, slides, posts);
    expect(next.slideId).toBe(110);
    expect(next.spotlight).toBe(905);
    expect(next.locked).toEqual([110]);
    expect(Object.keys(next.quiz)).toEqual(['111']);
    expect(Object.keys(next.sentence)).toEqual(['110']);
    expect(next.build).toEqual({ '111': 2 });
    expect(next.boardRights).toEqual({ '110': 'all' });
    expect(next.countdown).toBeNull();
    expect(next.blank).toBeNull();
  });

  it('schreibt Punkte und Einschätzungen der Kartenwand um, andere Antworten bleiben gleich', () => {
    expect(remapPayload({ dots: { c5: 2, c6: 1 }, ratings: { g7: [3, null] } }, posts, groups)).toEqual({
      dots: { c905: 2 },
      ratings: { g707: [3, null] },
    });
    expect(remapPayload({ picks: { g7: [0, 2], g8: [1] } }, posts, groups)).toEqual({ picks: { g707: [0, 2] } });
    expect(remapPayload({ choice: 1 }, posts, groups)).toEqual({ choice: 1 });
  });
});

describe('Import: Gruppeneinteilung', () => {
  it('schreibt Folien- und Teilnehmer-IDs der Gruppen um und lässt Unbekannte weg', () => {
    const state: RunState = {
      ...initialRunState(10),
      teams: {
        '10': [
          [1, 2],
          [3, 99],
        ],
        '98': [[1]],
      },
    };
    const next = remapState(
      state,
      slides,
      posts,
      new Map([
        [1, 501],
        [2, 502],
        [3, 503],
      ]),
    );
    expect(next.teams).toEqual({ '110': [[501, 502], [503]] });
  });
});
