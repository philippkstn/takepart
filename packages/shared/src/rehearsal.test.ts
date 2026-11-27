import { describe, expect, it } from 'vitest';
import { fakeName, simCardsDue, simDelay, SIM_MAX, SIM_MIN, simAudienceSize } from './rehearsal.ts';

/**
 * Simuliertes Publikum im Probelauf – wie es schiefgehen kann:
 * - Ein Neustart oder ein zweiter Takt plant neu → Antworten doppelt oder springen (muss deterministisch sein)
 * - Alle antworten im selben Moment → wirkt nicht wie ein Publikum
 * - Fast niemand antwortet oder wirklich alle → beides unecht
 * - Quizantworten nach Ablauf der Zeit → der Server verwirft sie, das Quiz bleibt leer
 * - Bei Q&A fragt jede Person → Fragenflut
 * - Dieselben Personen sind auf jeder Folie zuerst dran
 * - Karten erscheinen auf einmal statt nacheinander, oder es werden später weniger
 * - Doppelte Namen
 */

const ids = Array.from({ length: 40 }, (_, i) => 1000 + i);
const key = (participant: number, slide = 7, round = 1) => ({ run: 3, slide, round, participant });

describe('Zeitplan des simulierten Publikums', () => {
  it('ist für dieselbe Person, Folie und Runde immer gleich', () => {
    for (const p of ids) {
      expect(simDelay('vote', key(p))).toBe(simDelay('vote', key(p)));
      expect(simCardsDue('text', key(p), 45_000, 3)).toBe(simCardsDue('text', key(p), 45_000, 3));
    }
  });

  it('verteilt Abstimmungen über die Zeit, die meisten antworten innerhalb einer Minute', () => {
    const delays = ids.map((p) => simDelay('vote', key(p)));
    const answering = delays.filter((d): d is number => d !== null);
    expect(answering.length).toBeGreaterThanOrEqual(32);
    expect(answering.length).toBeLessThan(40);
    expect(answering.filter((d) => d < 3000).length).toBeLessThan(answering.length / 4);
    expect(answering.filter((d) => d <= 60_000).length).toBeGreaterThanOrEqual(answering.length * 0.8);
    expect(new Set(answering.map((d) => Math.round(d / 1000))).size).toBeGreaterThan(10);
  });

  it('beantwortet ein Quiz nur innerhalb der Zeit', () => {
    for (const slide of [1, 2, 3])
      for (const p of ids) {
        const d = simDelay('quiz', key(p, slide), 20);
        if (d !== null) expect(d).toBeLessThan(20_000);
      }
  });

  it('lässt bei Q&A nur eine Minderheit fragen', () => {
    const asking = ids.filter((p) => simCardsDue('question', key(p), 10 * 60_000, 3) > 0);
    expect(asking.length).toBeGreaterThan(0);
    expect(asking.length).toBeLessThan(ids.length * 0.4);
  });

  it('mischt die Reihenfolge je Folie', () => {
    const order = (slide: number) =>
      ids
        .map((p) => [p, simDelay('vote', key(p, slide)) ?? Infinity] as const)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 5)
        .map(([p]) => p);
    expect(order(1)).not.toEqual(order(2));
  });

  it('schreibt Karten nacheinander und nimmt nie welche zurück', () => {
    let staggered = 0;
    for (const p of ids) {
      let before = 0;
      for (let t = 0; t <= 5 * 60_000; t += 1000) {
        const n = simCardsDue('text', key(p), t, 3);
        expect(n).toBeGreaterThanOrEqual(before);
        expect(n).toBeLessThanOrEqual(3);
        if (n - before > 1) staggered--;
        before = n;
      }
      if (before > 1) staggered++;
    }
    expect(staggered).toBeGreaterThan(0);
    expect(simCardsDue('text', key(ids[0]!), 0, 3)).toBe(0);
  });

  it('wählt eine Publikumsgröße zwischen 30 und 50', () => {
    for (let run = 1; run < 200; run++) {
      const n = simAudienceSize(run);
      expect(n).toBeGreaterThanOrEqual(SIM_MIN);
      expect(n).toBeLessThanOrEqual(SIM_MAX);
    }
  });

  it('vergibt keine doppelten Namen', () => {
    const names = Array.from({ length: 200 }, (_, i) => fakeName(i));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Simulierte Antworten', () => {
  // Gleichverteilte Antworten sehen auf dem Beamer nicht nach echtem Publikum aus
  it('haben bei Abstimmungen einen klaren Favoriten', async () => {
    const { fakeResponse } = await import('./rehearsal.ts');
    const { parseConfig } = await import('./slides.ts');
    const config = parseConfig('choice', { question: 'Welche Option?', options: ['A', 'B', 'C', 'D', 'E'] });
    let s = 9;
    const random = () => ((s = (s * 1664525 + 1013904223) % 4294967296), s / 4294967296);
    for (const seed of [1, 2, 3, 4, 5]) {
      const counts = [0, 0, 0, 0, 0];
      for (let i = 0; i < 40; i++) {
        const r = fakeResponse('choice', config, random, [], { seed, prompt: config.question });
        for (const c of r!.choices) counts[c]!++;
      }
      expect(Math.max(...counts)).toBeGreaterThan((40 / 5) * 1.5);
    }
  });

  it('passen Freitexte zur Frage', async () => {
    const { fakePostText } = await import('./rehearsal.ts');
    const qa = new Set(Array.from({ length: 30 }, (_, i) => fakePostText('qa', () => (i + 0.5) / 30, 'Eure Fragen')));
    for (const q of qa) expect(q.endsWith('?')).toBe(true);
    const words = Array.from({ length: 30 }, (_, i) => fakePostText('open', () => (i + 0.5) / 30, 'Was hindert uns heute?'));
    expect(words.some((w) => w.includes('?'))).toBe(false);
  });
});
