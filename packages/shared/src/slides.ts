import { z } from 'zod';

/**
 * Folientypen. Jede Folie gehört zu einer Präsentation und hat eine typabhängige
 * Konfiguration (`config`). Live-Zustand (Runde, Quiz-Phase …) liegt nicht hier,
 * sondern im Zustand der Durchführung (siehe state.ts).
 */
export const SLIDE_TYPES = [
  'content',
  'choice',
  'open',
  'scale',
  'wordcloud',
  'ranking',
  'quiz',
  'brainstorm',
  'pinboard',
  'feedback',
  'qa',
  'sentence',
  'image',
] as const;
export type SlideType = (typeof SLIDE_TYPES)[number];

/** Folientypen, die man im Editor direkt anlegen kann („image“ entsteht nur durch den Import). */
export const CREATABLE_SLIDE_TYPES = SLIDE_TYPES.filter((t) => t !== 'image');

export const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  content: 'Textfolie',
  choice: 'Auswahl',
  open: 'Offene Antworten',
  scale: 'Skala',
  wordcloud: 'Wortwolke',
  ranking: 'Ranking',
  quiz: 'Quizfrage',
  brainstorm: 'Brainstorming',
  pinboard: 'Pinnwand',
  feedback: 'Feedback',
  qa: 'Fragen (Q&A)',
  sentence: 'Satz vervollständigen',
  image: 'Folie',
};

export const SLIDE_TYPE_HINTS: Record<SlideType, string> = {
  content: 'Titel, Text und auf Wunsch der Beitritts-Code groß',
  choice: 'Eine oder mehrere Antworten aus vorgegebenen Optionen',
  open: 'Freitext-Antworten, einzeln groß einblendbar',
  scale: 'Bewertung auf einer Skala mit Durchschnitt',
  wordcloud: 'Kurze Begriffe, häufige erscheinen größer',
  ranking: 'Optionen in eine Reihenfolge bringen',
  quiz: 'Richtige Antwort, Zeitlimit, Punkte und Rangliste',
  brainstorm: 'Ideen sammeln, das Publikum stimmt mit ab',
  pinboard: 'Gemeinsame Pinnwand mit Spalten',
  feedback: 'Sterne-Bewertung mit optionalem Kommentar',
  qa: 'Fragen mit Namen, Upvotes und Freigabe',
  sentence: 'Satzanfang vorgeben, das häufigste Wort wird angehängt',
  image: 'Importierte Folie aus PDF/PowerPoint',
};

const text = (max: number) => z.string().trim().max(max);
const option = z.string().trim().min(1, 'Option darf nicht leer sein').max(120);

export const contentConfig = z.object({
  title: text(200).default(''),
  body: text(2000).default(''),
  showJoin: z.boolean().default(false),
});
export const choiceConfig = z.object({
  question: text(300).default(''),
  options: z.array(option).min(2).max(10).default(['Option A', 'Option B']),
  multiple: z.boolean().default(false),
});
export const openConfig = z.object({
  question: text(300).default(''),
  maxLength: z.number().int().min(20).max(500).default(280),
});
export const scaleConfig = z.object({
  question: text(300).default(''),
  max: z.union([z.literal(5), z.literal(7), z.literal(10)]).default(5),
  minLabel: text(40).default('trifft nicht zu'),
  maxLabel: text(40).default('trifft voll zu'),
});
export const wordcloudConfig = z.object({
  question: text(300).default(''),
  maxWords: z.number().int().min(1).max(3).default(1),
});
export const rankingConfig = z.object({
  question: text(300).default(''),
  options: z.array(option).min(2).max(8).default(['Option A', 'Option B', 'Option C']),
});
export const quizConfig = z.object({
  question: text(300).default(''),
  options: z.array(option).min(2).max(6).default(['Antwort A', 'Antwort B', 'Antwort C', 'Antwort D']),
  correct: z.array(z.number().int().min(0)).min(1).default([0]),
  timeLimit: z.number().int().min(5).max(180).default(20),
});
export const brainstormConfig = z.object({
  question: text(300).default(''),
  allowVotes: z.boolean().default(true),
});
export const pinboardConfig = z.object({
  title: text(200).default(''),
  columns: z.array(z.string().trim().min(1).max(60)).min(1).max(5).default(['Gut', 'Verbessern', 'Ideen']),
});
export const feedbackConfig = z.object({
  question: text(300).default('Wie hat dir der Vortrag gefallen?'),
  withComment: z.boolean().default(true),
});
export const qaConfig = z.object({
  title: text(200).default('Eure Fragen'),
  moderated: z.boolean().default(true),
});
export const sentenceConfig = z.object({
  start: text(300).default(''),
});
/** Öffentliche, zufällige Kennung eines hochgeladenen Bildes – sie ist zugleich die Zugriffskontrolle. */
export const assetId = z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'Ungültige Bildkennung');
export const imageConfig = z.object({
  asset: assetId,
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
  /** Titel für Listen (beim Import aus der ersten Textzeile der Seite) */
  title: text(200).default(''),
});

export const slideConfigSchemas = {
  content: contentConfig,
  choice: choiceConfig,
  open: openConfig,
  scale: scaleConfig,
  wordcloud: wordcloudConfig,
  ranking: rankingConfig,
  quiz: quizConfig,
  brainstorm: brainstormConfig,
  pinboard: pinboardConfig,
  feedback: feedbackConfig,
  qa: qaConfig,
  sentence: sentenceConfig,
  image: imageConfig,
} satisfies Record<SlideType, z.ZodType>;

export type SlideConfigs = { [K in SlideType]: z.infer<(typeof slideConfigSchemas)[K]> };
export type SlideConfig<T extends SlideType = SlideType> = SlideConfigs[T];

export type Slide = {
  [K in SlideType]: { id: number; type: K; position: number; config: SlideConfigs[K] };
}[SlideType];

export function defaultConfig<T extends SlideType>(type: T): SlideConfigs[T] {
  return slideConfigSchemas[type].parse({}) as SlideConfigs[T];
}

/** Prüft eine Konfiguration und ergänzt fehlende Felder. Wirft bei ungültigen Werten. */
export function parseConfig<T extends SlideType>(type: T, config: unknown): SlideConfigs[T] {
  const parsed = slideConfigSchemas[type].parse(config ?? {}) as SlideConfigs[T];
  if (type === 'quiz') {
    const quiz = parsed as SlideConfigs['quiz'];
    const valid = quiz.correct.filter((i) => i < quiz.options.length);
    if (valid.length === 0) throw new Error('Mindestens eine richtige Antwort angeben');
    quiz.correct = [...new Set(valid)].sort((a, b) => a - b);
  }
  return parsed;
}

/** Überschrift, die eine Folie in Listen und auf dem Beamer trägt. */
export function slideHeadline(slide: Pick<Slide, 'type' | 'config'>): string {
  const c = slide.config as Record<string, unknown>;
  const value = (c.question ?? c.title ?? c.start ?? '') as string;
  return value.trim();
}

/** Folientypen, auf die das Publikum antwortet (alles außer der Textfolie). */
export function isInteractive(type: SlideType): boolean {
  return type !== 'content' && type !== 'image';
}

/** URLs hochgeladener Bilder; die Kennung ist zufällig und nicht erratbar. */
export const assetUrl = (asset: string) => `/api/assets/${asset}`;
export const assetThumbUrl = (asset: string) => `/api/assets/${asset}/thumb`;

/** Folientypen, deren Beiträge als einzelne Karten (Posts) gespeichert werden. */
export const POST_TYPES = ['open', 'brainstorm', 'pinboard', 'qa'] as const satisfies readonly SlideType[];
export type PostSlideType = (typeof POST_TYPES)[number];
export function isPostType(type: SlideType): type is PostSlideType {
  return (POST_TYPES as readonly string[]).includes(type);
}

/** Die beiden Satzanfänge aus der ersten Idee – als Vorlage für neue Präsentationen. */
export const SENTENCE_STARTERS = [
  'Ein Azubi kommt rein und teilt uns mit, dass',
  'Ein Admin öffnet die Tür des Serverraums und sieht, dass',
];

/* ───────────── Branding ───────────── */

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB angeben')
  .transform((v) => v.toUpperCase());

export const brandInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(100),
  accent: hexColor,
  chart: hexColor,
});
export type BrandInput = z.infer<typeof brandInput>;

/** Erlaubte Logo-Formate und Höchstgröße */
export const LOGO_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'] as const;
export const LOGO_MAX_BYTES = 512 * 1024;
