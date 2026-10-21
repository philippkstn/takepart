import './marks.css';
import { tagCountParts, tagCountText, tieAtLimit, tiedKeys, type BoardResults, type BoardView } from '@slides/shared';

/**
 * Kleine Marken an Einträgen einer Kartenwand: Verteilung der Kennzeichnungen
 * (z. B. „XL 3 · L 2 · M 1“) und Gleichstand. Gemeinsam für Beamer, Steuerpult und Handy.
 */

/** Verteilung der Kennzeichnungen einer Gruppe – große Stufen zuerst, nur Werte über null */
export function TagChips({
  board,
  itemKey,
  className = '',
}: {
  board: Pick<BoardView, 'tags' | 'tagCounts'>;
  itemKey: string;
  className?: string;
}) {
  const parts = tagCountParts(board.tags, board.tagCounts[itemKey]);
  if (parts.length === 0) return null;
  return (
    <span className={`tag-dist ${className}`} title={`Kennzeichnungen: ${tagCountText(board.tags, board.tagCounts[itemKey])}`}>
      {parts.map((p) => (
        <span key={p.tag} className="tag-dist-chip">
          {p.tag} <span className="tabular">{p.n}</span>
        </span>
      ))}
    </span>
  );
}

/** Dezenter Hinweis „gleichauf“ */
export function TieMark() {
  return (
    <span className="tie-mark" title="Gleich viele Punkte wie ein anderer Eintrag">
      gleichauf
    </span>
  );
}

/**
 * Einträge im Gleichstand: auf der Punkte-Folie aus ihrem eigenen Ergebnis
 * (nur, wenn es sichtbar ist), sonst vom Server aus den Punkten der Wand.
 */
export function tiedSet(board: BoardView, results: BoardResults | null | undefined): Set<string> {
  if (board.mode === 'dots') return new Set(results?.type === 'board' ? tiedKeys(board.targets, results.dots) : []);
  return new Set(board.tied);
}

/** Satz zum Gleichstand an der Grenze der Top-N-Auswahl, z. B. „Gleichstand auf Platz 5 – 6 Themen“ */
export function topTieText(board: BoardView, top: number, targets: string): string | null {
  if (targets === 'table') return null;
  // Großer Gleichstand: es bleibt bei N, der letzte Eintrag teilt seine Punkte mit nicht gezeigten
  const last = board.targets[board.targets.length - 1];
  return tieAtLimit(top, board.targets.length, board.targets.length === top && !!last && board.tied.includes(last));
}
