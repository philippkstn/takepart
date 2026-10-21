import { leadingChoices, type BoardConfig, type BoardResults, type BoardView, type PostView } from '@slides/shared';
import { Check, EyeOff } from 'lucide-react';
import { labelOf } from '../../lib/board.ts';
import { ScrollingResults } from '../../lib/autoScroll.tsx';
import { TagChips, TieMark } from './BoardMarks.tsx';

/**
 * Einordnen auf der Bühne: je Eintrag die Kategorien (z. B. Art des Nutzens) als
 * Spalten mit kleinen Balken und Zählern. Festlegungen der Moderation sind mit
 * Haken markiert, sonst sind die meistgewählten hervorgehoben. Solange die
 * Ergebnisse verborgen sind, erscheinen nur die Einträge und die Festlegungen.
 */
export function ChooseStage({
  slideId,
  config,
  board,
  posts,
  results,
  tied,
}: {
  slideId: number | undefined;
  config: Pick<BoardConfig, 'choices'>;
  board: BoardView;
  posts: PostView[];
  results: BoardResults | null;
  tied: Set<string>;
}) {
  if (board.targets.length === 0)
    return (
      <div className="stage-waiting">
        <EyeOff />
        <span>Noch keine Einträge auf dieser Wand</span>
      </div>
    );
  const showVotes = !!results && results.type === 'board' && results.voters > 0;
  const max = Math.max(1, ...board.targets.flatMap((k) => results?.picks[k] ?? []));
  return (
    <ScrollingResults key={slideId} className="stage-results board-results">
      <table className="choose-table" style={{ ['--choices' as string]: config.choices.length }}>
        <thead>
          <tr>
            <th>Thema</th>
            {config.choices.map((c, i) => (
              <th key={i} className="choose-col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.targets.map((key) => {
            const counts = showVotes ? results!.picks[key] : undefined;
            const lead = leadingChoices(counts, board.chosen[key]);
            return (
              <tr key={key}>
                <td className="choose-topic">
                  <span className="clamp">{labelOf(key, posts, board)}</span>
                  <span className="row" style={{ gap: '0.35em' }}>
                    <TagChips board={board} itemKey={key} />
                    {tied.has(key) && <TieMark />}
                  </span>
                </td>
                {config.choices.map((c, i) => {
                  const n = counts?.[i] ?? 0;
                  const on = lead.indices.includes(i);
                  return (
                    <td
                      key={i}
                      className={`choose-cell ${on ? 'is-lead' : ''} ${on && lead.fixed ? 'is-fixed' : ''}`}
                      aria-label={`${c}: ${n} ${n === 1 ? 'Stimme' : 'Stimmen'}${on && lead.fixed ? ', festgelegt' : ''}`}
                    >
                      {on && lead.fixed && (
                        <span className="choose-fixed">
                          <Check /> festgelegt
                        </span>
                      )}
                      {showVotes && (
                        <span className="choose-bar-row">
                          <span className="choose-bar">
                            <span style={{ width: `${(n / max) * 100}%` }} />
                          </span>
                          <span className="tabular choose-n">{n}</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollingResults>
  );
}
