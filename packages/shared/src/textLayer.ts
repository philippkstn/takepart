/*
 * Textebene importierter Folien: Der Text der PDF-Seite mit Position, damit er im
 * Fotoprotokoll unsichtbar über dem Folienbild liegt – im gedruckten PDF lässt er
 * sich dann markieren, kopieren und durchsuchen.
 */

/** Ein Textstück: Text, links, Grundlinie, Breite (Anteile der Seitenbreite/-höhe), Schriftgröße (Anteil der Höhe) */
export type TextRun = [text: string, x: number, y: number, w: number, size: number];

/** Höchstens so viele Zeichen je Seite (große Tabellen) */
export const MAX_TEXT_CHARS = 20_000;

const round = (v: number) => Math.round(v * 10_000) / 10_000;

/** 2D-Matrix wie in PDF/pdf.js: [a, b, c, d, e, f] */
function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

/**
 * Textstücke aus `page.getTextContent()` (pdf.js) in Seiten-Anteile umrechnen.
 * `viewport`: Breite, Höhe, Skalierung und Transformation des gerenderten Bilds.
 * Gedrehter Text wird übersprungen (im Protokoll ohnehin nur zum Kopieren).
 */
export function textRuns(
  items: readonly unknown[],
  viewport: { width: number; height: number; scale: number; transform: number[] },
): TextRun[] {
  const runs: TextRun[] = [];
  let chars = 0;
  for (const raw of items) {
    const item = raw as { str?: string; transform?: number[]; width?: number };
    const text = item.str ?? '';
    if (!text.trim() || !item.transform || item.width === undefined) continue;
    const m = multiply(viewport.transform, item.transform);
    if (Math.abs(m[1]!) > 1e-3 || Math.abs(m[2]!) > 1e-3) continue;
    const size = Math.abs(m[3]!);
    const w = item.width * viewport.scale;
    if (size <= 0 || w <= 0) continue;
    chars += text.length;
    if (chars > MAX_TEXT_CHARS) break;
    runs.push([text, round(m[4]! / viewport.width), round(m[5]! / viewport.height), round(w / viewport.width), round(size / viewport.height)]);
  }
  return runs;
}

/** Eingehende Textebene prüfen (Server) – unbrauchbare Einträge fallen weg. */
export function cleanTextRuns(value: unknown): TextRun[] {
  if (!Array.isArray(value)) return [];
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > -0.5 && v < 1.5;
  const out: TextRun[] = [];
  let chars = 0;
  for (const r of value) {
    if (!Array.isArray(r) || r.length !== 5 || typeof r[0] !== 'string' || !r.slice(1).every(ok)) continue;
    const text = r[0].slice(0, 2000);
    chars += text.length;
    if (chars > MAX_TEXT_CHARS) break;
    out.push([text, r[1], r[2], r[3], r[4]]);
  }
  return out;
}
