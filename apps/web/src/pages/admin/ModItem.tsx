import type { HostCommand, PostView } from '@slides/shared';
import { Check, ChevronUp, Eye, EyeOff, Maximize2 } from 'lucide-react';

type Cmd = (cmd: HostCommand) => Promise<void>;

/** Ein Beitrag in der Moderation: freigeben, groß zeigen, beantworten, ausblenden */
export function ModItem({
  post,
  command,
  spotlight,
  columns,
  qa,
  canSpotlight = true,
}: {
  post: PostView;
  command: Cmd;
  spotlight: number | null;
  columns: string[] | null;
  qa?: boolean;
  /** „Groß zeigen“ geht nur mit Beiträgen der aktuellen Folie */
  canSpotlight?: boolean;
}) {
  const isSpot = spotlight === post.id;
  return (
    <li className={`mod-item ${isSpot ? 'is-spot' : ''} ${post.status === 'hidden' ? 'is-hidden' : ''}`}>
      <div className="mod-text">
        <span>{post.text}</span>
        <span className="post-meta">
          {post.authorName && <span>{post.authorName}</span>}
          {columns && post.column !== null && <span className="pill">{columns[post.column]}</span>}
          {post.votes > 0 && (
            <span className="pill">
              <ChevronUp /> {post.votes}
            </span>
          )}
          {post.status === 'answered' && <span className="pill pill-good">beantwortet</span>}
          {post.status === 'hidden' && <span className="pill">ausgeblendet</span>}
        </span>
      </div>
      <div className="mod-actions">
        {post.status === 'pending' && (
          <button
            className="btn btn-small btn-primary"
            onClick={() => command({ action: 'post-status', postId: post.id, status: 'visible' })}
          >
            <Check /> Freigeben
          </button>
        )}
        {canSpotlight && post.status === 'visible' && (
          <button
            className={`btn btn-small ${isSpot ? 'btn-ink' : ''}`}
            onClick={() => command({ action: 'spotlight', postId: isSpot ? null : post.id })}
          >
            <Maximize2 /> {isSpot ? 'Groß aus' : 'Groß zeigen'}
          </button>
        )}
        {qa && post.status === 'visible' && (
          <button
            className="btn btn-small"
            title="Als beantwortet markieren – verschwindet auch aus dem Großformat"
            onClick={() => command({ action: 'post-status', postId: post.id, status: 'answered' })}
          >
            <Check /> Beantwortet
          </button>
        )}
        {post.status !== 'hidden' ? (
          <button
            className="icon-btn"
            title="Ausblenden"
            aria-label="Ausblenden"
            onClick={() => command({ action: 'post-status', postId: post.id, status: 'hidden' })}
          >
            <EyeOff />
          </button>
        ) : (
          <button
            className="icon-btn"
            title="Wieder zeigen"
            aria-label="Wieder zeigen"
            onClick={() => command({ action: 'post-status', postId: post.id, status: 'visible' })}
          >
            <Eye />
          </button>
        )}
      </div>
    </li>
  );
}
