import type { ParticipantView, PublicSlide, ResponsePayloads } from '@slides/shared';
import { Check, Hourglass, Lock, Send } from 'lucide-react';
import { useState } from 'react';
import { labelOf } from '../../lib/board.ts';
import { TagChips } from '../board/BoardMarks.tsx';
import { Expandable, Note, useSend } from './BoardActivity.tsx';

type BoardSlide = Extract<PublicSlide, { type: 'board' }>;

/**
 * Einordnen auf dem Handy: je Eintrag die Kategorien als Chips zum An- und Abwählen
 * (ohne Mehrfachauswahl wie Optionsfelder). Gespeichert wird wie beim Bewerten.
 */
export function ChooseActivity({ view, slide, token }: { view: ParticipantView; slide: BoardSlide; token: string }) {
  const board = view.board!;
  const own = view.response as ResponsePayloads['board'] | null;
  const { choices, multi } = slide.config;
  const [picks, setPicks] = useState<Record<string, number[]>>(own?.picks ?? {});
  const [editing, setEditing] = useState(!own);
  const { send, busy } = useSend(token);
  const toggle = (key: string, i: number) =>
    setPicks((p) => {
      const list = p[key] ?? [];
      const next = list.includes(i) ? list.filter((x) => x !== i) : multi ? [...list, i].sort((a, b) => a - b) : [i];
      return { ...p, [key]: next };
    });
  const done = board.targets.filter((k) => (picks[k]?.length ?? 0) > 0).length;
  const submit = async () => {
    const payload = Object.fromEntries(Object.entries(picks).filter(([k, v]) => v.length > 0 && board.targets.includes(k)));
    if (await send('/api/p/respond', { slideId: slide.id, payload: { picks: payload } })) setEditing(false);
  };
  const fixed = (key: string) => (board.chosen[key] ?? []).map((i) => choices[i]).filter(Boolean);

  if (board.targets.length === 0) return <Note icon={<Hourglass size={20} />}>Noch gibt es nichts einzuordnen.</Note>;
  if (own && !editing) {
    return (
      <div className="done-box">
        <span className="check">
          <Check />
        </span>
        <div className="grow">
          <strong>Danke für deine Einordnung!</strong>
          <ul className="small muted board-done-list">
            {Object.entries(own.picks ?? {}).map(([k, list]) => (
              <li key={k}>
                {labelOf(k, view.posts, board)}: {list.map((i) => choices[i]).join(', ')}
              </li>
            ))}
          </ul>
        </div>
        {!view.locked && (
          <button className="btn btn-small" onClick={() => setEditing(true)}>
            Ändern
          </button>
        )}
      </div>
    );
  }
  if (view.locked) return <Note icon={<Lock size={20} />}>Die Einordnung ist geschlossen.</Note>;
  return (
    <>
      <p className="small muted">
        {multi ? 'Wähle je Thema eine oder mehrere Kategorien.' : 'Wähle je Thema eine Kategorie.'} Was du nicht beurteilen kannst, lässt du
        leer.
      </p>
      <ul className="board-rate-list">
        {board.targets.map((key) => {
          const list = picks[key] ?? [];
          const set = fixed(key);
          return (
            <li key={key} className="card card-pad choose-item">
              <div className="choose-item-head">
                <Expandable as="strong" text={labelOf(key, view.posts, board)} />
                <TagChips board={board} itemKey={key} />
                {set.length > 0 && <span className="small muted">Von der Moderation festgelegt: {set.join(', ')}</span>}
              </div>
              <div
                className="choose-chips"
                role={multi ? 'group' : 'radiogroup'}
                aria-label={`Kategorien für ${labelOf(key, view.posts, board)}`}
              >
                {choices.map((c, i) => {
                  const on = list.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      className="choose-chip"
                      role={multi ? undefined : 'radio'}
                      aria-checked={multi ? undefined : on}
                      aria-pressed={on}
                      onClick={() => toggle(key, i)}
                    >
                      {on && <Check aria-hidden />}
                      {c}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <button className="btn btn-primary btn-large board-submit" onClick={submit} disabled={busy || done === 0}>
        Einordnung abgeben ({done}/{board.targets.length}) <Send />
      </button>
    </>
  );
}
