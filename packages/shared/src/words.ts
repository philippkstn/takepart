/**
 * Wörter zählen – für Wortwolke und Satz-Spiel.
 *
 * Gezählt wird nach einem normalisierten Schlüssel (Kleinschreibung, ohne Satzzeichen
 * am Rand, Unicode-NFC), angezeigt wird die Schreibweise, die am häufigsten
 * eingegeben wurde. „Server“, „server“ und „Server!“ sind also ein Wort.
 */

const EDGE_PUNCTUATION = /^[\s"'„“”‚‘’«»()[\]{}.,;:!?…–—-]+|[\s"'„“”‚‘’«»()[\]{}.,;:!?…–—-]+$/gu;

export function cleanWord(input: string): string {
  return input.normalize('NFC').replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '').trim();
}

export function wordKey(input: string): string {
  return cleanWord(input).toLocaleLowerCase('de-DE');
}

/** Ein einzelnes Wort: keine Leerzeichen, nicht leer, höchstens 40 Zeichen. */
export function validateSingleWord(input: string): { ok: true; word: string } | { ok: false; error: string } {
  const word = cleanWord(input);
  if (!word) return { ok: false, error: 'Bitte ein Wort eingeben' };
  if (/\s/.test(word)) return { ok: false, error: 'Bitte nur ein einzelnes Wort' };
  if (word.length > 40) return { ok: false, error: 'Das Wort ist zu lang' };
  return { ok: true, word };
}

/** Kurzer Begriff für die Wortwolke: bis zu drei Wörter, höchstens 40 Zeichen. */
export function validateTerm(input: string): { ok: true; word: string } | { ok: false; error: string } {
  const word = cleanWord(input);
  if (!word) return { ok: false, error: 'Bitte einen Begriff eingeben' };
  if (word.length > 40) return { ok: false, error: 'Der Begriff ist zu lang' };
  if (word.split(' ').length > 3) return { ok: false, error: 'Höchstens drei Wörter pro Begriff' };
  return { ok: true, word };
}

export interface WordCount {
  key: string;
  word: string;
  count: number;
}

/** Zählt Wörter, sortiert absteigend nach Häufigkeit, bei Gleichstand nach erstem Auftreten. */
export function countWords(words: Iterable<string>): WordCount[] {
  const groups = new Map<string, { order: number; count: number; variants: Map<string, number> }>();
  let order = 0;
  for (const raw of words) {
    const word = cleanWord(raw);
    if (!word) continue;
    const key = wordKey(word);
    let group = groups.get(key);
    if (!group) {
      group = { order: order++, count: 0, variants: new Map() };
      groups.set(key, group);
    }
    group.count++;
    group.variants.set(word, (group.variants.get(word) ?? 0) + 1);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.order - b.order)
    .map(([key, group]) => {
      let best = '';
      let bestCount = 0;
      for (const [variant, count] of group.variants) {
        if (count > bestCount) {
          best = variant;
          bestCount = count;
        }
      }
      return { key, word: best, count: group.count };
    });
}

/** Alle Wörter mit der höchsten Anzahl – mehr als eins bedeutet Gleichstand. */
export function topWords(counts: WordCount[]): WordCount[] {
  if (counts.length === 0) return [];
  const max = counts[0]!.count;
  return counts.filter((c) => c.count === max);
}

/** Hängt ein Wort an einen Satz an. Satzzeichen am Wortanfang werden ohne Leerzeichen angehängt. */
export function appendWord(sentence: string, word: string): string {
  const base = sentence.trimEnd();
  const w = word.trim();
  if (!w) return base;
  if (!base) return w;
  if (/^[.,;:!?…]/.test(w)) return base + w;
  return `${base} ${w}`;
}

/** Satzanfang ohne abschließende Auslassungspunkte („sieht, dass…“ → „sieht, dass“). */
export function sentenceStart(start: string): string {
  return start.trim().replace(/\s*(\.\.\.|…)\s*$/, '');
}

export function buildSentence(start: string, words: string[]): string {
  return words.reduce((acc, w) => appendWord(acc, w), sentenceStart(start));
}
