import { z } from 'zod';
import type { ResponsePayloads, ResponseSlideType } from './responses.ts';
import type { SlideConfigs, SlideType } from './slides.ts';

/**
 * Probelauf: simulierte Teilnehmende mit Zufallsantworten, damit Gruppen,
 * Kartenwand, Punkte und Ergebnisse vorher durchgespielt werden können. Die
 * Antworten laufen auf dem Server durch dieselbe Prüfung (`validateResponse`)
 * wie echte.
 */

type Random = () => number;

/** Höchstzahl simulierter Teilnehmender pro Probelauf */
export const MAX_FAKE_PARTICIPANTS = 200;

export const fakeInput = z.object({
  /** Neue Testteilnehmende anlegen (0 = keine) */
  add: z.number().int().min(0).max(50).default(0),
  /** Alle Testteilnehmenden beantworten die aktuelle Folie (wer schon geantwortet hat, nicht noch einmal) */
  answer: z.boolean().default(false),
  /** Simuliertes Publikum an/aus (an: legt bei Bedarf 30–50 Testteilnehmende an) */
  simulate: z.boolean().optional(),
});
export type FakeInput = z.infer<typeof fakeInput>;

const pick = <T>(items: readonly T[], random: Random): T => items[Math.floor(random() * items.length)]!;
const int = (min: number, max: number, random: Random) => min + Math.floor(random() * (max - min + 1));

function shuffled<T>(items: T[], random: Random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Größe des simulierten Publikums beim Start eines Probelaufs */
export const SIM_MIN = 30;
export const SIM_MAX = 50;

/* ---------- Deterministischer Zufall (gleiche Eingabe → gleiches Ergebnis, auch nach einem Neustart) ---------- */

/** 32-Bit-Hash (FNV-1a) über die Teile */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Nachmischen (eine Runde mulberry32), damit benachbarte IDs nicht ähnliche Werte ergeben
  return Math.floor(seededRandom(h)() * 4294967296) >>> 0;
}
const unit = (...parts: (string | number)[]) => hash32(...parts) / 4294967296;

/** Zufallsfolge aus einem Startwert (mulberry32) */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalverteilt (Box-Muller) aus zwei gleichverteilten Werten */
const gauss = (u1: number, u2: number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, u1))) * Math.cos(2 * Math.PI * u2);

export const simAudienceSize = (runId: number) => SIM_MIN + Math.floor(unit('size', runId) * (SIM_MAX - SIM_MIN + 1));

/* ---------- Namen ---------- */

const FIRST_NAMES = [
  'Anna',
  'Jonas',
  'Lea',
  'Lukas',
  'Marie',
  'Felix',
  'Sophie',
  'Paul',
  'Laura',
  'Tim',
  'Julia',
  'Max',
  'Sarah',
  'Niklas',
  'Lena',
  'David',
  'Hannah',
  'Jan',
  'Katharina',
  'Simon',
  'Lisa',
  'Tobias',
  'Johanna',
  'Moritz',
  'Clara',
  'Philipp',
  'Mia',
  'Florian',
  'Emma',
  'Sebastian',
  'Nina',
  'Daniel',
  'Carla',
  'Ben',
  'Franziska',
  'Elias',
  'Miriam',
  'Stefan',
  'Ayşe',
  'Mehmet',
  'Leonie',
  'Matthias',
  'Charlotte',
  'Thomas',
  'Selin',
  'Christian',
  'Paula',
  'Markus',
  'Svenja',
  'Kai',
  'Vanessa',
  'Ole',
  'Theresa',
  'Benedikt',
  'Ronja',
  'Andreas',
  'Yusuf',
  'Ida',
  'Fabian',
  'Merle',
];
const INITIALS = 'ABCDEFGHKLMNPRSTWZ';

/** Name der n-ten Testperson (ab 0): erst Vornamen, danach mit Initiale – nie doppelt */
export function fakeName(n: number): string {
  const first = FIRST_NAMES[n % FIRST_NAMES.length]!;
  const lap = Math.floor(n / FIRST_NAMES.length);
  if (lap === 0) return first;
  const initial = INITIALS[(lap - 1) % INITIALS.length]!;
  const extra = Math.floor((lap - 1) / INITIALS.length);
  return `${first} ${initial}.${extra > 0 ? ` ${extra + 1}` : ''}`;
}

/* ---------- Zeitplan: wann wer antwortet ---------- */

/**
 * Art der Beteiligung: Abstimmung (alles mit einer Antwort), Quiz (innerhalb der Zeit),
 * Freitext/Karten, Fragen (Q&A, nur wenige) und Parkplatz (selten, über lange Zeit).
 */
export type SimKind = 'vote' | 'quiz' | 'text' | 'question' | 'parking';

export interface SimKey {
  run: number;
  slide: number;
  round: number;
  participant: number;
}

const SIM_SHAPE: Record<SimKind, { share: number; median: number; spread: number; max: number }> = {
  vote: { share: 0.97, median: 11_000, spread: 0.55, max: 80_000 },
  quiz: { share: 0.98, median: 6_000, spread: 0.5, max: 0 },
  text: { share: 0.9, median: 26_000, spread: 0.5, max: 150_000 },
  question: { share: 0.2, median: 70_000, spread: 0.8, max: 360_000 },
  parking: { share: 0.12, median: 90_000, spread: 0.8, max: 600_000 },
};

/** Persönliches Tempo einer Testperson (gleich über alle Folien): 0,6 = flink … 1,6 = gemächlich */
const pace = (k: SimKey) => 0.6 + unit('pace', k.run, k.participant);
/** Manche machen seltener mit – gleich über alle Folien: 0,85 … 1 */
const keen = (k: SimKey) => 0.85 + 0.15 * unit('keen', k.run, k.participant);

/**
 * Nach wie vielen ms (ab Folienstart bzw. Quizstart) die Person antwortet,
 * oder null, wenn sie auf dieser Folie nicht antwortet. Rein aus den Kennungen
 * berechnet – nichts wird gespeichert, ein Neustart ändert nichts.
 */
export function simDelay(kind: SimKind, k: SimKey, quizSeconds = 30, card = 0): number | null {
  const shape = SIM_SHAPE[kind];
  const share = card === 0 ? shape.share * keen(k) : 1;
  if (unit('join', k.run, k.slide, k.round, k.participant, card) >= share) return null;
  const g = gauss(unit('t1', k.run, k.slide, k.round, k.participant, card), unit('t2', k.run, k.slide, k.round, k.participant, card));
  if (kind === 'quiz') {
    // Innerhalb der Zeit: die meisten in der ersten Hälfte, ein paar knapp vor Schluss
    const limit = quizSeconds * 1000;
    const median = Math.min(shape.median, limit * 0.35) * pace(k);
    return Math.max(1200, Math.min(limit * 0.92, median * Math.exp(shape.spread * g)));
  }
  return Math.max(1500, Math.min(shape.max, shape.median * pace(k) * Math.exp(shape.spread * g)));
}

/**
 * Wie viele Karten bzw. Beiträge die Person nach `elapsed` ms geschrieben hat (höchstens `max`).
 * Die erste nach `simDelay`, weitere jeweils 10–40 s später; die Zahl wächst nur.
 */
export function simCardsDue(kind: SimKind, k: SimKey, elapsed: number, max: number): number {
  const first = simDelay(kind, k);
  if (first === null || elapsed < first) return 0;
  // Wie viele die Person insgesamt schreibt: meist eine oder zwei, manche mehr
  const wanted = Math.max(1, Math.min(max, 1 + Math.floor(unit('many', k.run, k.slide, k.participant) ** 1.6 * Math.min(max, 4))));
  let at = first;
  let n = 1;
  while (n < wanted) {
    at += (10_000 + 30_000 * unit('next', k.run, k.slide, k.participant, n)) * pace(k);
    if (elapsed < at) break;
    n++;
  }
  return n;
}

/* ---------- Inhalte ---------- */

/** Vorlieben einer Folie: Gewichte je Option, gleich für alle Testpersonen (sonst gäbe es keinen Favoriten) */
function preferences(n: number, seed: number): number[] {
  const r = seededRandom(seed);
  // Ein klarer Favorit, ein, zwei Verfolger, der Rest selten
  return Array.from({ length: n }, () => 0.06 + r() ** 2.4);
}

function weightedPick(weights: number[], random: Random): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = random() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i]!;
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** Mehrere verschiedene, gewichtet gezogen */
function weightedSample(weights: number[], count: number, random: Random): number[] {
  const w = [...weights];
  const out: number[] = [];
  while (out.length < Math.min(count, w.length)) {
    const i = weightedPick(w, random);
    out.push(i);
    w[i] = 0;
    if (w.every((x) => x === 0)) break;
  }
  return out;
}

/** Kontext einer Folie für passende Antworten */
export interface FakeContext {
  /** Gleich für alle Antworten auf dieser Folie (Vorlieben) */
  seed: number;
  /** Frage bzw. Überschrift der Folie */
  prompt: string;
}

type Topic = 'mood' | 'origin' | 'expect' | 'obstacle' | 'idea' | 'takeaway' | 'parking' | 'feedback' | 'reflect' | 'generic';

/** Grobe Einordnung der Frage über Schlüsselwörter */
export function topicOf(prompt: string): Topic {
  const t = prompt.toLowerCase();
  if (/parkplatz|später|offen geblieben/.test(t)) return 'parking';
  if (/bereich|abteilung|woher|\brolle\b|aus welchem/.test(t) && !/\bwort\b/.test(t)) return 'origin';
  if (/stimmung|fühlst|geht es dir|energie|ankommen|kommst du heute an|\bwort\b|\bwörter/.test(t)) return 'mood';
  if (/erhoff|erwart|gelohnt|ziel|wünsch|mitnehmen möchtest/.test(t)) return 'expect';
  if (/hinder|problem|herausforder|schwierig|stört|bremst|nervt|hürde/.test(t)) return 'obstacle';
  if (/als erstes|probierst|vorsatz|nimmst du mit|umsetzen|gelernt|als nächstes/.test(t)) return 'takeaway';
  if (/anders machen|lief es|besser machen|rückblick|was lief/.test(t)) return 'reflect';
  if (/gefallen|feedback|bewert/.test(t)) return 'feedback';
  if (/idee|vorschlag|verbesser|lösung|nutzen|angehen|wie könnten|was wäre/.test(t)) return 'idea';
  return 'generic';
}

const CLOUD_WORDS: Record<Topic, string[]> = {
  mood: [
    'neugierig',
    'gespannt',
    'motiviert',
    'müde',
    'entspannt',
    'wach',
    'offen',
    'gestresst',
    'zuversichtlich',
    'neugierig',
    'voller Fragen',
    'hungrig',
    'gut gelaunt',
    'abgelenkt',
    'konzentriert',
    'Kaffee',
  ],
  origin: [
    'Vertrieb',
    'IT',
    'Marketing',
    'Personal',
    'Entwicklung',
    'Einkauf',
    'Controlling',
    'Kundenservice',
    'Produktion',
    'Projektmanagement',
    'Geschäftsführung',
    'Logistik',
    'Forschung',
    'Recht',
  ],
  expect: [
    'Austausch',
    'Klarheit',
    'Ideen',
    'Praxisbeispiele',
    'Werkzeuge',
    'Inspiration',
    'Struktur',
    'Vernetzung',
    'Lösungen',
    'Überblick',
    'Mut',
    'Antworten',
  ],
  obstacle: [
    'Zeit',
    'Meetings',
    'Abstimmung',
    'Prioritäten',
    'E-Mails',
    'Bürokratie',
    'Kommunikation',
    'Tools',
    'Silos',
    'Ressourcen',
    'Unklarheit',
    'Schnittstellen',
  ],
  idea: [
    'Fokus',
    'Transparenz',
    'Automatisierung',
    'Feedback',
    'Dokumentation',
    'Weniger Meetings',
    'Klare Rollen',
    'Pilotprojekt',
    'Austausch',
    'Vertrauen',
  ],
  takeaway: [
    'ausprobieren',
    'Fokuszeit',
    'nachfragen',
    'Feedback',
    'Retro',
    'Checkliste',
    'priorisieren',
    'delegieren',
    'teilen',
    'dranbleiben',
  ],
  parking: ['Budget', 'Tools', 'Datenschutz', 'Zuständigkeiten', 'Schulung', 'Zeitplan'],
  feedback: ['hilfreich', 'kurzweilig', 'praxisnah', 'interaktiv', 'zu kurz', 'inspirierend', 'klar', 'lebendig'],
  reflect: ['mehr Zeit', 'früher anfangen', 'mehr Pausen', 'kleinere Gruppen', 'Beispiele', 'Vorbereitung'],
  generic: [
    'Zusammenarbeit',
    'Zeit',
    'Kommunikation',
    'Klarheit',
    'Vertrauen',
    'Fokus',
    'Qualität',
    'Struktur',
    'Teamgeist',
    'Neugier',
    'Veränderung',
    'Lernen',
  ],
};

const CARD_TEXTS: Record<Topic, string[]> = {
  mood: [
    'Bin gespannt, was heute kommt',
    'Noch etwas müde, aber neugierig',
    'Gut gelaunt und motiviert',
    'Viel um die Ohren, freue mich auf den Austausch',
    'Offen für Neues',
  ],
  origin: [
    'Vertrieb Nord',
    'IT-Infrastruktur',
    'Personalentwicklung',
    'Produktmanagement',
    'Kundenservice',
    'Controlling',
    'Marketing & Kommunikation',
    'Einkauf',
  ],
  expect: [
    'Konkrete Methoden, die ich morgen anwenden kann',
    'Austausch mit anderen Teams',
    'Ein klares Bild, wie es weitergeht',
    'Praxisbeispiele statt Theorie',
    'Antworten auf meine offenen Fragen',
    'Neue Impulse für mein Team',
    'Dass wir heute etwas entscheiden',
    'Verstehen, wo die anderen stehen',
    'Ein paar gute Werkzeuge für den Alltag',
    'Mehr Klarheit über Zuständigkeiten',
    'Dass wir ehrlich über Probleme reden',
    'Gemeinsame Prioritäten finden',
  ],
  obstacle: [
    'Zu viele Abstimmungsrunden',
    'Unklare Zuständigkeiten',
    'Informationen kommen zu spät an',
    'Tools passen nicht zusammen',
    'Zu wenig Zeit für Wichtiges',
    'Ziele ändern sich ständig',
    'Meetings ohne Ergebnis',
    'Wissen steckt in einzelnen Köpfen',
    'Fehlendes Feedback',
    'Prozesse sind nicht dokumentiert',
    'Entscheidungen dauern zu lange',
    'Zu viele E-Mails',
    'Jeder arbeitet in seinem Silo',
    'Freigaben brauchen ewig',
    'Wir löschen nur Brände',
    'Zu viele Projekte gleichzeitig',
    'Keine klaren Prioritäten von oben',
    'Doppelte Arbeit zwischen Teams',
  ],
  idea: [
    'Feste Fokuszeiten ohne Meetings',
    'Ein gemeinsames Board für alle Projekte',
    'Entscheidungen schriftlich festhalten',
    'Kurze Weekly statt langer Jour fixe',
    'Ansprechpersonen je Thema benennen',
    'Wissen im Wiki sammeln',
    'Pilotprojekt mit einem Team starten',
    'Regelmäßige Retros einführen',
    'Freigabeprozess vereinfachen',
    'Weniger Tools, dafür richtig',
    'Quartalsziele gemeinsam festlegen',
    'Onboarding-Checkliste erstellen',
  ],
  takeaway: [
    'Meine Meetings auf 25 Minuten kürzen',
    'Einmal pro Woche Fokuszeit blocken',
    'Im Team nach Feedback fragen',
    'Die Methode in meinem nächsten Workshop testen',
    'Prioritäten mit meiner Führungskraft klären',
    'Eine Retro mit meinem Team machen',
    'Meine To-do-Liste radikal kürzen',
    'Häufiger nachfragen statt annehmen',
    'Dokumentation für mein Projekt anlegen',
    'Mit dem anderen Team einen Kaffee trinken',
  ],
  parking: [
    'Wie geht es mit dem Budget weiter?',
    'Thema Datenschutz klären',
    'Welche Tools sind freigegeben?',
    'Schulungsbedarf im Team',
    'Wer entscheidet über die Priorisierung?',
    'Zeitplan für die Umsetzung',
  ],
  feedback: [
    'Sehr hilfreich, danke!',
    'Gern wieder',
    'Etwas zu lang',
    'Mehr Beispiele wären gut',
    'Super Mischung aus Input und Austausch',
    'Die Gruppenarbeit war das Beste',
    'Etwas mehr Pausen bitte',
    'Klar strukturiert',
  ],
  reflect: [
    'Mehr Zeit für die Gruppenarbeit',
    'Früher mit der Planung anfangen',
    'Ergebnisse direkt festhalten',
    'Kleinere Gruppen',
    'Mehr Pausen einplanen',
    'Vorher die Erwartungen klären',
  ],
  generic: [
    'Bessere Zusammenarbeit zwischen Teams',
    'Mehr Zeit für das Wesentliche',
    'Klarere Kommunikation',
    'Mehr Vertrauen und weniger Kontrolle',
    'Schnellere Entscheidungen',
    'Regelmäßiger Austausch',
    'Mehr Raum für Ideen',
    'Gemeinsame Ziele',
    'Weniger Bürokratie',
    'Offene Fehlerkultur',
  ],
};

const QUESTIONS = [
  'Wie geht es danach weiter?',
  'Gibt es die Folien hinterher?',
  'Welches Beispiel war das genau?',
  'Wie messen wir den Erfolg?',
  'Wer ist Ansprechperson?',
  'Wie lässt sich das in kleinen Teams umsetzen?',
  'Was kostet das ungefähr?',
  'Gibt es dazu eine Checkliste?',
  'Wie habt ihr die Führungskräfte überzeugt?',
  'Was machen wir, wenn das Team nicht mitzieht?',
  'Wie viel Zeit sollte man dafür einplanen?',
  'Funktioniert das auch remote?',
  'Gibt es Erfahrungen aus anderen Abteilungen?',
  'Wo finde ich weiterführende Literatur?',
  'Wann gibt es das nächste Treffen?',
  'Wie gehen wir mit Widerständen um?',
];

const SENTENCE_WORDS = [
  'plötzlich',
  'alles',
  'brennt',
  'Kaffee',
  'fehlt',
  'heute',
  'niemand',
  'lacht',
  'wieder',
  'Montag',
  'der',
  'Chef',
  'tanzt',
  'leise',
  'im',
  'Meeting',
  'und',
  'dann',
  'Pizza',
  'schon',
  'fertig',
  'Drucker',
  'singt',
  'endlich',
  'Freitag',
];
const COMMENTS = [
  '',
  '',
  '',
  'Gern wieder',
  'Etwas zu lang',
  'Sehr hilfreich',
  'Mehr Beispiele wären gut',
  'Danke, hat Spaß gemacht',
  'Gute Mischung',
];

/**
 * Antwort einer Testperson auf eine Folie, auf die mit einer Antwort (nicht mit Karten)
 * reagiert wird. `targets` sind bei der Kartenwand die Einträge der Folie. Mit `context`
 * haben alle Antworten einer Folie dieselben Vorlieben (Favorit, Tendenz) und Wörter passen
 * zur Frage – sonst gleichverteilt. Gibt null zurück, wenn es hier nichts zu antworten gibt.
 */
export function fakeResponse<T extends ResponseSlideType>(
  type: T,
  config: SlideConfigs[T],
  random: Random = Math.random,
  targets: string[] = [],
  context?: FakeContext,
): ResponsePayloads[T] | null {
  const out = (v: unknown) => v as ResponsePayloads[T];
  const seed = context?.seed ?? Math.floor(random() * 4294967296);
  const prefs = (n: number, salt = 0) => preferences(n, hash32(seed, salt));
  switch (type) {
    case 'choice': {
      const c = config as SlideConfigs['choice'];
      const w = prefs(c.options.length);
      if (!c.multiple) return out({ choices: [weightedPick(w, random)] });
      // Meist zwei, drei Kreuze – selten alle
      const n = Math.max(1, Math.min(c.options.length, Math.round(1 + random() * random() * c.options.length)));
      return out({ choices: weightedSample(w, n, random).sort((a, b) => a - b) });
    }
    case 'scale': {
      // Je Folie eine Tendenz (eher Mitte bis oben), Streuung um sie herum
      const c = config as SlideConfigs['scale'];
      const r = seededRandom(hash32(seed, 'scale'));
      const mean = 1 + (c.max - 1) * (0.35 + 0.5 * r());
      const v = Math.round(mean + gauss(random(), random()) * Math.max(0.6, (c.max - 1) * 0.2));
      return out({ value: Math.min(c.max, Math.max(1, v)) });
    }
    case 'wordcloud': {
      const c = config as SlideConfigs['wordcloud'];
      const pool = [...new Set(CLOUD_WORDS[topicOf(context?.prompt ?? '')])];
      // Zipf: wenige Wörter oft, viele selten
      const order = shuffled(pool, seededRandom(hash32(seed, 'cloud')));
      const w = order.map((_, i) => 1 / (i + 1) ** 1.1);
      const n = int(1, Math.min(c.maxWords, random() < 0.6 ? 1 : c.maxWords), random);
      return out({ words: weightedSample(w, n, random).map((i) => order[i]!) });
    }
    case 'ranking': {
      // Gemeinsame Grundordnung plus persönliches Rauschen
      const c = config as SlideConfigs['ranking'];
      const w = prefs(c.options.length);
      const keyed = c.options.map((_, i) => [i, Math.log(w[i]!) + gauss(random(), random()) * 0.9] as const);
      return out({ order: keyed.sort((a, b) => b[1] - a[1]).map(([i]) => i) });
    }
    case 'quiz': {
      const c = config as SlideConfigs['quiz'];
      // Schwierigkeit je Frage: 35–85 % richtig; falsche Antworten meist auf einer naheliegenden Option
      const share = 0.35 + 0.5 * seededRandom(hash32(seed, 'quiz'))();
      if (random() < share) return out({ choice: pick(c.correct, random) });
      const wrong = c.options.map((_, i) => i).filter((i) => !c.correct.includes(i));
      if (wrong.length === 0) return out({ choice: pick(c.correct, random) });
      const w = prefs(wrong.length, 1);
      return out({ choice: wrong[weightedPick(w, random)]! });
    }
    case 'feedback': {
      const rating = weightedPick([0.02, 0.05, 0.18, 0.42, 0.33], random) + 1;
      return out({ rating, comment: pick(rating <= 3 ? [...COMMENTS, 'Etwas zu lang', 'Mehr Beispiele wären gut'] : COMMENTS, random) });
    }
    case 'sentence':
      return out({ word: pick(SENTENCE_WORDS, random) });
    case 'teams': {
      const c = config as SlideConfigs['teams'];
      return out({
        tag:
          c.tags.length > 0
            ? weightedPick(
                prefs(c.tags.length).map((x) => x + 0.3),
                random,
              )
            : null,
      });
    }
    case 'board': {
      const c = config as SlideConfigs['board'];
      if (targets.length === 0) return null;
      // Beliebtheit je Eintrag: gleich für alle, damit sich Favoriten bilden
      const pop = targets.map((t) => 0.08 + seededRandom(hash32(seed, t))() ** 2);
      if (c.mode === 'dots') {
        const dots: Record<string, number> = {};
        if (c.stack) {
          for (let i = 0; i < c.dots; i++) {
            const key = targets[weightedPick(pop, random)]!;
            dots[key] = (dots[key] ?? 0) + 1;
          }
        } else for (const i of weightedSample(pop, c.dots, random)) dots[targets[i]!] = 1;
        return out({ dots });
      }
      if (c.mode === 'rate') {
        const ratings: Record<string, (number | null)[]> = {};
        // Nur Kriterien, die alle schätzen; ohne solche nimmt die Folie keine Antworten an
        if (!c.scales.some((s) => s.source === 'votes')) return null;
        for (const key of targets)
          ratings[key] = c.scales.map((s, si) => {
            if (s.source !== 'votes') return null;
            const top = s.levels.length - 1;
            const mean = seededRandom(hash32(seed, key, si))() * top;
            return Math.min(top, Math.max(0, Math.round(mean + gauss(random(), random()) * 0.7)));
          });
        return out({ ratings });
      }
      if (c.mode === 'choose') {
        // Je Eintrag eine naheliegende Kategorie, ein paar weichen ab
        const picks: Record<string, number[]> = {};
        for (const key of targets) {
          const w = preferences(c.choices.length, hash32(seed, key));
          const first = weightedPick(w, random);
          const second = weightedPick(w, random);
          picks[key] = c.multi && random() < 0.3 && second !== first ? [first, second] : [first];
        }
        return out({ picks });
      }
      return null;
    }
  }
  return null;
}

/**
 * Bausteine für weitere Formulierungen je Thema: Kern × Satzrahmen. So wiederholen sich
 * bei 30–50 Personen mit mehreren Karten nicht ständig dieselben Sätze.
 */
const CARD_PARTS: Partial<Record<Topic, { cores: string[]; frames: string[] }>> = {
  expect: {
    cores: [
      'Praxisbeispiele',
      'Austausch mit anderen Teams',
      'klare nächste Schritte',
      'neue Methoden',
      'Antworten auf offene Fragen',
      'gemeinsame Prioritäten',
      'Klarheit über Zuständigkeiten',
      'Impulse für mein Team',
      'Werkzeuge für den Alltag',
      'eine ehrliche Diskussion',
      'ein gemeinsames Zielbild',
      'Zeit zum Ausprobieren',
    ],
    frames: ['{}', 'Vor allem: {}', 'Ich wünsche mir {}', 'Wichtig für mich: {}', 'Mein Wunsch: {}'],
  },
  obstacle: {
    cores: [
      'zu viele Meetings',
      'unklare Prioritäten',
      'fehlende Absprachen',
      'zu viele Tools',
      'lange Freigaben',
      'wenig Zeit für Konzeptarbeit',
      'ständige Unterbrechungen',
      'Informationen in E-Mails versteckt',
      'fehlende Ansprechpersonen',
      'zu viele Projekte parallel',
      'keine gemeinsame Planung',
      'Wissen nicht dokumentiert',
    ],
    frames: ['{}', 'Bei uns: {}', 'Immer wieder: {}', 'Ehrlich gesagt: {}', 'Größtes Problem: {}'],
  },
  idea: {
    cores: [
      'Fokuszeiten',
      'ein gemeinsames Board',
      'kürzere Meetings',
      'feste Ansprechpersonen',
      'ein Team-Wiki',
      'regelmäßige Retros',
      'klare Entscheidungswege',
      'weniger Tools',
      'Quartalsziele',
      'ein Pilotprojekt',
      'offene Sprechstunden',
      'Vorlagen für Übergaben',
    ],
    frames: ['{}', '{} einführen', '{} ausprobieren', 'Vorschlag: {}', '{} für alle Teams'],
  },
  takeaway: {
    cores: [
      'Fokuszeit blocken',
      'Meetings kürzen',
      'nach Feedback fragen',
      'die Methode testen',
      'Prioritäten klären',
      'eine Retro machen',
      'Aufgaben abgeben',
      'Wissen aufschreiben',
      'öfter nachfragen',
      'mit dem Nachbarteam sprechen',
    ],
    frames: ['{}', 'Nächste Woche: {}', 'Gleich morgen: {}', 'Mein Vorsatz: {}', 'Im Team: {}'],
  },
  generic: {
    cores: [
      'Zusammenarbeit',
      'Kommunikation',
      'Transparenz',
      'Vertrauen',
      'Fokus',
      'Austausch',
      'Klarheit',
      'Struktur',
      'Entscheidungen',
      'Feedback',
    ],
    frames: ['{}', 'Mehr {}', '{} zwischen den Teams', '{} im Alltag', 'Mehr Zeit für {}'],
  },
};

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Text einer Karte bzw. eines Beitrags passend zur Frage (offene Antworten, Brainstorming, Pinnwand, Q&A, Kartenwand). */
export function fakePostText(type: SlideType, random: Random = Math.random, prompt = ''): string {
  if (type === 'qa') return pick(QUESTIONS, random);
  const topic = topicOf(prompt);
  const parts = CARD_PARTS[topic];
  // Gut die Hälfte ganze Sätze, sonst eine Formulierung aus den Bausteinen
  if (!parts || random() < 0.5) return pick(CARD_TEXTS[topic], random);
  return capitalize(pick(parts.frames, random).replace('{}', pick(parts.cores, random)));
}
