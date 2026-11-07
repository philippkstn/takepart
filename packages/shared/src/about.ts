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
  /** Ablauf aus Sicht des Publikums */
  steps: [
    { title: 'Code auf dem Beamer', text: 'Die Präsentation zeigt einen sechsstelligen Code und einen QR-Code.' },
    { title: 'Mitmachen am Handy', text: 'Code eingeben oder scannen – ohne Konto, ohne App.' },
    { title: 'Ergebnisse live', text: 'Antworten erscheinen sofort auf der Bühne, für alle sichtbar.' },
  ],
  features: [
    { id: 'vote', title: 'Abstimmen', text: 'Umfragen, Skalen, Wortwolken, Rangfolgen und offene Antworten mit Live-Ergebnissen.' },
    { id: 'qa', title: 'Fragen aus dem Publikum', text: 'Q&A mit Stimmen und Moderation – die wichtigsten Fragen stehen oben.' },
    { id: 'quiz', title: 'Quiz', text: 'Mit Timer, Punkten und Rangliste.' },
    { id: 'board', title: 'Kartenwand', text: 'Für Workshops: sammeln, clustern, punkten, bewerten und als Ergebnistabelle festhalten.' },
    { id: 'teams', title: 'Gruppenarbeit', text: 'Gruppen bilden, Breakout-Phasen mit Countdown auf Beamer und Handy.' },
    { id: 'import', title: 'Eigene Folien', text: 'PowerPoint- und PDF-Import mit Sprechernotizen, Animationen und Referentenansicht.' },
  ] satisfies readonly AboutFeature[],
  /** Für Vortragende: Größe, Ergebnisse, Betrieb */
  presenters:
    'Für bis zu rund 300 gleichzeitige Teilnehmende. Ergebnisse als CSV und Fotoprotokoll, Laserpointer und Zeichnen inklusive.',
  selfHosting: 'Open Source (AGPL-3.0), selbst hostbar mit Docker und MariaDB; Oberfläche auf Deutsch.',
} as const;

/** Eine Funktion als ganzer Satz (llms.txt, JSON-LD) */
export const featureLine = (f: { title: string; text: string }) => `${f.title}: ${f.text}`;
