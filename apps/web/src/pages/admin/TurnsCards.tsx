import { cardsByTurn, type PostView, type TurnsHostView } from '@slides/shared';
import type { ReactNode } from 'react';

/**
 * Ablage beim Clustern nach Person: Reihenfolge wie reihum, wer dran ist zuerst
 * und hervorgehoben, Karten der Moderation zuletzt. So bringt jede Person ihre
 * Karten der Reihe nach ein, und die Moderation findet sie sofort.
 */
export function CardsByPerson({
  posts,
  turns,
  renderCard,
}: {
  posts: PostView[];
  turns: TurnsHostView;
  renderCard: (post: PostView) => ReactNode;
}) {
  const order = turns.order.map((p) => p.id);
  const currentId = turns.current === null ? null : (order[turns.current] ?? null);
  const groups = cardsByTurn(posts, order, turns.current);
  // Karten sind anonym: Namen nur für Personen in der Reihenfolge (die stellen ihre Karten ohnehin selbst vor)
  const names = new Map(turns.order.map((p) => [p.id, p.name]));
  let others = 0;
  return (
    <div className="stack-s">
      <span className="label">Ablage ({posts.length})</span>
      {groups.map(({ authorId, posts: cards }) => {
        const isCurrent = authorId !== null && authorId === currentId;
        const pos = authorId === null ? -1 : order.indexOf(authorId);
        const name =
          authorId === null
            ? 'Moderation'
            : (names.get(authorId) ?? cards[0]?.authorName ?? `${order.length > 0 ? 'Nicht in der Reihe' : 'Person'} ${++others}`);
        return (
          <div key={authorId ?? 'host'} className={`cards-person ${isCurrent ? 'is-current' : ''}`}>
            <div className="cards-person-head small">
              {pos >= 0 && <span className="faint tabular">{pos + 1}.</span>}
              <strong>{name}</strong>
              <span className="faint tabular">{cards.length}</span>
              {isCurrent && <span className="cards-person-badge">dran</span>}
            </div>
            <ul className="mod-list">{cards.map(renderCard)}</ul>
          </div>
        );
      })}
    </div>
  );
}
