/**
 * Kurzbeschreibung von TakePart für Suchmaschinen und KI-Suchen.
 * Eine Quelle für Startseite (sichtbare Abschnitte), ausgeliefertes HTML
 * (Meta-Angaben, JSON-LD, Inhalt vor dem Laden von React) und `llms.txt`.
 */

export interface AboutFeature {
  /** Kennung für das Icon auf der Startseite */
  id: 'vote' | 'qa' | 'quiz' | 'board' | 'teams' | 'import';
  title: string;
  text: string;
}

export const ABOUT = {
  name: 'TakePart',
  title: 'TakePart – interaktive Vorträge und Workshops, Open Source',
  tagline: 'Interaktive Vorträge und Workshops',
  description:
    'TakePart ist eine kostenlose Open-Source-App für interaktive Vorträge und Workshops: Abstimmungen, Fragen, Quiz, Kartenwand und Gruppenarbeit live – Teilnehmende machen mit Code oder QR-Code auf dem Handy mit, ohne Konto und ohne App. Selbst hostbar per Docker.',
  /** Überschrift der Startseite – spricht das Publikum an, das mit einem Code kommt */
  headline: 'Mitmachen mit dem Code vom Beamer',
  lead: 'Abstimmen, Fragen stellen, Ideen sammeln – direkt vom Handy, ohne Konto und ohne App.',
  /** Ablauf aus Sicht des Publikums */
  steps: [
    { title: 'Code ablesen', text: 'Die Präsentation zeigt einen sechsstelligen Code und einen QR-Code.' },
    { title: 'Am Handy mitmachen', text: 'Code eingeben oder QR-Code scannen. Kein Konto, keine App.' },
    { title: 'Ergebnis sehen', text: 'Jede Antwort erscheint sofort auf dem Beamer.' },
  ],
  features: [
    { id: 'vote', title: 'Abstimmen', text: 'Umfragen, Skalen, Wortwolken und Rangfolgen – das Ergebnis wächst live mit.' },
    { id: 'qa', title: 'Fragen aus dem Publikum', text: 'Alle fragen und stimmen ab, die wichtigsten Fragen stehen oben. Auf Wunsch erst nach Freigabe.' },
    { id: 'quiz', title: 'Quiz', text: 'Fragen mit Timer und Punkten, am Ende eine Rangliste.' },
    { id: 'board', title: 'Kartenwand', text: 'Ideen sammeln, clustern, mit Punkten gewichten und als Ergebnistabelle festhalten.' },
    { id: 'teams', title: 'Gruppenarbeit', text: 'Gruppen einteilen, Breakout-Phasen mit Countdown, Sammelruf zurück ins Plenum.' },
    { id: 'import', title: 'Eigene Folien', text: 'PowerPoint oder PDF importieren, mit Sprechernotizen, Animationen und Referentenansicht.' },
  ] satisfies readonly AboutFeature[],
  /** Für Vortragende: Größe, Ergebnisse, Betrieb */
  presenters:
    'Für Gruppen bis rund 300 Personen. Ergebnisse als CSV und Fotoprotokoll, Laserpointer und Zeichnen auf der Folie.',
  selfHosting: 'Open Source (AGPL-3.0), selbst hostbar mit Docker und MariaDB.',
} as const;

/** Eine Funktion als ganzer Satz (llms.txt, JSON-LD) */
export const featureLine = (f: { title: string; text: string }) => `${f.title}: ${f.text}`;
