import type { TextRun } from './textLayer.ts';

/**
 * Lage einzelner Absätze eines Textfelds („absatzweise“ animiert): Die PPTX
 * nennt nur Absatz-Nummern. Die Zeilen kommen aus der Textebene des PDFs –
 * Textstücke im Feld, nach Grundlinie zu Zeilen gruppiert und der Reihe nach
 * den Absätzen zugeordnet (Vergleich nur über Buchstaben und Ziffern, damit
 * Aufzählungszeichen, Leerzeichen und Umbrüche nicht stören).
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Je Absatz eine Box in voller Breite des Felds (deckt Aufzählungszeichen mit ab),
 * lückenlos und ohne Überlappung untereinander; leere Absätze `null`. Passt der
 * Text nicht zusammen, überall `null` – dann gilt das ganze Feld.
 */
export function paragraphBoxes(runs: readonly TextRun[], box: Box, paragraphs: readonly string[]): (Box | null)[] {
  const none = paragraphs.map(() => null);
  const inside = runs.filter(([, x, y, , size]) => x >= box.x - 0.02 && x <= box.x + box.w && y >= box.y && y <= box.y + box.h + size);
  // Zeilen: Textstücke mit (fast) gleicher Grundlinie
  const lines: { y: number; size: number; text: string }[] = [];
  for (const r of [...inside].sort((a, b) => a[2] - b[2] || a[1] - b[1])) {
    const last = lines.at(-1);
    if (last && Math.abs(r[2] - last.y) < Math.max(r[4], last.size) * 0.5) {
      last.text += ` ${r[0]}`;
      last.size = Math.max(last.size, r[4]);
    } else lines.push({ y: r[2], size: r[4], text: r[0] });
  }
  const textLines = lines.filter((l) => norm(l.text));

  const spans: ({ top: number; bottom: number } | null)[] = [];
  let next = 0;
  for (const p of paragraphs) {
    const want = norm(p);
    if (!want) {
      spans.push(null);
      continue;
    }
    let got = '';
    let top = Infinity;
    let bottom = -Infinity;
    while (got.length < want.length && next < textLines.length) {
      const line = textLines[next++]!;
      got += norm(line.text);
      top = Math.min(top, line.y - line.size * 1.05);
      bottom = Math.max(bottom, line.y + line.size * 0.3);
    }
    if (got !== want) return none;
    spans.push({ top, bottom });
  }

  // Grenzen zwischen benachbarten Absätzen in die Mitte der Lücke legen
  const filled = spans.map((s, i) => ({ s, i })).filter((e) => e.s) as { s: { top: number; bottom: number }; i: number }[];
  const out: (Box | null)[] = paragraphs.map(() => null);
  for (const [k, { s, i }] of filled.entries()) {
    const prev = filled[k - 1]?.s;
    const following = filled[k + 1]?.s;
    const top = Math.max(box.y, prev ? (prev.bottom + s.top) / 2 : s.top - 0.005);
    const bottom = Math.min(box.y + box.h, following ? (s.bottom + following.top) / 2 : s.bottom + 0.005);
    out[i] = { x: box.x, y: top, w: box.w, h: Math.max(0, bottom - top) };
  }
  return out;
}

/**
 * Liegt ein gezeichneter Pfad ganz im Element? (`inside` prüft einen Punkt in
 * Pixeln, z. B. `isPointInPath`.) Punkte knapp außerhalb der Box müssen draußen
 * liegen, mindestens ein Punkt eines feinen Rasters in der Box drin – so bleiben
 * Hintergründe und übergreifende Formen unberührt.
 */
export function pathInsideBox(inside: (x: number, y: number) => boolean, box: Box, width: number, height: number): boolean {
  const left = box.x * width;
  const top = box.y * height;
  const right = left + box.w * width;
  const bottom = top + box.h * height;
  const mx = Math.max(4, box.w * width * 0.02);
  const my = Math.max(4, box.h * height * 0.02);
  const ring: [number, number][] = [
    [left - mx, top - my],
    [(left + right) / 2, top - my],
    [right + mx, top - my],
    [right + mx, (top + bottom) / 2],
    [right + mx, bottom + my],
    [(left + right) / 2, bottom + my],
    [left - mx, bottom + my],
    [left - mx, (top + bottom) / 2],
  ];
  if (ring.some(([x, y]) => inside(x, y))) return false;
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      if (inside(left + ((right - left) * i) / steps, top + ((bottom - top) * j) / steps)) return true;
    }
  }
  return false;
}
