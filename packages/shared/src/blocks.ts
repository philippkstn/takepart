import { z } from 'zod';
import { plannedMinutes, schedulePhases, type SlideSchedule } from './schedule.ts';
import { CREATABLE_SLIDE_TYPES, type SlideType } from './slides.ts';

/**
 * Übungsbausteine: vordefinierte Folienfolgen, die der Editor mit einem Klick
 * hinter der gewählten Folie einfügt. Bausteine sind reine Daten – der Server
 * kennt sie nicht, er nimmt nur eine Liste von Folien entgegen
 * (`POST /api/presentations/:id/slides/batch`) und prüft jede mit `parseConfig`.
 * Soll-Dauer und Phasen liegen nicht im `config`, sondern optional in `schedule`
 * (eigene Spalten an `slides`, siehe Ablaufplan).
 */

export type CreatableSlideType = Exclude<SlideType, 'image'>;

export interface BlockSlide {
  type: CreatableSlideType;
  config: Record<string, unknown>;
  notes?: string;
  /** Ablaufplan der Folie (Soll-Dauer, Phasen, Auto-Start) */
  schedule?: Partial<SlideSchedule>;
}

/** Was der Editor beim Einfügen über die Präsentation weiß */
export interface BlockContext {
  /** Vorhandene Wand-Namen in Folienreihenfolge */
  boards: string[];
}

export interface SlideBlock {
  id: string;
  name: string;
  description: string;
  /** Vorschlag für den Namen der Kartenwand – nur bei Bausteinen mit Kartenwand */
  board?: string;
  /**
   * Folien des Bausteins; `board` ist der (eindeutig gemachte) Wand-Name. Weitere
   * Wände (z. B. ein Parkplatz) macht der Baustein mit `context.boards` selbst eindeutig.
   */
  slides: (board: string, context: BlockContext) => BlockSlide[];
}

/** Höchstzahl Folien, die auf einmal eingefügt werden */
export const MAX_BATCH_SLIDES = 30;

/** Eine Folie für das gesammelte Einfügen (Bausteine, eigene Bausteine) */
export const batchSchedule = z.object({
  plannedMinutes: plannedMinutes.default(null),
  phases: schedulePhases.default([]),
  autoCountdown: z.boolean().default(false),
});
export const batchSlide = z.object({
  type: z.enum(CREATABLE_SLIDE_TYPES),
  config: z.unknown().optional(),
  notes: z.string().max(20000).default(''),
  /** Optionaler Ablaufplan – eigene Spalten, nicht im config */
  schedule: batchSchedule.optional(),
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

/** Wand der Erwartungsrunde – die Feedbackrunde blickt darauf zurück */
export const EXPECTATIONS_BOARD = 'Erwartungen';

/**
 * Wand für den Rückblick der Feedbackrunde: die letzte vorhandene Erwartungswand
 * („Erwartungen“, „Erwartungen 2“ …), sonst der Standardname – dann passt der
 * Rückblick, sobald die Erwartungsrunde später eingefügt wird.
 */
export function expectationsBoard(boards: string[]): string {
  const pattern = new RegExp(`^${EXPECTATIONS_BOARD}( \\d+)?$`, 'i');
  return (
    [...boards]
      .reverse()
      .find((b) => pattern.test(b.trim()))
      ?.trim() ?? EXPECTATIONS_BOARD
  );
}

/** Phasen der Paarinterviews (Hindernisse v3): zwei Runden mit Rollentausch, 45 Minuten */
export const PAIR_INTERVIEW_PHASES = [
  { label: 'Einführung & Paare bilden', minutes: 5 },
  { label: 'Runde 1: A fragt, B erzählt', minutes: 12 },
  { label: 'B schreibt Karten', minutes: 5 },
  { label: 'B schätzt den Nutzen (S–XL)', minutes: 3 },
  { label: 'Runde 2: B fragt, A erzählt', minutes: 12 },
  { label: 'A schreibt Karten', minutes: 5 },
  { label: 'A schätzt den Nutzen (S–XL)', minutes: 3 },
];

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
    description: 'Kartenwand: Was muss heute passieren? Die Feedbackrunde zeigt sie am Ende wieder',
    board: EXPECTATIONS_BOARD,
    slides: (board) => [
      {
        type: 'board',
        config: {
          board,
          mode: 'collect',
          prompt: 'Was muss heute passieren, damit sich der Workshop für dich gelohnt hat?',
          maxCards: 2,
          askName: true,
        },
        notes:
          'Reihum: Jede Person nennt ihre Erwartung und tippt sie selbst ein. Wer kein Gerät dabei hat, dem legt die Moderation die Karte im Steuerpult an („Karte ergänzen“). Festhalten, worauf der Workshop eingehen wird – und worauf nicht. Die Feedbackrunde am Ende zeigt jeder Person ihre eigenen Karten wieder.',
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
    id: 'obstacles-v3',
    name: 'Hindernisse v3: Paarinterviews → Top 3',
    description: 'Paare bilden mit Phasen-Countdown, Karten S–XL, Parkplatz, clustern, punkten, Art des Nutzens, Ergebnistabelle',
    board: 'Hindernisse',
    slides: (board, { boards }) => [
      {
        type: 'teams',
        config: { title: 'Paare bilden', tagLabel: 'Deine Rolle', tags: ['Innendienst', 'Außendienst', 'Key Account', 'Führung'] },
        notes:
          'Rollen im Editor an die Gruppe anpassen. Im Steuerpult Gruppengröße 2 und „Rollen mischen“ wählen – bei ungerader Zahl entsteht ein Dreierteam. Die Paare gehen in Breakout-Räume. Der Phasen-Countdown startet beim Betreten dieser Folie und läuft beim Weiterblättern weiter; jede Phase erscheint auf allen Handys.',
        schedule: { phases: PAIR_INTERVIEW_PHASES, autoCountdown: true },
      },
      {
        type: 'board',
        config: {
          board,
          mode: 'collect',
          prompt: 'Was hindert uns heute?',
          task: 'Im Zweiergespräch – A fragt, B erzählt:\n• Was hindert uns heute daran, erfolgreicher zu sein?\n• Was hindert dich persönlich in deiner täglichen Arbeit?\n• Und was noch? Was steckt dahinter?\nDanach schreibt B eigene Karten: ein Hindernis pro Karte, Nutzen S–XL wählen.',
          maxCards: 5,
          tags: ['S', 'M', 'L', 'XL'],
          startHidden: true,
        },
        notes:
          'Die Ergebnisse bleiben auf dem Beamer verborgen, bis du sie aufdeckst. Wer erzählt, schreibt danach seine eigenen Karten (höchstens fünf, je 300 Zeichen).',
      },
      {
        type: 'board',
        config: {
          board: uniqueBoardName('Parkplatz', [...boards, board]),
          mode: 'collect',
          prompt: 'Parkplatz: Was nicht zum Thema passt, aber nicht verloren gehen soll',
          maxCards: 10,
          anytime: true,
        },
        notes: 'Der Parkplatz nimmt während des ganzen Workshops Karten an – von jeder Folie aus.',
      },
      {
        type: 'board',
        config: { board, mode: 'cluster', prompt: 'Ähnliche Hindernisse zu Themen bündeln', rights: 'host', showUnsorted: true },
        notes: 'Die Moderation clustert und benennt die Themen gemeinsam mit der Gruppe; noch lose Karten stehen am Rand.',
      },
      {
        type: 'board',
        config: { board, mode: 'dots', prompt: 'Wo wäre der Nutzen am größten, wenn das Hindernis weg wäre?', dots: 3, targets: 'groups' },
        notes: 'Drei Klebepunkte pro Person auf die Themen, auch mehrere auf dasselbe.',
      },
      {
        type: 'board',
        config: {
          board,
          mode: 'choose',
          prompt: 'Welche Art von Nutzen bringt es, wenn das Hindernis weg ist?',
          top: 5,
          targets: 'groups',
          choices: ['Zeit', 'Qualität', 'Umsatz', 'Kunde'],
          multi: true,
        },
        notes: 'Nur die fünf Themen mit den meisten Punkten. Mehrere Kategorien je Thema sind erlaubt.',
      },
      {
        type: 'board',
        config: {
          board,
          mode: 'table',
          prompt: 'Unsere Top 3',
          targets: 'groups',
          columns: ['Lösungsrichtung', 'Verantwortlich', 'Nächster Schritt', 'Bis'],
        },
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
    description: 'Erwartung erfüllt? Mit Rückblick auf die eigenen Erwartungen, Mitnehmen und anders machen',
    slides: (_board, { boards }) => [
      {
        type: 'feedback',
        config: {
          question: 'Wurden deine Erwartungen erfüllt?',
          withComment: true,
          commentLabel: 'Was nimmst du mit?',
          recall: expectationsBoard(boards),
        },
        notes:
          'Jedes Handy zeigt die eigenen Karten aus der Erwartungsrunde. Reihum in derselben Reihenfolge wie am Anfang: Sterne, dann ein Satz, was man mitnimmt.',
      },
      {
        type: 'open',
        config: { question: 'Was würdest du beim nächsten Mal anders machen?' },
        notes: 'Mehrere Antworten pro Person sind möglich.',
      },
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
export function blockSlides(block: SlideBlock, board?: string, context: BlockContext = { boards: [] }): BlockSlide[] {
  return block.slides((board ?? block.board ?? 'Karten').trim().slice(0, 60) || 'Karten', context);
}
