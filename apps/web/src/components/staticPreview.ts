import { buildSentence, sentenceStart, type BrandView, type DisplayView, type Slide } from '@slides/shared';

/**
 * Beamer-Ansicht einer Folie ohne Live-Daten – für die Vorschau im Editor und
 * „nächste Folie“ in der Referentenansicht.
 */
export function staticPreview(
  slide: Slide,
  opts: { title: string; brand: BrandView | null; index: number; count: number; code?: string | null; buildStep?: number },
): DisplayView {
  return {
    kind: 'display',
    run: { id: 0, title: opts.title, code: opts.code ?? '123456', ended: false, brand: opts.brand },
    serverTime: Date.now(),
    participants: 0,
    slide,
    slideIndex: opts.index,
    slideCount: opts.count,
    locked: false,
    resultsVisible: false,
    answers: 0,
    results: null,
    quiz: slide.type === 'quiz' ? { phase: 'ready', closesAt: null, revealed: false } : null,
    sentence:
      slide.type === 'sentence'
        ? {
            text: buildSentence(slide.config.start, []),
            start: sentenceStart(slide.config.start),
            appended: [],
            round: 1,
            revealed: false,
            done: false,
          }
        : null,
    posts: [],
    spotlight: null,
    leaderboard: null,
    showJoin: false,
    preload: [],
    // Ohne Angabe im Endzustand (alle Animationen aufgedeckt)
    buildStep: opts.buildStep ?? 50,
    blank: null,
  };
}
