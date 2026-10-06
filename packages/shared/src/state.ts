import { z } from 'zod';
import type { LeaderboardEntry, SlideResults } from './results.ts';
import type { Slide, SlideConfigs, SlideType } from './slides.ts';
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

export const hostCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), slideId: z.number().int() }),
  z.object({ action: z.literal('step'), delta: z.union([z.literal(1), z.literal(-1)]) }),
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
}

export interface HostSlideSummary {
  id: number;
  type: SlideType;
  headline: string;
  responses: number;
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
}

export type ServerMessage =
  { type: 'view'; view: ParticipantView | DisplayView | HostView } | { type: 'error'; message: string } | { type: 'ended' };
