import { batchSlides, EXPECTATIONS_BOARD, PARKING_BOARD, STARTER_SLIDES, type BatchSlide, type BlockSlide } from './blocks.ts';
import { slidePlannedMinutes } from './schedule.ts';

/**
 * Vorlagen für eine neue Präsentation (Galerie beim Anlegen). Reine Daten wie die
 * Bausteine: Folien mit Sprechernotizen und Ablaufplan je Folie. Der Server legt
 * sie bei `POST /api/presentations` mit `templateId` an; Wände hängen über ihren
 * Namen (`config.board`) zusammen. Neue Vorlagen müssen den Test in
 * `prep.test.ts` bestehen.
 */
export interface PresentationTemplate {
  id: string;
  name: string;
  /** Ein Satz für die Galerie */
  description: string;
  /** Für wen / wofür */
  audience: string;
  slides: BlockSlide[];
}

/** „Leer beginnen“ – keine Folien */
export const BLANK_TEMPLATE_ID = 'leer';
/** Vorlage für `template: true` (früher „Mit Startfolien“) */
export const DEFAULT_TEMPLATE_ID = 'workshop';

const join: BlockSlide = {
  type: 'content',
  config: { title: 'Gleich geht’s los.', body: 'Mach schon mal mit: Link öffnen oder QR-Code scannen.', showJoin: true },
  notes: 'Läuft, während alle ankommen. Wer schon beigetreten ist, ist bei den ersten Fragen gleich dabei.',
  schedule: { plannedMinutes: 5 },
};

const thanks = (body = 'Schön, dass du dabei warst.'): BlockSlide => ({
  type: 'content',
  config: { title: 'Danke!', body },
  notes: 'Kurz sagen, wie es weitergeht – Fotoprotokoll, nächster Termin, Ansprechperson.',
  schedule: { plannedMinutes: 1 },
});

const parking = (minutes = 2): BlockSlide => ({
  type: 'board',
  config: {
    board: PARKING_BOARD,
    mode: 'collect',
    prompt: 'Parkplatz: Fragen und Themen für später',
    task: 'Was dir zwischendurch einfällt, kannst du jederzeit vom Handy aus hier ablegen – auf jeder Folie.',
    maxCards: 10,
    anytime: true,
  },
  notes: 'Kurz zeigen, dass der Parkplatz den ganzen Termin über offen ist. Am Ende schauen wir gemeinsam darauf.',
  schedule: { plannedMinutes: minutes },
});

const parkingReview = (minutes = 10): BlockSlide => ({
  type: 'board',
  config: { board: PARKING_BOARD, mode: 'collect', prompt: 'Parkplatz: Was ist offen geblieben?', maxCards: 10 },
  notes: 'Alle Karten vom Parkplatz durchgehen: gleich beantworten, mit Verantwortlichen mitnehmen oder bewusst streichen.',
  schedule: { plannedMinutes: minutes },
});

const pause = (minutes: number): BlockSlide => ({
  type: 'pause',
  config: { title: 'Pause', minutes, question: true },
  notes: 'Die Pause startet beim Erreichen der Folie. Vor dem Weitermachen kurz auf die Energie-Rückmeldungen schauen.',
  schedule: { plannedMinutes: minutes },
});

const RETRO_BOARD = 'Retro';
const IDEAS_BOARD = 'Ideen';
const PROJECTS_BOARD = 'Vorhaben';
const RISKS_BOARD = 'Risiken';

export const TEMPLATES: PresentationTemplate[] = [
  {
    id: DEFAULT_TEMPLATE_ID,
    name: 'Workshop-Gerüst',
    description:
      'Ankommen, Parkplatz, Erwartungen und am Ende Vorsatz, Vorher-Nachher, Fragen und Feedback – dein Inhalt kommt dazwischen.',
    audience: 'Workshops und Seminare jeder Art',
    slides: STARTER_SLIDES,
  },
  {
    id: 'retro',
    name: 'Team-Retrospektive',
    description: 'Rückblick auf den letzten Abschnitt: sammeln, Themen bilden, punkten und Maßnahmen mit Verantwortlichen festhalten.',
    audience: 'Teams nach einem Sprint, Projektabschnitt oder Quartal',
    slides: [
      {
        type: 'content',
        config: {
          title: 'Retrospektive',
          body: 'Wir gehen davon aus, dass alle nach bestem Wissen und mit den Möglichkeiten gearbeitet haben, die sie hatten.\n\nMach mit: Link öffnen oder QR-Code scannen.',
          showJoin: true,
        },
        notes:
          'Grundhaltung der Retro vorlesen: Es geht um das Wie, nicht um Schuld. Zeitraum klar benennen, auf den wir zurückblicken. Ergebnisse der letzten Retro kurz zeigen, falls vorhanden.',
        schedule: { plannedMinutes: 3 },
      },
      {
        type: 'wordcloud',
        config: { question: 'Der letzte Abschnitt in einem Wort?', maxWords: 1 },
        notes: 'Stimmungsbild zum Einstieg. Auffällige Begriffe kurz aufgreifen, noch nicht diskutieren.',
        schedule: { plannedMinutes: 3 },
      },
      {
        type: 'scale',
        config: { question: 'Wie zufrieden bist du mit dem letzten Abschnitt?', max: 5, minLabel: 'gar nicht', maxLabel: 'sehr' },
        notes: 'Die Verteilung ist wichtiger als der Durchschnitt – Ausreißer später behutsam ansprechen.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'board',
        config: {
          board: RETRO_BOARD,
          mode: 'collect',
          prompt: 'Was lief gut, was lief schlecht, was wünschst du dir?',
          task: 'Ein Gedanke pro Karte. Wähle für jede Karte, ob sie gut lief, schlecht lief oder ein Wunsch ist.',
          maxCards: 6,
          tags: ['Lief gut', 'Lief schlecht', 'Wunsch'],
          startHidden: true,
        },
        notes:
          'Erst still schreiben, die Karten bleiben auf dem Beamer verborgen. Danach aufdecken und reihum vorlesen lassen – nur Verständnisfragen, noch keine Lösungen.',
        schedule: {
          phases: [
            { label: 'Still schreiben', minutes: 7 },
            { label: 'Vorlesen', minutes: 8 },
          ],
          autoCountdown: true,
        },
      },
      {
        type: 'board',
        config: { board: RETRO_BOARD, mode: 'cluster', prompt: 'Ähnliche Karten zu Themen bündeln', rights: 'own', showUnsorted: true },
        notes: 'Alle ordnen ihre eigenen Karten zu. Die Moderation benennt die Themen gemeinsam mit dem Team.',
        schedule: { plannedMinutes: 10 },
      },
      {
        type: 'board',
        config: { board: RETRO_BOARD, mode: 'dots', prompt: 'Welches Thema wollen wir als Erstes angehen?', dots: 3 },
        notes: 'Drei Punkte pro Person, auch mehrere auf dasselbe Thema. Die zwei bis drei Themen mit den meisten Punkten besprechen wir.',
        schedule: { plannedMinutes: 4 },
      },
      {
        type: 'board',
        config: {
          board: RETRO_BOARD,
          mode: 'table',
          prompt: 'Unsere Maßnahmen',
          columns: ['Maßnahme', 'Verantwortlich', 'Bis'],
        },
        notes:
          'Im Steuerpult „Top 3 nach Punkten übernehmen“. Je Thema eine kleine, überprüfbare Maßnahme mit genau einer verantwortlichen Person. Lieber zwei erledigte als fünf offene.',
        schedule: { plannedMinutes: 20 },
      },
      {
        type: 'feedback',
        config: {
          question: 'Wie wertvoll war diese Retro für dich?',
          withComment: true,
          commentLabel: 'Was sollten wir beim nächsten Mal anders machen?',
        },
        notes: 'Kurze Rückmeldung zur Retro selbst. Kommentare fließen in die Vorbereitung der nächsten ein.',
        schedule: { plannedMinutes: 3 },
      },
      thanks('Die Maßnahmen stehen im Fotoprotokoll. Bis zur nächsten Retro!'),
    ],
  },
  {
    id: 'kickoff',
    name: 'Projekt-Kick-off',
    description: 'Ziele klären, Hoffnungen und Bedenken sammeln, Risiken einschätzen und erste Schritte vereinbaren.',
    audience: 'Projektteams und Beteiligte zum Start eines Vorhabens',
    slides: [
      join,
      parking(),
      {
        type: 'wordcloud',
        config: { question: 'Was verbindest du mit dem Projekt?', maxWords: 2 },
        notes: 'Zeigt die Bilder im Kopf, bevor das Ziel vorgestellt wird. Am Ende lässt sich darauf zurückkommen.',
        schedule: { plannedMinutes: 3 },
      },
      {
        type: 'content',
        config: {
          title: 'Worum es geht',
          body: 'Ziel des Projekts\nWas dazugehört – und was nicht\nZeitrahmen und wichtige Termine\nWer beteiligt ist',
        },
        notes: 'Hier das Projekt vorstellen – Folien gern per PDF-Import ergänzen. Ziel in einem Satz, Abgrenzung klar benennen.',
        schedule: { plannedMinutes: 15 },
      },
      {
        type: 'board',
        config: {
          board: EXPECTATIONS_BOARD,
          mode: 'collect',
          prompt: 'Was erhoffst du dir von dem Projekt – und was bereitet dir Sorgen?',
          maxCards: 4,
          tags: ['Hoffnung', 'Bedenken'],
          askName: true,
        },
        notes:
          'Jede Karte als Hoffnung oder Bedenken kennzeichnen. Reihum vorstellen lassen. Bedenken ernst nehmen – sie sind oft die ersten Risiken.',
        schedule: {
          phases: [
            { label: 'Schreiben', minutes: 5 },
            { label: 'Reihum vorstellen', minutes: 10 },
          ],
          autoCountdown: true,
        },
      },
      {
        type: 'board',
        config: { board: EXPECTATIONS_BOARD, mode: 'cluster', prompt: 'Hoffnungen und Bedenken zu Themen bündeln', rights: 'host' },
        notes: 'Die Moderation bündelt, die Gruppe korrigiert. Die Themen tauchen bei Risiken und Rollen wieder auf.',
        schedule: { plannedMinutes: 10 },
      },
      pause(10),
      {
        type: 'board',
        config: {
          board: RISKS_BOARD,
          mode: 'collect',
          prompt: 'Was könnte das Projekt gefährden?',
          task: 'Ein Risiko pro Karte – möglichst konkret: Was passiert, und was wäre die Folge?',
          maxCards: 3,
          startHidden: true,
        },
        notes: 'Bedenken von vorhin dürfen hier als Risiko wieder auftauchen. Karten erst aufdecken, wenn alle fertig sind.',
        schedule: { plannedMinutes: 8 },
      },
      {
        type: 'board',
        config: { board: RISKS_BOARD, mode: 'dots', prompt: 'Welche Risiken sollten wir genauer anschauen?', dots: 3, targets: 'cards' },
        notes: 'Drei Punkte pro Person. Nur die Risiken mit den meisten Punkten werden gleich eingeschätzt.',
        schedule: { plannedMinutes: 4 },
      },
      {
        type: 'board',
        config: {
          board: RISKS_BOARD,
          mode: 'rate',
          prompt: 'Wie schwer wiegen die Risiken?',
          top: 6,
          targets: 'cards',
          scales: [
            { label: 'Auswirkung', levels: ['gering', 'mittel', 'hoch'] },
            { label: 'Wahrscheinlichkeit', levels: ['gering', 'mittel', 'hoch'] },
          ],
          quadrants: ['Beobachten', 'Sofort angehen', 'Hinnehmen', 'Vorsorge treffen'],
        },
        notes:
          'Alle schätzen die sechs Risiken mit den meisten Punkten nach Auswirkung und Wahrscheinlichkeit ein. Oben rechts liegt, was wir sofort angehen.',
        schedule: { plannedMinutes: 10 },
      },
      {
        type: 'board',
        config: {
          board: RISKS_BOARD,
          mode: 'table',
          prompt: 'Gegenmaßnahmen',
          targets: 'cards',
          columns: ['Gegenmaßnahme', 'Verantwortlich', 'Bis'],
        },
        notes: 'Im Steuerpult „Top 3 nach Punkten übernehmen“ und für die Risiken oben rechts gemeinsam eine Gegenmaßnahme festlegen.',
        schedule: { plannedMinutes: 15 },
      },
      {
        type: 'scale',
        config: {
          question: 'Wie klar ist dir, was jetzt von dir erwartet wird?',
          max: 5,
          minLabel: 'unklar',
          maxLabel: 'völlig klar',
        },
        notes: 'Niedrige Werte direkt ansprechen: Was fehlt noch? Ergebnis in die Notizen fürs Protokoll.',
        schedule: { plannedMinutes: 3 },
      },
      parkingReview(8),
      {
        type: 'qa',
        config: { title: 'Offene Fragen' },
        notes: 'Fragen mit den meisten Stimmen zuerst. Was offen bleibt, mit Verantwortlichen ins Protokoll.',
        schedule: { plannedMinutes: 10 },
      },
      {
        type: 'feedback',
        config: {
          question: 'Wie gut fühlst du dich für den Projektstart gerüstet?',
          withComment: true,
          commentLabel: 'Was brauchst du noch?',
          recall: EXPECTATIONS_BOARD,
        },
        notes: 'Jedes Handy zeigt die eigenen Hoffnungen und Bedenken vom Anfang – passt das Bild noch?',
        schedule: { plannedMinutes: 4 },
      },
      thanks('Auf einen guten Start! Das Fotoprotokoll mit allen Ergebnissen kommt per Link.'),
    ],
  },
  {
    id: 'training',
    name: 'Schulung mit Wissensquiz',
    description: 'Zwei Lernblöcke mit Quizfragen und Rangliste, Pause, offene Fragen und Vorher-Nachher-Vergleich.',
    audience: 'Trainings, Einführungen und Unterweisungen',
    slides: [
      join,
      {
        type: 'scale',
        config: { question: 'Wie sicher fühlst du dich heute mit dem Thema?', max: 5, minLabel: 'unsicher', maxLabel: 'sehr sicher' },
        notes: 'Dieselbe Frage kommt am Ende noch einmal – so wird der Lernfortschritt sichtbar.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'choice',
        config: {
          question: 'Wie viel hast du mit dem Thema schon zu tun?',
          options: ['Täglich', 'Mehrmals pro Woche', 'Ab und zu', 'Noch gar nicht'],
        },
        notes: 'Zeigt das Vorwissen im Raum. Beispiele im ersten Block danach ausrichten.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'content',
        config: { title: 'Teil 1: Grundlagen', body: 'Die wichtigsten Begriffe\nWarum das Thema wichtig ist\nEin Beispiel aus der Praxis' },
        notes: 'Hier die Inhalte des ersten Blocks einfügen, gern per PDF-Import. Nach etwa 20 Minuten folgt das Quiz.',
        schedule: { plannedMinutes: 20 },
      },
      {
        type: 'quiz',
        config: {
          question: 'Frage 1: Welche Aussage stimmt?',
          options: ['Aussage A', 'Aussage B', 'Aussage C', 'Aussage D'],
          correct: [0],
          timeLimit: 30,
        },
        notes: 'Frage und Antworten an den Inhalt anpassen. Nach dem Auflösen kurz erklären, warum die anderen Antworten nicht stimmen.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'quiz',
        config: {
          question: 'Frage 2: Was ist hier der richtige nächste Schritt?',
          options: ['Schritt A', 'Schritt B', 'Schritt C'],
          correct: [1],
          timeLimit: 30,
        },
        notes: 'Danach die Rangliste zeigen – kurz, nicht als Wettbewerb aufbauschen.',
        schedule: { plannedMinutes: 2 },
      },
      pause(10),
      {
        type: 'content',
        config: {
          title: 'Teil 2: Anwenden',
          body: 'Typische Fehler und wie man sie vermeidet\nSchritt für Schritt zum Ergebnis\nTipps für den Alltag',
        },
        notes: 'Inhalte des zweiten Blocks einfügen. Auf die Fragen eingehen, die im Quiz oft falsch beantwortet wurden.',
        schedule: { plannedMinutes: 25 },
      },
      {
        type: 'quiz',
        config: {
          question: 'Frage 3: Welche beiden Punkte gehören dazu?',
          options: ['Punkt A', 'Punkt B', 'Punkt C', 'Punkt D'],
          correct: [0, 2],
          timeLimit: 40,
        },
        notes: 'Mehrere richtige Antworten – vorher darauf hinweisen.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'quiz',
        config: {
          question: 'Frage 4: Was ist der häufigste Fehler?',
          options: ['Fehler A', 'Fehler B', 'Fehler C', 'Fehler D'],
          correct: [3],
          timeLimit: 30,
        },
        notes: 'Letzte Quizfrage. Danach die Rangliste mit den Gesamtpunkten zeigen und die Besten kurz würdigen.',
        schedule: { plannedMinutes: 3 },
      },
      {
        type: 'open',
        config: { question: 'Was ist für dich noch unklar?' },
        notes: 'Antworten bündeln und die häufigsten Punkte direkt aufgreifen. Rest geht in die Fragerunde.',
        schedule: { plannedMinutes: 5 },
      },
      {
        type: 'qa',
        config: { title: 'Eure Fragen' },
        notes: 'Fragen mit den meisten Stimmen zuerst. Was offen bleibt, schriftlich nachreichen.',
        schedule: { plannedMinutes: 8 },
      },
      {
        type: 'scale',
        config: { question: 'Wie sicher fühlst du dich jetzt mit dem Thema?', max: 5, minLabel: 'unsicher', maxLabel: 'sehr sicher' },
        notes: 'Mit dem Anfang vergleichen und den Unterschied benennen.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'feedback',
        config: { question: 'Wie hat dir die Schulung gefallen?', withComment: true, commentLabel: 'Was nimmst du mit?' },
        notes: 'Kurz warten, bis die meisten abgestimmt haben. Zwei oder drei Kommentare vorlesen.',
        schedule: { plannedMinutes: 3 },
      },
      thanks('Schön, dass du dabei warst. Die Unterlagen bekommst du im Anschluss.'),
    ],
  },
  {
    id: 'talk',
    name: 'Vortrag mit Q&A',
    description: 'Ein Vortrag mit Fragen, die das Publikum jederzeit stellen kann, einer Fragerunde am Ende und kurzem Feedback.',
    audience: 'Vorträge, Keynotes und Info-Veranstaltungen',
    slides: [
      join,
      {
        type: 'qa',
        config: {
          title: 'Fragen jederzeit',
          task: 'Stell deine Frage jederzeit vom Handy aus – am Ende beantworte ich die mit den meisten Stimmen.',
          moderated: true,
          anytime: true,
        },
        notes: 'Kurz zeigen, dass Fragen den ganzen Vortrag über möglich sind. Neue Fragen erscheinen still im Eingang des Steuerpults.',
        schedule: { plannedMinutes: 1 },
      },
      {
        type: 'choice',
        config: {
          question: 'Wie viel Erfahrung hast du mit dem Thema?',
          options: ['Viel', 'Etwas', 'Kaum', 'Keine'],
        },
        notes: 'Einstieg zum Mitmachen – danach weiß der Raum, dass die Handys gebraucht werden.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'content',
        config: { title: 'Dein Vortrag', body: 'Hier kommen deine Folien hin.' },
        notes:
          'Folien per PDF- oder PowerPoint-Import einfügen und diese Platzhalter-Folie löschen. Zwischendurch eine Abstimmung einbauen hält die Aufmerksamkeit.',
        schedule: { plannedMinutes: 25 },
      },
      {
        type: 'wordcloud',
        config: { question: 'Was nimmst du mit? Ein oder zwei Wörter.', maxWords: 2 },
        notes: 'Kurze Zusammenfassung durchs Publikum. Die großen Wörter aufgreifen und zur Fragerunde überleiten.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'qa',
        config: { title: 'Eure Fragen' },
        notes: 'Zeigt alle Fragen aus dem Vortrag. Die mit den meisten Stimmen zuerst beantworten, beantwortete abhaken.',
        schedule: { plannedMinutes: 10 },
      },
      {
        type: 'feedback',
        config: { question: 'Wie hat dir der Vortrag gefallen?', withComment: true },
        notes: 'Feedback läuft, während die letzten Fragen beantwortet werden.',
        schedule: { plannedMinutes: 2 },
      },
      thanks(),
    ],
  },
  {
    id: 'ideas',
    name: 'Ideenworkshop',
    description: 'Ideen allein sammeln, gemeinsam zu Themen bündeln, punkten und die Top 3 mit Verantwortlichen festhalten.',
    audience: 'Teams, die Lösungen für eine konkrete Frage suchen',
    slides: [
      join,
      parking(),
      {
        type: 'wordcloud',
        config: { question: 'Was fällt dir zur Frage des Tages spontan ein?', maxWords: 3 },
        notes: 'Aufwärmen – noch keine Bewertung. Die Wolke zeigt, wie unterschiedlich der Blick auf die Frage ist.',
        schedule: { plannedMinutes: 3 },
      },
      {
        type: 'content',
        config: {
          title: 'Die Frage des Tages',
          body: 'Wie können wir …?\n\nRegeln: Menge vor Qualität. Auf Ideen anderer aufbauen. Keine Kritik beim Sammeln.',
        },
        notes:
          'Die Frage im Editor konkret formulieren („Wie können wir … für … erreichen?“). Hintergrund kurz erklären: Warum fragen wir das jetzt?',
        schedule: { plannedMinutes: 5 },
      },
      {
        type: 'board',
        config: {
          board: IDEAS_BOARD,
          mode: 'collect',
          prompt: 'Welche Ideen hast du?',
          task: 'Eine Idee pro Karte, gern auch verrückte. Bis zu acht Karten.',
          maxCards: 8,
          askName: true,
          startHidden: true,
        },
        notes:
          'Erst allein und still schreiben – die Karten bleiben verborgen, damit niemand abschreibt. Dann aufdecken und reihum vorstellen lassen, jede Person ihre eigenen Karten.',
        schedule: {
          phases: [
            { label: 'Allein schreiben', minutes: 8 },
            { label: 'Reihum vorstellen', minutes: 12 },
          ],
          autoCountdown: true,
        },
      },
      {
        type: 'board',
        config: { board: IDEAS_BOARD, mode: 'cluster', prompt: 'Ähnliche Ideen zu Themen bündeln', rights: 'own', showUnsorted: true },
        notes:
          'Alle ordnen ihre eigenen Karten zu oder legen neue Themen an. Die Moderation hilft beim Benennen. Bei großen Gruppen im Steuerpult auf „Nur Moderation“ umschalten.',
        schedule: { plannedMinutes: 15 },
      },
      pause(10),
      {
        type: 'board',
        config: { board: IDEAS_BOARD, mode: 'dots', prompt: 'Welche Ideen sollten wir weiterverfolgen?', dots: 3 },
        notes: 'Drei Punkte pro Person, auch mehrere auf dasselbe Thema. Ergebnis kurz kommentieren: Was überrascht?',
        schedule: { plannedMinutes: 5 },
      },
      {
        type: 'board',
        config: {
          board: IDEAS_BOARD,
          mode: 'table',
          prompt: 'Unsere Top 3',
          columns: ['Nächster Schritt', 'Verantwortlich', 'Bis'],
        },
        notes:
          'Im Steuerpult „Top 3 nach Punkten übernehmen“. Für jedes Thema einen konkreten nächsten Schritt mit einer verantwortlichen Person und einem Datum.',
        schedule: { plannedMinutes: 15 },
      },
      parkingReview(5),
      {
        type: 'feedback',
        config: { question: 'Wie zufrieden bist du mit dem Ergebnis?', withComment: true, commentLabel: 'Was nimmst du mit?' },
        notes: 'Reihum ein Satz zum Abschluss, wenn die Zeit reicht.',
        schedule: { plannedMinutes: 4 },
      },
      thanks('Die Top 3 und alle Ideen stehen im Fotoprotokoll.'),
    ],
  },
  {
    id: 'priorities',
    name: 'Priorisierungs-Workshop',
    description: 'Vorhaben sammeln, bündeln, nach Nutzen und Aufwand in einer Matrix einschätzen und die Prioritäten festhalten.',
    audience: 'Leitungsteams und Gremien, die entscheiden müssen, was zuerst kommt',
    slides: [
      join,
      parking(),
      {
        type: 'content',
        config: {
          title: 'Ausgangslage',
          body: 'Wo wir stehen\nWelche Ziele für den Zeitraum gelten\nWie viel Kapazität wir haben',
        },
        notes: 'Rahmen setzen: Ziele und Kapazität sind die Messlatte für jede Einschätzung. Gern eigene Folien per Import ergänzen.',
        schedule: { plannedMinutes: 10 },
      },
      {
        type: 'board',
        config: {
          board: PROJECTS_BOARD,
          mode: 'collect',
          prompt: 'Welche Vorhaben stehen zur Wahl?',
          task: 'Ein Vorhaben pro Karte, kurz und eindeutig benannt. Laufende Vorhaben gehören dazu.',
          maxCards: 4,
          startHidden: true,
        },
        notes:
          'Bereits bekannte Vorhaben kann die Moderation im Steuerpult vorab als Karten ergänzen. Karten erst aufdecken, wenn alle fertig sind.',
        schedule: { plannedMinutes: 10 },
      },
      {
        type: 'board',
        config: { board: PROJECTS_BOARD, mode: 'cluster', prompt: 'Doppelte und ähnliche Vorhaben zusammenfassen', rights: 'host' },
        notes: 'Die Moderation fasst Doppeltes zusammen, die Gruppe bestätigt. Jede Gruppe soll danach ein klar benanntes Vorhaben sein.',
        schedule: { plannedMinutes: 15 },
      },
      {
        type: 'board',
        config: {
          board: PROJECTS_BOARD,
          mode: 'dots',
          prompt: 'Welche Vorhaben bringen uns den Zielen am nächsten?',
          dots: 5,
          stack: false,
        },
        notes: 'Fünf Punkte pro Person, höchstens einer je Vorhaben – so zählt die Breite der Zustimmung.',
        schedule: { plannedMinutes: 5 },
      },
      pause(10),
      {
        type: 'board',
        config: {
          board: PROJECTS_BOARD,
          mode: 'rate',
          prompt: 'Nutzen und Aufwand einschätzen',
          top: 8,
          scales: [
            { label: 'Nutzen', levels: ['S', 'M', 'L', 'XL'] },
            { label: 'Aufwand', levels: ['S', 'M', 'L', 'XL'] },
          ],
          quadrants: ['Quick Wins', 'Strategisch', 'Mitnehmen', 'Zurückstellen'],
        },
        notes:
          'Alle schätzen die acht Vorhaben mit den meisten Punkten ein. Bei großer Streuung nachfragen: Wer hat hoch, wer niedrig eingeschätzt – und warum? Werte notfalls im Steuerpult festlegen.',
        schedule: { plannedMinutes: 20 },
      },
      {
        type: 'board',
        config: {
          board: PROJECTS_BOARD,
          mode: 'table',
          prompt: 'Unsere Prioritäten',
          columns: ['Ziel', 'Verantwortlich', 'Erster Schritt', 'Bis'],
        },
        notes:
          'Im Steuerpult die Top 3 übernehmen und mit der Matrix abgleichen: Quick Wins und strategische Vorhaben zuerst. Bewusst benennen, was zurückgestellt wird.',
        schedule: { plannedMinutes: 20 },
      },
      {
        type: 'scale',
        config: {
          question: 'Wie gut kannst du diese Prioritäten mittragen?',
          max: 5,
          minLabel: 'gar nicht',
          maxLabel: 'voll und ganz',
        },
        notes: 'Niedrige Werte sind ein Signal, keine Ablehnung: Was müsste sich ändern, damit du mitgehen kannst?',
        schedule: { plannedMinutes: 5 },
      },
      parkingReview(8),
      {
        type: 'feedback',
        config: { question: 'Wie zufrieden bist du mit dem Ergebnis?', withComment: true, commentLabel: 'Was nimmst du mit?' },
        notes: 'Feedback kurz halten – das Ergebnis ist die Tabelle.',
        schedule: { plannedMinutes: 3 },
      },
      thanks('Prioritäten, Matrix und offene Punkte stehen im Fotoprotokoll.'),
    ],
  },
  {
    id: 'onboarding',
    name: 'Kennenlernen & Onboarding',
    description: 'Neue Kolleginnen und Kollegen lernen sich in kleinen Gruppen kennen, testen ihr Wissen und sagen, was sie brauchen.',
    audience: 'Einstiegstage, neue Teams und Netzwerktreffen',
    slides: [
      join,
      {
        type: 'qa',
        config: {
          title: 'Fragen zum Start',
          task: 'Was du schon immer wissen wolltest – jederzeit vom Handy aus, auch anonym.',
          moderated: true,
          anytime: true,
        },
        notes: 'Kurz zeigen, dass Fragen den ganzen Termin über möglich sind. Am Ende gehen wir sie gemeinsam durch.',
        schedule: { plannedMinutes: 1 },
      },
      {
        type: 'wordcloud',
        config: { question: 'Was hast du gemacht, bevor du hier angefangen hast?', maxWords: 2 },
        notes: 'Lockerer Einstieg. Auf Gemeinsamkeiten und Überraschungen hinweisen.',
        schedule: { plannedMinutes: 3 },
      },
      {
        type: 'teams',
        config: {
          title: 'Gruppen bilden',
          tagLabel: 'Dein Bereich',
          tags: ['Vertrieb', 'Technik', 'Verwaltung', 'Produktion'],
        },
        notes:
          'Bereiche im Editor anpassen. Im Steuerpult Gruppen zu viert bilden und die Bereiche mischen – so lernen sich Leute aus verschiedenen Bereichen kennen.',
        schedule: { plannedMinutes: 3 },
      },
      {
        type: 'board',
        config: {
          board: 'Gemeinsamkeiten',
          mode: 'collect',
          prompt: 'Was habt ihr alle gemeinsam?',
          task: 'Findet in eurer Gruppe drei Dinge, die auf alle zutreffen – je überraschender, desto besser. Jede Gemeinsamkeit auf eine Karte.',
          maxCards: 5,
          perTeam: true,
        },
        notes: 'Jede Gruppe sammelt für sich und sieht nur die eigenen Karten. Danach liest jede Gruppe ihre schönste Gemeinsamkeit vor.',
        schedule: {
          phases: [
            { label: 'In der Gruppe reden', minutes: 10 },
            { label: 'Vorlesen', minutes: 5 },
          ],
          autoCountdown: true,
        },
      },
      {
        type: 'content',
        config: { title: 'Wer wir sind', body: 'Unsere Geschichte\nWas wir machen und für wen\nWie wir zusammenarbeiten' },
        notes: 'Hier die Organisation vorstellen – gern per PDF-Import. Die Quizfragen danach greifen den Inhalt auf.',
        schedule: { plannedMinutes: 15 },
      },
      {
        type: 'quiz',
        config: {
          question: 'Seit wann gibt es uns?',
          options: ['Seit 1990', 'Seit 2000', 'Seit 2010', 'Seit 2020'],
          correct: [1],
          timeLimit: 20,
        },
        notes: 'Frage und richtige Antwort an die eigene Organisation anpassen.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'quiz',
        config: {
          question: 'Wie viele Menschen arbeiten bei uns?',
          options: ['Unter 50', '50 bis 200', '200 bis 1.000', 'Über 1.000'],
          correct: [2],
          timeLimit: 20,
        },
        notes: 'Nach dem Auflösen die Rangliste zeigen – mit einem Augenzwinkern.',
        schedule: { plannedMinutes: 2 },
      },
      {
        type: 'board',
        config: {
          board: EXPECTATIONS_BOARD,
          mode: 'collect',
          prompt: 'Was brauchst du, um gut bei uns anzukommen?',
          maxCards: 3,
          askName: true,
        },
        notes: 'Die Karten sind die Arbeitsliste für die ersten Wochen. Die Feedbackrunde zeigt jeder Person ihre eigenen Karten wieder.',
        schedule: { plannedMinutes: 8 },
      },
      {
        type: 'qa',
        config: { title: 'Eure Fragen' },
        notes: 'Zeigt alle Fragen seit Beginn. Die mit den meisten Stimmen zuerst, beantwortete abhaken.',
        schedule: { plannedMinutes: 10 },
      },
      {
        type: 'feedback',
        config: {
          question: 'Wie willkommen fühlst du dich?',
          withComment: true,
          commentLabel: 'Was hätte dir heute noch geholfen?',
          recall: EXPECTATIONS_BOARD,
        },
        notes: 'Jedes Handy zeigt die eigenen Wünsche von vorhin – wurde schon etwas davon beantwortet?',
        schedule: { plannedMinutes: 3 },
      },
      thanks('Schön, dass du da bist!'),
    ],
  },
];

/** Folien einer Vorlage, wie sie der Server anlegt (Ablaufplan vollständig) */
export function templateSlides(template: PresentationTemplate): BatchSlide[] {
  return batchSlides.parse(template.slides);
}

/** Geplante Gesamtdauer einer Vorlage in Minuten */
export function templateMinutes(template: PresentationTemplate): number {
  return templateSlides(template).reduce((acc, s) => acc + (slidePlannedMinutes(s.schedule) ?? 0), 0);
}

/**
 * Vorlage für `POST /api/presentations`: `templateId` hat Vorrang; ohne sie gilt
 * das alte `template` (Standard an) als Workshop-Gerüst. `null` = leer,
 * `undefined` = unbekannte Vorlage.
 */
export function resolveTemplate(input: { template?: boolean; templateId?: string }): PresentationTemplate | null | undefined {
  const id = input.templateId ?? (input.template === false ? BLANK_TEMPLATE_ID : DEFAULT_TEMPLATE_ID);
  if (id === BLANK_TEMPLATE_ID) return null;
  return TEMPLATES.find((t) => t.id === id);
}
