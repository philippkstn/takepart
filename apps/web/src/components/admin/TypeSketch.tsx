import type { ReactNode } from 'react';

/**
 * Schematische Mini-Vorschau je Folientyp bzw. Kartenwand-Schritt (Schlüssel aus
 * `goalItemKey`) für den Einfügen-Dialog. Reine SVG-Skizzen in den Farb-Tokens,
 * keine Bilder: Flächen `.sk-card`, Linien `.sk-line`, Hervorhebung `.sk-accent`.
 */

const W = 80;
const H = 48;

const line = (x: number, y: number, w: number, h = 3) => <rect className="sk-line" x={x} y={y} width={w} height={h} rx={h / 2} />;
const accent = (x: number, y: number, w: number, h: number, rx = 1.5) => (
  <rect className="sk-accent" x={x} y={y} width={w} height={h} rx={rx} />
);
const card = (x: number, y: number, w: number, h: number, rx = 2) => <rect className="sk-card" x={x} y={y} width={w} height={h} rx={rx} />;
const dot = (cx: number, cy: number, r: number, className = 'sk-accent') => <circle className={className} cx={cx} cy={cy} r={r} />;

/** Karte mit zwei Textzeilen */
const note = (x: number, y: number, w = 18, h = 13) => (
  <>
    {card(x, y, w, h)}
    {line(x + 3, y + 3.5, w - 6, 2)}
    {line(x + 3, y + 7.5, (w - 6) * 0.6, 2)}
  </>
);

const star = (cx: number, cy: number, r: number, filled: boolean) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return <polygon className={filled ? 'sk-accent' : 'sk-card'} points={pts} />;
};

const SKETCHES: Record<string, () => ReactNode> = {
  content: () => (
    <>
      {line(12, 10, 40, 6)}
      {line(12, 22, 56)}
      {line(12, 29, 50)}
      {line(12, 36, 34)}
    </>
  ),
  choice: () => (
    <>
      {[44, 28, 16].map((w, i) => (
        <g key={i}>
          {line(10, 9 + i * 12, 10, 2)}
          {accent(24, 7 + i * 12, w, 6)}
        </g>
      ))}
    </>
  ),
  open: () => (
    <>
      {note(8, 7, 30, 15)}
      {note(42, 7, 30, 15)}
      {note(8, 26, 30, 15)}
    </>
  ),
  scale: () => (
    <>
      {line(10, 30, 60, 2)}
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>{dot(10 + i * 15, 31, 3, 'sk-card')}</g>
      ))}
      {dot(55, 31, 4)}
      {line(10, 12, 14, 2)}
      {line(56, 12, 14, 2)}
    </>
  ),
  wordcloud: () => (
    <>
      {accent(26, 19, 28, 9, 2)}
      {line(10, 10, 16, 5)}
      {line(48, 9, 20, 4)}
      {line(12, 33, 12, 4)}
      {line(30, 33, 20, 5)}
      {line(56, 32, 14, 3)}
      {line(58, 21, 12, 3)}
      {line(8, 22, 14, 3)}
    </>
  ),
  ranking: () => (
    <>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          {i === 0 ? accent(10, 7 + i * 12, 8, 8, 2) : card(10, 7 + i * 12, 8, 8)}
          {card(22, 7 + i * 12, 48, 8)}
          {line(25, 10 + i * 12, 22 - i * 4, 2)}
        </g>
      ))}
    </>
  ),
  quiz: () => (
    <>
      {card(8, 8, 30, 14)}
      {accent(42, 8, 30, 14, 2)}
      {card(8, 26, 30, 14)}
      {card(42, 26, 30, 14)}
      <path className="sk-mark is-on-accent" d="M51 15 l3 3 l6 -6" />
    </>
  ),
  brainstorm: () => (
    <>
      {[
        [8, 8],
        [30, 8],
        [52, 8],
        [8, 27],
        [30, 27],
      ].map(([x, y], i) => (
        <g key={i}>
          {note(x!, y!, 20, 14)}
          {i < 3 && accent(x! + 13, y! + 9, 4, 2.5, 1)}
        </g>
      ))}
    </>
  ),
  pinboard: () => (
    <>
      {[0, 1, 2].map((c) => (
        <g key={c}>
          {line(8 + c * 22, 6, 14, 2)}
          {note(8 + c * 22, 11, 20, 12)}
          {c !== 1 && note(8 + c * 22, 26, 20, 12)}
        </g>
      ))}
    </>
  ),
  feedback: () => (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>{star(16 + i * 12, 18, 5.5, i < 4)}</g>
      ))}
      {line(14, 32, 52)}
      {line(14, 38, 32)}
    </>
  ),
  qa: () => (
    <>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          {card(8, 6 + i * 13, 64, 10)}
          {i === 0 ? accent(11, 8 + i * 13, 6, 6, 1.5) : line(11, 9 + i * 13, 6, 4)}
          {line(21, 9.5 + i * 13, 40 - i * 8, 2.5)}
        </g>
      ))}
    </>
  ),
  sentence: () => (
    <>
      {line(10, 16, 34, 4)}
      {accent(48, 14, 22, 8, 2)}
      {line(10, 30, 60, 1.5)}
      {line(10, 36, 40, 1.5)}
    </>
  ),
  teams: () => (
    <>
      {[16, 40, 64].map((cx, g) => (
        <g key={g}>
          <circle className="sk-card" cx={cx} cy={24} r={10} />
          {dot(cx - 4, 21, 2.5, g === 0 ? 'sk-accent' : 'sk-line')}
          {dot(cx + 4, 21, 2.5, g === 0 ? 'sk-accent' : 'sk-line')}
          {dot(cx, 28, 2.5, g === 0 ? 'sk-accent' : 'sk-line')}
        </g>
      ))}
    </>
  ),
  pause: () => (
    <>
      <circle className="sk-card" cx={40} cy={22} r={12} />
      <path className="sk-mark" d="M40 15 v7 l5 3" />
      {line(26, 39, 28, 3)}
    </>
  ),
  'board:collect': () => (
    <>
      {note(8, 8)}
      {note(31, 8)}
      {note(54, 8)}
      {note(8, 26)}
      <rect className="sk-card sk-dashed" x={31} y={26} width={18} height={13} rx={2} />
      <path className="sk-mark" d="M40 29.5 v6 M37 32.5 h6" />
    </>
  ),
  'board:cluster': () => (
    <>
      <rect className="sk-group" x={5} y={6} width={34} height={36} rx={3} />
      <rect className="sk-group" x={42} y={6} width={33} height={36} rx={3} />
      {line(9, 9, 14, 2.5)}
      {line(46, 9, 12, 2.5)}
      {note(9, 15, 26, 11)}
      {note(9, 28, 26, 11)}
      {note(46, 15, 25, 11)}
    </>
  ),
  'board:place': () => (
    <>
      {[0, 1, 2].map((c) => (
        <g key={c}>
          <rect className="sk-group" x={5 + c * 24} y={6} width={22} height={36} rx={2} />
          {line(9 + c * 24, 9, 12, 2.5)}
        </g>
      ))}
      {note(7, 16, 18, 11)}
      {note(31, 16, 18, 11)}
      {note(31, 29, 18, 11)}
      <path className="sk-mark" d="M21 34 h12 m-3 -3 l3 3 l-3 3" />
    </>
  ),
  'board:dots': () => (
    <>
      {note(8, 8, 30, 14)}
      {note(42, 8, 30, 14)}
      {note(8, 26, 30, 14)}
      {note(42, 26, 30, 14)}
      {dot(30, 17, 2.4)}
      {dot(34, 17, 2.4)}
      {dot(64, 17, 2.4)}
      {dot(30, 35, 2.4)}
      {dot(34, 35, 2.4)}
      {dot(26, 35, 2.4)}
    </>
  ),
  'board:rate': () => (
    <>
      <rect className="sk-line" x={16} y={6} width={1.5} height={36} rx={0.75} />
      {line(16, 40.5, 58, 1.5)}
      <path className="sk-grid" d="M45 8 V40 M18 24 H72" />
      {dot(28, 30, 3, 'sk-line')}
      {dot(58, 14, 3.5)}
      {dot(36, 16, 3, 'sk-line')}
      {dot(62, 32, 3, 'sk-line')}
    </>
  ),
  'board:choose': () => (
    <>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          {card(8, 6 + i * 13, 64, 10)}
          {line(12, 9.5 + i * 13, 26, 2.5)}
          {i === 1 ? line(48, 8.5 + i * 13, 20, 5) : accent(48, 8.5 + i * 13, i === 0 ? 20 : 14, 5, 2.5)}
        </g>
      ))}
    </>
  ),
  'board:table': () => (
    <>
      {card(6, 6, 68, 36)}
      {accent(6, 6, 68, 8, 2)}
      <path className="sk-grid" d="M6 23 H74 M6 32 H74 M34 6 V42 M56 6 V42" />
      {[18, 27, 36].map((y) => (
        <g key={y}>
          {line(10, y - 1, 18, 2)}
          {line(38, y - 1, 12, 2)}
          {line(60, y - 1, 10, 2)}
        </g>
      ))}
    </>
  ),
};

export function TypeSketch({ itemKey }: { itemKey: string }) {
  const draw = SKETCHES[itemKey] ?? SKETCHES.content!;
  return (
    <svg className="type-sketch" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      {draw()}
    </svg>
  );
}
