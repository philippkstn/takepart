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

import type { BuildEffect, PptxSlideInfo, RawBuildRegion } from '@slides/shared';

/** Lange Seite der Folienbilder in Pixeln – scharf auf Full-HD-Beamern, klein genug für Handys. */
const FULL_SIZE = 1920;
const THUMB_WIDTH = 400;

export interface RenderedPage {
  index: number;
  total: number;
  width: number;
  height: number;
  full: Blob;
  thumb: Blob;
  /** Größter Text der Seite – meist die Überschrift, für Folienlisten */
  title: string;
  /**
   * Gemessene Abdeckfarben je angefragtem Bereich (siehe `regionsFor`);
   * `null`, wenn die Umgebung nicht einfarbig ist (Foto, Verlauf) – dann wäre
   * eine Abdeckung als Fleck zu sehen.
   */
  fills: (string | null)[];
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

/**
 * Abdeckfarbe eines Bereichs: Median der Pixel auf einem schmalen Ring knapp
 * außerhalb des Elements. Liegt ein Text auf einer Fläche, ist das die Farbe der
 * Fläche – genau das, was vor dem Aufdecken zu sehen sein soll.
 */
function sampleFill(data: ImageData, box: Box): { fill: string; spread: number } {
  const { width, height } = data;
  const x0 = Math.round(box.x * width) - 3;
  const y0 = Math.round(box.y * height) - 3;
  const x1 = Math.round((box.x + box.w) * width) + 2;
  const y1 = Math.round((box.y + box.h) * height) + 2;
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const take = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    r.push(data.data[i]!);
    g.push(data.data[i + 1]!);
    b.push(data.data[i + 2]!);
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
  if (r.length === 0) return { fill: '#ffffff', spread: 0 };
  const sorted = [r, g, b].map((v) => v.sort((a, c) => a - c));
  const at = (v: number[], q: number) => v[Math.min(v.length - 1, Math.floor(v.length * q))]!;
  // Spannweite ohne die äußersten 10 % (einzelne Linien oder Kanten im Ring stören nicht)
  const spread = Math.max(...sorted.map((v) => at(v, 0.9) - at(v, 0.1)));
  const fill = '#' + sorted.map((v) => at(v, 0.5).toString(16).padStart(2, '0')).join('');
  return { fill, spread };
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

/**
 * Rendert die Seiten eines PDFs. `select` bekommt die Seitenzahl und entscheidet
 * je Seite, ob sie gebraucht wird – übersprungene Seiten werden nicht gerendert.
 */
export async function* renderPdfPages(
  file: File,
  select: (total: number) => (index: number) => boolean = () => () => true,
  regionsFor: (index: number) => Box[] = () => [],
): AsyncGenerator<RenderedPage> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
  });
  const doc = await task.promise;
  const wanted = select(doc.numPages);

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (!wanted(i - 1)) continue;
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = FULL_SIZE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      // Weißer Grund: transparente PDF-Seiten sähen sonst auf dunklem Beamer schwarz aus.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // intent 'print': zeichnet ohne requestAnimationFrame – der Import läuft so auch
      // weiter, wenn der Tab im Hintergrund liegt. Für statische Folienbilder ohnehin passend.
      await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = THUMB_WIDTH;
      thumbCanvas.height = Math.round((canvas.height / canvas.width) * THUMB_WIDTH);
      const tctx = thumbCanvas.getContext('2d')!;
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

      const boxes = regionsFor(i - 1);
      let fills: (string | null)[] = [];
      let spreads: number[] = [];
      if (boxes.length > 0) {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const samples = boxes.map((box) => sampleFill(data, box));
        fills = samples.map((x) => (x.spread <= MAX_FILL_SPREAD ? x.fill : null));
        spreads = samples.map((x) => x.spread);
      }

      const [full, thumb, title] = await Promise.all([canvasToBlob(canvas, 0.86), canvasToBlob(thumbCanvas, 0.8), pageTitle(page)]);
      page.cleanup();
      yield { index: i - 1, total: doc.numPages, width: canvas.width, height: canvas.height, full, thumb, title, fills, spreads };
    }
  } finally {
    await task.destroy();
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
function shapeBoxes(slide: Element, slideW: number, slideH: number): Map<string, Box & { line: number }> {
  const boxes = new Map<string, Box & { line: number }>();
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
      const cx = Number(ext.getAttribute('cx'));
      const cy = Number(ext.getAttribute('cy'));
      const [ax, ay] = tf(ox, oy);
      // Konturen liegen mittig auf der Kante und ragen halb über die Box hinaus
      const ln = kid(props, 'ln');
      const line = ln && !kid(ln, 'noFill') ? Number(ln.getAttribute('w') ?? 12700) : 0;
      if (id) boxes.set(id, { x: ax / slideW, y: ay / slideH, w: (cx * sx) / slideW, h: (cy * sy) / slideH, line });
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

function effectOf(presetId: string | null, subtype: string | null): BuildEffect {
  if (presetId === '1') return 'appear';
  if (presetId === '2') {
    // „Hineinfliegen“: Untertyp ist die Richtung, aus der das Element kommt
    return subtype === '1' ? 'fly-top' : subtype === '2' ? 'fly-right' : subtype === '8' ? 'fly-left' : 'fly-bottom';
  }
  if (presetId === '53' || presetId === '23') return 'zoom';
  return 'fade';
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

    const entrances = effects.filter((e) => e.cTn.getAttribute('presetClass') === 'entr');
    const onClick = effects[0]!.cTn.getAttribute('nodeType') === 'clickEffect';
    if (onClick) {
      if (entrances.length === 0) continue; // nur Ausgang/Betonung – lässt sich aus dem PDF nicht nachbauen
      step++;
      stepEnd = 0;
    }
    const base = onClick || first ? 0 : stepEnd;
    first = false;

    for (const e of entrances) {
      const spid = e.cTn.getElementsByTagNameNS('*', 'spTgt')[0]?.getAttribute('spid');
      const box = spid ? boxes.get(spid) : undefined;
      if (!box || box.w <= 0 || box.h <= 0 || step > 50) continue;
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
        effect: effectOf(e.cTn.getAttribute('presetID'), e.cTn.getAttribute('presetSubtype')),
      });
      stepEnd = Math.max(stepEnd, at + dur);
    }
  }
  return { regions, steps: Math.min(50, step) };
}
