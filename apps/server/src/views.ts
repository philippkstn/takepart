import {
  sentenceStart,
  sentenceState,
  slideHeadline,
  type DisplayView,
  type HostView,
  type ParticipantView,
  type PostView,
  type QuizAnswer,
  type QuizView,
  type RunInfo,
  type SentenceView,
} from '@slides/shared';
import { computeResults, effectiveQuiz, publicPosts, publicSlide, sentenceText, stripPost, type Snapshot } from './snapshot.ts';

function runInfo(snap: Snapshot): RunInfo {
  return { id: snap.run.id, title: snap.run.title, code: snap.run.code, ended: snap.run.ended, brand: snap.run.brand };
}

function quizView(snap: Snapshot): QuizView | null {
  const slide = snap.current;
  if (!slide || slide.type !== 'quiz') return null;
  const q = effectiveQuiz(snap.run.state, slide.id, snap.now);
  return { phase: q.phase, closesAt: q.closesAt, revealed: q.revealed };
}

function sentenceView(snap: Snapshot, withWords: boolean): SentenceView | null {
  const slide = snap.current;
  if (!slide || slide.type !== 'sentence') return null;
  const s = sentenceState(snap.run.state, slide.id);
  const view: SentenceView = {
    text: sentenceText(slide, snap.run.state),
    start: sentenceStart(slide.config.start),
    appended: s.words,
    round: s.round,
    revealed: s.revealed,
    done: s.done,
  };
  if (withWords) {
    const results = computeResults(
      slide,
      snap.responses.map((r) => r.payload),
    );
    if (results?.type === 'sentence') view.words = results.words;
  }
  return view;
}

function answerCount(snap: Snapshot): number {
  if (!snap.current) return 0;
  if (snap.posts.length > 0 || snap.current.type === 'qa') return new Set(snap.posts.map((p) => p.participantId)).size;
  return snap.responses.length;
}

const isLocked = (snap: Snapshot) => !!snap.current && snap.run.state.locked.includes(snap.current.id);

export function participantView(snap: Snapshot, participantId: number): ParticipantView {
  const { state } = snap.run;
  const slide = snap.current;
  const own = snap.responses.find((r) => r.participantId === participantId);
  const voted = snap.votes.get(participantId) ?? new Set<number>();
  const quiz = quizView(snap);

  let posts: PostView[] = [];
  if (slide && (slide.type === 'qa' || slide.type === 'brainstorm' || slide.type === 'pinboard')) {
    const visible = publicPosts(snap);
    const visibleIds = new Set(visible.map((p) => p.id));
    // Eigene, noch nicht freigegebene Fragen sieht die Person selbst (mit Hinweis).
    const ownPending = snap.posts.filter((p) => p.participantId === participantId && !visibleIds.has(p.id) && p.status === 'pending');
    posts = [...visible, ...ownPending].map((p) => ({
      ...stripPost(p),
      mine: p.participantId === participantId,
      voted: voted.has(p.id),
    }));
  } else if (slide?.type === 'open') {
    posts = snap.posts.filter((p) => p.participantId === participantId).map((p) => ({ ...stripPost(p), mine: true }));
  }

  let quizPoints: number | null = null;
  if (slide?.type === 'quiz' && quiz?.revealed && own) quizPoints = (own.payload as QuizAnswer).points;

  let rank: ParticipantView['rank'] = null;
  if (state.leaderboard) {
    const entry = snap.leaderboard.find((e) => e.participantId === participantId);
    if (entry) rank = { rank: entry.rank, points: entry.points, of: snap.leaderboard.length };
  }

  let response: unknown = own?.payload ?? null;
  if (slide?.type === 'quiz' && own) response = { choice: (own.payload as QuizAnswer).choice };

  return {
    kind: 'participant',
    run: runInfo(snap),
    serverTime: snap.now,
    name: snap.names.get(participantId) ?? null,
    slide: slide ? publicSlide(slide, state) : null,
    slideIndex: snap.index,
    slideCount: snap.slides.length,
    locked: isLocked(snap),
    response,
    quizPoints,
    quiz,
    sentence: sentenceView(snap, false),
    posts,
    rank,
    leaderboard: state.leaderboard,
  };
}

export function displayView(snap: Snapshot, participants: number): DisplayView {
  const { state } = snap.run;
  const slide = snap.current;
  const quiz = quizView(snap);
  const sentence = sentenceView(snap, !!slide && slide.type === 'sentence' && sentenceState(state, slide.id).revealed);

  let results = slide
    ? computeResults(
        slide,
        snap.responses.map((r) => r.payload),
      )
    : null;
  // Quiz: Verteilung erst nach Ablauf der Zeit, sonst beeinflusst sie die Antworten.
  if (slide?.type === 'quiz' && quiz?.phase !== 'closed') results = null;
  if (slide?.type === 'sentence') results = null;
  if (!state.resultsVisible) results = null;

  const posts = state.resultsVisible || slide?.type === 'qa' ? publicPosts(snap).map(stripPost) : [];
  const spotlight = posts.find((p) => p.id === state.spotlight) ?? null;

  return {
    kind: 'display',
    run: runInfo(snap),
    serverTime: snap.now,
    participants,
    slide: slide ? publicSlide(slide, state) : null,
    slideIndex: snap.index,
    slideCount: snap.slides.length,
    locked: isLocked(snap),
    resultsVisible: state.resultsVisible,
    answers: answerCount(snap),
    results,
    quiz,
    sentence,
    posts,
    spotlight,
    leaderboard: state.leaderboard ? snap.leaderboard.slice(0, 10) : null,
    showJoin: state.showJoin,
  };
}

export function hostView(snap: Snapshot, participants: number): HostView {
  const { state } = snap.run;
  const slide = snap.current;
  const posts = snap.posts.map(stripPost);
  const visible = publicPosts(snap).map(stripPost);
  return {
    kind: 'host',
    run: runInfo(snap),
    serverTime: snap.now,
    participants,
    slide,
    slideIndex: snap.index,
    slideCount: snap.slides.length,
    locked: isLocked(snap),
    resultsVisible: state.resultsVisible,
    answers: answerCount(snap),
    results: slide
      ? computeResults(
          slide,
          snap.responses.map((r) => r.payload),
        )
      : null,
    quiz: quizView(snap),
    sentence: sentenceView(snap, true),
    posts:
      slide?.type === 'qa' || slide?.type === 'brainstorm'
        ? [...posts].sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt)
        : posts,
    spotlight: visible.find((p) => p.id === state.spotlight) ?? null,
    leaderboard: snap.leaderboard,
    showJoin: state.showJoin,
    state,
    displayToken: snap.run.displayToken,
    presentationId: snap.run.presentationId,
    display: displayView(snap, participants),
    slides: snap.slides.map((s) => ({
      id: s.id,
      type: s.type,
      headline: slideHeadline(s),
      responses: snap.counts.get(s.id) ?? 0,
    })),
  };
}
