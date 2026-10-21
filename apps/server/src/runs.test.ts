import { boardRights, initialRunState, sentenceState, type RunState, type SlideSchedule } from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError } from './runs.ts';
import { effectiveQuiz } from './snapshot.ts';

const slides = [10, 20, 30];

describe('Steuerbefehle', () => {
  it('blättert mit step und bleibt an den Rändern stehen', () => {
    let s = initialRunState(10);
    s = applyCommand(s, { action: 'step', delta: -1 }, slides);
    expect(s.slideId).toBe(10);
    s = applyCommand(s, { action: 'step', delta: 1 }, slides);
    s = applyCommand(s, { action: 'step', delta: 1 }, slides);
    s = applyCommand(s, { action: 'step', delta: 1 }, slides);
    expect(s.slideId).toBe(30);
  });

  it('beendet Spotlight und Rangliste beim Folienwechsel', () => {
    let s: RunState = { ...initialRunState(10), spotlight: 5, leaderboard: true };
    s = applyCommand(s, { action: 'goto', slideId: 20 }, slides);
    expect(s.spotlight).toBeNull();
    expect(s.leaderboard).toBe(false);
  });

  it('beendet die Runde reihum beim Folienwechsel, behält aber die Reihenfolge', () => {
    let s: RunState = { ...initialRunState(10), turns: { order: [3, 1, 2], current: 1, shown: true } };
    s = applyCommand(s, { action: 'goto', slideId: 20 }, slides);
    expect(s.turns).toEqual({ order: [3, 1, 2], current: null, shown: false });
  });

  it('lehnt fremde Folien ab', () => {
    expect(() => applyCommand(initialRunState(10), { action: 'goto', slideId: 99 }, slides)).toThrow(CommandError);
  });

  it('Satz-Spiel: anhängen startet eine neue Runde, zurücknehmen auch', () => {
    let s = initialRunState(20);
    s = applyCommand(s, { action: 'sentence-reveal', slideId: 20, revealed: true }, slides);
    s = applyCommand(s, { action: 'sentence-append', slideId: 20, word: 'alles' }, slides);
    expect(sentenceState(s, 20)).toEqual({ words: ['alles'], round: 2, revealed: false, done: false });
    s = applyCommand(s, { action: 'sentence-append', slideId: 20, word: 'brennt' }, slides);
    s = applyCommand(s, { action: 'sentence-undo', slideId: 20 }, slides);
    // Neue Runde nach dem Zurücknehmen, damit alte Antworten nicht wieder auftauchen
    expect(sentenceState(s, 20)).toMatchObject({ words: ['alles'], round: 4 });
    s = applyCommand(s, { action: 'sentence-reset', slideId: 20 }, slides);
    expect(sentenceState(s, 20).words).toEqual([]);
    expect(() => applyCommand(s, { action: 'sentence-undo', slideId: 20 }, slides)).toThrow(CommandError);
  });

  it('Quiz: Phasen und Ablauf der Zeit', () => {
    let s = initialRunState(30);
    s = applyCommand(s, { action: 'quiz-start', slideId: 30 }, slides, 1000);
    s.quiz[30]!.closesAt = 1000 + 20_000;
    expect(effectiveQuiz(s, 30, 5000).phase).toBe('open');
    expect(effectiveQuiz(s, 30, 21_000).phase).toBe('closed');
    expect(() => applyCommand(s, { action: 'quiz-start', slideId: 30 }, slides)).toThrow(CommandError);
    s = applyCommand(s, { action: 'quiz-reveal', slideId: 30 }, slides, 8000);
    expect(s.quiz[30]).toMatchObject({ phase: 'closed', revealed: true, closesAt: 8000 });
    expect(s.resultsVisible).toBe(true);
  });

  it('verändert den übergebenen Zustand nicht', () => {
    const s = initialRunState(10);
    applyCommand(s, { action: 'lock', slideId: 10, locked: true }, slides);
    expect(s.locked).toEqual([]);
  });

  it('Animationen: Weiter deckt erst auf, dann nächste Folie; Zurück landet im Endzustand', () => {
    const steps = new Map([[10, 2]]);
    let s = initialRunState(10);
    s = applyCommand(s, { action: 'step', delta: 1 }, slides, 0, steps);
    expect([s.slideId, s.build?.[10]]).toEqual([10, 1]);
    s = applyCommand(s, { action: 'step', delta: 1 }, slides, 0, steps);
    expect([s.slideId, s.build?.[10]]).toEqual([10, 2]);
    s = applyCommand(s, { action: 'step', delta: 1 }, slides, 0, steps);
    expect([s.slideId, s.build?.[20]]).toEqual([20, 0]);
    s = applyCommand(s, { action: 'step', delta: -1 }, slides, 0, steps);
    expect([s.slideId, s.build?.[10]]).toEqual([10, 2]);
    s = applyCommand(s, { action: 'step', delta: -1 }, slides, 0, steps);
    expect([s.slideId, s.build?.[10]]).toEqual([10, 1]);
    s = applyCommand(s, { action: 'goto', slideId: 10 }, slides, 0, steps);
    expect(s.build?.[10]).toBe(0);
  });

  it('Schwarzbild: an, Weiß, und Blättern beendet es', () => {
    let s = initialRunState(10);
    s = applyCommand(s, { action: 'blank', mode: 'black' }, slides);
    expect(s.blank).toBe('black');
    s = applyCommand(s, { action: 'blank', mode: 'white' }, slides);
    expect(s.blank).toBe('white');
    s = applyCommand(s, { action: 'step', delta: 1 }, slides);
    expect(s.blank).toBeNull();
  });

  it('Sprung zu Folie per Nummer, Ende und Anfang', () => {
    let s = initialRunState(10);
    s = applyCommand(s, { action: 'jump', index: -1 }, slides);
    expect(s.slideId).toBe(slides.at(-1));
    s = applyCommand(s, { action: 'jump', index: 999 }, slides);
    expect(s.slideId).toBe(slides.at(-1));
    s = applyCommand(s, { action: 'jump', index: 0 }, slides);
    expect(s.slideId).toBe(slides[0]);
  });
});

describe('Workshop-Befehle', () => {
  it('startet und beendet den Countdown', () => {
    let s = applyCommand(initialRunState(10), { action: 'countdown', seconds: 300 }, slides, 1000);
    expect(s.countdown).toEqual({ endsAt: 301_000, seconds: 300 });
    s = applyCommand(s, { action: 'countdown', seconds: null }, slides);
    expect(s.countdown).toBeNull();
  });

  it('setzt die Rechte der Teilnehmenden je Folie', () => {
    const s = applyCommand(initialRunState(10), { action: 'board-rights', slideId: 20, rights: 'all' }, slides);
    expect(boardRights(s, { id: 20, config: { rights: 'host' } })).toBe('all');
    expect(boardRights(s, { id: 30, config: { rights: 'own' } })).toBe('own');
    expect(() => applyCommand(s, { action: 'board-rights', slideId: 99, rights: 'all' }, slides)).toThrow(CommandError);
  });
});

describe('Ablaufplan', () => {
  const schedule = new Map<number, SlideSchedule>([
    [
      20,
      {
        plannedMinutes: null,
        autoCountdown: true,
        phases: [
          { label: 'Gespräch', minutes: 15 },
          { label: 'Rollenwechsel', minutes: 15 },
        ],
      },
    ],
    [30, { plannedMinutes: 5, phases: [], autoCountdown: false }],
  ]);
  const noBuilds = new Map<number, number>();

  it('startet den Countdown mit Phasen beim Betreten (goto, step, jump)', () => {
    for (const cmd of [
      { action: 'goto', slideId: 20 },
      { action: 'step', delta: 1 },
      { action: 'jump', index: 1 },
    ] as const) {
      const s = applyCommand(initialRunState(10), cmd, slides, 1000, noBuilds, schedule);
      expect(s.slideId).toBe(20);
      expect(s.countdown).toEqual({
        endsAt: 1000 + 30 * 60_000,
        seconds: 1800,
        phases: [
          { label: 'Gespräch', seconds: 900 },
          { label: 'Rollenwechsel', seconds: 900 },
        ],
      });
    }
  });

  it('startet nicht neu, wenn die Folie schon aktiv ist, und stoppt beim Verlassen nicht', () => {
    let s = applyCommand(initialRunState(10), { action: 'goto', slideId: 20 }, slides, 1000, noBuilds, schedule);
    const running = s.countdown;
    s = applyCommand(s, { action: 'goto', slideId: 20 }, slides, 5000, noBuilds, schedule);
    expect(s.countdown).toEqual(running);
    // Folie 30 hat keinen Auto-Start: Countdown läuft weiter
    s = applyCommand(s, { action: 'step', delta: 1 }, slides, 6000, noBuilds, schedule);
    expect(s.slideId).toBe(30);
    expect(s.countdown).toEqual(running);
  });

  it('ohne Ablaufplan bleibt alles wie bisher', () => {
    const s = applyCommand(initialRunState(10), { action: 'goto', slideId: 20 }, slides, 1000);
    expect(s.countdown).toBeUndefined();
  });

  it('startet den Countdown einer Folie von Hand und verlängert ihn', () => {
    let s = applyCommand(initialRunState(10), { action: 'countdown-slide', slideId: 30 }, slides, 1000, noBuilds, schedule);
    expect(s.countdown).toEqual({ endsAt: 301_000, seconds: 300 });
    s = applyCommand(s, { action: 'countdown-extend', seconds: 60 }, slides, 2000, noBuilds, schedule);
    expect(s.countdown).toEqual({ endsAt: 361_000, seconds: 360 });
    expect(() => applyCommand(s, { action: 'countdown-slide', slideId: 10 }, slides, 1000, noBuilds, schedule)).toThrow(CommandError);
    expect(() => applyCommand(initialRunState(10), { action: 'countdown-extend', seconds: 60 }, slides)).toThrow(CommandError);
  });
});
