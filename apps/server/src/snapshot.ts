import {
  boardResults,
  buildSentence,
  choiceResults,
  feedbackResults,
  isPostType,
  leaderboard,
  quizResults,
  quizState,
  rankingResults,
  scaleResults,
  sentenceResults,
  sentenceState,
  wordcloudResults,
  type LeaderboardEntry,
  type PostStatus,
  type PostView,
  type PublicSlide,
  type QuizAnswer,
  type QuizState,
  type ResponsePayloads,
  type RunState,
  type BrandView,
  type Slide,
  type SlideResults,
  type SlideType,
  type SlideSchedule,
} from '@slides/shared';
import { loadBoard, loadCards, type BoardData, type BoardSlide } from './board.ts';
import { BRAND_COLUMNS, brandView, type BrandRow } from './brands.ts';
import { json, one, query, type Conn } from './db.ts';
import { loadTeamTags } from './teams.ts';
import { loadSchedule } from './schedule.ts';

/**
 * Alles, was für die Ansichten einer Durchführung gebraucht wird – einmal pro
 * Broadcast geladen und dann für jede verbundene Person zusammengesetzt.
 */
export interface Snapshot {
  run: {
    id: number;
    presentationId: number;
    title: string;
    code: string | null;
    displayToken: string;
    ended: boolean;
    state: RunState;
    brand: BrandView | null;
    startedAt: number;
    handoutToken: string | null;
    shareSlides: boolean;
    targetMinutes: number | null;
    /** Probelauf (nicht im Archiv) */
    rehearsal: boolean;
    /** Simulierte Testteilnehmende eines Probelaufs */
    fakeParticipants: number;
  };
  slides: Slide[];
  /** Sprechernotizen der aktuellen Folie – nur für die Host-Ansicht */
  notes: string;
  /** Ablaufplan je Folie (Soll-Dauer, Phasen) – nur für die Host-Ansicht */
  schedule: Map<number, SlideSchedule>;
  current: Slide | null;
  index: number;
  /** Antworten auf die aktuelle Folie (beim Satz-Spiel: aktuelle Runde) */
  responses: { participantId: number; payload: unknown }[];
  posts: SnapshotPost[];
  /** Kartenwand der aktuellen Folie */
  board: BoardData | null;
  /** Sammel-Folien, die jederzeit Karten annehmen (Parkplatz), mit ihren Karten */
  parking: { slide: BoardSlide; posts: SnapshotPost[] }[];
  /** participantId → hochgevotete Post-IDs der aktuellen Folie */
  votes: Map<number, Set<number>>;
  names: Map<number, string>;
  /** Alle Teilnehmenden der Durchführung, auch ohne Namen */
  participantTotal: number;
  /** Gruppen bilden: Kennzeichnung je Person (auch von früheren Gruppen-Folien übernommen) */
  teamTags: Map<number, number | null>;
  leaderboard: LeaderboardEntry[];
  counts: Map<number, number>;
  now: number;
}

/** Beitrag mit Person (null: von der Moderation ergänzte Karte) */
export type SnapshotPost = PostView & { participantId: number | null };

interface RunRow extends BrandRow {
  id: number;
  presentation_id: number;
  title: string;
  code: string | null;
  display_token: string;
  handout_token: string | null;
  state: string;
  started_at: Date;
  ended_at: Date | null;
  share_slides: number;
  target_minutes: number | null;
  rehearsal: number;
}

interface SlideRow {
  id: number;
  type: SlideType;
  position: number;
  config: string;
}

export function toSlide(row: SlideRow): Slide {
  return { id: row.id, type: row.type, position: row.position, config: json(row.config) } as Slide;
}

export async function loadSlides(db: Conn, presentationId: number): Promise<Slide[]> {
  const rows = await query<SlideRow>(db, 'SELECT id, type, position, config FROM slides WHERE presentation_id = ? ORDER BY position, id', [
    presentationId,
  ]);
  return rows.map(toSlide);
}

/** Quizphase unter Berücksichtigung des Zeitlimits: nach Ablauf ist die Frage geschlossen. */
export function effectiveQuiz(state: RunState, slideId: number, now: number): QuizState {
  const q = quizState(state, slideId);
  if (q.phase === 'open' && q.closesAt !== null && now >= q.closesAt) return { ...q, phase: 'closed' };
  return q;
}

export async function loadSnapshot(db: Conn, runId: number): Promise<Snapshot | null> {
  const run = await one<RunRow>(
    db,
    `SELECT r.id, r.presentation_id, p.title, r.code, r.display_token, r.handout_token, r.state, r.started_at, r.ended_at, r.rehearsal,
            p.share_slides, p.target_minutes, ${BRAND_COLUMNS}
       FROM runs r JOIN presentations p ON p.id = r.presentation_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE r.id = ?`,
    [runId],
  );
  if (!run) return null;
  const state = json<RunState>(run.state);
  const slides = await loadSlides(db, run.presentation_id);
  const index = slides.findIndex((s) => s.id === state.slideId);
  const current = index >= 0 ? slides[index]! : null;
  const now = Date.now();

  let responses: Snapshot['responses'] = [];
  let posts: Snapshot['posts'] = [];
  let board: BoardData | null = null;
  const votes = new Map<number, Set<number>>();

  if (current?.type === 'board') {
    board = await loadBoard(db, runId, slides, current);
    posts = board.cards.map(cardToPost);
    if (current.config.mode === 'dots' || current.config.mode === 'rate' || current.config.mode === 'choose') {
      const rows = await query<{ participant_id: number; payload: string }>(
        db,
        'SELECT participant_id, payload FROM responses WHERE run_id = ? AND slide_id = ? AND round = 1 ORDER BY id',
        [runId, current.id],
      );
      responses = rows.map((r) => ({ participantId: r.participant_id, payload: json(r.payload) }));
    }
  } else if (current && isPostType(current.type)) {
    const rows = await query<{
      id: number;
      participant_id: number;
      author_name: string | null;
      text: string;
      column_index: number | null;
      status: PostStatus;
      votes: number;
      created_at: Date;
    }>(
      db,
      `SELECT id, participant_id, author_name, text, column_index, status, votes, created_at
         FROM posts WHERE run_id = ? AND slide_id = ? ORDER BY created_at, id`,
      [runId, current.id],
    );
    posts = rows.map((r) => ({
      id: r.id,
      participantId: r.participant_id,
      authorName: r.author_name,
      text: r.text,
      column: r.column_index,
      status: r.status,
      votes: r.votes,
      createdAt: r.created_at.getTime(),
    }));
    if (current.type === 'qa' || current.type === 'brainstorm') {
      const voteRows = await query<{ post_id: number; participant_id: number }>(
        db,
        `SELECT v.post_id, v.participant_id FROM post_votes v JOIN posts p ON p.id = v.post_id
          WHERE p.run_id = ? AND p.slide_id = ?`,
        [runId, current.id],
      );
      for (const v of voteRows) {
        let set = votes.get(v.participant_id);
        if (!set) votes.set(v.participant_id, (set = new Set()));
        set.add(v.post_id);
      }
    }
  } else if (current && current.type !== 'content' && current.type !== 'image') {
    const round = current.type === 'sentence' ? sentenceState(state, current.id).round : 1;
    const rows = await query<{ participant_id: number; payload: string }>(
      db,
      'SELECT participant_id, payload FROM responses WHERE run_id = ? AND slide_id = ? AND round = ? ORDER BY id',
      [runId, current.id, round],
    );
    responses = rows.map((r) => ({ participantId: r.participant_id, payload: json(r.payload) }));
  }

  const nameRows = await query<{ id: number; name: string }>(
    db,
    'SELECT id, name FROM participants WHERE run_id = ? AND name IS NOT NULL',
    [runId],
  );
  const names = new Map(nameRows.map((r) => [r.id, r.name]));
  const total = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM participants WHERE run_id = ?', [runId]);
  const fakes = run.rehearsal
    ? Number((await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM participants WHERE run_id = ? AND fake = 1', [runId]))?.n ?? 0)
    : 0;

  let ranking: LeaderboardEntry[] = [];
  if (slides.some((s) => s.type === 'quiz')) {
    const quizRows = await query<{ participant_id: number; payload: string }>(
      db,
      `SELECT r.participant_id, r.payload FROM responses r JOIN slides s ON s.id = r.slide_id
        WHERE r.run_id = ? AND s.type = 'quiz'`,
      [runId],
    );
    ranking = leaderboard(
      quizRows.map((r) => {
        const a = json<QuizAnswer>(r.payload);
        return { participantId: r.participant_id, name: names.get(r.participant_id) ?? null, points: a.points, correct: a.correct };
      }),
    );
  }

  const countRows = await query<{ slide_id: number; n: number }>(
    db,
    `SELECT slide_id, COUNT(DISTINCT participant_id) AS n FROM responses WHERE run_id = ? GROUP BY slide_id
     UNION ALL
     SELECT slide_id, COUNT(*) AS n FROM posts WHERE run_id = ? GROUP BY slide_id`,
    [runId, runId],
  );
  const counts = new Map<number, number>();
  for (const r of countRows) counts.set(r.slide_id, (counts.get(r.slide_id) ?? 0) + Number(r.n));

  // Parkplatz: Sammel-Folien, die von jeder Folie aus Karten annehmen
  const parkingSlides = slides.filter(
    (s): s is BoardSlide => s.type === 'board' && s.config.mode === 'collect' && s.config.anytime && s.id !== current?.id,
  );
  const parkingCards = await loadCards(
    db,
    runId,
    parkingSlides.map((s) => s.id),
  );
  const parking = parkingSlides.map((slide) => ({
    slide,
    posts: parkingCards.filter((c) => c.slideId === slide.id).map(cardToPost),
  }));

  const notes = current
    ? ((await one<{ notes: string | null }>(db, 'SELECT notes FROM slides WHERE id = ?', [current.id]))?.notes ?? '')
    : '';

  return {
    run: {
      id: run.id,
      presentationId: run.presentation_id,
      title: run.title,
      code: run.code,
      displayToken: run.display_token,
      ended: run.ended_at !== null,
      state,
      brand: brandView(run),
      startedAt: run.started_at.getTime(),
      handoutToken: run.handout_token,
      shareSlides: !!run.share_slides,
      rehearsal: !!run.rehearsal,
      fakeParticipants: fakes,
      targetMinutes: run.target_minutes,
    },
    slides,
    notes,
    schedule: await loadSchedule(db, run.presentation_id),
    current,
    index,
    responses,
    posts,
    board,
    parking,
    votes,
    names,
    participantTotal: Number(total?.n ?? 0),
    teamTags: current?.type === 'teams' ? await loadTeamTags(db, runId, current.id) : new Map(),
    leaderboard: ranking,
    counts,
    now,
  };
}

function cardToPost(c: BoardData['cards'][number]): SnapshotPost {
  return {
    id: c.id,
    participantId: c.participantId,
    authorName: null,
    text: c.text,
    column: c.column,
    status: c.status,
    votes: c.votes,
    createdAt: c.createdAt,
    group: c.group,
    team: c.team,
  };
}

/** Ergebnisse einer Folie aus ihren Antworten. Für Post-Folien und Textfolien `null`. */
export function computeResults(slide: Slide, payloads: unknown[]): SlideResults | null {
  switch (slide.type) {
    case 'choice':
      return choiceResults(slide.config, payloads as ResponsePayloads['choice'][]);
    case 'scale':
      return scaleResults(slide.config, payloads as ResponsePayloads['scale'][]);
    case 'wordcloud':
      return wordcloudResults(payloads as ResponsePayloads['wordcloud'][]);
    case 'ranking':
      return rankingResults(slide.config, payloads as ResponsePayloads['ranking'][]);
    case 'quiz':
      return quizResults(slide.config, payloads as QuizAnswer[]);
    case 'feedback':
      return feedbackResults(payloads as ResponsePayloads['feedback'][]);
    case 'sentence':
      return sentenceResults(payloads as ResponsePayloads['sentence'][]);
    case 'board':
      if (slide.config.mode !== 'dots' && slide.config.mode !== 'rate' && slide.config.mode !== 'choose') return null;
      return boardResults(slide.config, payloads as ResponsePayloads['board'][]);
    default:
      return null;
  }
}

/** Quizlösung erst nach dem Auflösen mitschicken. */
export function publicSlide(slide: Slide, state: RunState): PublicSlide {
  if (slide.type !== 'quiz') return slide;
  if (quizState(state, slide.id).revealed) return slide;
  const { correct: _hidden, ...config } = slide.config;
  return { ...slide, config };
}

export function sentenceText(slide: Slide & { type: 'sentence' }, state: RunState): string {
  return buildSentence(slide.config.start, sentenceState(state, slide.id).words);
}

const byVotes = (a: PostView, b: PostView) => b.votes - a.votes || a.createdAt - b.createdAt;

export function stripPost({ participantId: _p, ...post }: SnapshotPost): PostView {
  return post;
}

/** Beiträge, die öffentlich sichtbar sind (Beamer und Publikum). */
export function publicPosts(snap: Snapshot): SnapshotPost[] {
  const slide = snap.current;
  if (!slide) return [];
  const visible = snap.posts.filter((p) => p.status === 'visible' || (slide.type === 'qa' && p.status === 'answered'));
  if (slide.type === 'qa' || (slide.type === 'brainstorm' && slide.config.allowVotes)) {
    return visible.sort((a, b) => Number(a.status === 'answered') - Number(b.status === 'answered') || byVotes(a, b));
  }
  return visible;
}
