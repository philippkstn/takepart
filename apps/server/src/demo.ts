import { parseConfig, SENTENCE_STARTERS, type SlideType } from '@slides/shared';
import { exec, type Conn } from './db.ts';

/**
 * Demo-Inhalte für den ersten Start: fiktive Brandings mit unterschiedlichen
 * Farbschemata und ein Foliensatz, der jede Funktion einmal zeigt.
 *
 * Diagrammfarben mit dem dataviz-Validator geprüft (≥ 3:1 auf hellem und
 * dunklem Hintergrund). Die Namen sind ausgedacht – keine echten Marken.
 */

function initialLogo(letter: string, color: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/>` +
      `<text x="32" y="43" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#ffffff">${letter}</text></svg>`,
  );
}

export const DEMO_BRANDS = [
  { name: 'Demo · Fjord', accent: '#1D5FD1', chart: '#1D5FD1', letter: 'F' },
  { name: 'Demo · Waldhaus', accent: '#1F7A4D', chart: '#2E9160', letter: 'W' },
  { name: 'Demo · Kupferwerk', accent: '#D9631E', chart: '#2F6FB3', letter: 'K' },
  { name: 'Demo · Seehafen', accent: '#0F766E', chart: '#C98500', letter: 'S' },
  { name: 'Demo · Leuchtturm', accent: '#C8102E', chart: '#0E7FB0', letter: 'L' },
];

/** Nur für Migration 003 (damals ohne Konten) – neue Konten bekommen insertDemoBrandsFor. */
export async function insertDemoBrands(conn: Conn) {
  for (const b of DEMO_BRANDS) {
    await exec(
      conn,
      `INSERT INTO brands (name, accent, chart, logo, logo_type)
       SELECT ?, ?, ?, ?, 'image/svg+xml' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM brands WHERE name = ?)`,
      [b.name, b.accent, b.chart, initialLogo(b.letter, b.accent), b.name],
    );
  }
}

/** Demo-Brandings für ein neues Konto */
export async function insertDemoBrandsFor(conn: Conn, userId: number) {
  for (const b of DEMO_BRANDS) {
    await exec(conn, `INSERT INTO brands (user_id, name, accent, chart, logo, logo_type) VALUES (?, ?, ?, ?, ?, 'image/svg+xml')`, [
      userId,
      b.name,
      b.accent,
      b.chart,
      initialLogo(b.letter, b.accent),
    ]);
  }
}

export const DEMO_TITLE = 'TakePart Demo – alle Funktionen';

/** Ein Foliensatz, der jede Aktivität einmal zeigt – in der Reihenfolge eines echten Vortrags. */
export const DEMO_SLIDES: { type: SlideType; config: unknown; notes?: string }[] = [
  {
    type: 'content',
    config: { title: 'Willkommen bei TakePart', body: 'Mach mit – auf dem Handy oder im Browser. Kein Konto nötig.', showJoin: true },
  },
  { type: 'choice', config: { question: 'Wie bist du heute dabei?', options: ['Am Laptop', 'Am Handy', 'Am Tablet', 'Vor Ort im Raum'] } },
  {
    type: 'choice',
    config: {
      question: 'Welche Werkzeuge nutzt ihr im Arbeitsalltag?',
      options: ['Chat', 'Videokonferenz', 'Gemeinsame Dokumente', 'Aufgabenboard', 'E-Mail'],
      multiple: true,
    },
  },
  {
    type: 'scale',
    config: { question: 'Wie vertraut bist du schon mit dem Thema?', max: 5, minLabel: 'ganz neu', maxLabel: 'sehr vertraut' },
  },
  { type: 'wordcloud', config: { question: 'Was macht für dich gute Zusammenarbeit aus?', maxWords: 2 } },
  { type: 'open', config: { question: 'Was möchtest du heute mitnehmen?', maxLength: 280 } },
  {
    type: 'ranking',
    config: {
      question: 'Was ist euch in Meetings am wichtigsten?',
      options: ['Klare Agenda', 'Pünktlich enden', 'Echte Entscheidungen', 'Gute Stimmung'],
    },
  },
  {
    type: 'quiz',
    config: {
      question: 'Wofür steht die Abkürzung „QR“ in QR-Code?',
      options: ['Quick Response', 'Quality Rating', 'Query Result', 'Quick Reader'],
      correct: [0],
      timeLimit: 20,
    },
  },
  {
    type: 'quiz',
    config: { question: 'Wie viele Bits hat ein Byte?', options: ['4', '8', '16', '32'], correct: [1], timeLimit: 15 },
  },
  { type: 'brainstorm', config: { question: 'Wie machen wir Vorträge interaktiver?', allowVotes: true } },
  { type: 'pinboard', config: { title: 'Kurze Retro: Wie lief das letzte Projekt?', columns: ['Lief gut', 'Verbessern', 'Ideen'] } },
  ...SENTENCE_STARTERS.map((start) => ({ type: 'sentence' as const, config: { start } })),
  // Workshop: Kartenwände über mehrere Folien – jede Variante einmal
  {
    type: 'content',
    config: {
      title: 'Workshop: Kartenwand',
      body: 'Karten sammeln, clustern, zuordnen, Punkte kleben, bewerten und die Top 3 festhalten – gemeinsam, live.',
      showJoin: false,
    },
    notes:
      'Folien mit demselben Wand-Namen teilen sich Karten und Gruppen. Für Arbeitsphasen den Timer im Steuerpult starten – er erscheint auf Beamer und Handys.',
  },
  {
    type: 'board',
    config: { board: 'Parkplatz', mode: 'collect', prompt: 'Parkplatz: Lösungsideen für später', maxCards: 10, anytime: true },
    notes: 'Jederzeit offen: Teilnehmende parken Ideen von jeder Folie aus über den Knopf unten auf dem Handy.',
  },
  {
    type: 'board',
    config: {
      board: 'Hindernisse',
      mode: 'collect',
      prompt: 'Was hindert uns heute daran, erfolgreicher zu sein?',
      maxCards: 5,
      tags: ['Vertrieb', 'Marketing', 'Leitung'],
    },
    notes: 'Höchstens 5 Karten pro Person, jede mit Rolle. Ergebnisse verbergen, solange geschrieben wird.',
  },
  {
    type: 'board',
    config: {
      board: 'Hindernisse',
      mode: 'place',
      prompt: 'Wo im Prozess sitzen die Hindernisse?',
      targets: 'cards',
      rights: 'own',
      showUnsorted: true,
      lanes: [
        { title: 'Neukunden', cells: ['Marketing', 'Lead', 'Opportunity', 'Angebot', 'Unterschrift'] },
        { title: 'Bestandskunden', cells: ['Zielkunden', 'Potenzial', 'Ansprache', 'Qualifizieren', 'Übergabe'] },
      ],
    },
    notes: 'Prozess-Board mit zwei Bahnen: Jede Person ordnet ihre eigenen Karten selbst ein.',
  },
  {
    type: 'board',
    config: { board: 'Hindernisse', mode: 'cluster', prompt: 'Ähnliche Hindernisse bündeln', rights: 'host' },
    notes:
      'Reihum vorstellen: Karte im Steuerpult „Groß zeigen“ und in der Vorschau auf eine Gruppe ziehen. Noch nicht eingeordnete Karten sieht nur die Moderation. Rechte bei Bedarf live auf „Alle bearbeiten gemeinsam“ umschalten.',
  },
  {
    type: 'board',
    config: { board: 'Hindernisse', mode: 'dots', prompt: 'Wo wäre der Nutzen am größten, wenn das Hindernis weg wäre?', dots: 3 },
    notes: 'Drei Klebepunkte, auch mehrere auf dieselbe Gruppe. Ergebnisse erst nach dem Abstimmen zeigen.',
  },
  {
    type: 'board',
    config: {
      board: 'Hindernisse',
      mode: 'rate',
      prompt: 'Nutzen und Aufwand der Top 5',
      top: 5,
      scales: [
        { label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'] },
        { label: 'Aufwand', levels: ['S', 'M', 'L', 'XL'] },
      ],
    },
    notes: 'Zwei Kriterien ergeben die Matrix aus den Durchschnitten. Nur die Top 5 nach Punkten.',
  },
  {
    type: 'board',
    config: {
      board: 'Hindernisse',
      mode: 'place',
      prompt: 'Gemeinsam einordnen',
      lanes: [
        { title: 'hoch', cells: ['Quick Wins', 'Strategisch'] },
        { title: 'gering', cells: ['Mitnehmen', 'Zurückstellen'] },
      ],
      xLabel: 'Aufwand: gering → hoch',
      yLabel: 'Nutzen',
    },
    notes: 'Matrix 2×2: Gruppen im Plenum per Drag & Drop einordnen.',
  },
  {
    type: 'board',
    config: { board: 'Hindernisse', mode: 'table', prompt: 'Unsere Top 3' },
    notes: 'Im Steuerpult „Top 3 nach Punkten übernehmen“ und die Felder gemeinsam ausfüllen.',
  },
  {
    type: 'board',
    config: { board: 'Ideen', mode: 'collect', prompt: 'Wie könnten wir unsere Meetings verbessern?', maxCards: 3 },
  },
  {
    type: 'board',
    config: { board: 'Ideen', mode: 'cluster', prompt: 'Bessere Meetings', layout: 'mindmap', rights: 'all', showUnsorted: true },
    notes: 'Mindmap, die alle gemeinsam bearbeiten: Karten verschieben, Gruppen anlegen und umbenennen.',
  },
  {
    type: 'board',
    config: { board: 'Ideen', mode: 'dots', prompt: 'Was probieren wir zuerst aus?', dots: 2, stack: false, targets: 'cards' },
    notes: 'Zwei Punkte, höchstens einer pro Karte.',
  },
  {
    type: 'board',
    config: {
      board: 'Ideen',
      mode: 'rate',
      prompt: 'Wie leicht lässt sich das umsetzen?',
      targets: 'cards',
      top: 3,
      scales: [{ label: 'Umsetzbarkeit', levels: ['schwer', 'mittel', 'leicht'] }],
    },
    notes: 'Ein Kriterium ergibt eine Rangliste.',
  },
  { type: 'qa', config: { title: 'Eure Fragen', moderated: true } },
  { type: 'feedback', config: { question: 'Wie hat dir der Vortrag gefallen?', withComment: true } },
  { type: 'content', config: { title: 'Danke fürs Mitmachen!', body: 'Die Ergebnisse gibt es im Anschluss.', showJoin: false } },
];

/** Hängt den Demo-Foliensatz an eine Präsentation an (ab Position `from`). */
export async function insertDemoSlides(conn: Conn, presentationId: number, from = 0) {
  for (const [i, s] of DEMO_SLIDES.entries()) {
    await exec(conn, 'INSERT INTO slides (presentation_id, position, type, config, notes) VALUES (?, ?, ?, ?, ?)', [
      presentationId,
      from + i,
      s.type,
      JSON.stringify(parseConfig(s.type, s.config)),
      s.notes ?? null,
    ]);
  }
}
