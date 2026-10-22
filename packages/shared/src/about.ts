/**
 * Kurzbeschreibung von TakePart für Suchmaschinen und KI-Suchen.
 * Eine Quelle für Startseite (sichtbarer Abschnitt), ausgeliefertes HTML
 * (Meta-Angaben, JSON-LD, Inhalt vor dem Laden von React) und `llms.txt`.
 */
export const ABOUT = {
  name: 'TakePart',
  title: 'TakePart – interaktive Vorträge und Workshops, Open Source',
  tagline: 'Interaktive Vorträge und Workshops',
  description:
    'TakePart ist eine kostenlose Open-Source-App für interaktive Vorträge und Workshops: Abstimmungen, Fragen, Quiz, Kartenwand und Gruppenarbeit live – Teilnehmende machen mit Code oder QR-Code auf dem Handy mit, ohne Konto und ohne App. Selbst hostbar per Docker.',
  features: [
    'Abstimmungen, Skalen, Wortwolken, Rangfolgen und offene Antworten mit Live-Ergebnissen',
    'Fragen aus dem Publikum (Q&A) mit Stimmen und Moderation',
    'Quiz mit Timer, Punkten und Rangliste',
    'Kartenwand für Workshops: sammeln, clustern, punkten, bewerten, Ergebnistabelle',
    'Gruppen bilden mit Breakout-Phasen, Countdown und Phasen auf Beamer und Handy',
    'PowerPoint- und PDF-Import mit Sprechernotizen und Animationen, Referentenansicht, Laserpointer',
    'Für bis zu rund 300 gleichzeitige Teilnehmende, Ergebnisse als CSV und Fotoprotokoll',
  ],
  selfHosting: 'Open Source (AGPL-3.0), selbst hostbar mit Docker und MariaDB; Oberfläche auf Deutsch.',
} as const;
