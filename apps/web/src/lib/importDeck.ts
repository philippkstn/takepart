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

import type { PptxSlideInfo } from '@slides/shared';

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

      const [full, thumb, title] = await Promise.all([canvasToBlob(canvas, 0.86), canvasToBlob(thumbCanvas, 0.8), pageTitle(page)]);
      page.cleanup();
      yield { index: i - 1, total: doc.numPages, width: canvas.width, height: canvas.height, full, thumb, title };
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

    const slideRels = await rels(slidePath.replace(/([^/]+)$/, '_rels/$1.rels'));
    const notesRel = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'));
    if (!notesRel) {
      notes.push({ notes: '', hidden });
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
    });
  }
  return notes;
}
