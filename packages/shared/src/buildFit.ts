/*
 * Abdeckungen für Aufbau-Animationen an das gerenderte Folienbild anpassen.
 *
 * Die Position eines Elements kommt aus der PPTX (`a:xfrm`). Was tatsächlich
 * gezeichnet wird, kann darüber hinausragen: Text, der aus seinem Kasten läuft,
 * Schatten, gedrehte Elemente, Kantenglättung. Eine Abdeckung genau auf der Box
 * lässt solche Ränder vor dem Aufdecken durchscheinen. Deshalb wird beim Import
 * auf dem unkomprimierten Bild je Seite nachgesehen, ob direkt außerhalb der Box
 * noch „Tinte“ liegt, und die Box so weit vergrößert, bis der Rand sauber ist –
 * aber nur in engen Grenzen: Endet die Tinte nicht bald, ist es ein Nachbar
 * oder ein Bild, und die Seite bleibt, wie sie war (sonst verdeckte die
 * Abdeckung schon sichtbare Inhalte). Danach ein kleiner fester Zuschlag gegen
 * Kompressionsartefakte (WebP/JPEG) rund um kontrastreiche Kanten.
 */

/** Pixeldaten wie `ImageData` (RGBA, zeilenweise) */
export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Bereich relativ zur Folie (0…1) */
export interface FitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Abweichung (je Kanal, 0–255) ab der ein Pixel als Tinte statt Hintergrund gilt */
const INK = 48;
/** Anteil Tinte auf einer Randlinie, ab dem sie als nicht sauber gilt */
const DIRTY_SHARE = 0.02;
/** Höchstens so weit (Anteil der Breite bzw. Höhe) wächst eine Seite */
const MAX_GROW_X = 0.015;
const MAX_GROW_Y = 0.02;
/** Fester Zuschlag gegen Kompressionsartefakte: 4 px bei 1920 px Breite */
const OUTSET = 4 / 1920;

type Rgb = [number, number, number];

function pixel(px: Pixels, x: number, y: number): Rgb | null {
  if (x < 0 || y < 0 || x >= px.width || y >= px.height) return null;
  const i = (y * px.width + x) * 4;
  return [px.data[i]!, px.data[i + 1]!, px.data[i + 2]!];
}

/**
 * Median-Farbe und Streuung auf einem Ring (Pixelkoordinaten, inklusive).
 * Streuung = Spannweite ohne die äußersten 10 %, damit einzelne Linien nicht stören.
 */
export function ringColor(px: Pixels, x0: number, y0: number, x1: number, y1: number): { fill: string; rgb: Rgb; spread: number } {
  const ch: [number[], number[], number[]] = [[], [], []];
  const take = (x: number, y: number) => {
    const p = pixel(px, x, y);
    if (!p) return;
    ch[0].push(p[0]);
    ch[1].push(p[1]);
    ch[2].push(p[2]);
  };
  // Gleichmäßiger Abstand entlang des ganzen Rings, damit kurze Seiten nicht überwiegen
  const step = Math.max(1, Math.round((2 * (x1 - x0) + 2 * (y1 - y0)) / 240));
  for (let x = x0; x <= x1; x += step) {
    take(x, y0);
    take(x, y1);
  }
  for (let y = y0 + step; y < y1; y += step) {
    take(x0, y);
    take(x1, y);
  }
  if (ch[0].length === 0) return { fill: '#ffffff', rgb: [255, 255, 255], spread: 0 };
  const sorted = ch.map((v) => v.sort((a, b) => a - b));
  const at = (v: number[], q: number) => v[Math.min(v.length - 1, Math.floor(v.length * q))]!;
  const spread = Math.max(...sorted.map((v) => at(v, 0.9) - at(v, 0.1)));
  const rgb = sorted.map((v) => at(v, 0.5)) as Rgb;
  return { fill: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''), rgb, spread };
}

/**
 * Box an das Bild anpassen und Abdeckfarbe messen. Liefert die angepasste Box
 * (relativ), die Farbe und die Streuung der Umgebung (zu groß = Foto/Verlauf,
 * dann lässt sich das Element nicht sauber abdecken).
 */
export function fitBuildBox(px: Pixels, box: FitBox): { box: FitBox; fill: string; spread: number } {
  const W = px.width;
  const H = px.height;
  const orig = {
    l: Math.round(box.x * W),
    t: Math.round(box.y * H),
    r: Math.round((box.x + box.w) * W) - 1,
    b: Math.round((box.y + box.h) * H) - 1,
  };
  // Hintergrundfarbe aus einem Ring knapp außerhalb – Median, Tinte stört bis knapp 50 %
  const bg = ringColor(px, orig.l - 3, orig.t - 3, orig.r + 3, orig.b + 3).rgb;
  const isInk = (x: number, y: number) => {
    const p = pixel(px, x, y);
    return !!p && Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2])) > INK;
  };
  const dirtyCol = (x: number, t: number, b: number) => {
    if (x < 0 || x >= W) return false;
    let n = 0;
    for (let y = Math.max(0, t); y <= Math.min(H - 1, b); y++) if (isInk(x, y)) n++;
    return n > Math.max(0, (b - t + 1) * DIRTY_SHARE);
  };
  const dirtyRow = (y: number, l: number, r: number) => {
    if (y < 0 || y >= H) return false;
    let n = 0;
    for (let x = Math.max(0, l); x <= Math.min(W - 1, r); x++) if (isInk(x, y)) n++;
    return n > Math.max(0, (r - l + 1) * DIRTY_SHARE);
  };

  const maxX = Math.max(2, Math.round(W * MAX_GROW_X));
  const maxY = Math.max(2, Math.round(H * MAX_GROW_Y));
  const cur = { ...orig };
  const stuck = { l: false, t: false, r: false, b: false };
  for (let changed = true; changed;) {
    changed = false;
    if (!stuck.l && dirtyCol(cur.l - 1, cur.t, cur.b)) {
      if (orig.l - (cur.l - 2) > maxX) ((stuck.l = true), (cur.l = orig.l));
      else ((cur.l -= 2), (changed = true));
    }
    if (!stuck.r && dirtyCol(cur.r + 1, cur.t, cur.b)) {
      if (cur.r + 2 - orig.r > maxX) ((stuck.r = true), (cur.r = orig.r));
      else ((cur.r += 2), (changed = true));
    }
    if (!stuck.t && dirtyRow(cur.t - 1, cur.l, cur.r)) {
      if (orig.t - (cur.t - 2) > maxY) ((stuck.t = true), (cur.t = orig.t));
      else ((cur.t -= 2), (changed = true));
    }
    if (!stuck.b && dirtyRow(cur.b + 1, cur.l, cur.r)) {
      if (cur.b + 2 - orig.b > maxY) ((stuck.b = true), (cur.b = orig.b));
      else ((cur.b += 2), (changed = true));
    }
  }

  const ox = Math.round(OUTSET * W);
  const oy = Math.round(OUTSET * W);
  const l = Math.max(0, cur.l - ox);
  const t = Math.max(0, cur.t - oy);
  const r = Math.min(W - 1, cur.r + ox);
  const b = Math.min(H - 1, cur.b + oy);
  const ring = ringColor(px, l - 3, t - 3, r + 3, b + 3);
  return { box: { x: l / W, y: t / H, w: (r - l + 1) / W, h: (b - t + 1) / H }, fill: ring.fill, spread: ring.spread };
}

/**
 * Umschließendes Rechteck eines um seine Mitte gedrehten Rechtecks
 * (`rot` in Grad; Koordinaten in einer gemeinsamen Einheit, z. B. EMU).
 */
export function rotatedBounds(x: number, y: number, w: number, h: number, rot: number): { x: number; y: number; w: number; h: number } {
  const a = (rot * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return { x: x + w / 2 - bw / 2, y: y + h / 2 - bh / 2, w: bw, h: bh };
}
