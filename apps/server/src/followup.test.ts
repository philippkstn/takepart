import { parseConfig, type BoardSummary, type SlideConfigs } from '@slides/shared';
import { describe, expect, it } from 'vitest';
import { followupSlides, MAX_FOLLOWUP_TOPICS, tableTopics } from './followup.ts';

describe('Folgetermin-Vorlage', () => {
  it('ohne Ergebnistabelle: Titel, Rückblick, Q&A', () => {
    const slides = followupSlides({ title: 'Strategie', date: '3. März 2026', participants: 12, topics: [] });
    expect(slides.map((s) => s.type)).toEqual(['content', 'content', 'qa']);
    expect(slides[0]!.config.title).toBe('Follow-up: Strategie');
    expect(slides[1]!.config.body).toBe('Termin: 3. März 2026\nTeilnehmende: 12');
  });

  it('je Thema eine Textfolie mit den Feldern und eine Skala', () => {
    const slides = followupSlides({
      title: 'Workshop',
      date: '1. Juni 2026',
      participants: 8,
      topics: [
        {
          label: 'Onboarding',
          fields: [
            { column: 'Verantwortlich', value: 'Anna' },
            { column: 'Nächster Schritt', value: '' },
          ],
        },
        { label: 'onboarding ', fields: [] },
        { label: 'Werkzeuge', fields: [] },
      ],
    });
    expect(slides.map((s) => s.type)).toEqual(['content', 'content', 'content', 'scale', 'content', 'scale', 'qa']);
    expect(slides[1]!.config.body).toContain('– Onboarding\n– Werkzeuge');
    expect(slides[2]!.config).toMatchObject({ title: 'Onboarding', body: 'Verantwortlich: Anna\nNächster Schritt: –' });
    expect(slides[3]!.config.question).toBe('Wie weit sind wir bei „Onboarding“?');
    expect(slides[4]!.config.body).toBe('Was ist seitdem passiert?');
    // Alles muss durch die Folien-Schemas passen
    for (const s of slides) expect(() => parseConfig(s.type, s.config)).not.toThrow();
  });

  it('kürzt lange Texte und begrenzt die Zahl der Themen', () => {
    const long = 'x'.repeat(400);
    const slides = followupSlides({
      title: long,
      date: 'heute',
      participants: 1,
      topics: Array.from({ length: 15 }, (_, i) => ({ label: `${long}${i}`, fields: [{ column: 'Notiz', value: long.repeat(10) }] })),
    });
    expect(slides.filter((s) => s.type === 'scale')).toHaveLength(MAX_FOLLOWUP_TOPICS);
    for (const s of slides) expect(() => parseConfig(s.type, s.config)).not.toThrow();
  });

  it('liest Themen aus der Ergebnistabelle (Gruppen und Karten)', () => {
    const config = parseConfig('board', { mode: 'table', columns: ['Wer', 'Bis wann'] }) as SlideConfigs['board'];
    const board = {
      view: {
        groups: [{ id: 7, name: 'Kommunikation', cards: 2 }],
        rows: [
          { key: 'g7', fields: ['Ben', 'Mai'] },
          { key: 'c3', fields: ['', ''] },
        ],
      },
      cards: [{ id: 3, text: 'Mehr Pausen' }],
    } as unknown as BoardSummary;
    expect(tableTopics(config, board)).toEqual([
      {
        label: 'Kommunikation',
        fields: [
          { column: 'Wer', value: 'Ben' },
          { column: 'Bis wann', value: 'Mai' },
        ],
      },
      {
        label: 'Mehr Pausen',
        fields: [
          { column: 'Wer', value: '' },
          { column: 'Bis wann', value: '' },
        ],
      },
    ]);
  });
});
