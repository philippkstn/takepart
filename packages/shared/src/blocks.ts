import { z } from 'zod';
import { CREATABLE_SLIDE_TYPES, type SlideType } from './slides.ts';

/**
 * Übungsbausteine: vordefinierte Folienfolgen, die der Editor mit einem Klick
 * hinter der gewählten Folie einfügt. Bausteine sind reine Daten – der Server
 * kennt sie nicht, er nimmt nur eine Liste von Folien entgegen
 * (`POST /api/presentations/:id/slides/batch`) und prüft jede mit `parseConfig`.
 */

export type CreatableSlideType = Exclude<SlideType, 'image'>;

export interface BlockSlide {
  type: CreatableSlideType;
  config: Record<string, unknown>;
  notes?: string;
}

export interface SlideBlock {
  id: string;
  name: string;
  description: string;
  /** Vorschlag für den Namen der Kartenwand – nur bei Bausteinen mit Kartenwand */
  board?: string;
  /** Folien des Bausteins; `board` ist der (eindeutig gemachte) Wand-Name */
  slides: (board: string) => BlockSlide[];
}

/** Höchstzahl Folien, die auf einmal eingefügt werden */
export const MAX_BATCH_SLIDES = 30;

/** Eine Folie für das gesammelte Einfügen (Bausteine, eigene Bausteine) */
export const batchSlide = z.object({
  type: z.enum(CREATABLE_SLIDE_TYPES),
  config: z.unknown().optional(),
  notes: z.string().max(20000).default(''),
});
export type BatchSlide = z.infer<typeof batchSlide>;
export const batchSlides = z
  .array(batchSlide)
  .min(1, 'Keine Folien')
  .max(MAX_BATCH_SLIDES, `Höchstens ${MAX_BATCH_SLIDES} Folien auf einmal`);

/** Eigener Baustein eines Kontos (gespeicherte Folienfolge) */
export const customBlockInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(100),
  slides: batchSlides,
});
export type CustomBlockInput = z.infer<typeof customBlockInput>;
export interface CustomBlock {
  id: number;
  name: string;
  slides: BatchSlide[];
}

/**
 * Wand-Namen eindeutig machen, damit ein zweiter Baustein nicht mit den Karten
 * eines ersten zusammenfällt: „Hindernisse“, „Hindernisse 2“, …
 */
export function uniqueBoardName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const clean = base.trim().slice(0, 55) || 'Karten';
  if (!used.has(clean.toLowerCase())) return clean;
  for (let i = 2; ; i++) {
    const name = `${clean} ${i}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

export const BUILTIN_BLOCKS: SlideBlock[] = [
  {
    id: 'checkin',
    name: 'Check-in',
    description: 'Wortwolke zum Ankommen',
    slides: () => [
      {
        type: 'wordcloud',
        config: { question: 'Mit welchem Wort kommst du heute an?', maxWords: 1 },
        notes: 'Kurz warten, bis die ersten Begriffe da sind, dann zwei oder drei große Wörter aufgreifen.',
      },
    ],
  },
  {
    id: 'expectations',
    name: 'Erwartungsrunde',
    description: 'Offene Antworten: Was muss heute passieren?',
    slides: () => [
      {
        type: 'open',
        config: { question: 'Was muss heute passieren, damit sich der Termin für dich gelohnt hat?', maxLength: 280 },
        notes:
          'Zwei Minuten Zeit geben. Danach einzelne Antworten groß einblenden und festhalten, worauf der Termin eingehen wird – und worauf nicht.',
      },
    ],
  },
  {
    id: 'obstacles',
    name: 'Hindernisse → Themen → Top 3',
    description: 'Kartenwand: sammeln, clustern, punkten, bewerten, Ergebnistabelle',
    board: 'Hindernisse',
    slides: (board) => [
      {
        type: 'board',
        config: { board, mode: 'collect', prompt: 'Was hindert uns heute daran, erfolgreicher zu sein?', maxCards: 5 },
        notes: 'Eine Idee pro Karte, höchstens fünf pro Person. Ergebnisse verbergen, solange geschrieben wird.',
      },
      {
        type: 'board',
        config: { board, mode: 'cluster', prompt: 'Ähnliche Hindernisse zu Themen bündeln', rights: 'own' },
        notes: 'Jede Person ordnet ihre eigenen Karten in Gruppen ein. Danach Gruppen gemeinsam benennen.',
      },
      {
        type: 'board',
        config: { board, mode: 'dots', prompt: 'Wo wäre der Nutzen am größten, wenn das Hindernis weg wäre?', dots: 3, targets: 'cards' },
        notes: 'Drei Klebepunkte pro Person auf einzelne Hindernisse, auch mehrere auf dasselbe. Im Editor auf „Gruppen“ umstellbar.',
      },
      {
        type: 'board',
        config: {
          board,
          mode: 'rate',
          prompt: 'Wie groß ist der Nutzen?',
          top: 5,
          targets: 'cards',
          scales: [{ label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'] }],
        },
        notes: 'Nur die fünf Hindernisse mit den meisten Punkten werden eingeschätzt.',
      },
      {
        type: 'board',
        config: { board, mode: 'table', prompt: 'Unsere Top 3', targets: 'cards' },
        notes: 'Im Steuerpult „Top 3 nach Punkten übernehmen“ und die Felder gemeinsam ausfüllen.',
      },
    ],
  },
  {
    id: 'groupwork',
    name: 'Gruppen bilden + Gruppenarbeit',
    description: 'Zufällige Gruppen und eine Sammel-Folie für die Ergebnisse',
    board: 'Gruppenarbeit',
    slides: (board) => [
      {
        type: 'teams',
        config: { title: 'Gruppen bilden' },
        notes: 'Alle geben ihren Namen ein, dann im Steuerpult die Gruppen einteilen.',
      },
      {
        type: 'board',
        config: { board, mode: 'collect', prompt: 'Haltet die Ergebnisse eurer Gruppe fest', maxCards: 10 },
        notes: 'Timer im Steuerpult starten – er erscheint auf Beamer und Handys.',
      },
    ],
  },
  {
    id: 'retro',
    name: 'Retro',
    description: 'Pinnwand Gut / Verbessern / Ideen und Punkte für die wichtigsten Themen',
    board: 'Retro',
    slides: (board) => [
      {
        type: 'pinboard',
        config: { title: 'Wie lief es?', columns: ['Gut', 'Verbessern', 'Ideen'] },
        notes: 'Fünf Minuten schreiben lassen, dann Spalte für Spalte durchgehen.',
      },
      {
        type: 'board',
        config: { board, mode: 'collect', prompt: 'Was wollen wir als Nächstes angehen?', maxCards: 3 },
        notes: 'Aus der Pinnwand die wichtigsten Punkte als Karten aufschreiben.',
      },
      {
        type: 'board',
        config: { board, mode: 'dots', prompt: 'Was ist am wichtigsten?', dots: 3, targets: 'cards' },
      },
    ],
  },
  {
    id: 'feedback',
    name: 'Feedbackrunde',
    description: 'Skala „Erwartung erfüllt?“ und zwei offene Fragen',
    slides: () => [
      {
        type: 'scale',
        config: { question: 'Wurden deine Erwartungen erfüllt?', max: 5, minLabel: 'gar nicht', maxLabel: 'voll und ganz' },
      },
      { type: 'open', config: { question: 'Was nimmst du mit?' } },
      { type: 'open', config: { question: 'Was würdest du anders machen?' } },
    ],
  },
  {
    id: 'closing',
    name: 'Abschluss mit Q&A',
    description: 'Fragen mit Upvotes, Feedback und Dank',
    slides: () => [
      { type: 'qa', config: { title: 'Eure Fragen', moderated: true } },
      { type: 'feedback', config: { question: 'Wie hat dir der Termin gefallen?', withComment: true } },
      { type: 'content', config: { title: 'Danke!', body: 'Schön, dass du dabei warst.' } },
    ],
  },
];

/** Folien eines Bausteins mit eindeutigem Wand-Namen. */
export function blockSlides(block: SlideBlock, board?: string): BlockSlide[] {
  return block.slides((board ?? block.board ?? 'Karten').trim().slice(0, 60) || 'Karten');
}
