import {
  activeCallback,
  assignmentAt,
  breakoutAssignment,
  callbackHeadline,
  defaultConfig,
  doneTeams,
  initialRunState,
  makeCallback,
  teamIndexOf,
  teamVisibleCards,
  toggleTeamDone,
  type RunState,
} from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { remapState } from './transfer.ts';
import { applyCommand } from './runs.ts';

const slides = [
  { id: 1, type: 'teams' },
  { id: 2, type: 'board' },
  { id: 3, type: 'teams' },
  { id: 4, type: 'board' },
];
const teams = {
  '1': [
    [10, 11],
    [12, 13],
  ],
  '3': [[10, 12], [11], [13]],
};
const collect = (perTeam: boolean) => ({ ...defaultConfig('board'), mode: 'collect' as const, perTeam });

describe('Breakout: Gruppenzuordnung einer Karte', () => {
  it('nimmt die letzte Einteilung bis zur Folie', () => {
    expect(assignmentAt(slides, 1, teams)?.slideId).toBe(1);
    expect(assignmentAt(slides, 3, teams)?.slideId).toBe(3);
    expect(teamIndexOf(assignmentAt(slides, 1, teams), 13)).toBe(1);
    expect(teamIndexOf(assignmentAt(slides, 3, teams), 13)).toBe(2);
  });

  it('überspringt leere Einteilungen und kennt Personen ohne Gruppe', () => {
    expect(assignmentAt(slides, 3, { '1': teams['1'], '3': [] })?.slideId).toBe(1);
    expect(assignmentAt(slides, 0, undefined)).toBeNull();
    expect(teamIndexOf(assignmentAt(slides, 1, teams), 99)).toBeNull();
  });

  it('gilt nur beim gruppenweisen Sammeln und nur mit Einteilung davor', () => {
    expect(breakoutAssignment(slides, { id: 2, config: collect(true) }, teams)?.slideId).toBe(1);
    expect(breakoutAssignment(slides, { id: 2, config: collect(false) }, teams)).toBeNull();
    expect(breakoutAssignment(slides, { id: 2, config: { ...collect(true), mode: 'cluster' } }, teams)).toBeNull();
    expect(breakoutAssignment(slides, { id: 2, config: collect(true) }, { '3': teams['3'] })).toBeNull();
  });
});

describe('Breakout: Sichtbarkeit', () => {
  const cards = [
    { id: 1, participantId: 10, team: 0, status: 'visible' },
    { id: 2, participantId: 11, team: 0, status: 'visible' },
    { id: 3, participantId: 12, team: 1, status: 'visible' },
    { id: 4, participantId: 11, team: 0, status: 'hidden' },
    { id: 5, participantId: 10, team: 0, status: 'hidden' },
    { id: 6, participantId: null, team: null, status: 'visible' },
  ];
  it('zeigt eigene Karten und sichtbare Karten der eigenen Gruppe – nie fremde Gruppen', () => {
    expect(teamVisibleCards(cards, 10, 0).map((c) => c.id)).toEqual([1, 2, 5]);
    expect(teamVisibleCards(cards, 12, 1).map((c) => c.id)).toEqual([3]);
  });
  it('ohne Gruppe nur die eigenen Karten', () => {
    expect(teamVisibleCards(cards, 10, null).map((c) => c.id)).toEqual([1, 5]);
  });
});

describe('Breakout: fertig melden und Sammelruf', () => {
  it('setzt und nimmt Fertig-Meldungen zurück, ignoriert veraltete Gruppen', () => {
    expect(toggleTeamDone(undefined, 2, true)).toEqual([2]);
    expect(toggleTeamDone([2, 0], 2, false)).toEqual([0]);
    expect(toggleTeamDone([1], 1, true)).toEqual([1]);
    expect(doneTeams([4, 1, 1, 0], 3)).toEqual([0, 1]);
  });

  it('Sammelruf läuft nach den Minuten plus Nachlauf ab', () => {
    const cb = makeCallback('Bitte Ergebnisse mitbringen', 2, 1000);
    expect(callbackHeadline(cb)).toBe('In 2 Min. zurück ins Plenum');
    expect(activeCallback(cb, 1000 + 2 * 60_000)).toEqual(cb);
    expect(activeCallback(cb, cb.until)).toBeNull();
    expect(callbackHeadline(makeCallback('', null, 0))).toBe('Alle zurück ins Plenum');
  });

  it('Host-Befehle ändern den Zustand', () => {
    let s: RunState = initialRunState(2);
    s = applyCommand(s, { action: 'team-done', slideId: 2, team: 1, done: true }, [1, 2]);
    expect(s.teamDone).toEqual({ '2': [1] });
    s = applyCommand(s, { action: 'callback', callback: { text: 'Kaffee', minutes: 5 } }, [1, 2], 500);
    expect(s.callback).toMatchObject({ text: 'Kaffee', minutes: 5, at: 500 });
    s = applyCommand(s, { action: 'callback', callback: null }, [1, 2]);
    expect(s.callback).toBeNull();
  });

  it('Import schreibt Fertig-Meldungen auf neue Folien um und verwirft den Sammelruf', () => {
    const state: RunState = { ...initialRunState(2), teamDone: { '2': [0], '77': [1] }, callback: makeCallback('', 1, 0) };
    const next = remapState(state, new Map([[2, 202]]), new Map());
    expect(next.teamDone).toEqual({ '202': [0] });
    expect(next.callback).toBeNull();
  });
});
