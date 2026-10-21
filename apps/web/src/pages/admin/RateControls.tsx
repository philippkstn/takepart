import { entryTagColumns, hasVoteScale, levelLabel, tagLevel, type BoardOp, type BoardResults, type HostView } from '@slides/shared';
import { Check } from 'lucide-react';
import { labelOf } from '../../lib/board.ts';
import { TagChips, TieMark, topTieText } from '../../components/board/BoardMarks.tsx';

type BoardHostSlide = Extract<NonNullable<HostView['slide']>, { type: 'board' }>;

/**
 * Bewerten im Steuerpult: je Eintrag und Kriterium Stufen-Chips. Ein Klick legt die
 * Stufe fest, ein zweiter hebt die Festlegung auf – dann gilt wieder die Quelle
 * (Durchschnitt der Stimmen bzw. der Kennzeichnungen der Karten). Bei Kriterien der
 * Moderation ist die Festlegung der Wert.
 */
export function RateControls({ view, op, busy }: { view: HostView; op: (o: BoardOp) => void; busy: boolean }) {
  const board = view.board!;
  const slide = view.slide as BoardHostSlide;
  const { scales, top, targets } = slide.config;
  const results = view.results?.type === 'board' ? (view.results as BoardResults) : null;
  const tie = topTieText(board, top, targets);
  const votes = hasVoteScale(slide.config);
  if (board.targets.length === 0) return <p className="muted small">Auf dieser Wand gibt es noch keine Einträge.</p>;

  const fixedOf = (key: string, i: number): number | null => (board.ratedFixed[key]?.[i] ? (board.rated[key]?.[i] ?? null) : null);
  const toggle = (key: string, i: number, level: number) => {
    const values = scales.map((_, j) => fixedOf(key, j));
    values[i] = values[i] === level ? null : level;
    op({ op: 'rate-set', key, values });
  };
  /** Wert aus der Quelle (ohne Festlegung) und kurzer Text dazu */
  const sourceOf = (key: string, i: number): { level: number | null; text: string | null } => {
    const scale = scales[i]!;
    if (scale.source === 'votes') {
      const avg = results?.ratings[key]?.average[i] ?? null;
      const n = results?.ratings[key]?.n[i] ?? 0;
      return { level: avg, text: n > 0 ? `Ø ${levelLabel(scale.levels, avg)} · ${n}×` : 'noch keine Stimmen' };
    }
    if (scale.source === 'tags') {
      const level = tagLevel(entryTagColumns(key, view.posts), scale.levels.length);
      return { level, text: level === null ? 'keine gekennzeichneten Karten' : `Karten: ${levelLabel(scale.levels, level)}` };
    }
    return { level: null, text: null };
  };

  return (
    <div className="stack-s">
      <span className="label">
        {votes ? `${view.answers} ${view.answers === 1 ? 'Antwort' : 'Antworten'}` : 'Die Moderation ordnet ein'}
        {votes && !view.resultsVisible && ' · Stimmen auf dem Beamer verborgen'}
      </span>
      {tie && <p className="small faint">{tie} – alle gleichauf liegenden stehen zur Wahl.</p>}
      <p className="small faint">Stufe antippen, um sie festzulegen – noch einmal antippen hebt die Festlegung auf.</p>
      <ul className="mod-list">
        {board.targets.map((key) => (
          <li key={key} className="mod-item">
            <div className="mod-text">
              <span>{labelOf(key, view.posts, board)}</span>
              <span className="post-meta">
                <TagChips board={board} itemKey={key} />
                {board.tied.includes(key) && <TieMark />}
              </span>
              {scales.map((scale, i) => {
                const fixed = fixedOf(key, i);
                const source = sourceOf(key, i);
                const leading = fixed === null && source.level !== null ? Math.round(source.level) : null;
                return (
                  <div key={i} className="rate-control-row">
                    <span className="small muted rate-control-label">{scale.label}</span>
                    <div className="choose-chips" role="group" aria-label={`${scale.label} festlegen`}>
                      {scale.levels.map((level, l) => (
                        <button
                          key={l}
                          type="button"
                          className={`choose-chip is-small ${leading === l ? 'is-leading' : ''}`}
                          aria-pressed={fixed === l}
                          disabled={busy}
                          title={fixed === l ? 'Festlegung aufheben' : 'Festlegen'}
                          onClick={() => toggle(key, i, l)}
                        >
                          {fixed === l && <Check aria-hidden />}
                          {level}
                        </button>
                      ))}
                    </div>
                    {source.text && <span className="small faint tabular">{source.text}</span>}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
