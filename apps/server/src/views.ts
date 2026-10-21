import {
  activeCallback,
  boardRights,
  cardKey,
  assetThumbUrl,
  buildSteps,
  assetUrl,
  sentenceStart,
  sentenceState,
  slideHeadline,
  slidePlannedMinutes,
  type DisplayView,
  type HostView,
  type ParticipantView,
  type PostView,
  type PublicSlide,
  type Slide,
  type QuizAnswer,
  type QuizView,
  type RunInfo,
  type SentenceView,
  type BoardView,
  type ParkingView,
} from '@slides/shared';
import { buildBoardView } from './board.ts';
import { breakoutPosts, breakoutView, myTeamView } from './breakout.ts';
import { participantTeam, teamsView } from './teams.ts';
import { displayPause, participantPause, pauseStats } from './pause.ts';
import { displayPicked, hostSignals, participantModeration, pickerView, presenceView } from './moderation.ts';
import { computeResults, effectiveQuiz, publicPosts, publicSlide, sentenceText, stripPost, type Snapshot } from './snapshot.ts';

/** Aufgedeckter Animationsschritt der aktuellen Folie (begrenzt auf die vorhandenen Schritte) */
const buildStepOf = (snap: Snapshot) => {
  const slide = snap.current;
  if (!slide) return 0;
  return Math.min(snap.run.state.build?.[slide.id] ?? 0, buildSteps(slide));
};

const handoutUrl = (snap: Snapshot) => (snap.run.handoutToken ? `/h/${snap.run.handoutToken}` : null);

/** Ist „Folien auf Handys zeigen“ aus, bekommt das Publikum die Bildkennung gar nicht erst. */
function participantSlide(snap: Snapshot, slide: Slide): PublicSlide {
  if (slide.type === 'image' && !snap.run.shareSlides) {
    return { ...slide, config: { ...slide.config, asset: '', title: '' } };
  }
  return publicSlide(slide, snap.run.state);
}

/** Bild der nächsten Folie vorab laden, damit der Wechsel auf dem Beamer nicht flackert. */
function preloadFor(snap: Snapshot): string[] {
  const next = snap.slides[snap.index + 1];
  return next?.type === 'image' ? [assetUrl(next.config.asset)] : [];
}

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

function boardViewOf(snap: Snapshot): BoardView | null {
  const slide = snap.current;
  if (slide?.type !== 'board' || !snap.board) return null;
  const view = buildBoardView(slide, snap.board, boardRights(snap.run.state, slide));
  const breakout = breakoutView(snap);
  if (breakout) view.breakout = breakout;
  return view;
}

/** Karten, die eine Person auf ihrem Gerät braucht – nicht die ganze Wand. */
function participantBoardPosts(snap: Snapshot, board: BoardView, participantId: number): PostView[] {
  const slide = snap.current;
  if (slide?.type !== 'board') return [];
  const own = (p: { participantId: number | null }) => p.participantId === participantId;
  const visible = snap.posts.filter((p) => p.status === 'visible');
  let posts: typeof snap.posts;
  switch (slide.config.mode) {
    case 'collect':
      // Gruppenweise: eigene Karten und die der eigenen Arbeitsgruppe (nur lesend)
      posts = breakoutPosts(snap, participantId) ?? snap.posts.filter(own);
      break;
    case 'cluster':
    case 'place':
      // Gemeinsames Bearbeiten: alle Karten, sonst nur die eigenen
      posts = board.rights === 'all' ? visible : visible.filter(own);
      if (slide.config.mode === 'place') {
        const keys = new Set(board.targets);
        posts = posts.filter((p) => keys.has(cardKey(p.id)));
      }
      break;
    case 'dots':
    case 'rate':
    case 'choose': {
      const keys = new Set(board.targets);
      posts = visible.filter((p) => keys.has(cardKey(p.id)));
      break;
    }
    case 'table': {
      const keys = new Set(board.rows.map((r) => r.key));
      posts = visible.filter((p) => keys.has(cardKey(p.id)));
      break;
    }
  }
  return posts.map((p) => ({ ...stripPost(p), mine: own(p) }));
}

function parkingViews(snap: Snapshot, participantId: number): ParkingView[] {
  return snap.parking.map(({ slide, posts }) => {
    const mine = posts.filter((p) => p.participantId === participantId);
    return {
      slideId: slide.id,
      title: slide.config.prompt || slide.config.board,
      tags: slide.config.tags,
      remaining: Math.max(0, slide.config.maxCards - mine.length),
      mine: mine.map((p) => ({ ...stripPost(p), mine: true })),
    };
  });
}

function answerCount(snap: Snapshot): number {
  if (!snap.current) return 0;
  if (snap.current.type === 'board') {
    const mode = snap.current.config.mode;
    if (mode === 'dots' || mode === 'rate') return snap.responses.length;
    if (mode === 'collect') return new Set(snap.posts.map((p) => p.participantId)).size;
    return snap.posts.filter((p) => p.status === 'visible').length;
  }
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
  const board = boardViewOf(snap);
  if (board) {
    posts = participantBoardPosts(snap, board, participantId);
    board.ownGroups = snap.board!.groups.filter((g) => g.participantId === participantId).map((g) => g.id);
    if (slide?.type === 'board' && slide.config.mode === 'collect') {
      board.remaining = Math.max(0, slide.config.maxCards - posts.filter((p) => p.mine).length);
    }
    // Gruppenweises Sammeln: nur die eigene Gruppe, nicht den Stand aller Gruppen
    if (board.breakout) {
      board.myTeam = myTeamView(snap, participantId);
      delete board.breakout;
    }
  }

  let quizPoints: number | null = null;
  if (slide?.type === 'quiz' && quiz?.revealed && own) quizPoints = (own.payload as QuizAnswer).points;

  let rank: ParticipantView['rank'] = null;
  if (state.leaderboard) {
    const entry = snap.leaderboard.find((e) => e.participantId === participantId);
    if (entry) rank = { rank: entry.rank, points: entry.points, of: snap.leaderboard.length };
  }

  let response: unknown = own?.payload ?? null;
  // Gruppen bilden: Rolle von einer früheren Gruppen-Folie vorausgewählt
  if (slide?.type === 'teams' && !own && snap.teamTags.has(participantId)) response = { tag: snap.teamTags.get(participantId) };
  if (slide?.type === 'quiz' && own) response = { choice: (own.payload as QuizAnswer).choice };

  return {
    kind: 'participant',
    run: runInfo(snap),
    serverTime: snap.now,
    name: snap.names.get(participantId) ?? null,
    slide: slide ? participantSlide(snap, slide) : null,
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
    handoutUrl: handoutUrl(snap),
    buildStep: buildStepOf(snap),
    board,
    parking: parkingViews(snap, participantId),
    countdown: state.countdown ?? null,
    team: participantTeam(snap, participantId),
    pause: participantPause(state, participantId),
    ...participantModeration(snap, participantId),
    callback: activeCallback(state.callback, snap.now),
    recall: snap.recall ? snap.recall.filter((c) => c.participantId === participantId).map((c) => c.text) : null,
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

  // Kartenwand: Karten sind die Beschriftung der Wand und bleiben sichtbar – außer beim Sammeln.
  const boardLabels = slide?.type === 'board' && slide.config.mode !== 'collect';
  const posts = state.resultsVisible || slide?.type === 'qa' || boardLabels ? publicPosts(snap).map(stripPost) : [];
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
    preload: preloadFor(snap),
    buildStep: buildStepOf(snap),
    blank: state.blank ?? null,
    board: boardViewOf(snap),
    countdown: state.countdown ?? null,
    teams: teamsView(snap, false),
    pause: displayPause(snap),
    picked: displayPicked(snap),
    callback: activeCallback(state.callback, snap.now),
  };
}

export function hostView(
  snap: Snapshot,
  participants: number,
  online: ReadonlySet<number> = new Set(),
  displays: HostView['displays'] = { connected: 0, hidden: 0 },
): HostView {
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
    preload: [],
    buildStep: buildStepOf(snap),
    blank: state.blank ?? null,
    board: boardViewOf(snap),
    countdown: state.countdown ?? null,
    teams: teamsView(snap, true),
    pause: displayPause(snap),
    pauseStats: pauseStats(state, participants),
    callback: activeCallback(state.callback, snap.now),
    state,
    displayToken: snap.run.displayToken,
    presentationId: snap.run.presentationId,
    display: displayView(snap, participants),
    notes: snap.notes,
    nextSlide: snap.index >= 0 ? (snap.slides[snap.index + 1] ?? null) : (snap.slides[0] ?? null),
    startedAt: snap.run.startedAt,
    targetMinutes: snap.run.targetMinutes,
    handoutUrl: handoutUrl(snap),
    signals: hostSignals(snap),
    picker: pickerView(snap),
    turnsHost: { order: [], current: null, shown: false, missing: 0 },
    presence: presenceView(snap, online),
    rehearsal: snap.run.rehearsal,
    fakeParticipants: snap.run.fakeParticipants,
    displays,
    slides: snap.slides.map((s) => ({
      id: s.id,
      type: s.type,
      headline: slideHeadline(s),
      responses: snap.counts.get(s.id) ?? 0,
      thumb: s.type === 'image' ? assetThumbUrl(s.config.asset) : null,
      plannedMinutes: slidePlannedMinutes(snap.schedule.get(s.id)),
      phases: snap.schedule.get(s.id)?.phases ?? [],
    })),
  };
}
