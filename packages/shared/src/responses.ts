import { z } from 'zod';
import { BOARD_KEY } from './board.ts';
import type { SlideConfigs, SlideType } from './slides.ts';
import { validateSingleWord, validateTerm } from './words.ts';

/**
 * Antworten, die genau einmal pro Person (und Runde) gespeichert werden. Beiträge mit
 * Karten-Charakter (offene Antworten, Brainstorming, Pinnwand, Q&A) sind Posts,
 * siehe `postInput`.
 */
export const responsePayloads = {
  choice: z.object({ choices: z.array(z.number().int().min(0)).min(1).max(10) }),
  scale: z.object({ value: z.number().int().min(1).max(10) }),
  wordcloud: z.object({ words: z.array(z.string().max(60)).min(1).max(3) }),
  ranking: z.object({ order: z.array(z.number().int().min(0)).min(2).max(8) }),
  quiz: z.object({ choice: z.number().int().min(0) }),
  feedback: z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).default('') }),
  sentence: z.object({ word: z.string().max(60) }),
  /** Kartenwand: Punkte je Eintrag bzw. Stufe je Kriterium (null = nicht eingeschätzt) */
  board: z.object({
    dots: z.record(z.string().regex(BOARD_KEY), z.number().int().min(0).max(10)).optional(),
    ratings: z.record(z.string().regex(BOARD_KEY), z.array(z.number().int().min(0).max(6).nullable()).min(1).max(2)).optional(),
    /** Einordnen: gewählte Kategorien (Indizes in `choices`) je Eintrag */
    picks: z.record(z.string().regex(BOARD_KEY), z.array(z.number().int().min(0).max(7)).max(8)).optional(),
  }),
  /** Gruppen bilden: gewählte Kennzeichnung (null = keine Angabe) */
  teams: z.object({ tag: z.number().int().min(0).nullable() }),
} as const;

export type ResponseSlideType = keyof typeof responsePayloads;
export type ResponsePayloads = { [K in ResponseSlideType]: z.infer<(typeof responsePayloads)[K]> };

export function isResponseType(type: SlideType): type is ResponseSlideType {
  return type in responsePayloads;
}

/** Antworttypen, bei denen eine abgegebene Antwort nicht mehr geändert werden kann. */
export const FINAL_RESPONSE_TYPES: readonly ResponseSlideType[] = ['quiz', 'sentence'];

/**
 * Prüft eine Antwort gegen die Folienkonfiguration und gibt die bereinigte Fassung
 * zurück. Fehlermeldungen sind für Teilnehmende formuliert.
 */
export function validateResponse<T extends ResponseSlideType>(
  type: T,
  config: SlideConfigs[T],
  payload: unknown,
): { ok: true; value: ResponsePayloads[T] } | { ok: false; error: string } {
  const parsed = responsePayloads[type].safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Ungültige Antwort' };
  const value = parsed.data as ResponsePayloads[ResponseSlideType];

  switch (type) {
    case 'choice': {
      const c = config as SlideConfigs['choice'];
      const v = value as ResponsePayloads['choice'];
      const choices = [...new Set(v.choices)].sort((a, b) => a - b);
      if (choices.some((i) => i >= c.options.length)) return { ok: false, error: 'Unbekannte Option' };
      if (!c.multiple && choices.length !== 1) return { ok: false, error: 'Bitte genau eine Option wählen' };
      return { ok: true, value: { choices } as ResponsePayloads[T] };
    }
    case 'scale': {
      const c = config as SlideConfigs['scale'];
      const v = value as ResponsePayloads['scale'];
      if (v.value > c.max) return { ok: false, error: 'Wert außerhalb der Skala' };
      return { ok: true, value: v as ResponsePayloads[T] };
    }
    case 'wordcloud': {
      const c = config as SlideConfigs['wordcloud'];
      const v = value as ResponsePayloads['wordcloud'];
      const words: string[] = [];
      for (const raw of v.words) {
        if (!raw.trim()) continue;
        const r = validateTerm(raw);
        if (!r.ok) return r;
        words.push(r.word);
      }
      if (words.length === 0) return { ok: false, error: 'Bitte einen Begriff eingeben' };
      if (words.length > c.maxWords) return { ok: false, error: `Höchstens ${c.maxWords} Begriffe` };
      return { ok: true, value: { words } as ResponsePayloads[T] };
    }
    case 'ranking': {
      const c = config as SlideConfigs['ranking'];
      const v = value as ResponsePayloads['ranking'];
      const n = c.options.length;
      const valid = v.order.length === n && new Set(v.order).size === n && v.order.every((i) => i < n);
      if (!valid) return { ok: false, error: 'Bitte alle Optionen in eine Reihenfolge bringen' };
      return { ok: true, value: v as ResponsePayloads[T] };
    }
    case 'quiz': {
      const c = config as SlideConfigs['quiz'];
      const v = value as ResponsePayloads['quiz'];
      if (v.choice >= c.options.length) return { ok: false, error: 'Unbekannte Antwort' };
      return { ok: true, value: v as ResponsePayloads[T] };
    }
    case 'feedback': {
      const c = config as SlideConfigs['feedback'];
      const v = value as ResponsePayloads['feedback'];
      return { ok: true, value: { rating: v.rating, comment: c.withComment ? v.comment : '' } as ResponsePayloads[T] };
    }
    case 'sentence': {
      const v = value as ResponsePayloads['sentence'];
      const r = validateSingleWord(v.word);
      if (!r.ok) return r;
      return { ok: true, value: { word: r.word } as ResponsePayloads[T] };
    }
    case 'board': {
      const c = config as SlideConfigs['board'];
      const v = value as ResponsePayloads['board'];
      if (c.mode === 'dots') {
        const dots = Object.fromEntries(Object.entries(v.dots ?? {}).filter(([, n]) => n > 0));
        const sum = Object.values(dots).reduce((a, b) => a + b, 0);
        if (sum === 0) return { ok: false, error: 'Bitte mindestens einen Punkt vergeben' };
        if (sum > c.dots) return { ok: false, error: `Höchstens ${c.dots} Punkte` };
        if (!c.stack && Object.values(dots).some((n) => n > 1)) return { ok: false, error: 'Höchstens ein Punkt pro Eintrag' };
        return { ok: true, value: { dots } as ResponsePayloads[T] };
      }
      if (c.mode === 'rate') {
        // Nur Kriterien, die alle schätzen – die übrigen kommen aus den Karten bzw. von der Moderation
        if (!c.scales.some((s) => s.source === 'votes')) return { ok: false, error: 'Auf dieser Folie bewertet die Moderation' };
        const ratings: Record<string, (number | null)[]> = {};
        for (const [key, raw] of Object.entries(v.ratings ?? {})) {
          if (raw.length !== c.scales.length) return { ok: false, error: 'Ungültige Bewertung' };
          const values = raw.map((x, i) => (c.scales[i]!.source === 'votes' ? x : null));
          if (values.some((x, i) => x !== null && x >= c.scales[i]!.levels.length)) return { ok: false, error: 'Unbekannte Stufe' };
          if (values.some((x) => x !== null)) ratings[key] = values;
        }
        if (Object.keys(ratings).length === 0) return { ok: false, error: 'Bitte mindestens einen Eintrag einschätzen' };
        return { ok: true, value: { ratings } as ResponsePayloads[T] };
      }
      if (c.mode === 'choose') {
        const picks: Record<string, number[]> = {};
        for (const [key, values] of Object.entries(v.picks ?? {})) {
          const unique = [...new Set(values)].sort((a, b) => a - b);
          if (unique.some((x) => x >= c.choices.length)) return { ok: false, error: 'Unbekannte Kategorie' };
          if (!c.multi && unique.length > 1) return { ok: false, error: 'Nur eine Kategorie pro Eintrag' };
          if (unique.length > 0) picks[key] = unique;
        }
        if (Object.keys(picks).length === 0) return { ok: false, error: 'Bitte mindestens einen Eintrag einordnen' };
        return { ok: true, value: { picks } as ResponsePayloads[T] };
      }
      return { ok: false, error: 'Auf dieser Folie wird nicht abgestimmt' };
    }
    case 'teams': {
      const c = config as SlideConfigs['teams'];
      const v = value as ResponsePayloads['teams'];
      if (v.tag !== null && v.tag >= c.tags.length) return { ok: false, error: 'Unbekannte Auswahl' };
      return { ok: true, value: { tag: v.tag } as ResponsePayloads[T] };
    }
  }
  return { ok: false, error: 'Ungültige Antwort' };
}

export const postInput = z.object({
  text: z.string().trim().min(1, 'Bitte etwas eingeben').max(500, 'Höchstens 500 Zeichen'),
  column: z.number().int().min(0).max(4).optional(),
});

/** Eigene Karte einer Kartenwand ändern */
export const cardEditInput = z.object({
  text: z.string().trim().min(1, 'Bitte etwas eingeben').max(300, 'Höchstens 300 Zeichen'),
  column: z.number().int().min(0).max(4).nullable().optional(),
});
export type PostInput = z.infer<typeof postInput>;

export const participantName = z.string().trim().min(2, 'Bitte mindestens zwei Zeichen').max(40, 'Höchstens 40 Zeichen');
