import type { ResponsePayloads } from './responses.ts';
import type { SlideConfigs } from './slides.ts';
import { dotTotals } from './board.ts';
import { countWords, type WordCount } from './words.ts';

/** Gespeicherte Quiz-Antwort: Auswahl plus beim Abgeben berechnete Punkte. */
export interface QuizAnswer {
  choice: number;
  correct: boolean;
  points: number;
  ms: number;
}

export type SlideResults =
  | { type: 'choice'; voters: number; counts: number[] }
  | { type: 'scale'; voters: number; distribution: number[]; average: number | null }
  | { type: 'wordcloud'; voters: number; words: WordCount[] }
  | { type: 'ranking'; voters: number; items: { index: number; score: number; averagePosition: number | null }[] }
  | { type: 'quiz'; voters: number; counts: number[]; correctVoters: number }
  | { type: 'feedback'; voters: number; distribution: number[]; average: number | null; comments: string[] }
  | { type: 'sentence'; voters: number; words: WordCount[] }
  | BoardResults;

/** Einschätzungen eines Eintrags: je Kriterium Anzahl, Durchschnitt (Stufenindex) und Verteilung */
export interface BoardRating {
  n: number[];
  average: (number | null)[];
  distribution: number[][];
}

export interface BoardResults {
  type: 'board';
  voters: number;
  /** Punkte je Eintrag (nur Punkte-Folien) */
  dots: Record<string, number>;
  /** Einschätzungen je Eintrag (nur Bewerten-Folien) */
  ratings: Record<string, BoardRating>;
  /** Einordnen: Stimmen je Kategorie (Index in `choices`) je Eintrag */
  picks: Record<string, number[]>;
}

const avg = (sum: number, n: number) => (n === 0 ? null : Math.round((sum / n) * 100) / 100);

export function choiceResults(config: SlideConfigs['choice'], rows: ResponsePayloads['choice'][]): SlideResults {
  const counts = config.options.map(() => 0);
  for (const r of rows) for (const i of r.choices) if (i < counts.length) counts[i]!++;
  return { type: 'choice', voters: rows.length, counts };
}

export function scaleResults(config: SlideConfigs['scale'], rows: ResponsePayloads['scale'][]): SlideResults {
  const distribution = Array.from({ length: config.max }, () => 0);
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (r.value < 1 || r.value > config.max) continue;
    distribution[r.value - 1]!++;
    sum += r.value;
    n++;
  }
  return { type: 'scale', voters: n, distribution, average: avg(sum, n) };
}

export function wordcloudResults(rows: ResponsePayloads['wordcloud'][]): SlideResults {
  return { type: 'wordcloud', voters: rows.length, words: countWords(rows.flatMap((r) => r.words)) };
}

/**
 * Ranking nach Borda-Zählung: Platz 1 bekommt n−1 Punkte, der letzte Platz 0.
 * `score` ist auf 0–100 normiert (100 = alle setzen die Option auf Platz 1).
 */
export function rankingResults(config: SlideConfigs['ranking'], rows: ResponsePayloads['ranking'][]): SlideResults {
  const n = config.options.length;
  const points = Array.from({ length: n }, () => 0);
  const positions = Array.from({ length: n }, () => 0);
  let voters = 0;
  for (const r of rows) {
    if (r.order.length !== n) continue;
    voters++;
    r.order.forEach((option, place) => {
      if (option >= n) return;
      points[option]! += n - 1 - place;
      positions[option]! += place + 1;
    });
  }
  const maxPoints = voters * (n - 1);
  const items = points
    .map((p, index) => ({
      index,
      score: maxPoints === 0 ? 0 : Math.round((p / maxPoints) * 100),
      averagePosition: avg(positions[index]!, voters),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return { type: 'ranking', voters, items };
}

export function quizResults(config: SlideConfigs['quiz'], rows: QuizAnswer[]): SlideResults {
  const counts = config.options.map(() => 0);
  let correctVoters = 0;
  for (const r of rows) {
    if (r.choice < counts.length) counts[r.choice]!++;
    if (config.correct.includes(r.choice)) correctVoters++;
  }
  return { type: 'quiz', voters: rows.length, counts, correctVoters };
}

export function feedbackResults(rows: ResponsePayloads['feedback'][]): SlideResults {
  const distribution = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const r of rows) {
    distribution[r.rating - 1]!++;
    sum += r.rating;
  }
  const comments = rows.map((r) => r.comment.trim()).filter(Boolean);
  return { type: 'feedback', voters: rows.length, distribution, average: avg(sum, rows.length), comments };
}

export function sentenceResults(rows: ResponsePayloads['sentence'][]): SlideResults {
  return { type: 'sentence', voters: rows.length, words: countWords(rows.map((r) => r.word)) };
}

export function boardResults(config: SlideConfigs['board'], rows: ResponsePayloads['board'][]): BoardResults {
  const ratings: Record<string, BoardRating> = {};
  const scales = config.scales;
  for (const r of rows) {
    for (const [key, values] of Object.entries(r.ratings ?? {})) {
      const entry = (ratings[key] ??= {
        n: scales.map(() => 0),
        average: scales.map(() => null),
        distribution: scales.map((s) => s.levels.map(() => 0)),
      });
      values.forEach((v, i) => {
        if (v === null || i >= scales.length || v >= scales[i]!.levels.length) return;
        entry.n[i]!++;
        entry.distribution[i]![v]!++;
      });
    }
  }
  for (const entry of Object.values(ratings)) {
    entry.average = entry.distribution.map((d, i) => {
      const n = entry.n[i]!;
      return n === 0 ? null : Math.round((d.reduce((sum, count, level) => sum + count * level, 0) / n) * 100) / 100;
    });
  }
  const picks: Record<string, number[]> = {};
  for (const r of rows) {
    for (const [key, chosen] of Object.entries(r.picks ?? {})) {
      const counts = (picks[key] ??= config.choices.map(() => 0));
      for (const i of new Set(chosen)) if (i < counts.length) counts[i]!++;
    }
  }
  return { type: 'board', voters: rows.length, dots: dotTotals(rows), ratings, picks };
}

/**
 * Punkte für eine Quiz-Antwort: richtig gibt 500 Punkte plus bis zu 500 für
 * Schnelligkeit (linear über das Zeitlimit), falsch gibt 0.
 */
export function quizPoints(correct: boolean, elapsedMs: number, timeLimitSec: number): number {
  if (!correct) return 0;
  const limit = timeLimitSec * 1000;
  const fraction = Math.min(1, Math.max(0, elapsedMs / limit));
  return Math.round(500 + 500 * (1 - fraction));
}

export interface LeaderboardEntry {
  participantId: number;
  name: string;
  points: number;
  correct: number;
  rank: number;
}

/** Rangliste über alle Quizfragen einer Durchführung; gleiche Punkte teilen sich den Rang. */
export function leaderboard(rows: { participantId: number; name: string | null; points: number; correct: boolean }[]): LeaderboardEntry[] {
  const totals = new Map<number, { name: string; points: number; correct: number }>();
  for (const r of rows) {
    const t = totals.get(r.participantId) ?? { name: r.name ?? 'Anonym', points: 0, correct: 0 };
    t.points += r.points;
    if (r.correct) t.correct++;
    if (r.name) t.name = r.name;
    totals.set(r.participantId, t);
  }
  const sorted = [...totals.entries()]
    .map(([participantId, t]) => ({ participantId, ...t, rank: 0 }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'de'));
  sorted.forEach((e, i) => {
    e.rank = i > 0 && sorted[i - 1]!.points === e.points ? sorted[i - 1]!.rank : i + 1;
  });
  return sorted;
}
