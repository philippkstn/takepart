import { leadingChoices, type BoardOp, type BoardResults, type HostView } from '@slides/shared';
import { Check } from 'lucide-react';
import { labelOf } from '../../lib/board.ts';
import { TagChips, TieMark, topTieText } from '../../components/board/BoardMarks.tsx';

type BoardHostSlide = Extract<NonNullable<HostView['slide']>, { type: 'board' }>;

/**
 * Einordnen im Steuerpult: je Eintrag die Stimmen je Kategorie; ein Klick auf eine
 * Kategorie legt sie fest (oder hebt die Festlegung auf). Ohne Festlegung zählen
 * die meistgewählten Kategorien.
 */
export function ChooseControls({ view, op, busy }: { view: HostView; op: (o: BoardOp) => void; busy: boolean }) {
  const board = view.board!;
  const slide = view.slide as BoardHostSlide;
  const { choices, multi, top, targets } = slide.config;
  const results = view.results as BoardResults | null;
  const tie = topTieText(board, top, targets);
  if (board.targets.length === 0) return <p className="muted small">Auf dieser Wand gibt es noch keine Einträge.</p>;

  const toggle = (key: string, i: number) => {
    const current = board.chosen[key] ?? [];
    const next = current.includes(i) ? current.filter((x) => x !== i) : multi ? [...current, i] : [i];
    op({ op: 'choose-set', key, choices: next });
  };

  return (
    <div className="stack-s">
      <span className="label">
        {view.answers} {view.answers === 1 ? 'Antwort' : 'Antworten'}
        {!view.resultsVisible && ' · Ergebnisse auf dem Beamer verborgen'}
      </span>
      {tie && <p className="small faint">{tie} – alle gleichauf liegenden stehen zur Wahl.</p>}
      <p className="small faint">Kategorie antippen, um sie festzulegen – sonst zählen die meistgewählten.</p>
      <ul className="mod-list">
        {board.targets.map((key) => {
          const counts = results?.picks[key];
          const lead = leadingChoices(counts, board.chosen[key]);
          return (
            <li key={key} className="mod-item">
              <div className="mod-text">
                <span>{labelOf(key, view.posts, board)}</span>
                <span className="post-meta">
                  <TagChips board={board} itemKey={key} />
                  {board.tied.includes(key) && <TieMark />}
                </span>
                <div className="choose-chips" role="group" aria-label="Kategorie festlegen">
                  {choices.map((c, i) => {
                    const fixed = lead.fixed && lead.indices.includes(i);
                    const leading = !lead.fixed && lead.indices.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`choose-chip is-small ${leading ? 'is-leading' : ''}`}
                        aria-pressed={fixed}
                        disabled={busy}
                        title={fixed ? 'Festlegung aufheben' : 'Festlegen'}
                        onClick={() => toggle(key, i)}
                      >
                        {fixed && <Check aria-hidden />}
                        {c} <span className="tabular faint">{counts?.[i] ?? 0}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
