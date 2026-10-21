import { describe, expect, it } from 'vitest';
import {
  batchSlides,
  blockSlides,
  BUILTIN_BLOCKS,
  expectationsBoard,
  MAX_BATCH_SLIDES,
  PAIR_INTERVIEW_PHASES,
  uniqueBoardName,
} from './blocks.ts';
import { schedulePhases } from './schedule.ts';
import { fakePostText, fakeResponse } from './rehearsal.ts';
import { isResponseType, validateResponse } from './responses.ts';
import { CREATABLE_SLIDE_TYPES, defaultConfig, parseConfig, slideConfigSchemas, type SlideConfigs, type SlideType } from './slides.ts';

/** Reproduzierbarer Zufall für die Tests */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('Übungsbausteine', () => {
  it('haben eindeutige Kennungen und gültige Folien (parseConfig, Batch-Schema)', () => {
    expect(new Set(BUILTIN_BLOCKS.map((b) => b.id)).size).toBe(BUILTIN_BLOCKS.length);
    for (const block of BUILTIN_BLOCKS) {
      const slides = blockSlides(block);
      expect(slides.length).toBeGreaterThan(0);
      expect(slides.length).toBeLessThanOrEqual(MAX_BATCH_SLIDES);
      expect(batchSlides.safeParse(slides).success).toBe(true);
      for (const s of slides) {
        expect(CREATABLE_SLIDE_TYPES).toContain(s.type);
        expect(() => parseConfig(s.type, s.config)).not.toThrow();
      }
    }
  });

  it('Kartenwand-Bausteine nutzen durchgehend den gewählten Wand-Namen (Parkplatz als eigene Wand)', () => {
    for (const block of BUILTIN_BLOCKS.filter((b) => b.board)) {
      const configs = blockSlides(block, 'Mein Workshop')
        .filter((s) => s.type === 'board')
        .map((s) => parseConfig('board', s.config));
      const main = configs.filter((c) => !c.anytime);
      expect(main.length).toBeGreaterThan(0);
      expect(new Set(main.map((c) => c.board))).toEqual(new Set(['Mein Workshop']));
      for (const c of configs.filter((c) => c.anytime)) expect(c.board).not.toBe('Mein Workshop');
    }
  });

  it('Zusatzwände werden gegen vorhandene Wände eindeutig gemacht', () => {
    const block = BUILTIN_BLOCKS.find((b) => b.id === 'obstacles-v3')!;
    const parking = blockSlides(block, 'Parkplatz', { boards: ['Parkplatz 2'] })
      .map((s) => (s.type === 'board' ? parseConfig('board', s.config) : null))
      .find((c) => c?.anytime)!;
    expect(parking.board).toBe('Parkplatz 3');
  });

  it('„Hindernisse v3“: Paare mit Phasen, Sammeln S–XL, Parkplatz, Clustern, Punkte, Einordnen, Tabelle', () => {
    const block = BUILTIN_BLOCKS.find((b) => b.id === 'obstacles-v3')!;
    const slides = blockSlides(block);
    expect(slides.map((s) => s.type)).toEqual(['teams', 'board', 'board', 'board', 'board', 'board', 'board']);
    const teams = slides[0]!;
    expect(teams.schedule?.autoCountdown).toBe(true);
    expect(teams.schedule?.phases?.map((p) => p.minutes)).toEqual([5, 12, 5, 3, 12, 5, 3]);
    expect(schedulePhases.safeParse(PAIR_INTERVIEW_PHASES).success).toBe(true);
    expect(parseConfig('teams', teams.config).tags.length).toBeGreaterThan(1);
    const [collect, parking, cluster, dots, choose, table] = slides.slice(1).map((s) => parseConfig('board', s.config));
    expect(collect).toMatchObject({ mode: 'collect', maxCards: 5, tags: ['S', 'M', 'L', 'XL'], startHidden: true, anytime: false });
    expect(parking).toMatchObject({ mode: 'collect', anytime: true, board: 'Parkplatz' });
    expect(cluster).toMatchObject({ mode: 'cluster', rights: 'host', showUnsorted: true });
    expect(dots).toMatchObject({ mode: 'dots', dots: 3, targets: 'groups' });
    expect(choose).toMatchObject({
      mode: 'choose',
      top: 5,
      targets: 'groups',
      multi: true,
      choices: ['Zeit', 'Qualität', 'Umsatz', 'Kunde'],
    });
    expect(table).toMatchObject({ mode: 'table', columns: ['Lösungsrichtung', 'Verantwortlich', 'Nächster Schritt', 'Bis'] });
  });

  it('Feedbackrunde blickt auf die (ggf. umbenannte) Erwartungswand zurück', () => {
    expect(expectationsBoard([])).toBe('Erwartungen');
    expect(expectationsBoard(['Hindernisse', 'erwartungen', 'Erwartungen 2', 'Parkplatz'])).toBe('Erwartungen 2');
    expect(expectationsBoard(['Erwartungshaltung'])).toBe('Erwartungen');
    const block = BUILTIN_BLOCKS.find((b) => b.id === 'feedback')!;
    const [feedback, open] = blockSlides(block, undefined, { boards: ['Erwartungen 2'] });
    expect(parseConfig('feedback', feedback!.config)).toMatchObject({
      recall: 'Erwartungen 2',
      withComment: true,
      commentLabel: 'Was nimmst du mit?',
    });
    expect(open!.type).toBe('open');
    // Die Erwartungsrunde legt genau diese Wand an
    const expectations = BUILTIN_BLOCKS.find((b) => b.id === 'expectations')!;
    expect(expectations.board).toBe('Erwartungen');
    expect(parseConfig('board', blockSlides(expectations)[0]!.config)).toMatchObject({ mode: 'collect', board: 'Erwartungen' });
  });

  it('das Batch-Schema nimmt einen optionalen Ablaufplan an', () => {
    const parsed = batchSlides.parse([{ type: 'content', schedule: { phases: [{ label: 'A', minutes: 5 }], autoCountdown: true } }]);
    expect(parsed[0]!.schedule).toEqual({ plannedMinutes: null, phases: [{ label: 'A', minutes: 5 }], autoCountdown: true });
    expect(batchSlides.parse([{ type: 'content' }])[0]!.schedule).toBeUndefined();
    expect(batchSlides.safeParse([{ type: 'content', schedule: { phases: [{ label: 'A', minutes: 0 }] } }]).success).toBe(false);
  });

  it('„Hindernisse → Themen → Top 3“ deckt Sammeln, Clustern, Punkte, Bewerten und Tabelle ab', () => {
    const block = BUILTIN_BLOCKS.find((b) => b.id === 'obstacles')!;
    const configs = blockSlides(block).map((s) => parseConfig('board', s.config));
    expect(configs.map((c) => c.mode)).toEqual(['collect', 'cluster', 'dots', 'rate', 'table']);
    expect(configs[1]!.rights).toBe('own');
    expect(configs[2]!.dots).toBe(3);
    expect(configs[3]!.top).toBe(5);
    expect(configs[3]!.scales).toEqual([{ label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'] }]);
  });

  it('Wand-Namen werden eindeutig gemacht', () => {
    expect(uniqueBoardName('Hindernisse', [])).toBe('Hindernisse');
    expect(uniqueBoardName('Hindernisse', ['hindernisse'])).toBe('Hindernisse 2');
    expect(uniqueBoardName('Hindernisse', ['Hindernisse', 'Hindernisse 2'])).toBe('Hindernisse 3');
    expect(uniqueBoardName('  ', [])).toBe('Karten');
  });

  it('das Batch-Schema lehnt importierte Bild-Folien und zu viele Folien ab', () => {
    expect(batchSlides.safeParse([{ type: 'image', config: {} }]).success).toBe(false);
    expect(batchSlides.safeParse([]).success).toBe(false);
    expect(batchSlides.safeParse(Array.from({ length: MAX_BATCH_SLIDES + 1 }, () => ({ type: 'content' }))).success).toBe(false);
  });
});

describe('Probelauf: Zufallsantworten', () => {
  const variants: { type: SlideType; config: unknown }[] = [
    ...CREATABLE_SLIDE_TYPES.map((type) => ({ type, config: {} })),
    { type: 'choice', config: { options: ['A', 'B', 'C', 'D'], multiple: true } },
    { type: 'scale', config: { max: 7 } },
    { type: 'scale', config: { max: 10 } },
    { type: 'wordcloud', config: { maxWords: 3 } },
    { type: 'quiz', config: { options: ['A', 'B', 'C'], correct: [1, 2] } },
    { type: 'feedback', config: { withComment: false } },
    { type: 'teams', config: { tags: ['Vertrieb', 'Technik'] } },
    { type: 'board', config: { mode: 'dots', dots: 3 } },
    { type: 'board', config: { mode: 'dots', dots: 5, stack: false } },
    { type: 'board', config: { mode: 'dots', dots: 5, stack: false, targets: 'cards' } },
    { type: 'board', config: { mode: 'rate' } },
    {
      type: 'board',
      config: {
        mode: 'rate',
        scales: [
          { label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'] },
          { label: 'Aufwand', levels: ['gering', 'hoch'] },
        ],
      },
    },
  ];
  const targets = ['c1', 'c2', 'g3'];

  it('bestehen validateResponse für jeden Folientyp mit Antworten', () => {
    const random = seeded(42);
    for (const v of variants) {
      if (!isResponseType(v.type)) continue;
      const config = parseConfig(v.type, v.config) as SlideConfigs[typeof v.type];
      const isBoardAnswer = v.type !== 'board' || ['dots', 'rate'].includes((config as SlideConfigs['board']).mode);
      for (let i = 0; i < 200; i++) {
        const payload = fakeResponse(v.type, config as never, random, targets);
        if (!isBoardAnswer) {
          expect(payload).toBeNull();
          continue;
        }
        expect(payload, `${v.type} ${JSON.stringify(v.config)}`).not.toBeNull();
        const result = validateResponse(v.type, config as never, payload);
        expect(result.ok, `${v.type} ${JSON.stringify(payload)}`).toBe(true);
      }
    }
  });

  it('Kartenwand ohne Einträge liefert keine Antwort', () => {
    expect(fakeResponse('board', parseConfig('board', { mode: 'dots' }), seeded(1), [])).toBeNull();
  });

  it('Beispieltexte passen in jede Karte', () => {
    const random = seeded(7);
    for (const type of Object.keys(slideConfigSchemas) as SlideType[]) {
      const text = fakePostText(type, random);
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(Math.min(300, defaultConfig('open').maxLength));
    }
  });
});
