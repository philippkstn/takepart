import { describe, expect, it } from 'vitest';
import { collectInk, emptyPendingInk, slideFrame, takeInk } from './ink.ts';

describe('collectInk/takeInk', () => {
  it('nimmt vom Zeiger nur die letzte Position', () => {
    const p = emptyPendingInk();
    collectInk(p, { type: 'pointer', x: 0.1, y: 0.1 });
    collectInk(p, { type: 'pointer', x: 0.2, y: 0.3 });
    expect(takeInk(p)).toEqual([{ type: 'pointer', x: 0.2, y: 0.3 }]);
  });

  it('Ausblenden nach Bewegung schickt nur das Ausblenden, Bewegung danach nur die Position', () => {
    const p = emptyPendingInk();
    collectInk(p, { type: 'pointer', x: 0.1, y: 0.1 });
    collectInk(p, { type: 'pointer-off' });
    expect(takeInk(p)).toEqual([{ type: 'pointer-off' }]);
    collectInk(p, { type: 'pointer-off' });
    collectInk(p, { type: 'pointer', x: 0.5, y: 0.5 });
    expect(takeInk(p)).toEqual([{ type: 'pointer', x: 0.5, y: 0.5 }]);
  });

  it('fasst Punkte desselben Strichs zusammen', () => {
    const p = emptyPendingInk();
    collectInk(p, { type: 'stroke', id: 'a', points: [[0, 0]], done: false });
    collectInk(p, { type: 'stroke', id: 'b', points: [[1, 1]], done: false });
    collectInk(p, {
      type: 'stroke',
      id: 'a',
      points: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
      done: true,
    });
    expect(takeInk(p)).toEqual([
      {
        type: 'stroke',
        id: 'a',
        points: [
          [0, 0],
          [0.1, 0.1],
          [0.2, 0.2],
        ],
        done: true,
      },
      { type: 'stroke', id: 'b', points: [[1, 1]], done: false },
    ]);
  });

  it('Löschen verwirft vorher gesammelte Striche und steht vorn', () => {
    const p = emptyPendingInk();
    collectInk(p, { type: 'stroke', id: 'a', points: [[0, 0]], done: false });
    collectInk(p, { type: 'pointer', x: 0.4, y: 0.4 });
    collectInk(p, { type: 'clear' });
    collectInk(p, { type: 'stroke', id: 'c', points: [[0.5, 0.5]], done: true });
    expect(takeInk(p)).toEqual([
      { type: 'clear' },
      { type: 'stroke', id: 'c', points: [[0.5, 0.5]], done: true },
      { type: 'pointer', x: 0.4, y: 0.4 },
    ]);
  });

  it('ist nach dem Herausnehmen leer', () => {
    const p = emptyPendingInk();
    collectInk(p, { type: 'clear' });
    takeInk(p);
    expect(takeInk(p)).toEqual([]);
  });
});

describe('slideFrame', () => {
  it('16:9 füllt die Bühne', () => {
    expect(slideFrame(1920, 1080)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('4:3 hat seitliche Ränder', () => {
    const f = slideFrame(1024, 768);
    expect(f.x).toBeCloseTo(0.125);
    expect(f.w).toBeCloseTo(0.75);
    expect(f.y).toBe(0);
    expect(f.h).toBe(1);
  });

  it('breiter als 16:9 hat Ränder oben und unten', () => {
    const f = slideFrame(2400, 1000);
    expect(f.w).toBe(1);
    expect(f.h).toBeCloseTo(16 / 9 / 2.4);
    expect(f.y).toBeCloseTo((1 - 16 / 9 / 2.4) / 2);
  });

  it('fällt ohne Maße auf die volle Bühne zurück', () => {
    expect(slideFrame(0, 0)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
