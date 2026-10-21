import type { Slide } from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { boardNames, isTurnsCommand } from './turns.ts';

const board = (id: number, name: string) => ({ id, type: 'board', config: { board: name } }) as unknown as Slide;

describe('Reihum auf dem Server', () => {
  it('kennt nur Reihum-Befehle', () => {
    expect(isTurnsCommand({ action: 'turns-clear' })).toBe(true);
    expect(isTurnsCommand({ action: 'pick-reset' })).toBe(false);
  });

  it('listet jede Wand einmal in Folienreihenfolge', () => {
    const slides = [board(1, 'Ideen'), { id: 2, type: 'text', config: {} } as unknown as Slide, board(3, 'Erwartungen'), board(4, 'Ideen')];
    expect(boardNames(slides)).toEqual(['Ideen', 'Erwartungen']);
  });
});
