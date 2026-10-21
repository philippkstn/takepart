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
  'board',
  'teams',
  'pause',
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
  board: 'Kartenwand',
  teams: 'Gruppen bilden',
  pause: 'Pause',
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
  board: 'Karten sammeln, clustern, zuordnen, punkten und bewerten',
  teams: 'Alle nennen ihren Namen, du teilst automatisch in Gruppen ein',
  pause: 'Pause mit voreingestellter Dauer – startet beim Erreichen der Folie',
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
  /** Name einer Kartenwand (z. B. „Erwartungen“): jedes Handy zeigt die eigenen Karten von dort zum Gegenlesen */
  recall: z.string().trim().max(60).default(''),
});
export const qaConfig = z.object({
  title: text(200).default('Eure Fragen'),
  moderated: z.boolean().default(true),
});
export const sentenceConfig = z.object({
  start: text(300).default(''),
});
/**
 * Kartenwand für Workshop-Übungen. Mehrere Folien teilen sich eine Wand über
 * ihren Namen (`board`): Auf der ersten werden Karten gesammelt, auf den
 * folgenden geclustert, zugeordnet, gepunktet und bewertet. So liegen die
 * Übungsschritte im normalen Folienablauf zwischen den Anleitungsfolien.
 */
export const BOARD_MODES = ['collect', 'cluster', 'place', 'dots', 'rate', 'choose', 'table'] as const;
export type BoardMode = (typeof BOARD_MODES)[number];
export const BOARD_MODE_LABELS: Record<BoardMode, string> = {
  collect: 'Karten sammeln',
  cluster: 'Clustern',
  place: 'Zuordnen',
  dots: 'Punkte kleben',
  rate: 'Bewerten',
  choose: 'Einordnen',
  table: 'Ergebnistabelle',
};
export const BOARD_MODE_HINTS: Record<BoardMode, string> = {
  collect: 'Jede Person schreibt Karten – eine Idee pro Karte',
  cluster: 'Karten zu Gruppen bündeln, als Wand oder Mindmap',
  place: 'Karten oder Gruppen in Spalten, Prozessschritte oder eine Matrix',
  dots: 'Klebepunkte auf Gruppen oder Karten verteilen',
  rate: 'Einträge einschätzen, z. B. Nutzen und Aufwand in S bis XL',
  choose: 'Einträgen eine oder mehrere Kategorien geben, z. B. die Art des Nutzens',
  table: 'Top-Themen mit Verantwortlichen und nächsten Schritten',
};
export const BOARD_RIGHTS = ['host', 'own', 'all'] as const;
export type BoardRights = (typeof BOARD_RIGHTS)[number];
export const BOARD_RIGHTS_LABELS: Record<BoardRights, string> = {
  host: 'Nur Moderation',
  own: 'Eigene Karten einordnen',
  all: 'Alle bearbeiten gemeinsam',
};
const shortLabel = (max: number) => z.string().trim().min(1, 'Beschriftung darf nicht leer sein').max(max);
export const boardLane = z.object({
  title: text(60).default(''),
  cells: z.array(shortLabel(60)).min(1).max(8),
});
export const boardScale = z.object({
  label: shortLabel(40),
  levels: z.array(shortLabel(20)).min(2).max(7),
});
export const boardConfig = z.object({
  /** Name der Wand – Folien mit gleichem Namen arbeiten mit denselben Karten */
  board: z.string().trim().min(1, 'Bitte einen Namen für die Kartenwand angeben').max(60).default('Karten'),
  mode: z.enum(BOARD_MODES).default('collect'),
  prompt: text(300).default(''),
  /* Sammeln */
  maxCards: z.number().int().min(1).max(20).default(5),
  /** Optionale Kennzeichnung je Karte, z. B. Rollen (höchstens fünf) */
  tags: z.array(shortLabel(40)).max(5).default([]),
  /** Karten jederzeit annehmen, auch wenn die Folie nicht gezeigt wird (Parkplatz) */
  anytime: z.boolean().default(false),
  /** Jede Gruppe (aus „Gruppen bilden“) sammelt für sich und sieht die Karten der eigenen Gruppe */
  perTeam: z.boolean().default(false),
  /** Beim Betreten der Folie sind die Ergebnisse auf dem Beamer verborgen (Moderation deckt auf) */
  startHidden: z.boolean().default(false),
  /* Clustern */
  layout: z.enum(['wall', 'mindmap']).default('wall'),
  /* Zuordnen: Bahnen mit eigenen Feldern; zwei Bahnen à zwei Felder ergeben eine Matrix */
  lanes: z
    .array(boardLane)
    .min(1)
    .max(4)
    .default([{ title: '', cells: ['Spalte 1', 'Spalte 2', 'Spalte 3'] }]),
  xLabel: text(60).default(''),
  yLabel: text(60).default(''),
  /* Clustern und Zuordnen */
  /**
   * Was Teilnehmende auf der Wand dürfen: nichts (nur Moderation), eigene Karten
   * einordnen oder gemeinsam alles bearbeiten (Karten verschieben und ändern,
   * Gruppen anlegen und umbenennen). Im Steuerpult live umschaltbar.
   */
  rights: z.enum(BOARD_RIGHTS).default('host'),
  /** Noch nicht eingeordnete Karten auf dem Beamer zeigen */
  showUnsorted: z.boolean().default(false),
  /* Zuordnen, Punkte, Bewerten: worauf sich die Folie bezieht */
  /** `table`: die Zeilen der letzten Ergebnistabelle derselben Wand vor dieser Folie (z. B. die bestätigten Top 3) */
  targets: z.enum(['auto', 'cards', 'groups', 'table']).default('auto'),
  /** Nur die N Einträge mit den meisten Punkten (0 = alle) */
  top: z.number().int().min(0).max(30).default(0),
  /* Punkte */
  dots: z.number().int().min(1).max(10).default(3),
  /** Mehrere Punkte auf denselben Eintrag erlaubt */
  stack: z.boolean().default(true),
  /* Bewerten: ein oder zwei Kriterien; bei zweien entsteht eine Matrix */
  scales: z
    .array(boardScale)
    .min(1)
    .max(2)
    .default([{ label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'] }]),
  /** Felder der Matrix bei zwei Kriterien: oben links, oben rechts, unten links, unten rechts */
  quadrants: z.array(text(40)).length(4).default(['Quick Wins', 'Strategisch', 'Mitnehmen', 'Zurückstellen']),
  /* Einordnen: Kategorien je Eintrag (Teilnehmende stimmen ab, die Moderation kann festlegen) */
  choices: z.array(shortLabel(40)).min(2).max(8).default(['Zeit', 'Qualität', 'Umsatz', 'Kunde']),
  /** Mehrere Kategorien je Eintrag erlaubt */
  multi: z.boolean().default(true),
  /* Ergebnistabelle */
  columns: z.array(shortLabel(40)).min(1).max(5).default(['Lösungsrichtung', 'Verantwortlich', 'Nächster Schritt', 'Bis']),
});
export type BoardConfig = z.infer<typeof boardConfig>;

/**
 * Gruppen bilden: Teilnehmende geben ihren Namen ein (und optional eine
 * Kennzeichnung, z. B. ihre Rolle); im Steuerpult entstehen daraus zufällige,
 * auf Wunsch nach Kennzeichnung gemischte Gruppen. Die Einteilung liegt im
 * Zustand der Durchführung (`RunState.teams`).
 */
/**
 * Pause als Folie: Beim Erreichen startet der Pausenmodus mit der voreingestellten
 * Dauer (Countdown, „Weiter um …“, Energie-Frage); Weiterblättern beendet ihn.
 */
export const pauseConfig = z.object({
  title: text(200).default('Pause'),
  minutes: z.number().int().min(1).max(240).default(10),
  /** Auf den Handys fragen: Wie ist deine Energie? */
  question: z.boolean().default(true),
});

export const teamsConfig = z.object({
  title: text(200).default('Gruppen bilden'),
  /** Frage zur Kennzeichnung, z. B. „Deine Rolle“ – nur mit Kennzeichnungen */
  tagLabel: text(60).default('Deine Rolle'),
  tags: z.array(shortLabel(40)).max(8).default([]),
});

/**
 * Aufbau-Animationen einer importierten Folie (aus der PPTX). Das Folienbild zeigt
 * den Endzustand; noch nicht aufgedeckte Elemente werden mit Flächen in der
 * gemessenen Umgebungsfarbe abgedeckt. Nur Eingangseffekte lassen sich so
 * nachbauen – Ausgang, Betonung und Pfade nicht.
 */
export const BUILD_EFFECTS = ['appear', 'fade', 'fly-left', 'fly-right', 'fly-top', 'fly-bottom', 'zoom'] as const;
export type BuildEffect = (typeof BUILD_EFFECTS)[number];
const unit = z.number().min(0).max(1);
export const buildRegion = z.object({
  /** Position und Größe relativ zur Folie (0…1) */
  x: unit,
  y: unit,
  w: unit,
  h: unit,
  /** 0 = läuft automatisch beim Aufrufen der Folie, 1…n = n-ter Klick */
  step: z.number().int().min(0).max(50),
  /** Start relativ zum Schritt und Dauer in ms */
  at: z.number().int().min(0).max(60000),
  dur: z.number().int().min(0).max(10000),
  effect: z.enum(BUILD_EFFECTS),
  /** Abdeckfarbe (beim Import am Rand des Elements gemessen) */
  fill: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type BuildRegion = z.infer<typeof buildRegion>;
export const buildsConfig = z.object({
  enabled: z.boolean().default(true),
  /** Anzahl Klicks bis zum Endzustand */
  steps: z.number().int().min(0).max(50),
  regions: z.array(buildRegion).max(300),
});
export type BuildsConfig = z.infer<typeof buildsConfig>;

/** Öffentliche, zufällige Kennung eines hochgeladenen Bildes – sie ist zugleich die Zugriffskontrolle. */
export const assetId = z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'Ungültige Bildkennung');
export const imageConfig = z.object({
  asset: assetId,
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
  /** Titel für Listen (beim Import aus der ersten Textzeile der Seite) */
  title: text(200).default(''),
  builds: buildsConfig.optional(),
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
  board: boardConfig,
  teams: teamsConfig,
  pause: pauseConfig,
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
  if (slide.type === 'board') {
    const b = slide.config as BoardConfig;
    return b.prompt.trim() || `${BOARD_MODE_LABELS[b.mode]}: ${b.board}`;
  }
  // Nur Texte zählen: bei der Pausen-Folie ist `question` ein Schalter (Energie-Frage)
  const c = slide.config as Record<string, unknown>;
  const value = [c.question, c.title, c.start].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  return value?.trim() ?? '';
}

/** Folientypen, auf die das Publikum antwortet (alles außer der Textfolie). */
export function isInteractive(type: SlideType): boolean {
  return type !== 'content' && type !== 'image';
}

/** Klicks bis zum Endzustand einer Folie (0 = kein Aufbau). */
export function buildSteps(slide: { type: string; config: unknown }): number {
  if (slide.type !== 'image') return 0;
  const b = (slide.config as { builds?: BuildsConfig }).builds;
  return b?.enabled ? b.steps : 0;
}

/** URLs hochgeladener Bilder; die Kennung ist zufällig und nicht erratbar. */
export const assetUrl = (asset: string) => `/api/assets/${asset}`;
export const assetThumbUrl = (asset: string) => `/api/assets/${asset}/thumb`;

/** Folientypen, deren Beiträge als einzelne Karten (Posts) gespeichert werden. */
export const POST_TYPES = ['open', 'brainstorm', 'pinboard', 'qa', 'board'] as const satisfies readonly SlideType[];
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
