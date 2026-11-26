/**
 * Folien importieren – komplett im Browser, ohne Office- oder PDF-Software auf dem Server.
 *
 * PDF: pdf.js rendert jede Seite auf ein Canvas; hochgeladen werden ein Bild (WebP,
 * in Safari JPEG) und eine kleine Miniatur fürs Steuerpult.
 * PPTX: nur die Sprechernotizen werden gelesen (JSZip). Die Optik kommt aus dem
 * PDF-Export, der in PowerPoint, Keynote und Google Slides originalgetreu ist.
 *
 * Beide Bibliotheken werden erst hier nachgeladen und landen nicht im Bundle
 * für Teilnehmende.
 */

import {
  fitBuildBox,
  rotatedBounds,
  textRuns,
  buildEffectOf,
  buildExitEffectOf,
  paragraphBoxes,
  pathInsideBox,
  pathMatchesBox,
  type BuildsConfig,
  type PptxSlideInfo,
  type RawBuildRegion,
  type TextRun,
} from '@slides/shared';

/** Lange Seite der Folienbilder in Pixeln – scharf auf Full-HD-Beamern, klein genug für Handys. */
const FULL_SIZE = 1920;
/** Druckbild (Fotoprotokoll, große Beamer): doppelte Auflösung */
const HIRES_SIZE = 3840;
const THUMB_WIDTH = 400;

export interface RenderedPage {
  index: number;
  total: number;
  width: number;
  height: number;
  full: Blob;
  thumb: Blob;
  /** Doppelte Auflösung – Druck und große Beamer */
  hires: Blob;
  /** Startbild mit allen Elementen (vor den Ausgängen) – nur bei Ausgängen von Text, Bildern & Co. */
  start: Blob | null;
  /** Text der Seite mit Position (unsichtbar über dem Bild im Fotoprotokoll) */
  text: TextRun[];
  /** Größter Text der Seite – meist die Überschrift, für Folienlisten */
  title: string;
  /**
   * Gemessene Abdeckfarben je angefragtem Bereich (siehe `regionsFor`);
   * `null`, wenn die Umgebung nicht einfarbig ist (Foto, Verlauf) – dann wäre
   * eine Abdeckung als Fleck zu sehen.
   */
  fills: (string | null)[];
  /** An das gerenderte Bild angepasste Bereiche (Text über den Kasten hinaus, Schatten, Kanten) */
  boxes: Box[];
  /** Streuung der Umgebungsfarbe je Bereich (für Diagnose) */
  spreads: number[];
}

/** Ab dieser Farbstreuung (0–255) gilt die Umgebung als nicht einfarbig. */
const MAX_FILL_SPREAD = 24;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (webp) => {
        // Safari kann (je nach Version) kein WebP kodieren und liefert dann PNG – lieber JPEG.
        if (webp && webp.type === 'image/webp') return resolve(webp);
        canvas.toBlob((jpeg) => (jpeg ? resolve(jpeg) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', quality);
      },
      'image/webp',
      quality,
    );
  });
}

async function openPdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
  });
}

/** Überschriften aller Seiten (ohne zu rendern) – zum Zuordnen beim Aktualisieren der Folienbilder */
export async function pdfPageTitles(file: File): Promise<string[]> {
  const task = await openPdf(file);
  try {
    const doc = await task.promise;
    const titles: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      titles.push(await pageTitle(page));
      page.cleanup();
    }
    return titles;
  } finally {
    await task.destroy();
  }
}

/** Bereich, den der Import auf einer Seite braucht (Rohform aus der PPTX, siehe `RawBuildRegion`) */
type PageRegion = Box & {
  cover?: boolean;
  exit?: boolean;
  shapeText?: string;
  picture?: boolean;
  paragraph?: [number, number];
  paragraphTexts?: string[];
};

/**
 * Rendert die Seiten eines PDFs. `select` bekommt die Seitenzahl und entscheidet
 * je Seite, ob sie gebraucht wird – übersprungene Seiten werden nicht gerendert.
 * `regionsFor` liefert die Aufbau-Bereiche einer Seite: Elemente mit Ausgang
 * werden im Folienbild weggelassen (Endzustand); gibt es solche (außer einfarbigen
 * Abdeckern), entsteht zusätzlich ein Startbild mit allen Elementen.
 */
export async function* renderPdfPages(
  file: File,
  select: (total: number) => (index: number) => boolean = () => () => true,
  regionsFor: (index: number) => PageRegion[] = () => [],
): AsyncGenerator<RenderedPage> {
  const task = await openPdf(file);
  const doc = await task.promise;
  const wanted = select(doc.numPages);

  const render = async (page: Awaited<ReturnType<typeof doc.getPage>>, size: number, prepare?: (ctx: CanvasRenderingContext2D) => void) => {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: size / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    // Weißer Grund: transparente PDF-Seiten sähen sonst auf dunklem Beamer schwarz aus.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    prepare?.(ctx);
    // intent 'print': zeichnet ohne requestAnimationFrame – der Import läuft so auch
    // weiter, wenn der Tab im Hintergrund liegt. Für statische Folienbilder ohnehin passend.
    await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
    return canvas;
  };
  const scaled = (source: HTMLCanvasElement, width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  };

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (!wanted(i - 1)) continue;
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: FULL_SIZE / Math.max(base.width, base.height) });
      const text = await pageText(page, viewport);
      // „Absatzweise“: Lage der Absätze aus der Textebene
      const regions = paragraphRegions(regionsFor(i - 1), text);
      const exits = regions.some((r) => r.exit);

      // Startbild (alle Elemente sichtbar) – nur, wenn Elemente per Ausgang verschwinden
      const startCanvas = exits ? await render(page, FULL_SIZE) : null;
      // Einmal in doppelter Auflösung rendern, das Beamer-Bild daraus verkleinern.
      // Elemente mit Ausgang fehlen darin (Endzustand); einfarbige Abdecker liefern dabei ihre Farbe.
      let coverFills: (string | null)[] = regions.map(() => null);
      const hiresCanvas = await render(page, HIRES_SIZE, (ctx) => {
        coverFills = omitShapes(ctx, regions, text);
      });
      const canvas = scaled(hiresCanvas, Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext('2d')!;
      const thumbCanvas = scaled(canvas, THUMB_WIDTH, Math.round((canvas.height / canvas.width) * THUMB_WIDTH));

      let fills: (string | null)[] = [];
      let spreads: number[] = [];
      let fitted: Box[] = [];
      if (regions.length > 0) {
        // Auf dem unkomprimierten Bild messen – nach WebP/JPEG lägen Artefakte um jede Kante
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const startData = startCanvas?.getContext('2d')!.getImageData(0, 0, startCanvas.width, startCanvas.height);
        const samples = regions.map((box, k) => {
          if (box.w <= 0 || box.h <= 0) return { fill: null, spread: 0, box };
          // Weggelassene Abdecker: ihre gezeichnete Farbe; die Box wächst über Text, der knapp darunter hervorragt
          if (box.cover) return { fill: coverFills[k] ?? null, spread: 0, box: fitBuildBox(data, box).box };
          // Ausgang: Ausschnitt aus dem Startbild – Box dort anpassen, die Farbe wird nicht gebraucht
          if (box.exit && startData) {
            const fit = fitBuildBox(startData, box);
            return { fill: fit.fill, spread: 0, box: fit.box };
          }
          return fitBuildBox(data, box);
        });
        fills = samples.map((x) => (x.fill && x.spread <= MAX_FILL_SPREAD ? x.fill : null));
        spreads = samples.map((x) => x.spread);
        fitted = samples.map((x) => x.box);
      }

      const [full, hires, thumb, start, title] = await Promise.all([
        canvasToBlob(canvas, 0.9),
        canvasToBlob(hiresCanvas, 0.9),
        canvasToBlob(thumbCanvas, 0.8),
        startCanvas ? canvasToBlob(startCanvas, 0.9) : Promise.resolve(null),
        pageTitle(page),
      ]);
      page.cleanup();
      yield {
        index: i - 1,
        total: doc.numPages,
        width: canvas.width,
        height: canvas.height,
        full,
        thumb,
        hires,
        start,
        text,
        title,
        fills,
        boxes: fitted,
        spreads,
      };
    }
  } finally {
    await task.destroy();
  }
}

/**
 * „Absatzweise“ animierte Bereiche auf ihre Absätze zuschneiden (Lage aus der
 * Textebene). Lässt sich der Text nicht zuordnen, deckt der erste Absatzschritt
 * das ganze Feld auf, die übrigen entfallen (Breite 0).
 */
function paragraphRegions(regions: PageRegion[], text: TextRun[]): PageRegion[] {
  const cache = new Map<string, (Box | null)[]>();
  const firstOfShape = new Set<string>();
  return regions.map((r) => {
    if (!r.paragraph || !r.paragraphTexts) return r;
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    if (!cache.has(key)) cache.set(key, paragraphBoxes(text, r, r.paragraphTexts));
    const boxes = cache.get(key)!;
    const [from, to] = r.paragraph;
    const parts = boxes.slice(from, to + 1).filter((b): b is Box => !!b);
    if (parts.length === 0) {
      if (boxes.some(Boolean) || firstOfShape.has(key)) return { ...r, w: 0, h: 0 };
      firstOfShape.add(key);
      return r;
    }
    const top = Math.min(...parts.map((b) => b.y));
    const bottom = Math.max(...parts.map((b) => b.y + b.h));
    return { ...r, y: top, h: bottom - top };
  });
}

/** Farbe einer Füllung als #rrggbb – nur deckende Volltonfarben */
function solidHex(style: unknown): string | null {
  if (typeof style !== 'string') return null;
  if (/^#[0-9a-f]{6}$/i.test(style)) return style.toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(style);
  if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Textzeilen (Grundlinie, Anfang, Ende, Größe – Anteile der Seite) der Elemente mit
 * Ausgang: Textstücke in ihrer Box, deren Buchstaben im Text des Elements vorkommen;
 * Aufzählungszeichen (ohne Buchstaben) nur auf solchen Zeilen.
 */
function exitTextSpans(text: TextRun[], boxes: PageRegion[]): { y: number; x0: number; x1: number; size: number }[] {
  const letters = (t: string) => [...t.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));
  const spans: { y: number; x0: number; x1: number; size: number }[] = [];
  for (const b of boxes) {
    const own = new Set(letters(b.shapeText ?? ''));
    if (own.size === 0) continue;
    const inside = text.filter(([, x, y, , size]) => x >= b.x - 0.01 && x <= b.x + b.w && y >= b.y && y <= b.y + b.h + size);
    const lines = inside.filter(([t]) => {
      const l = letters(t);
      return l.length > 0 && l.every((c) => own.has(c));
    });
    for (const [t, x, y, w, size] of inside) {
      const isLine = lines.some((r) => r[0] === t && r[1] === x && r[2] === y);
      const bullet = letters(t).length === 0 && lines.some((r) => Math.abs(r[2] - y) < size * 0.5);
      if (isLine || bullet) spans.push({ y, x0: x, x1: x + w, size });
    }
  }
  return spans;
}

/**
 * Zeichnungen von Elementen mit Ausgangs-Animation auslassen – das Folienbild
 * zeigt den Endzustand:
 *  - einfarbige Abdecker (`cover`): Füllung und Kontur des Pfads, der genau ihre Box ist;
 *    liefert je Box die gezeichnete Füllfarbe (für die Abdeckung)
 *  - andere Elemente (`exit`): ihr Hintergrund (Pfad = Box), Text in der Box, dessen
 *    Zeichen zum Element gehören, kleine Pfade ganz in der Box (Aufzählungszeichen)
 *    und bei Bildern das Bild selbst
 */
function omitShapes(ctx: CanvasRenderingContext2D, regions: PageRegion[], text: TextRun[]): (string | null)[] {
  const fills: (string | null)[] = regions.map(() => null);
  const covers = regions.map((b, k) => ({ b, k })).filter(({ b }) => b.cover && b.w > 0);
  const exits = regions.map((b, k) => ({ b, k })).filter(({ b }) => b.exit && b.w > 0);
  if (covers.length === 0 && exits.length === 0) return fills;
  const { width, height } = ctx.canvas;
  const W = width;
  const H = height;
  // Textzeilen der Elemente aus der Textebene: pdf.js zeichnet eingebettete Schriften mit
  // Ersatzzeichen, die Buchstaben selbst taugen also nicht zum Vergleich – die Lage schon.
  const lineSpans = exitTextSpans(
    text,
    exits.map(({ b }) => b),
  );

  const insideOf = (args: unknown[]) => {
    const path = args[0] instanceof Path2D ? args[0] : null;
    const rule = (path ? args[1] : args[0]) === 'evenodd' ? 'evenodd' : 'nonzero';
    return (x: number, y: number) => (path ? ctx.isPointInPath(path, x, y, rule) : ctx.isPointInPath(x, y, rule));
  };
  const coverHit = (inside: (x: number, y: number) => boolean) => covers.find(({ b }) => pathMatchesBox(inside, b, W, H));
  const exitPath = (inside: (x: number, y: number) => boolean) =>
    exits.some(({ b }) => pathMatchesBox(inside, b, W, H) || (!b.picture && b.shapeText && pathInsideBox(inside, b, W, H)));
  const point = (x: number, y: number) => {
    const m = ctx.getTransform();
    return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f] as const;
  };

  const fill = ctx.fill.bind(ctx) as (...a: unknown[]) => void;
  const stroke = ctx.stroke.bind(ctx) as (...a: unknown[]) => void;
  const fillRect = ctx.fillRect.bind(ctx);
  const fillText = ctx.fillText.bind(ctx);
  const strokeText = ctx.strokeText.bind(ctx);
  const drawImage = ctx.drawImage.bind(ctx) as (...a: unknown[]) => void;

  ctx.fill = ((...args: unknown[]) => {
    const inside = insideOf(args);
    const found = coverHit(inside);
    if (found) {
      fills[found.k] ??= solidHex(ctx.fillStyle);
      return;
    }
    if (exits.length > 0 && exitPath(inside)) return;
    fill(...args);
  }) as CanvasRenderingContext2D['fill'];
  ctx.stroke = ((...args: unknown[]) => {
    const path = args[0] instanceof Path2D ? args[0] : null;
    // Kontur: Punkte auf der Kante liegen im Pfad (Füllregel) – dieselbe Prüfung wie bei der Füllung
    const inside = (x: number, y: number) => (path ? ctx.isPointInPath(path, x, y) : ctx.isPointInPath(x, y));
    if (coverHit(inside) || (exits.length > 0 && exitPath(inside))) return;
    stroke(...args);
  }) as CanvasRenderingContext2D['stroke'];
  ctx.fillRect = (x: number, y: number, w: number, h: number) => {
    const [ax, ay] = point(x, y);
    const [bx, by] = point(x + w, y + h);
    const [l, r, t, btm] = [Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)];
    const inside = (px: number, py: number) => px >= l && px <= r && py >= t && py <= btm;
    const found = coverHit(inside);
    if (found) {
      fills[found.k] ??= solidHex(ctx.fillStyle);
      return;
    }
    if (exits.length > 0 && exitPath(inside)) return;
    fillRect(x, y, w, h);
  };
  // Text: Ursprung des Glyphs liegt auf einer Textzeile eines Elements mit Ausgang
  const textOfExit = (_text: string, x: number, y: number) => {
    const [px, py] = point(x, y);
    return lineSpans.some(
      (l) => Math.abs(py - l.y * H) <= l.size * H * 0.35 && px >= l.x0 * W - l.size * H && px <= l.x1 * W + l.size * H * 0.5,
    );
  };
  ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    if (exits.length > 0 && textOfExit(text, x, y)) return;
    if (maxWidth === undefined) fillText(text, x, y);
    else fillText(text, x, y, maxWidth);
  };
  ctx.strokeText = (text: string, x: number, y: number, maxWidth?: number) => {
    if (exits.length > 0 && textOfExit(text, x, y)) return;
    if (maxWidth === undefined) strokeText(text, x, y);
    else strokeText(text, x, y, maxWidth);
  };
  // Bilder: Bild-Elemente mit Ausgang (gezeichnete Fläche ≈ ihre Box)
  ctx.drawImage = ((...args: unknown[]) => {
    const pics = exits.filter(({ b }) => b.picture);
    if (pics.length > 0) {
      const n = args.length;
      const [dx, dy, dw, dh] =
        n >= 9
          ? (args.slice(5, 9) as number[])
          : n >= 5
            ? (args.slice(1, 5) as number[])
            : [args[1] as number, args[2] as number, (args[0] as { width: number }).width, (args[0] as { height: number }).height];
      const [ax, ay] = point(dx, dy);
      const [bx, by] = point(dx + dw, dy + dh);
      const [l, r, t, btm] = [Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)];
      const inside = (px: number, py: number) => px >= l && px <= r && py >= t && py <= btm;
      if (pics.some(({ b }) => pathMatchesBox(inside, b, W, H))) return;
    }
    drawImage(...args);
  }) as CanvasRenderingContext2D['drawImage'];
  return fills;
}

/** Text der Seite mit Position (Anteile der Seite) – leer, wenn die PDF keinen Text enthält */
async function pageText(
  page: { getTextContent: () => Promise<{ items: unknown[] }> },
  viewport: { width: number; height: number; scale: number; transform: number[] },
): Promise<TextRun[]> {
  try {
    return textRuns((await page.getTextContent()).items, viewport);
  } catch {
    return [];
  }
}

/** Überschrift raten: der Text mit der größten Schrift unter den ersten Textstücken. */
async function pageTitle(page: { getTextContent: () => Promise<{ items: unknown[] }> }): Promise<string> {
  try {
    const content = await page.getTextContent();
    let best = '';
    let bestSize = 0;
    for (const item of content.items.slice(0, 60) as { str?: string; transform?: number[] }[]) {
      const text = item.str?.trim();
      if (!text || text.length < 2 || !item.transform) continue;
      const size = Math.hypot(item.transform[0]!, item.transform[1]!);
      if (size > bestSize + 0.5) {
        best = text;
        bestSize = size;
      }
    }
    return best.slice(0, 200);
  } catch {
    return '';
  }
}

/**
 * Sprechernotizen aus einer PPTX in Folienreihenfolge – mit Kennzeichen für
 * ausgeblendete Folien. Ob ein PDF-Export diese enthält, hängt vom Programm ab
 * (PowerPoint: nein, Google Slides: ja); die Zuordnung macht `planNotes`.
 */
export async function extractPptxNotes(file: File): Promise<PptxSlideInfo[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = async (path: string) => {
    const text = await zip.file(path)?.async('string');
    return text ? new DOMParser().parseFromString(text, 'application/xml') : null;
  };
  const rels = async (path: string) => {
    const doc = await xml(path);
    const map = new Map<string, { target: string; type: string }>();
    for (const r of Array.from(doc?.getElementsByTagNameNS('*', 'Relationship') ?? [])) {
      map.set(r.getAttribute('Id') ?? '', { target: r.getAttribute('Target') ?? '', type: r.getAttribute('Type') ?? '' });
    }
    return map;
  };
  const resolve = (from: string, target: string) => {
    const parts = from.split('/').slice(0, -1);
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  };

  const presentation = await xml('ppt/presentation.xml');
  if (!presentation) throw new Error('Keine gültige PowerPoint-Datei');
  const size = presentation.getElementsByTagNameNS('*', 'sldSz')[0];
  const slideW = Number(size?.getAttribute('cx') ?? 9144000);
  const slideH = Number(size?.getAttribute('cy') ?? 5143500);
  const presRels = await rels('ppt/_rels/presentation.xml.rels');
  const notes: PptxSlideInfo[] = [];

  for (const sldId of Array.from(presentation.getElementsByTagNameNS('*', 'sldId'))) {
    const rid =
      sldId.getAttribute('r:id') ?? sldId.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '';
    const target = presRels.get(rid)?.target;
    if (!target) continue;
    const slidePath = resolve('ppt/presentation.xml', target);
    const slide = await xml(slidePath);
    const hidden = slide?.documentElement.getAttribute('show') === '0';
    const builds = { ...(slide ? parseBuilds(slide.documentElement, slideW, slideH) : { regions: [], steps: 0 }), aspect: slideW / slideH };
    // Google-Slides-Exporte benennen jede Form „Google Shape;<n>;<Kennung der Folie>“ – stabil über Exporte hinweg
    const sourceKey = Array.from(slide?.getElementsByTagNameNS('*', 'cNvPr') ?? [])
      .map((el) => /^Google Shape;\d+;([A-Za-z0-9_]{1,100})$/.exec(el.getAttribute('name') ?? '')?.[1])
      .find(Boolean);
    if (sourceKey) Object.assign(builds, { sourceKey });

    const slideRels = await rels(slidePath.replace(/([^/]+)$/, '_rels/$1.rels'));
    const notesRel = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'));
    if (!notesRel) {
      notes.push({ notes: '', hidden, ...builds });
      continue;
    }
    const notesDoc = await xml(resolve(slidePath, notesRel.target));
    const paragraphs: string[] = [];
    for (const shape of Array.from(notesDoc?.getElementsByTagNameNS('*', 'sp') ?? [])) {
      const ph = shape.getElementsByTagNameNS('*', 'ph')[0];
      const phType = ph?.getAttribute('type');
      // Nur der Notiztext – nicht Foliennummer, Folienbild, Kopf-/Fußzeile
      if (!ph || (phType && phType !== 'body')) continue;
      for (const p of Array.from(shape.getElementsByTagNameNS('*', 'p'))) {
        paragraphs.push(
          Array.from(p.getElementsByTagNameNS('*', 't'))
            .map((t) => t.textContent ?? '')
            .join(''),
        );
      }
    }
    notes.push({
      notes: paragraphs
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      hidden,
      ...builds,
    });
  }
  return notes;
}

/* ───────────────────── Animationen aus der PPTX ───────────────────── */

const kids = (el: Element | null | undefined, name?: string) =>
  el ? Array.from(el.children).filter((c) => !name || c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const SHAPES = ['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'];

/** Position aller Elemente einer Folie (relativ 0…1), auch in verschachtelten Gruppen. */
/**
 * Einfarbiges Rechteck ohne Text und Drehung – kann als Abdeckung nachgebaut
 * werden, wenn es per Ausgangs-Animation verschwindet.
 */
function isCoverShape(el: Element): boolean {
  if (el.localName !== 'sp') return false;
  const props = kid(el, 'spPr');
  if (kid(props, 'prstGeom')?.getAttribute('prst') !== 'rect' || !kid(props, 'solidFill')) return false;
  if (Number(kid(props, 'xfrm')?.getAttribute('rot') ?? 0) !== 0) return false;
  return Array.from(el.getElementsByTagNameNS('*', 't')).every((t) => !t.textContent?.trim());
}

interface ShapeBox extends Box {
  line: number;
  /** Einfarbiges Rechteck ohne Text (siehe `isCoverShape`) */
  cover: boolean;
  /** Bild (`p:pic`) */
  picture: boolean;
  /** Text je Absatz (`a:p`), leer bei Formen ohne Text */
  paragraphs: string[];
}

/** Text je Absatz eines Elements */
function paragraphTexts(el: Element): string[] {
  const body = kid(el, 'txBody');
  if (!body) return [];
  return kids(body, 'p').map((p) =>
    Array.from(p.getElementsByTagNameNS('*', 't'))
      .map((t) => t.textContent ?? '')
      .join(''),
  );
}

function shapeBoxes(slide: Element, slideW: number, slideH: number): Map<string, ShapeBox> {
  const boxes = new Map<string, ShapeBox>();
  type Transform = (x: number, y: number) => [number, number];
  const walk = (container: Element | null, tf: Transform, sx: number, sy: number) => {
    for (const el of kids(container)) {
      if (!SHAPES.includes(el.localName)) continue;
      const nv = kids(el).find((c) => c.localName.startsWith('nv'));
      const id = kid(nv, 'cNvPr')?.getAttribute('id');
      const props = el.localName === 'grpSp' ? kid(el, 'grpSpPr') : el.localName === 'graphicFrame' ? el : kid(el, 'spPr');
      const xfrm = kid(props, 'xfrm');
      const off = kid(xfrm, 'off');
      const ext = kid(xfrm, 'ext');
      if (!off || !ext) continue;
      const ox = Number(off.getAttribute('x'));
      const oy = Number(off.getAttribute('y'));
      let cx = Number(ext.getAttribute('cx'));
      let cy = Number(ext.getAttribute('cy'));
      // Tabellen: Die Rahmengröße ist oft veraltet – maßgeblich sind Spaltenbreiten und Zeilenhöhen
      const table = el.localName === 'graphicFrame' ? tableSize(el) : null;
      if (table) [cx, cy] = table;
      const [ax, ay] = tf(ox, oy);
      // Konturen liegen mittig auf der Kante und ragen halb über die Box hinaus
      const ln = kid(props, 'ln');
      const line = ln && !kid(ln, 'noFill') ? Number(ln.getAttribute('w') ?? 12700) : 0;
      // Gedrehte Elemente (rot in 1/60000 Grad): umschließendes Rechteck abdecken
      const rot = Number(xfrm?.getAttribute('rot') ?? 0) / 60000;
      const b = rotatedBounds(ax, ay, cx * sx, cy * sy, Number.isFinite(rot) ? rot : 0);
      if (id) {
        boxes.set(id, {
          x: b.x / slideW,
          y: b.y / slideH,
          w: b.w / slideW,
          h: b.h / slideH,
          line,
          cover: isCoverShape(el),
          picture: el.localName === 'pic',
          paragraphs: el.localName === 'sp' ? paragraphTexts(el) : [],
        });
      }
      if (el.localName === 'grpSp') {
        // Kinder einer Gruppe liegen in eigenen Koordinaten (chOff/chExt)
        const chOff = kid(xfrm, 'chOff');
        const chExt = kid(xfrm, 'chExt');
        const chW = Number(chExt?.getAttribute('cx'));
        const chH = Number(chExt?.getAttribute('cy'));
        const kx = chW ? cx / chW : 1;
        const ky = chH ? cy / chH : 1;
        const cox = Number(chOff?.getAttribute('x') ?? 0);
        const coy = Number(chOff?.getAttribute('y') ?? 0);
        walk(el, (x, y) => tf(ox + (x - cox) * kx, oy + (y - coy) * ky), sx * kx, sy * ky);
      }
    }
  };
  walk(kid(kid(slide, 'cSld'), 'spTree'), (x, y) => [x, y], 1, 1);
  return boxes;
}

/** Größe einer Tabelle (EMU) aus `a:gridCol@w` und `a:tr@h`, sonst `null` */
function tableSize(frame: Element): [number, number] | null {
  const tbl = frame.getElementsByTagNameNS('*', 'tbl')[0];
  if (!tbl) return null;
  const sum = (name: string, attr: string) =>
    Array.from(tbl.getElementsByTagNameNS('*', name)).reduce((n, c) => n + (Number(c.getAttribute(attr)) || 0), 0);
  const w = sum('gridCol', 'w');
  const h = sum('tr', 'h');
  return w > 0 && h > 0 ? [w, h] : null;
}

const delayOf = (cTn: Element | null) => {
  const d = kid(kid(cTn, 'stCondLst'), 'cond')?.getAttribute('delay');
  const n = Number(d);
  return d && d !== 'indefinite' && Number.isFinite(n) ? n : 0;
};

/**
 * Eingangsanimationen einer Folie als Aufbau-Schritte.
 *
 * Struktur (mainSeq): jede oberste Gruppe ist ein Auslöser. Ob sie einen Klick
 * braucht, verrät der Typ ihres ersten Effekts – „clickEffect“ heißt Klick,
 * „withEffect“/„afterEffect“ heißt: läuft von selbst (beim Aufrufen der Folie
 * bzw. im Anschluss an den vorigen Klick). Startzeiten sind die Summe der
 * Verzögerungen entlang der Verschachtelung.
 */
function parseBuilds(slide: Element, slideW: number, slideH: number): { regions: RawBuildRegion[]; steps: number } {
  const timing = kid(slide, 'timing');
  if (!timing) return { regions: [], steps: 0 };
  const mainSeq = Array.from(timing.getElementsByTagNameNS('*', 'cTn')).find((c) => c.getAttribute('nodeType') === 'mainSeq');
  if (!mainSeq) return { regions: [], steps: 0 };
  const boxes = shapeBoxes(slide, slideW, slideH);
  const regions: RawBuildRegion[] = [];
  let step = 0;
  let stepEnd = 0;
  let first = true;

  for (const group of kids(kid(mainSeq, 'childTnLst'), 'par')) {
    const effects: { cTn: Element; at: number }[] = [];
    const collect = (par: Element, t: number) => {
      const cTn = kid(par, 'cTn');
      if (!cTn) return;
      const at = t + delayOf(cTn);
      if (cTn.getAttribute('presetClass')) effects.push({ cTn, at });
      else for (const child of kids(kid(cTn, 'childTnLst'), 'par')) collect(child, at);
    };
    for (const child of kids(kid(kid(group, 'cTn'), 'childTnLst'), 'par')) collect(child, 0);
    if (effects.length === 0) continue;

    const spidOf = (cTn: Element) => cTn.getElementsByTagNameNS('*', 'spTgt')[0]?.getAttribute('spid') ?? '';
    const classOf = (cTn: Element) => cTn.getAttribute('presetClass');
    // Eingänge, Ausgänge (Element wird beim Rendern weggelassen) und die Hervorhebung „Drehen“
    const entrances = effects.filter(
      (e) =>
        classOf(e.cTn) === 'entr' || classOf(e.cTn) === 'exit' || (classOf(e.cTn) === 'emph' && e.cTn.getAttribute('presetID') === '8'),
    );
    const onClick = effects[0]!.cTn.getAttribute('nodeType') === 'clickEffect';
    if (onClick) {
      if (entrances.length === 0) continue; // nur andere Hervorhebungen – lassen sich aus dem PDF nicht nachbauen
      step++;
      stepEnd = 0;
    }
    const base = onClick || first ? 0 : stepEnd;
    first = false;

    for (const e of entrances) {
      const spid = spidOf(e.cTn);
      const box = spid ? boxes.get(spid) : undefined;
      const exit = classOf(e.cTn) === 'exit';
      const spin = classOf(e.cTn) === 'emph';
      if (!box || box.w <= 0 || box.h <= 0 || step > 50) continue;
      // „Absatzweise“: Ziel ist ein Absatzbereich des Textfelds
      const range = e.cTn.getElementsByTagNameNS('*', 'pRg')[0];
      const paragraph: [number, number] | null =
        range && box.paragraphs.length > 0 ? [Number(range.getAttribute('st') ?? 0), Number(range.getAttribute('end') ?? 0)] : null;
      const durs = Array.from(e.cTn.getElementsByTagNameNS('*', 'cTn'))
        .map((c) => Number(c.getAttribute('dur')))
        .filter((d) => Number.isFinite(d));
      const dur = Math.min(10000, Math.max(0, ...durs));
      const at = Math.min(60000, Math.round(base + e.at));
      // Halbe Konturbreite plus ~1,5 px (bei 1920 px) gegen Kantenglättung
      const padX = box.line / 2 / slideW + 0.0008;
      const padY = box.line / 2 / slideH + 0.0014;
      const x = Math.min(1, Math.max(0, box.x - padX));
      const y = Math.min(1, Math.max(0, box.y - padY));
      regions.push({
        x,
        y,
        w: Math.min(1 - x, Math.max(0, box.w + 2 * padX)),
        h: Math.min(1 - y, Math.max(0, box.h + 2 * padY)),
        step,
        at,
        dur: Math.round(dur),
        effect: spin
          ? 'spin'
          : (exit ? buildExitEffectOf : buildEffectOf)(
              e.cTn.getAttribute('presetID'),
              e.cTn.getAttribute('presetSubtype'),
              e.cTn.getElementsByTagNameNS('*', 'animEffect')[0]?.getAttribute('filter') ?? null,
            ),
        // Einfarbige Rechtecke: Abdeckung in ihrer Farbe; andere Elemente: Ausschnitt aus dem Startbild
        ...(exit && box.cover ? { cover: true } : {}),
        ...(exit && !box.cover ? { exit: true, shapeText: box.paragraphs.join(''), picture: box.picture } : {}),
        ...(paragraph ? { paragraph, paragraphTexts: box.paragraphs } : {}),
      });
      stepEnd = Math.max(stepEnd, at + dur);
    }
  }
  return { regions, steps: Math.min(50, step) };
}

/**
 * Aufbau-Animationen einer gerenderten Seite aus den Bereichen der PPTX-Folie:
 * angepasste Boxen und gemessene Farben übernehmen, Elemente auf Foto/Verlauf
 * weglassen (`skipped`), leere Klicks entfernen. Ohne passendes Seitenverhältnis
 * keine Animationen – die Abdeckungen säßen sonst daneben.
 */
export function pageBuilds(
  page: Pick<RenderedPage, 'width' | 'height' | 'fills' | 'boxes'>,
  regions: RawBuildRegion[],
  slideInfo: PptxSlideInfo | null | undefined,
  /** Hochgeladenes Startbild (für Ausgänge von Text, Bildern & Co.); ohne entfallen diese */
  startImage: string | null = null,
): { builds: BuildsConfig | undefined; skipped: number } {
  const fits = slideInfo?.aspect ? Math.abs(page.width / page.height - slideInfo.aspect) < 0.01 : false;
  const covered = regions.flatMap((r, k) => {
    const fill = page.fills[k];
    const box = page.boxes[k];
    if (!fill || !box || box.w <= 0 || box.h <= 0 || (r.exit && !startImage)) return [];
    // Nur die gespeicherten Felder – Hilfsangaben aus der PPTX (Text, Absätze …) bleiben hier
    return [
      {
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        step: r.step,
        at: r.at,
        dur: r.dur,
        effect: r.effect,
        fill,
        ...(r.exit ? { exit: true } : {}),
      },
    ];
  });
  const clicks = [...new Set(covered.map((r) => r.step).filter((x) => x > 0))].sort((a, b) => a - b);
  const renumbered = covered.map((r) => ({ ...r, step: r.step === 0 ? 0 : clicks.indexOf(r.step) + 1 }));
  const withStart = startImage && renumbered.some((r) => r.exit);
  const builds: BuildsConfig | undefined =
    renumbered.length > 0 && fits
      ? { enabled: true, steps: clicks.length, regions: renumbered, fitted: true, ...(withStart ? { startImage } : {}) }
      : undefined;
  return { builds, skipped: regions.length - covered.length };
}
