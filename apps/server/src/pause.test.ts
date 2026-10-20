import { hostCommand, initialRunState, pauseVoteInput, type RunState } from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { applyPauseVote, participantPause, pauseStats } from './pause.ts';
import { applyCommand, CommandError } from './runs.ts';

const slides = [10, 20, 30];
const now = 1_000_000;

const paused = (seconds = 600, question = true): RunState =>
  applyCommand(initialRunState(10), { action: 'pause-start', seconds, question }, slides, now);

describe('Pausenmodus', () => {
  it('startet mit Dauer, leert Rückmeldungen und beendet das Schwarzbild', () => {
    let s: RunState = { ...initialRunState(10), blank: 'black', pauseVotes: { 7: { ready: true } } };
    s = applyCommand(s, { action: 'pause-start', seconds: 600, question: true }, slides, now);
    expect(s.pause).toEqual({ endsAt: now + 600_000, seconds: 600, question: true });
    expect(s.pauseVotes).toEqual({});
    expect(s.blank).toBeNull();
  });

  it('verlängert ab dem Ende – oder ab jetzt, wenn die Pause schon abgelaufen ist', () => {
    let s = paused(600);
    s = applyCommand(s, { action: 'pause-extend', seconds: 300 }, slides, now + 1000);
    expect(s.pause).toMatchObject({ endsAt: now + 900_000, seconds: 900 });
    const later = now + 2_000_000;
    s = applyCommand(s, { action: 'pause-extend', seconds: 300 }, slides, later);
    expect(s.pause).toMatchObject({ endsAt: later + 300_000, seconds: 1200 });
  });

  it('verlängern ohne Pause ist ein Fehler', () => {
    expect(() => applyCommand(initialRunState(10), { action: 'pause-extend', seconds: 300 }, slides, now)).toThrow(CommandError);
  });

  it('„Pause beenden“ verwirft Pause und Rückmeldungen', () => {
    let s = applyPauseVote(paused(), 7, { ready: true });
    s = applyCommand(s, { action: 'pause-end' }, slides, now);
    expect(s.pause).toBeNull();
    expect(s.pauseVotes).toBeUndefined();
  });

  it.each([
    { action: 'step', delta: 1 },
    { action: 'step', delta: -1 },
    { action: 'goto', slideId: 30 },
    { action: 'jump', index: 2 },
  ] as const)('Blättern beendet die Pause ($action)', (cmd) => {
    const s = applyCommand(applyPauseVote(paused(), 7, { energy: 3 }), cmd, slides, now);
    expect(s.pause).toBeNull();
    expect(s.pauseVotes).toBeUndefined();
  });

  it('Blättern während der Pause wechselt wie gewohnt die Folie', () => {
    const s = applyCommand(paused(), { action: 'step', delta: 1 }, slides, now);
    expect(s.slideId).toBe(20);
  });

  it('andere Befehle lassen die Pause laufen', () => {
    let s = paused();
    s = applyCommand(s, { action: 'results', visible: false }, slides, now);
    s = applyCommand(s, { action: 'countdown', seconds: 60 }, slides, now);
    expect(s.pause).not.toBeNull();
  });

  it('Befehle prüfen Dauer und setzen Vorgaben', () => {
    expect(hostCommand.safeParse({ action: 'pause-start', seconds: 30 }).success).toBe(false);
    expect(hostCommand.parse({ action: 'pause-start', seconds: 300 })).toEqual({ action: 'pause-start', seconds: 300, question: true });
    expect(hostCommand.parse({ action: 'pause-extend' })).toEqual({ action: 'pause-extend', seconds: 300 });
  });
});

describe('Rückmeldungen in der Pause', () => {
  it('führt „wieder da“ und Energie zusammen und lässt Änderungen zu', () => {
    let s = applyPauseVote(paused(), 7, { energy: 2 });
    s = applyPauseVote(s, 7, { ready: true });
    s = applyPauseVote(s, 7, { energy: 4 });
    expect(participantPause(s, 7)?.vote).toEqual({ energy: 4, ready: true });
    expect(participantPause(s, 8)?.vote).toBeNull();
  });

  it('nur während einer Pause und Energie nur mit Frage', () => {
    expect(() => applyPauseVote(initialRunState(10), 7, { ready: true })).toThrow(CommandError);
    expect(() => applyPauseVote(paused(600, false), 7, { energy: 3 })).toThrow(CommandError);
    expect(() => applyPauseVote(paused(600, false), 7, { ready: true })).not.toThrow();
  });

  it('prüft die Eingabe', () => {
    expect(pauseVoteInput.safeParse({}).success).toBe(false);
    expect(pauseVoteInput.safeParse({ energy: 6 }).success).toBe(false);
    expect(pauseVoteInput.safeParse({ energy: 2.5 }).success).toBe(false);
    expect(pauseVoteInput.safeParse({ ready: false }).success).toBe(true);
  });

  it('fasst für das Steuerpult zusammen', () => {
    let s = paused();
    s = applyPauseVote(s, 1, { energy: 5, ready: true });
    s = applyPauseVote(s, 2, { energy: 2 });
    s = applyPauseVote(s, 3, { ready: true });
    s = applyPauseVote(s, 4, { ready: false });
    expect(pauseStats(s, 12)).toEqual({ ready: 2, connected: 12, energy: [0, 1, 0, 0, 1], energyAverage: 3.5 });
    expect(pauseStats(initialRunState(10), 12)).toBeNull();
  });
});
