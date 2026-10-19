import { z } from 'zod';
import type { LeaderboardEntry, SlideResults } from './results.ts';
import { BOARD_KEY } from './board.ts';
import {
  BOARD_RIGHTS,
  type BoardConfig,
  type BoardMode,
  type BoardRights,
  type Slide,
  type SlideConfigs,
  type SlideType,
} from './slides.ts';
import type { WordCount } from './words.ts';

/* ───────────────────────── Zustand einer Durchführung ───────────────────────── */

export interface QuizState {
  /** ready: Frage sichtbar, Abgabe noch zu · open: Timer läuft · closed: Zeit abgelaufen */
  phase: 'ready' | 'open' | 'closed';
  openedAt: number | null;
  closesAt: number | null;
  revealed: boolean;
}

export interface SentenceState {
  words: string[];
  round: number;
  /** Antworten der aktuellen Runde werden auf dem Beamer gezeigt */
  revealed: boolean;
  /** Satz ist beendet, es werden keine Wörter mehr gesammelt */
  done: boolean;
}

/**
 * Live-Zustand einer Durchführung. Liegt als JSON in `runs.state`, damit ein
 * Neustart des Servers (z. B. Deployment) mitten im Vortrag nichts verliert.
 */
export interface RunState {
  slideId: number | null;
  /** Ergebnisse der aktuellen Folie auf dem Beamer zeigen */
  resultsVisible: boolean;
  /** Ein einzelner Beitrag (Post-ID), groß auf dem Beamer */
  spotlight: number | null;
  /** Folien, für die keine Antworten mehr angenommen werden */
  locked: number[];
  /** Rangliste statt Folie auf dem Beamer */
  leaderboard: boolean;
  /** Beitritts-Hinweis groß über die Folie legen */
  showJoin: boolean;
  quiz: Record<string, QuizState>;
  sentence: Record<string, SentenceState>;
  /** Start des Vortrags-Timers (ms); fehlt er, gilt der Start der Durchführung */
  timerStartedAt?: number | null;
  /** Aufgedeckter Animationsschritt je Folie (0 = Startzustand) */
  build?: Record<string, number>;
  /** Schwarz- oder Weißbild auf dem Beamer (wie „B“/„W“ in PowerPoint) */
  blank?: 'black' | 'white' | null;
  /** Countdown für Arbeitsphasen und Pausen – auf Beamer und Handys */
  countdown?: Countdown | null;
  /** Live geänderte Rechte der Teilnehmenden je Kartenwand-Folie (sonst gilt die Folie) */
  boardRights?: Record<string, BoardRights>;
}

/** Rechte der Teilnehmenden auf einer Wand-Folie: live gesetzt oder aus der Folie */
export function boardRights(state: RunState, slide: { id: number; config: Pick<BoardConfig, 'rights'> }): BoardRights {
  return state.boardRights?.[slide.id] ?? slide.config.rights;
}

/** Moderationsbefehle, die Teilnehmende mit dem Recht „alle bearbeiten“ ausführen dürfen */
export const PARTICIPANT_BOARD_OPS = [
  'group-add',
  'group-rename',
  'group-delete',
  'group-move',
  'assign',
  'place',
  'card-add',
  'card-edit',
] as const;

export interface Countdown {
  /** Ende (Serverzeit, ms) */
  endsAt: number;
  /** Ursprüngliche Dauer in Sekunden – für den Fortschritt */
  seconds: number;
}

export function initialRunState(firstSlideId: number | null): RunState {
  return {
    slideId: firstSlideId,
    resultsVisible: true,
    spotlight: null,
    locked: [],
    leaderboard: false,
    showJoin: false,
    quiz: {},
    sentence: {},
  };
}

export function quizState(state: RunState, slideId: number): QuizState {
  return state.quiz[slideId] ?? { phase: 'ready', openedAt: null, closesAt: null, revealed: false };
}

export function sentenceState(state: RunState, slideId: number): SentenceState {
  return state.sentence[slideId] ?? { words: [], round: 1, revealed: false, done: false };
}

/* ───────────────────────── Steuerbefehle des Hosts ───────────────────────── */

const boardKey = z.string().regex(BOARD_KEY);
const groupName = z.string().trim().min(1, 'Bitte eine Überschrift angeben').max(120);
const cardText = z.string().trim().min(1, 'Bitte etwas eingeben').max(300, 'Höchstens 300 Zeichen');
const delta = z.union([z.literal(1), z.literal(-1)]);

/** Moderation einer Kartenwand: Gruppen, Einordnen, Karten ergänzen, Ergebnistabelle */
export const boardOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('group-add'), name: groupName, postIds: z.array(z.number().int()).max(100).default([]) }),
  z.object({ op: z.literal('group-rename'), groupId: z.number().int(), name: groupName }),
  z.object({ op: z.literal('group-delete'), groupId: z.number().int() }),
  z.object({ op: z.literal('group-move'), groupId: z.number().int(), delta }),
  /** Karte in eine Gruppe legen (null = zurück in die Ablage) */
  z.object({ op: z.literal('assign'), postId: z.number().int(), groupId: z.number().int().nullable() }),
  /** Eintrag in ein Feld legen (null = zurück in die Ablage) */
  z.object({
    op: z.literal('place'),
    key: boardKey,
    lane: z.number().int().min(0).max(3).nullable(),
    cell: z.number().int().min(0).max(7).nullable(),
  }),
  z.object({ op: z.literal('card-add'), text: cardText, groupId: z.number().int().nullable().default(null) }),
  z.object({ op: z.literal('card-edit'), postId: z.number().int(), text: cardText }),
  z.object({ op: z.literal('row-add'), key: boardKey }),
  z.object({ op: z.literal('row-remove'), key: boardKey }),
  z.object({ op: z.literal('row-move'), key: boardKey, delta }),
  /** Die N Einträge mit den meisten Punkten als Zeilen übernehmen */
  z.object({ op: z.literal('rows-top'), n: z.number().int().min(1).max(20) }),
  z.object({ op: z.literal('row-fields'), key: boardKey, fields: z.array(z.string().trim().max(300)).max(5) }),
]);
export type BoardOp = z.infer<typeof boardOp>;

export const hostCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), slideId: z.number().int() }),
  z.object({ action: z.literal('step'), delta: z.union([z.literal(1), z.literal(-1)]) }),
  /** Zu Folie Nummer `index` (0-basiert, -1 = letzte) – für Pos1/Ende und Nummer + Enter */
  z.object({ action: z.literal('jump'), index: z.number().int().min(-1).max(10000) }),
  z.object({ action: z.literal('results'), visible: z.boolean() }),
  z.object({ action: z.literal('lock'), slideId: z.number().int(), locked: z.boolean() }),
  z.object({ action: z.literal('spotlight'), postId: z.number().int().nullable() }),
  z.object({ action: z.literal('join'), visible: z.boolean() }),
  z.object({ action: z.literal('leaderboard'), visible: z.boolean() }),
  z.object({ action: z.literal('quiz-start'), slideId: z.number().int() }),
  z.object({ action: z.literal('quiz-close'), slideId: z.number().int() }),
  z.object({ action: z.literal('quiz-reveal'), slideId: z.number().int() }),
  z.object({ action: z.literal('quiz-reset'), slideId: z.number().int() }),
  z.object({ action: z.literal('sentence-reveal'), slideId: z.number().int(), revealed: z.boolean() }),
  z.object({ action: z.literal('sentence-append'), slideId: z.number().int(), word: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal('sentence-undo'), slideId: z.number().int() }),
  z.object({ action: z.literal('sentence-done'), slideId: z.number().int(), done: z.boolean() }),
  z.object({ action: z.literal('sentence-reset'), slideId: z.number().int() }),
  z.object({
    action: z.literal('post-status'),
    postId: z.number().int(),
    status: z.enum(['pending', 'visible', 'hidden', 'answered']),
  }),
  z.object({ action: z.literal('clear-responses'), slideId: z.number().int() }),
  z.object({ action: z.literal('timer-reset') }),
  z.object({ action: z.literal('blank'), mode: z.enum(['black', 'white']).nullable() }),
  /** Countdown starten (Sekunden) oder beenden (null) */
  z.object({
    action: z.literal('countdown'),
    seconds: z
      .number()
      .int()
      .min(1)
      .max(4 * 3600)
      .nullable(),
  }),
  z.object({ action: z.literal('board'), slideId: z.number().int(), op: boardOp }),
  z.object({ action: z.literal('board-rights'), slideId: z.number().int(), rights: z.enum(BOARD_RIGHTS) }),
]);
export type HostCommand = z.infer<typeof hostCommand>;

/* ───────────────────────── Ansichten (über WebSocket) ───────────────────────── */

export type PostStatus = 'pending' | 'visible' | 'hidden' | 'answered';

export interface PostView {
  id: number;
  text: string;
  authorName: string | null;
  column: number | null;
  status: PostStatus;
  votes: number;
  createdAt: number;
  /** nur in der Teilnehmer-Ansicht: eigener Beitrag / selbst hochgevotet */
  mine?: boolean;
  voted?: boolean;
  /** Kartenwand: Gruppe, in der die Karte liegt */
  group?: number | null;
}

/* ───────────── Kartenwand ───────────── */

export interface BoardGroupView {
  id: number;
  name: string;
  /** Anzahl Karten in der Gruppe */
  cards: number;
}

/**
 * Zustand einer Kartenwand für die aktuelle Folie. Die Karten selbst stehen in
 * `posts` (mit `group`), Einträge werden über Schlüssel (`c<id>`, `g<id>`) adressiert.
 */
export interface BoardView {
  name: string;
  mode: BoardMode;
  groups: BoardGroupView[];
  /** Einträge dieser Folie (Zuordnen, Punkte, Bewerten) – bei „Top N“ in Punkte-Reihenfolge */
  targets: string[];
  /** Platzierungen auf dieser Folie (Zuordnen) */
  places: Record<string, { lane: number; cell: number }>;
  /** Zeilen der Ergebnistabelle in Reihenfolge */
  rows: { key: string; fields: string[] }[];
  /** Punkte aus den anderen Punkte-Folien dieser Wand – für Top-Auswahl und Tabelle */
  totals: Record<string, number>;
  /** Was Teilnehmende gerade dürfen */
  rights: BoardRights;
  /** Nur Teilnehmende auf Sammel-Folien: wie viele Karten noch gehen */
  remaining?: number;
}

/** Wand einer Folie im Archiv: Ansicht wie live plus alle Karten */
export interface BoardSummary {
  view: BoardView;
  cards: PostView[];
}

/** Sammel-Folie, die jederzeit Karten annimmt (Parkplatz) – erreichbar von jeder Folie aus */
export interface ParkingView {
  slideId: number;
  title: string;
  tags: string[];
  remaining: number;
  mine: PostView[];
}

/** Folie, wie sie das Publikum sieht – bei Quizfragen ohne Lösung, bis sie aufgelöst ist. */
export type PublicSlide =
  | Exclude<Slide, { type: 'quiz' }>
  | { id: number; type: 'quiz'; position: number; config: Omit<SlideConfigs['quiz'], 'correct'> & { correct?: number[] } };

/** Branding, wie es Beamer und Publikum bekommen (Logo als URL, nicht als Daten). */
export interface BrandView {
  name: string;
  accent: string;
  chart: string;
  logoUrl: string | null;
}

export interface RunInfo {
  id: number;
  title: string;
  code: string | null;
  ended: boolean;
  brand: BrandView | null;
}

export interface SentenceView {
  text: string;
  /** Satzanfang ohne Auslassungspunkte und die angehängten Wörter – für Animationen */
  start: string;
  appended: string[];
  round: number;
  revealed: boolean;
  done: boolean;
  words?: WordCount[];
}

export interface QuizView {
  phase: QuizState['phase'];
  closesAt: number | null;
  revealed: boolean;
}

export interface ParticipantView {
  kind: 'participant';
  run: RunInfo;
  serverTime: number;
  name: string | null;
  slide: PublicSlide | null;
  slideIndex: number;
  slideCount: number;
  locked: boolean;
  /** Eigene Antwort auf die aktuelle Folie (bzw. Runde beim Satz-Spiel) */
  response: unknown;
  /** Bei Quizfragen nach dem Auflösen: eigene Punkte für diese Frage */
  quizPoints: number | null;
  quiz: QuizView | null;
  sentence: SentenceView | null;
  /** Sichtbare Beiträge (Q&A, Brainstorming, Pinnwand) und eigene offene Antworten */
  posts: PostView[];
  /** Eigener Platz in der Rangliste, falls die Rangliste gezeigt wird */
  rank: { rank: number; points: number; of: number } | null;
  leaderboard: boolean;
  /** Link zu den freigegebenen Folien und Ergebnissen (falls freigegeben) */
  handoutUrl: string | null;
  /** Aufgedeckter Animationsschritt der aktuellen Folie */
  buildStep: number;
  board: BoardView | null;
  parking: ParkingView[];
  countdown: Countdown | null;
}

export interface DisplayView {
  kind: 'display';
  run: RunInfo;
  serverTime: number;
  participants: number;
  slide: PublicSlide | null;
  slideIndex: number;
  slideCount: number;
  locked: boolean;
  resultsVisible: boolean;
  /** Anzahl Personen, die auf die aktuelle Folie (Runde) geantwortet haben */
  answers: number;
  results: SlideResults | null;
  quiz: QuizView | null;
  sentence: SentenceView | null;
  posts: PostView[];
  spotlight: PostView | null;
  leaderboard: LeaderboardEntry[] | null;
  showJoin: boolean;
  /** Bilder der nächsten Folie vorab laden, damit der Wechsel nicht flackert */
  preload: string[];
  /** Aufgedeckter Animationsschritt der aktuellen Folie */
  buildStep: number;
  blank: 'black' | 'white' | null;
  board: BoardView | null;
  countdown: Countdown | null;
}

export interface HostSlideSummary {
  id: number;
  type: SlideType;
  headline: string;
  responses: number;
  /** Miniatur für importierte Folien */
  thumb: string | null;
}

export interface HostView extends Omit<DisplayView, 'kind' | 'slide' | 'leaderboard'> {
  kind: 'host';
  slide: Slide | null;
  state: RunState;
  displayToken: string;
  presentationId: number;
  slides: HostSlideSummary[];
  /** Alle Beiträge der aktuellen Folie, auch nicht freigegebene und ausgeblendete */
  posts: PostView[];
  leaderboard: LeaderboardEntry[];
  /** Genau das, was der Beamer gerade zeigt – für die Vorschau im Steuerpult */
  display: DisplayView;
  /** Referentenansicht – erreicht nie Beamer oder Publikum */
  notes: string;
  nextSlide: Slide | null;
  startedAt: number;
  targetMinutes: number | null;
  handoutUrl: string | null;
}

/* ───────────────────── Laserpointer & Zeichnen ─────────────────────
 * Laufen direkt über den WebSocket des Hosts und werden an Beamer und Hosts
 * weitergereicht – flüchtig, nicht in der Datenbank. Koordinaten sind auf die
 * 16:9-Bühne normiert (0…1).
 */
const coord = z.number().min(0).max(1);
export const inkEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pointer'), x: coord, y: coord }),
  z.object({ type: z.literal('pointer-off') }),
  z.object({
    type: z.literal('stroke'),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    points: z
      .array(z.tuple([coord, coord]))
      .min(1)
      .max(100),
    done: z.boolean(),
  }),
  z.object({ type: z.literal('clear') }),
]);
export type InkEvent = z.infer<typeof inkEvent>;
export interface InkStroke {
  id: string;
  points: [number, number][];
}

export type ServerMessage =
  | { type: 'view'; view: ParticipantView | DisplayView | HostView }
  | { type: 'error'; message: string }
  | { type: 'ended'; handoutUrl?: string | null }
  | { type: 'ink'; event: InkEvent }
  | { type: 'ink-state'; strokes: InkStroke[] };

/* ───────────── Freigabe für Teilnehmende (/h/:token) ───────────── */

export type HandoutSlide =
  | { type: 'image'; title: string; image: string; width: number; height: number }
  | { type: 'content'; title: string; body: string }
  | { type: 'results'; slide: PublicSlide; results: SlideResults }
  | { type: 'sentence'; headline: string; sentence: string }
  | { type: 'board'; headline: string; mode: BoardMode; columns: string[]; entries: HandoutBoardEntry[] };

/** Zusammengefasster Eintrag einer Kartenwand – Gruppen, nie einzelne Karten */
export interface HandoutBoardEntry {
  label: string;
  cards: number;
  place: string | null;
  dots: number | null;
  rating: string | null;
  fields: string[];
}

export interface HandoutData {
  title: string;
  date: string;
  brand: BrandView | null;
  slides: HandoutSlide[];
}
