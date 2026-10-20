import { z } from 'zod';
import type { ResponsePayloads, ResponseSlideType } from './responses.ts';
import type { SlideConfigs, SlideType } from './slides.ts';

/**
 * Probelauf: simulierte Teilnehmende mit Zufallsantworten, damit Gruppen,
 * Kartenwand, Punkte und Ergebnisse vorher durchgespielt werden können. Die
 * Antworten laufen auf dem Server durch dieselbe Prüfung (`validateResponse`)
 * wie echte.
 */

type Random = () => number;

/** Höchstzahl simulierter Teilnehmender pro Probelauf */
export const MAX_FAKE_PARTICIPANTS = 200;

export const fakeInput = z.object({
  /** Neue Testteilnehmende anlegen (0 = keine) */
  add: z.number().int().min(0).max(50).default(0),
  /** Alle Testteilnehmenden beantworten die aktuelle Folie (wer schon geantwortet hat, nicht noch einmal) */
  answer: z.boolean().default(false),
});
export type FakeInput = z.infer<typeof fakeInput>;

export const fakeName = (n: number) => `Test ${n}`;

const pick = <T>(items: readonly T[], random: Random): T => items[Math.floor(random() * items.length)]!;
const int = (min: number, max: number, random: Random) => min + Math.floor(random() * (max - min + 1));

function shuffled<T>(items: T[], random: Random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const WORDS = ['neugierig', 'müde', 'motiviert', 'gespannt', 'entspannt', 'wach', 'offen', 'gestresst', 'fröhlich', 'konzentriert'];
const SENTENCE_WORDS = ['plötzlich', 'alles', 'brennt', 'Kaffee', 'fehlt', 'heute', 'niemand', 'lacht', 'wieder', 'Montag'];
const COMMENTS = ['Gern wieder', 'Etwas zu lang', 'Sehr hilfreich', 'Mehr Beispiele wären gut', ''];
const TEXTS = [
  'Zu viele Abstimmungsrunden',
  'Unklare Zuständigkeiten',
  'Informationen kommen zu spät an',
  'Tools passen nicht zusammen',
  'Zu wenig Zeit für Wichtiges',
  'Ziele ändern sich ständig',
  'Meetings ohne Ergebnis',
  'Wissen steckt in einzelnen Köpfen',
  'Fehlendes Feedback',
  'Prozesse sind nicht dokumentiert',
  'Entscheidungen dauern zu lange',
  'Zu viele E-Mails',
];
const QUESTIONS = [
  'Wie geht es danach weiter?',
  'Gibt es die Folien hinterher?',
  'Welches Beispiel war das genau?',
  'Wie messen wir den Erfolg?',
  'Wer ist Ansprechperson?',
];

/**
 * Zufallsantwort für eine Folie, auf die mit einer Antwort (nicht mit Karten)
 * reagiert wird. `targets` sind bei der Kartenwand die Einträge der Folie.
 * Gibt null zurück, wenn es auf dieser Folie nichts zu antworten gibt.
 */
export function fakeResponse<T extends ResponseSlideType>(
  type: T,
  config: SlideConfigs[T],
  random: Random = Math.random,
  targets: string[] = [],
): ResponsePayloads[T] | null {
  const out = (v: unknown) => v as ResponsePayloads[T];
  switch (type) {
    case 'choice': {
      const c = config as SlideConfigs['choice'];
      const all = c.options.map((_, i) => i);
      if (!c.multiple) return out({ choices: [pick(all, random)] });
      return out({ choices: shuffled(all, random).slice(0, int(1, all.length, random)) });
    }
    case 'scale': {
      // Leicht zur Mitte und nach oben verschoben – wirkt wie echte Rückmeldungen
      const c = config as SlideConfigs['scale'];
      const v = Math.round(((random() + random() + random()) / 3) * (c.max - 1) + 1 + random() * 0.8);
      return out({ value: Math.min(c.max, Math.max(1, v)) });
    }
    case 'wordcloud': {
      const c = config as SlideConfigs['wordcloud'];
      return out({ words: shuffled(WORDS, random).slice(0, int(1, c.maxWords, random)) });
    }
    case 'ranking': {
      const c = config as SlideConfigs['ranking'];
      return out({
        order: shuffled(
          c.options.map((_, i) => i),
          random,
        ),
      });
    }
    case 'quiz': {
      const c = config as SlideConfigs['quiz'];
      // Gut die Hälfte liegt richtig
      const choice = random() < 0.55 ? pick(c.correct, random) : int(0, c.options.length - 1, random);
      return out({ choice });
    }
    case 'feedback':
      return out({ rating: int(3, 5, random), comment: pick(COMMENTS, random) });
    case 'sentence':
      return out({ word: pick(SENTENCE_WORDS, random) });
    case 'teams': {
      const c = config as SlideConfigs['teams'];
      return out({ tag: c.tags.length > 0 ? int(0, c.tags.length - 1, random) : null });
    }
    case 'board': {
      const c = config as SlideConfigs['board'];
      if (targets.length === 0) return null;
      if (c.mode === 'dots') {
        const dots: Record<string, number> = {};
        const keys = c.stack ? targets : shuffled(targets, random);
        for (let i = 0; i < c.dots; i++) {
          const key = c.stack ? pick(keys, random) : keys[i];
          if (key === undefined) break;
          dots[key] = (dots[key] ?? 0) + 1;
        }
        return out({ dots });
      }
      if (c.mode === 'rate') {
        const ratings: Record<string, (number | null)[]> = {};
        for (const key of targets) ratings[key] = c.scales.map((s) => int(0, s.levels.length - 1, random));
        return out({ ratings });
      }
      return null;
    }
  }
  return null;
}

/** Beispieltext für eine Karte oder einen Beitrag (offene Antworten, Brainstorming, Pinnwand, Q&A, Kartenwand). */
export function fakePostText(type: SlideType, random: Random = Math.random): string {
  if (type === 'qa') return pick(QUESTIONS, random);
  return pick(TEXTS, random);
}
