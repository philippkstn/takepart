/**
 * Ähnliche Themen über mehrere Durchführungen finden – ohne externe Dienste.
 *
 * Verfahren: Text normalisieren (Kleinschreibung, Umlaute ausschreiben, Satzzeichen
 * weg, Stoppwörter weg, einfache Endungen kürzen), dann Wortmengen vergleichen
 * (Jaccard-Index). Paare über der Schwelle landen in derselben Gruppe
 * (Union-Find). Verglichen werden nur Einträge, die mindestens ein Wort teilen
 * (invertierter Index) – so bleibt es auch bei tausenden Karten schnell.
 */

const STOPWORDS = new Set(
  `aber alle allem allen aller alles als also am an ander andere anderen auch auf aus bei beim bin bis bist da damit dann das
  dass dem den der des die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines er es
  etwas euch euer eure für gegen hat hatte haben hier hin ich ihr ihre im in ist ja jede jedem jeden jeder jedes kann kein
  keine man mehr mein mit muss nach nicht noch nur ob oder ohne sehr sein seine sich sie sind so soll sollte sowie über um
  und uns unser unsere unter viel viele vom von vor war waren was weil weiter wenn wer werden wie wir wird wo zu zum zur zwischen
  the a an and or of to for in on with is are be`
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => fold(w)),
);

/** Kleinschreibung, Umlaute ausschreiben, Akzente entfernen */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Häufige Endungen kürzen („Meetings“ → „meeting“, „Prozesse“ → „prozess“) – bewusst grob */
function stem(word: string): string {
  for (const suffix of ['ungen', 'en', 'er', 'es', 'e', 'n', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

/** Normalisierte Wortmenge eines Textes */
export function topicTokens(text: string): Set<string> {
  const words = fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words.map(stem));
}

/** Jaccard-Index zweier Wortmengen (0…1); leere Mengen sind sich nie ähnlich */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common);
}

export interface TopicItem<S = number> {
  text: string;
  /** Herkunft, z. B. die Durchführung */
  source: S;
}

export interface TopicCluster<S = number> {
  /** Repräsentativer Text (der häufigste, bei Gleichstand der kürzeste) */
  label: string;
  items: TopicItem<S>[];
  /** Verschiedene Herkünfte in dieser Gruppe */
  sources: S[];
}

/**
 * Gruppiert ähnliche Texte. Ergebnis: nur Gruppen, die in mindestens
 * `minSources` verschiedenen Herkünften vorkommen – sortiert nach Zahl der
 * Herkünfte, dann der Einträge.
 */
export function groupSimilar<S>(items: TopicItem<S>[], threshold = 0.5, minSources = 2): TopicCluster<S>[] {
  const tokens = items.map((it) => topicTokens(it.text));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const index = new Map<string, number[]>();
  tokens.forEach((set, i) => {
    for (const w of set) index.set(w, [...(index.get(w) ?? []), i]);
  });
  const compared = new Set<string>();
  for (const list of index.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = list[x]!;
        const b = list[y]!;
        const key = `${a}:${b}`;
        if (compared.has(key)) continue;
        compared.add(key);
        if (jaccard(tokens[a]!, tokens[b]!) >= threshold) union(a, b);
      }
    }
  }

  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });

  const clusters: TopicCluster<S>[] = [];
  for (const members of groups.values()) {
    const list = members.map((i) => items[i]!);
    const sources = [...new Set(list.map((it) => it.source))];
    if (sources.length < minSources) continue;
    const counts = new Map<string, { text: string; n: number }>();
    for (const it of list) {
      const key = fold(it.text.trim());
      const entry = counts.get(key) ?? { text: it.text.trim(), n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
    const label = [...counts.values()].sort((a, b) => b.n - a.n || a.text.length - b.text.length)[0]!.text;
    clusters.push({ label, items: list, sources });
  }
  return clusters.sort(
    (a, b) => b.sources.length - a.sources.length || b.items.length - a.items.length || a.label.localeCompare(b.label, 'de'),
  );
}
