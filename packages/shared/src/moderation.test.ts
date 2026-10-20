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
      { name: 'Ben', at: T0 + 60_000, until: T0 + 60_000 + SIGNAL_TTL_MS },
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
