import type { BoardConfig } from './slides.ts';

/**
 * Breakout: Gruppen aus „Gruppen bilden“ arbeiten getrennt. Eine Kartenwand-Folie
 * zum Sammeln mit `perTeam` ordnet jede neue Karte der Gruppe ihrer Autorin bzw.
 * ihres Autors zu (`posts.team` = Index der Gruppe in der Einteilung). Maßgeblich
 * ist die letzte Einteilung bis zu dieser Folie (in Folienreihenfolge).
 */

/** Kurzname einer Gruppe, wie ihn auch „Gruppen bilden“ vergibt */
export const teamLabel = (index: number) => `Gruppe ${index + 1}`;
/** Kennzeichnung an einer Karte, z. B. „G2“ */
export const teamShort = (index: number) => `G${index + 1}`;

export interface TeamAssignment {
  /** „Gruppen bilden“-Folie, aus der die Einteilung stammt */
  slideId: number;
  /** Teilnehmer-IDs je Gruppe */
  teams: number[][];
}

/** Letzte nicht leere Einteilung bis einschließlich der Folie `slideIndex` */
export function assignmentAt(
  slides: { id: number; type: string }[],
  slideIndex: number,
  teams: Record<string, number[][]> | undefined,
): TeamAssignment | null {
  if (!teams || slideIndex < 0) return null;
  for (let i = Math.min(slideIndex, slides.length - 1); i >= 0; i--) {
    const slide = slides[i]!;
    if (slide.type !== 'teams') continue;
    const assigned = teams[slide.id];
    if (assigned?.length) return { slideId: slide.id, teams: assigned };
  }
  return null;
}

/** Gruppe einer Person in einer Einteilung (null: keiner Gruppe zugeteilt) */
export function teamIndexOf(assignment: TeamAssignment | null, participantId: number): number | null {
  if (!assignment) return null;
  const i = assignment.teams.findIndex((t) => t.includes(participantId));
  return i < 0 ? null : i;
}

/** Sammelt diese Folie gruppenweise? Nur beim Sammeln und nur mit Einteilung davor. */
export function breakoutAssignment(
  slides: { id: number; type: string }[],
  slide: { id: number; config: Pick<BoardConfig, 'mode' | 'perTeam'> },
  teams: Record<string, number[][]> | undefined,
): TeamAssignment | null {
  if (slide.config.mode !== 'collect' || !slide.config.perTeam) return null;
  const index = slides.findIndex((s) => s.id === slide.id);
  return assignmentAt(slides, index, teams);
}

/**
 * Karten, die eine Person beim gruppenweisen Sammeln sieht: die eigenen (auch
 * ausgeblendete, mit Hinweis) und die sichtbaren Karten ihrer Gruppe. Karten
 * fremder Gruppen nie.
 */
export function teamVisibleCards<T extends { participantId: number | null; team?: number | null; status: string }>(
  cards: T[],
  participantId: number,
  team: number | null,
): T[] {
  return cards.filter((c) => c.participantId === participantId || (team !== null && c.team === team && c.status === 'visible'));
}

/** Fertig gemeldete Gruppen, die es in der Einteilung (noch) gibt – sortiert */
export function doneTeams(done: number[] | undefined, teamCount: number): number[] {
  return [...new Set(done ?? [])].filter((i) => i >= 0 && i < teamCount).sort((a, b) => a - b);
}

/** Gruppe als fertig melden oder zurücknehmen */
export function toggleTeamDone(done: number[] | undefined, team: number, value: boolean): number[] {
  const rest = (done ?? []).filter((i) => i !== team);
  return value ? [...rest, team].sort((a, b) => a - b) : rest;
}

/** Sammelruf „Alle zurück ins Plenum“ – auf allen Handys und dem Beamer */
export interface Callback {
  text: string;
  /** Minuten bis zur Rückkehr (null: sofort) */
  minutes: number | null;
  /** Zeitpunkt des Rufs (Serverzeit, ms) – Kennung zum lokalen Schließen */
  at: number;
  /** Danach verschwindet der Hinweis von selbst (Serverzeit, ms) */
  until: number;
}

/** Nach Ablauf der Minuten bleibt der Hinweis noch so lange stehen */
export const CALLBACK_GRACE_MS = 2 * 60 * 1000;

export function makeCallback(text: string, minutes: number | null, now: number): Callback {
  return { text, minutes, at: now, until: now + (minutes ?? 0) * 60_000 + CALLBACK_GRACE_MS };
}

/** Sammelruf, solange er gilt */
export function activeCallback(callback: Callback | null | undefined, now: number): Callback | null {
  return callback && callback.until > now ? callback : null;
}

/** Überschrift des Sammelrufs, z. B. „In 2 Min. zurück ins Plenum“ */
export function callbackHeadline(callback: Pick<Callback, 'minutes'>): string {
  return callback.minutes ? `In ${callback.minutes} Min. zurück ins Plenum` : 'Alle zurück ins Plenum';
}
