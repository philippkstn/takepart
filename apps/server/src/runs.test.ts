import { initialRunState, sentenceState, type RunState } from '@slides/shared';
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
