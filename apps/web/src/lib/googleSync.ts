import { planNotes, planSync, type BuildsConfig, type NotesPlan, type RawBuildRegion, type Slide } from '@slides/shared';
import { api, ApiError } from './api.ts';
import { extractPptxNotes, pageBuilds, pdfPageTitles, renderPdfPages } from './importDeck.ts';
import { uploadPage, uploadStartImage } from './uploadPage.ts';

/**
 * Abgleich mit der verknüpften Google-Slides-Präsentation – im Browser, weil
 * nur hier gerendert wird. Der Server reicht PDF und PPTX von Google durch.
 *
 * 1. PDF + PPTX holen (Prüfsumme des PDFs aus dem Header)
 * 2. Seiten ohne ausgeblendete Folien den Bildfolien zuordnen (`planSync`)
 * 3. Jede gebrauchte Seite rendern; unveränderte (gleiche Prüfsumme von Bild
 *    und Notizen wie beim letzten Abgleich) nicht erneut hochladen
 * 4. Alles in einem Schritt anwenden (`/source/apply`, bedingt auf `baseHash`)
 */

export interface SyncProgress {
  step: 'download' | 'pages' | 'saving';
  done?: number;
  total?: number;
}

export interface SyncResult {
  replaced: number;
  inserted: number;
  removed: number;
  /** In Google gelöscht, aber wegen Ergebnissen behalten */
  kept: number;
  unchanged: number;
  /** PDF bytegleich zum letzten Abgleich – nichts getan */
  noChange?: boolean;
}

async function download(presentationId: number, format: 'pdf' | 'pptx'): Promise<{ file: File; hash: string | null }> {
  let res: Response;
  try {
    res = await fetch(`/api/presentations/${presentationId}/source/file/${format}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Keine Verbindung – bitte gleich noch einmal versuchen');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`, data);
  }
  const blob = await res.blob();
  return { file: new File([blob], `google.${format}`, { type: blob.type }), hash: res.headers.get('X-Source-Hash') };
}

async function sha256(parts: (Blob | string)[]): Promise<string> {
  const buffers = await Promise.all(parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : p.arrayBuffer())));
  const total = new Uint8Array(buffers.reduce((n, b) => n + b.byteLength, 0));
  let offset = 0;
  for (const b of buffers) {
    total.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', total);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

type Item = {
  asset: string;
  width: number;
  height: number;
  title: string;
  notes: string;
  builds?: BuildsConfig;
  sourceKey: string | null;
  pageHash: string;
};

export async function syncFromGoogle(
  presentationId: number,
  slides: Slide[],
  sources: Record<string, { key: string | null; hash: string | null }>,
  baseHash: string | null,
  onProgress: (p: SyncProgress) => void,
  /** Rückfrage, wenn ungewöhnlich viele Folien wegfallen; ohne (automatischer Abgleich) wird abgebrochen */
  confirmRemoval?: (count: number, total: number) => boolean | Promise<boolean>,
  /** Alles neu einlesen, auch Unverändertes (z. B. nach einer Verbesserung des Imports) */
  force = false,
): Promise<SyncResult> {
  onProgress({ step: 'download' });
  const pdf = await download(presentationId, 'pdf');
  if (!pdf.hash) throw new Error('Google hat keine Prüfsumme geliefert');
  // Unverändert seit dem letzten Abgleich: nichts rendern, keine Version
  if (pdf.hash === baseHash && !force) {
    const images = slides.filter((s) => s.type === 'image').length;
    return { replaced: 0, inserted: 0, removed: 0, kept: 0, unchanged: images, noChange: true };
  }
  const pptx = await download(presentationId, 'pptx');
  const info = await extractPptxNotes(pptx.file);
  const titles = await pdfPageTitles(pdf.file);
  // Google-PDFs enthalten ausgeblendete Folien – die PPTX sagt, welche
  const plan: NotesPlan = planNotes(info, titles.length, false);
  const included = titles.map((_, i) => i).filter((i) => plan.pages[i]?.include ?? true);
  const syncPages = included.map((i) => ({ key: plan.pages[i]?.slide?.sourceKey ?? null, title: titles[i] ?? '' }));

  // Ohne verlässliche Zuordnung von Seiten zu Google-Folien lieber abbrechen, als gekennzeichnete
  // Folien zu löschen und alles neu anzuhängen
  const keyedSlides = slides.some((s) => sources[s.id]?.key);
  if (keyedSlides && (plan.mode === 'mismatch' || syncPages.every((p) => !p.key))) {
    throw new Error(
      'Die Seiten aus Google ließen sich den Folien nicht sicher zuordnen (PDF und PowerPoint-Export passen nicht zusammen). ' +
        'Bitte später erneut abgleichen – es wurde nichts geändert.',
    );
  }

  const sync = planSync(
    slides.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.type === 'image' ? s.config.title : '',
      sourceKey: sources[s.id]?.key ?? null,
    })),
    syncPages,
  );

  // Mehr als die Hälfte der Google-Folien weg? Eher ein Fehler beim Export als echte Löschungen
  const keyedCount = slides.filter((s) => sources[s.id]?.key).length;
  if (keyedCount >= 4 && sync.remove.length > keyedCount / 2 && !(await confirmRemoval?.(sync.remove.length, keyedCount))) {
    throw new Error(
      `Der Abgleich würde ${sync.remove.length} von ${keyedCount} Google-Folien entfernen. Das sieht nach einem unvollständigen Export aus – ` +
        'es wurde nichts geändert. Bitte in Google Slides prüfen und erneut abgleichen.',
    );
  }

  /** PDF-Seite → wofür sie gebraucht wird */
  const slideOfPage = new Map(sync.replace.map((r) => [included[r.page]!, r.slideId]));
  const insertOfPage = new Map(sync.insert.map((it) => [included[it.page]!, it]));
  const keyOfPdfPage = new Map(included.map((pdfIndex, k) => [pdfIndex, syncPages[k]!.key]));
  const regions = (i: number): RawBuildRegion[] => plan.pages[i]?.slide?.regions ?? [];

  const replace: (Item & { slideId: number })[] = [];
  const keys: { slideId: number; sourceKey: string | null }[] = [];
  const insert: (Item & { before?: number; after?: number })[] = [];
  let unchanged = 0;
  const total = slideOfPage.size + insertOfPage.size;
  onProgress({ step: 'pages', done: 0, total });
  let done = 0;
  for await (const page of renderPdfPages(pdf.file, () => (i) => slideOfPage.has(i) || insertOfPage.has(i), regions)) {
    const notes = plan.pages[page.index]?.notes ?? '';
    const pageHash = await sha256([page.full, '\u0000', notes]);
    const sourceKey = keyOfPdfPage.get(page.index) ?? null;
    const slideId = slideOfPage.get(page.index);
    if (slideId !== undefined && sources[slideId]?.hash === pageHash && !force) {
      // Seite unverändert: nichts hochladen, nur die Kennung nachtragen
      unchanged++;
      if ((sources[slideId]?.key ?? null) !== sourceKey) keys.push({ slideId, sourceKey });
    } else {
      const asset = await uploadPage(presentationId, page);
      const start = await uploadStartImage(presentationId, page);
      const { builds } = pageBuilds(page, regions(page.index), plan.pages[page.index]?.slide, start);
      const item: Item = { asset, width: page.width, height: page.height, title: page.title, notes, builds, sourceKey, pageHash };
      if (slideId !== undefined) replace.push({ ...item, slideId });
      else {
        const it = insertOfPage.get(page.index)!;
        insert.push({ ...item, ...('before' in it ? { before: it.before } : 'after' in it ? { after: it.after } : {}) });
      }
    }
    onProgress({ step: 'pages', done: ++done, total });
  }
  // `insert` muss in Seitenreihenfolge bleiben – renderPdfPages liefert aufsteigend
  onProgress({ step: 'saving' });
  const res = await api<{ kept: number[] }>(`/api/presentations/${presentationId}/source/apply`, {
    body: { baseHash, hash: pdf.hash, replace, keys, insert, remove: sync.remove },
  });
  return {
    replaced: replace.length,
    inserted: insert.length,
    removed: sync.remove.length - res.kept.length,
    kept: res.kept.length,
    unchanged,
  };
}
