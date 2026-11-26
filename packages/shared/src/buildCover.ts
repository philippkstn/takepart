import { buildEffectOf, type BuildEffect } from './slides.ts';

/**
 * Einfarbige Formen mit Ausgangs-Animation („Abdecker“): Ein Rechteck liegt über
 * einem Element und verschwindet per Klick. Das PDF zeigt die Folie samt Rechteck –
 * das Darunterliegende wäre nie zu sehen. Deshalb lässt der Import genau diese
 * Zeichnung beim Rendern weg (Folienbild = Endzustand) und baut das Rechteck als
 * Abdeckung in seiner gezeichneten Farbe nach.
 */

/** Ausgangs-Effekt der Form als Effekt ihrer Abdeckung */
export function buildExitEffectOf(presetId: string | null, subtype: string | null, filter: string | null): BuildEffect {
  if (presetId === '2') {
    // „Hinausfliegen“: Untertyp ist die Richtung, in die die Form verschwindet
    return subtype === '1' ? 'out-top' : subtype === '2' ? 'out-right' : subtype === '8' ? 'out-left' : 'out-bottom';
  }
  // „Verkleinern“
  if (presetId === '53' || presetId === '23') return 'zoom-out';
  // Wischen, Verblassen, Verschwinden wirken wie beim Eingang
  const effect = buildEffectOf(presetId, subtype, filter);
  return effect.startsWith('fly') || effect === 'zoom' ? 'fade' : effect;
}

/**
 * Ist der gezeichnete Pfad genau die Form? `inside(x, y)` prüft einen Punkt in
 * Pixeln (z. B. `isPointInPath`), `box` ist die Form relativ zur Seite. Punkte
 * knapp innerhalb der Kanten müssen drin, knapp außerhalb draußen liegen –
 * so gelten weder Hintergründe noch Elemente in der Form als Treffer.
 */
export function pathMatchesBox(
  inside: (x: number, y: number) => boolean,
  box: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): boolean {
  const left = box.x * width;
  const top = box.y * height;
  const right = left + box.w * width;
  const bottom = top + box.h * height;
  // Spielraum für Rundung, Kontur und den Rand, den der Import um jede Form legt (einige Pixel)
  const tx = Math.max(8, box.w * width * 0.02);
  const ty = Math.max(8, box.h * height * 0.02);
  if (right - left < 3 * tx || bottom - top < 3 * ty) return false;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const inPoints: [number, number][] = [
    [cx, cy],
    [left + tx, top + ty],
    [right - tx, top + ty],
    [left + tx, bottom - ty],
    [right - tx, bottom - ty],
  ];
  const outPoints: [number, number][] = [
    [left - tx, cy],
    [right + tx, cy],
    [cx, top - ty],
    [cx, bottom + ty],
  ];
  return inPoints.every(([x, y]) => inside(x, y)) && outPoints.every(([x, y]) => !inside(x, y));
}
