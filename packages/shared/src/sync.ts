/**
 * Abgleich mit einer verknüpften Google-Slides-Präsentation: ordnet die Seiten
 * des aktuellen Exports den vorhandenen Bildfolien zu.
 *
 *  1. Über die Google-Kennung der Seite (`source_key`), unabhängig von der Reihenfolge –
 *     umsortierte Seiten behalten ihre Folie (und damit Notizen und Ergebnisse).
 *  2. Hat noch keine Folie eine Kennung (erste Verknüpfung eines früheren PDF-Imports)
 *     und stimmt die Anzahl, der Reihe nach.
 *  3. Sonst über die Überschriften (längste gemeinsame Folge, leere zählen nie).
 *
 * Nicht zugeordnete Seiten werden eingefügt – vor der Folie der nächsten
 * zugeordneten Seite (eine Abstimmung hinter der vorigen Folie bleibt dort),
 * am Ende hinter der letzten zugeordneten. Entfernt werden nur Folien mit
 * Google-Kennung, deren Seite es nicht mehr gibt; Bildfolien ohne Kennung bleiben.
 */

export interface SyncSlide {
  id: number;
  type: string;
  title: string;
  sourceKey: string | null;
}

export interface SyncPage {
  /** Google-Kennung der Seite (aus der PPTX), falls erkennbar */
  key: string | null;
  title: string;
}

export type SyncInsert = { page: number } & ({ before: number } | { after: number } | { end: true });

export interface SyncPlan {
  /** Bild der Folie durch die Seite ersetzen (in Folienreihenfolge) */
  replace: { slideId: number; page: number }[];
  /** Neue Bildfolien (in Seitenreihenfolge) */
  insert: SyncInsert[];
  /** In Google gelöschte Seiten */
  remove: number[];
  /** Bildfolien ohne Kennung, die keiner Seite entsprechen – bleiben unverändert */
  unmatched: number[];
}

const norm = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

/** Längste gemeinsame Folge; liefert Paare [a-Index, b-Index] */
function lcs<A, B>(a: A[], b: B[], eq: (x: A, y: B) => boolean): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array.from<number>({ length: m + 1 }).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! > dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

export function planSync(slides: SyncSlide[], pages: SyncPage[]): SyncPlan {
  const images = slides.filter((s) => s.type === 'image');
  /** Seite → Folie */
  const slideOfPage = new Map<number, number>();
  const matchedSlides = new Set<number>();
  const match = (page: number, slideId: number) => {
    slideOfPage.set(page, slideId);
    matchedSlides.add(slideId);
  };

  // 1. Kennungen
  const byKey = new Map<string, number>();
  for (const s of images) if (s.sourceKey && !byKey.has(s.sourceKey)) byKey.set(s.sourceKey, s.id);
  for (const [i, p] of pages.entries()) {
    const sid = p.key ? byKey.get(p.key) : undefined;
    if (sid !== undefined && !matchedSlides.has(sid)) match(i, sid);
  }

  const freeSlides = images.filter((s) => !s.sourceKey && !matchedSlides.has(s.id));
  const freePages = pages.map((p, i) => ({ ...p, index: i })).filter((p) => !slideOfPage.has(p.index));
  if (images.every((s) => !s.sourceKey) && freeSlides.length === pages.length && freeSlides.length > 0) {
    // 2. Erste Verknüpfung, gleiche Anzahl: der Reihe nach
    for (const [k, s] of freeSlides.entries()) match(k, s.id);
  } else {
    // 3. Überschriften
    for (const [si, pi] of lcs(freeSlides, freePages, (s, p) => norm(s.title) !== '' && norm(s.title) === norm(p.title))) {
      match(freePages[pi]!.index, freeSlides[si]!.id);
    }
  }

  const replace = images.flatMap((s) => {
    const page = [...slideOfPage.entries()].find(([, sid]) => sid === s.id)?.[0];
    return page === undefined ? [] : [{ slideId: s.id, page }];
  });

  const insert: SyncInsert[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (slideOfPage.has(i)) continue;
    let next: number | undefined;
    for (let k = i + 1; k < pages.length && next === undefined; k++) next = slideOfPage.get(k);
    if (next !== undefined) {
      insert.push({ page: i, before: next });
      continue;
    }
    let prev: number | undefined;
    for (let k = i - 1; k >= 0 && prev === undefined; k--) prev = slideOfPage.get(k);
    insert.push(prev !== undefined ? { page: i, after: prev } : { page: i, end: true });
  }

  return {
    replace,
    insert,
    remove: images.filter((s) => s.sourceKey && !matchedSlides.has(s.id)).map((s) => s.id),
    unmatched: images.filter((s) => !s.sourceKey && !matchedSlides.has(s.id)).map((s) => s.id),
  };
}
