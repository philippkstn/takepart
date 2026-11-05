/**
 * Sprechernotizen aus einer PPTX den Seiten eines PDF-Exports zuordnen.
 *
 * Die Exporte unterscheiden sich bei ausgeblendeten Folien:
 *  - PowerPoint lässt sie weg → PDF-Seiten = sichtbare Folien
 *  - Google Slides (und manche Druck-Exporte) behalten sie → PDF-Seiten = alle Folien
 * Welcher Fall vorliegt, ergibt sich aus der Seitenzahl.
 */

/** Aufbau-Bereich aus der PPTX – die Abdeckfarbe wird erst am gerenderten Bild gemessen. */
export type RawBuildRegion = Omit<import('./slides.ts').BuildRegion, 'fill'>;

export interface PptxSlideInfo {
  notes: string;
  hidden: boolean;
  /** Eingangsanimationen dieser Folie (leer, wenn keine) */
  regions?: RawBuildRegion[];
  /** Anzahl Klicks bis zum Endzustand */
  steps?: number;
  /** Seitenverhältnis der Folie (Breite / Höhe) */
  aspect?: number;
}

export type NotesMode = 'all-slides' | 'visible-slides' | 'mismatch' | 'none';

export interface PagePlan {
  /** Seite importieren? (ausgeblendete Folien werden standardmäßig übersprungen) */
  include: boolean;
  notes: string;
  /** Zugeordnete PPTX-Folie (für Notizen und Animationen) */
  slide: PptxSlideInfo | null;
}

export interface NotesPlan {
  mode: NotesMode;
  pages: PagePlan[];
  /** Anzahl übersprungener, ausgeblendeter Folien */
  skippedHidden: number;
}

export function planNotes(slides: PptxSlideInfo[] | null, pageCount: number, includeHidden = false): NotesPlan {
  const blank = (include = true): PagePlan => ({ include, notes: '', slide: null });
  if (!slides) return { mode: 'none', pages: Array.from({ length: pageCount }, () => blank()), skippedHidden: 0 };

  if (slides.length === pageCount && slides.some((s) => s.hidden)) {
    // PDF enthält auch die ausgeblendeten Folien (z. B. Google Slides)
    const pages = slides.map((s) => ({ include: includeHidden || !s.hidden, notes: s.notes, slide: s }));
    return { mode: 'all-slides', pages, skippedHidden: pages.filter((p) => !p.include).length };
  }

  const visible = slides.filter((s) => !s.hidden);
  if (visible.length === pageCount) {
    return { mode: 'visible-slides', pages: visible.map((s) => ({ include: true, notes: s.notes, slide: s })), skippedHidden: 0 };
  }
  if (slides.length === pageCount) {
    return { mode: 'all-slides', pages: slides.map((s) => ({ include: true, notes: s.notes, slide: s })), skippedHidden: 0 };
  }

  // Passt nicht: der Reihe nach über die sichtbaren Folien zuordnen
  return {
    mode: 'mismatch',
    // Bei unsicherer Zuordnung keine Animationen übernehmen – falsche Abdeckungen wären schlimmer als keine
    pages: Array.from({ length: pageCount }, (_, i) => ({ include: true, notes: visible[i]?.notes ?? '', slide: null })),
    skippedHidden: 0,
  };
}

const normTitle = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * „Folienbilder aktualisieren“: Seiten eines neuen PDFs den vorhandenen Bildfolien
 * zuordnen. Gleiche Anzahl → der Reihe nach. Sonst über die Überschriften
 * (längste gemeinsame Teilfolge, Reihenfolge bleibt): jede Bildfolie braucht eine
 * Seite mit gleicher Überschrift, sonst `null` (lieber abbrechen als falsch zuordnen).
 * Liefert je Bildfolie den Seitenindex.
 */
export function alignPages(slideTitles: string[], pageTitles: string[]): number[] | null {
  if (slideTitles.length === pageTitles.length) return slideTitles.map((_, i) => i);
  const a = slideTitles.map(normTitle);
  const b = pageTitles.map(normTitle);
  if (a.some((t) => !t)) return null;
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  if (dp[0]![0] !== n) return null;
  const out: number[] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j] && dp[i]![j] === dp[i + 1]![j + 1]! + 1) {
      out.push(j);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out.length === n ? out : null;
}
