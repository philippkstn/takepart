import { describe, expect, it } from 'vitest';
import {
  clearSignals,
  countActive,
  drawPick,
  emptyPicker,
  ownSignals,
  pickCandidates,
  pruneSignals,
  setSignal,
  SIGNAL_TTL_MS,
  signalsView,
  teamsAt,
  appendTurns,
  cardsByTurn,
  emptyTurns,
  liveTurns,
  moveTurn,
  myTurn,
  orderByFirstCard,
  removeTurn,
  shuffleTurns,
  stepTurn,
  type TurnsState,
} from './moderation.ts';
import { hostCommand, initialRunState, signalInput } from './state.ts';

const T0 = 1_000_000;

describe('Handzeichen', () => {
  it('ein Signal pro Person und Art; erneutes Setzen verlängert, Zurücknehmen löscht', () => {
    let s = initialRunState(1);
    s = setSignal(s, 'fast', 7, true, T0);
    s = setSignal(s, 'fast', 7, true, T0 + 1000);
    s = setSignal(s, 'fast', 8, true, T0);
    s = setSignal(s, 'question', 7, true, T0);
    expect(Object.keys(s.signals!.fast!)).toHaveLength(2);
    expect(s.signals!.fast![7]).toBe(T0 + 1000);
    s = setSignal(s, 'fast', 7, false, T0 + 2000);
    expect(Object.keys(s.signals!.fast!)).toEqual(['8']);
    expect(ownSignals(s.signals, 7, T0 + 2000)).toEqual({ question: T0 + SIGNAL_TTL_MS });
  });

  it('erlischt nach drei Minuten – beim Lesen gefiltert, beim Schreiben entfernt', () => {
    let s = setSignal(initialRunState(1), 'break', 1, true, T0);
    s = setSignal(s, 'break', 2, true, T0 + 60_000);
    const later = T0 + SIGNAL_TTL_MS;
    expect(signalsView(s.signals, later - 1).break).toHaveLength(2);
    expect(signalsView(s.signals, later, new Map([[2, 'Ben']])).break).toEqual([
      { id: 2, name: 'Ben', at: T0 + 60_000, until: T0 + 60_000 + SIGNAL_TTL_MS },
    ]);
    expect(ownSignals(s.signals, 1, later)).toEqual({});
    // Zählen im Browser anhand der Ablaufzeitpunkte
    const view = signalsView(s.signals, T0 + 61_000);
    expect(countActive(view.break, T0 + 61_000)).toBe(2);
    expect(countActive(view.break, later)).toBe(1);
    expect(countActive(view.break, later + 60_000)).toBe(0);
    // Ein neues Signal räumt Abgelaufenes auf
    s = setSignal(s, 'fast', 3, true, later + 60_000);
    expect(s.signals).toEqual({ fast: { 3: later + 60_000 } });
    expect(pruneSignals(undefined, T0)).toEqual({});
  });

  it('Moderation quittiert alle Signale einer Art', () => {
    let s = setSignal(initialRunState(1), 'question', 1, true, T0);
    s = setSignal(s, 'question', 2, true, T0);
    s = setSignal(s, 'fast', 2, true, T0);
    s = clearSignals(s, 'question', T0 + 10);
    expect(s.signals).toEqual({ fast: { 2: T0 } });
    expect(signalsView(s.signals, T0).question).toEqual([]);
  });

  it('prüft Eingaben und Befehle', () => {
    expect(signalInput.safeParse({ kind: 'fast', active: true }).success).toBe(true);
    expect(signalInput.safeParse({ kind: 'lauter', active: true }).success).toBe(false);
    expect(hostCommand.safeParse({ action: 'signals-clear', kind: 'break' }).success).toBe(true);
    expect(hostCommand.parse({ action: 'pick-draw' })).toEqual({ action: 'pick-draw', team: null });
  });
});

describe('Zufallsauswahl', () => {
  it('zieht ohne Wiederholung, bis alle dran waren', () => {
    const named = [1, 2, 3, 4];
    let picker = emptyPicker();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const next = drawPick(picker, pickCandidates(named, picker.drawn), (n) => (i * 7) % n);
      expect(next).not.toBeNull();
      picker = next!;
      seen.push(picker.current!);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    expect(picker.drawn).toEqual(seen);
    expect(drawPick(picker, pickCandidates(named, picker.drawn), () => 0)).toBeNull();
  });

  it('filtert auf eine Gruppe', () => {
    expect(pickCandidates([1, 2, 3, 4, 5], [2], [2, 3, 9])).toEqual([3]);
    expect(pickCandidates([1, 2, 3], [], null)).toEqual([1, 2, 3]);
  });

  it('nimmt die letzte Einteilung bis zur aktuellen Folie', () => {
    const slides = [
      { id: 10, type: 'teams' },
      { id: 11, type: 'content' },
      { id: 12, type: 'teams' },
      { id: 13, type: 'content' },
    ];
    const teams = { 10: [[1, 2]], 12: [[3], [4]] };
    expect(teamsAt(slides, 1, teams)).toEqual({ slideId: 10, groups: [[1, 2]] });
    expect(teamsAt(slides, 3, teams)).toEqual({ slideId: 12, groups: [[3], [4]] });
    // Noch nicht eingeteilt: frühere Einteilung gilt weiter
    expect(teamsAt(slides, 3, { 10: [[1, 2]], 12: [] })).toEqual({ slideId: 10, groups: [[1, 2]] });
    expect(teamsAt(slides, -1, teams)).toBeNull();
    expect(teamsAt(slides, 3, undefined)).toBeNull();
  });
});

describe('Handzeichen einzeln quittieren', () => {
  it('setzt nur das Zeichen einer Person zurück', () => {
    let s = setSignal(initialRunState(1), 'question', 1, true, T0);
    s = setSignal(s, 'question', 2, true, T0);
    s = clearSignals(s, 'question', T0 + 1000, 1);
    expect(Object.keys(s.signals!.question!)).toEqual(['2']);
    s = clearSignals(s, 'question', T0 + 1000, 2);
    expect(s.signals!.question).toBeUndefined();
  });
});

describe('Reihum', () => {
  const turns = (order: number[], current: number | null = null): TurnsState => ({ order, current, shown: false });

  it('Weiter/Zurück: startet bei der ersten Person, bleibt am Ende stehen', () => {
    expect(stepTurn(turns([1, 2, 3]), 1).current).toBe(0);
    // Nach der letzten Person endet die Runde
    expect(stepTurn(turns([1, 2, 3], 2), 1).current).toBeNull();
    expect(stepTurn(turns([1, 2, 3], 0), -1).current).toBe(0);
    expect(stepTurn(turns([]), 1).current).toBeNull();
  });

  it('Verschieben behält die Person, die dran ist', () => {
    const moved = moveTurn(turns([1, 2, 3], 1), 2, -1);
    expect(moved.order).toEqual([2, 1, 3]);
    expect(moved.current).toBe(0);
    expect(moveTurn(turns([1, 2, 3], 1), 3, 1)).toEqual(turns([1, 2, 3], 1));
  });

  it('Entfernen: vor der aktuellen Person rückt „dran“ mit, die aktuelle Person übergibt an die nächste', () => {
    expect(removeTurn(turns([1, 2, 3], 2), 1)).toMatchObject({ order: [2, 3], current: 1 });
    expect(removeTurn(turns([1, 2, 3], 1), 2)).toMatchObject({ order: [1, 3], current: 1 });
    expect(removeTurn(turns([1, 2, 3], 2), 3)).toMatchObject({ order: [1, 2], current: 1 });
    expect(removeTurn(turns([1], 0), 1)).toMatchObject({ order: [], current: null });
  });

  it('Unbekannte Personen fallen beim Lesen heraus, „dran“ bleibt bei derselben Person', () => {
    const live = liveTurns(turns([1, 2, 3, 4], 2), new Set([2, 3, 4]));
    expect(live).toMatchObject({ order: [2, 3, 4], current: 1 });
    expect(liveTurns(null, new Set([1]))).toEqual(emptyTurns());
    expect(liveTurns(turns([1, 1, 2]), new Set([1, 2])).order).toEqual([1, 2]);
  });

  it('Anhängen ohne Doppelte, Mischen verliert niemanden', () => {
    expect(appendTurns(turns([2, 1]), [1, 2, 3]).order).toEqual([2, 1, 3]);
    const mixed = shuffleTurns([1, 2, 3, 4, 5], (n) => n - 1);
    expect([...mixed].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('Nach erster Karte: früheste Karte vorn, ohne Karte hinten in Beitrittsreihenfolge', () => {
    const first = new Map([
      [3, 100],
      [1, 300],
      [4, 200],
    ]);
    expect(orderByFirstCard([1, 2, 3, 4, 5], first)).toEqual([3, 4, 1, 2, 5]);
  });

  it('Handy: nur während einer Runde und nur für Personen in der Reihe', () => {
    expect(myTurn(turns([1, 2, 3]), 2)).toBeNull();
    expect(myTurn(turns([1, 2, 3], 0), 2)).toEqual({ position: 1, of: 3, current: 0 });
    expect(myTurn({ ...turns([1, 2, 3]), shown: true }, 3)).toEqual({ position: 2, of: 3, current: null });
    expect(myTurn(turns([1, 2, 3], 0), 9)).toBeNull();
  });

  it('Karten nach Person: wer dran ist zuerst, dann reihum, Fremde danach, Moderation zuletzt', () => {
    const posts = [
      { id: 1, authorId: null },
      { id: 2, authorId: 7 },
      { id: 3, authorId: 1 },
      { id: 4, authorId: 2 },
      { id: 5, authorId: 1 },
      { id: 6, authorId: 3 },
    ];
    const groups = cardsByTurn(posts, [1, 2, 3], 1);
    expect(groups.map((g) => g.authorId)).toEqual([2, 1, 3, 7, null]);
    expect(groups[1]!.posts.map((p) => p.id)).toEqual([3, 5]);
    expect(cardsByTurn(posts, [], null).map((g) => g.authorId)).toEqual([7, 1, 2, 3, null]);
  });

  it('Host-Befehle für Reihum werden geprüft', () => {
    expect(hostCommand.parse({ action: 'turns-make', source: 'board', board: 'Ideen' })).toMatchObject({ source: 'board' });
    expect(hostCommand.safeParse({ action: 'turns-make', source: 'abc' }).success).toBe(false);
    expect(hostCommand.parse({ action: 'turns-go', index: null })).toEqual({ action: 'turns-go', index: null });
  });
});
