import { describe, expect, it } from 'vitest';
import { publicProtocol } from './protocol.ts';

type Data = Parameters<typeof publicProtocol>[0];

const ASSET = 'A'.repeat(32);

function run(): Data {
  const base = { note: null, results: null, responses: 0, posts: [], sentence: null, quiz: null, board: null, teams: null };
  return {
    id: 7,
    presentationId: 3,
    title: 'Workshop',
    startedAt: new Date('2026-03-01T09:00:00Z'),
    endedAt: new Date('2026-03-01T11:00:00Z'),
    participants: 2,
    brand: null,
    protocol: { url: '/p/geheim', names: true, slides: true },
    slides: [
      {
        ...base,
        id: 41,
        type: 'image',
        typeLabel: 'Folie',
        headline: 'Einstieg',
        config: {
          asset: ASSET,
          width: 1920,
          height: 1080,
          title: 'Einstieg',
          builds: { enabled: true, steps: 1, regions: [] },
        },
      },
      {
        ...base,
        id: 42,
        type: 'qa',
        typeLabel: 'Q&A',
        headline: 'Fragen?',
        config: { question: 'Fragen?' },
        responses: 2,
        posts: [
          { id: 900, authorName: 'Anna', text: 'Wann geht es weiter?', column: null, status: 'visible', votes: 1 },
          { id: 901, authorName: 'Ben', text: 'ausgeblendet', column: null, status: 'hidden', votes: 0 },
        ],
      },
    ],
  } as unknown as Data;
}

describe('geteiltes Fotoprotokoll', () => {
  it('gibt ohne „Folien mitteilen“ keine Bildkennung heraus', () => {
    const data = publicProtocol(run(), true, false);
    expect(data.withSlides).toBe(false);
    expect(data.slides[0]!.config).toEqual({ title: 'Einstieg' });
    expect(JSON.stringify(data)).not.toContain(ASSET);
  });

  it('gibt mit „Folien mitteilen“ das Folienbild mit, aber keine Animationen', () => {
    const data = publicProtocol(run(), true, true);
    expect(data.withSlides).toBe(true);
    expect(data.slides[0]!.config).toEqual({ asset: ASSET, width: 1920, height: 1080, title: 'Einstieg' });
  });

  it('nummeriert neu und lässt interne IDs, Link und Ausgeblendetes weg', () => {
    const data = publicProtocol(run(), false, true);
    expect(data.slides.map((s) => s.id)).toEqual([1, 2]);
    expect(data.slides[1]!.posts).toEqual([
      { id: 1, authorName: null, text: 'Wann geht es weiter?', column: null, status: 'visible', votes: 1 },
    ]);
    const text = JSON.stringify(data);
    for (const leak of ['"presentationId"', '/p/geheim', '"notes"', '"quiz"']) expect(text).not.toContain(leak);
  });
});
