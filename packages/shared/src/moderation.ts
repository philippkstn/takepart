import type { RunState } from './state.ts';

/* ───────────────────────── Stimmungsbarometer / Handzeichen ─────────────────────────
 * Teilnehmende geben jederzeit dezent ein Signal („Zu schnell“, „Frage“, „Pause“).
 * Gespeichert wird nur der Zeitpunkt je Person und Art in `RunState.signals`; ein
 * Signal erlischt nach SIGNAL_TTL_MS. Abgelaufene Einträge werden beim Lesen
 * herausgefiltert und beim nächsten Schreiben entfernt – kein Timer im Speicher.
 */

/** Feste Liste – neue Arten hier anhängen (Reihenfolge = Anzeige-Reihenfolge) */
export const SIGNAL_KINDS = ['fast', 'question', 'break'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  fast: 'Zu schnell',
  question: 'Frage',
  break: 'Pause bitte',
};

/** Ein Signal gilt drei Minuten */
export const SIGNAL_TTL_MS = 3 * 60 * 1000;

/** Signal-Zeitpunkte (ms) je Art und Person (Schlüssel: Teilnehmer-ID) */
export type SignalStore = Partial<Record<SignalKind, Record<string, number>>>;

const alive = (at: number, now: number) => now - at < SIGNAL_TTL_MS && at <= now + 60_000;

/** Ohne abgelaufene Einträge (und ohne leere Arten) */
export function pruneSignals(store: SignalStore | undefined, now: number): SignalStore {
  const next: SignalStore = {};
  for (const kind of SIGNAL_KINDS) {
    const entries = Object.entries(store?.[kind] ?? {}).filter(([, at]) => alive(at, now));
    if (entries.length > 0) next[kind] = Object.fromEntries(entries);
  }
  return next;
}

/** Signal einer Person setzen (erneutes Setzen verlängert es) oder zurücknehmen */
export function setSignal(state: RunState, kind: SignalKind, participantId: number, active: boolean, now: number): RunState {
  const signals = pruneSignals(state.signals, now);
  const own = { ...signals[kind] };
  if (active) own[participantId] = now;
  else delete own[participantId];
  if (Object.keys(own).length > 0) signals[kind] = own;
  else delete signals[kind];
  return { ...state, signals };
}

/** Moderation hat die Signale einer Art gesehen: alle zurücksetzen */
/** Handzeichen einer Art quittieren – alle oder nur das einer Person */
export function clearSignals(state: RunState, kind: SignalKind, now: number, participantId: number | null = null): RunState {
  const signals = pruneSignals(state.signals, now);
  if (participantId === null) delete signals[kind];
  else if (signals[kind]) {
    const rest = { ...signals[kind] };
    delete rest[participantId];
    if (Object.keys(rest).length > 0) signals[kind] = rest;
    else delete signals[kind];
  }
  return { ...state, signals };
}

/**
 * Ein Handzeichen im Steuerpult: wer (null = ohne Namen), seit wann und bis wann.
 * Gezählt wird im Browser, damit Signale auch ohne neue Ansicht erlöschen.
 */
export interface SignalEntry {
  /** Teilnehmer-ID – nur im Steuerpult, zum einzelnen Quittieren */
  id: number;
  name: string | null;
  at: number;
  until: number;
}

/** Nur für die Moderation – nie Beamer oder Publikum */
export type SignalsView = Record<SignalKind, SignalEntry[]>;

export function signalsView(store: SignalStore | undefined, now: number, names: ReadonlyMap<number, string> = new Map()): SignalsView {
  const live = pruneSignals(store, now);
  const view = {} as SignalsView;
  for (const kind of SIGNAL_KINDS) {
    view[kind] = Object.entries(live[kind] ?? {})
      .map(([id, at]) => ({ id: Number(id), name: names.get(Number(id)) ?? null, at, until: at + SIGNAL_TTL_MS }))
      .sort((a, b) => a.at - b.at);
  }
  return view;
}

/** Für Teilnehmende: eigene aktive Signale mit Ablaufzeitpunkt */
export function ownSignals(store: SignalStore | undefined, participantId: number, now: number): Partial<Record<SignalKind, number>> {
  const own: Partial<Record<SignalKind, number>> = {};
  for (const kind of SIGNAL_KINDS) {
    const at = store?.[kind]?.[participantId];
    if (at !== undefined && alive(at, now)) own[kind] = at + SIGNAL_TTL_MS;
  }
  return own;
}

/** Noch nicht abgelaufene Signale zählen (Serverzeit `now`) */
export const activeSignals = (entries: SignalEntry[], now: number) => entries.filter((e) => e.until > now);
export const countActive = (entries: SignalEntry[], now: number) => activeSignals(entries, now).length;

/* ───────────────────────── Zufallsauswahl ───────────────────────── */

export interface PickerState {
  /** Bereits gezogene Teilnehmer-IDs (inkl. der aktuellen) – bis „Neu starten“ */
  drawn: number[];
  current: number | null;
  /** Name groß auf dem Beamer */
  shown: boolean;
}

export const emptyPicker = (): PickerState => ({ drawn: [], current: null, shown: false });

/**
 * Einteilung, die an Position `index` gilt: die letzte „Gruppen bilden“-Folie bis
 * dorthin (in Folienreihenfolge), die schon Gruppen hat.
 */
export function teamsAt(
  slides: readonly { id: number; type: string }[],
  index: number,
  teams: Record<string, number[][]> | undefined,
): { slideId: number; groups: number[][] } | null {
  if (!teams || index < 0) return null;
  for (let i = Math.min(index, slides.length - 1); i >= 0; i--) {
    const slide = slides[i]!;
    if (slide.type !== 'teams') continue;
    const groups = teams[slide.id];
    if (groups?.length) return { slideId: slide.id, groups };
  }
  return null;
}

/** Wer gezogen werden kann: mit Namen, noch nicht gezogen, ggf. nur aus einer Gruppe */
export function pickCandidates(named: Iterable<number>, drawn: readonly number[], group: readonly number[] | null = null): number[] {
  const done = new Set(drawn);
  const inGroup = group ? new Set(group) : null;
  return [...named].filter((id) => !done.has(id) && (!inGroup || inGroup.has(id)));
}

/** Eine Person ziehen; `random(n)` liefert eine ganze Zahl in [0, n) */
export function drawPick(picker: PickerState, candidates: readonly number[], random: (n: number) => number): PickerState | null {
  if (candidates.length === 0) return null;
  const id = candidates[random(candidates.length)]!;
  return { ...picker, drawn: [...picker.drawn, id], current: id };
}

/** Zufallsauswahl im Steuerpult */
export interface PickerView {
  current: string | null;
  shown: boolean;
  /** Anzahl bereits gezogener Personen */
  drawn: number;
  /** Noch ziehbar (mit Namen, nicht gezogen) */
  remaining: number;
  /** Gruppen der geltenden Einteilung mit noch ziehbaren Personen */
  groups: { name: string; remaining: number }[];
}

/* ───────────────────────── Anwesenheit ───────────────────────── */

/** Wer gerade verbunden ist – nur im Steuerpult */
export interface PresenceView {
  /** Mit Namen: verbundene zuerst, dann alphabetisch */
  people: { name: string; online: boolean }[];
  /** Ohne Namen */
  unnamed: { online: number; total: number };
}

/* ───────────────────────── Reihum (Redereihenfolge) ───────────────────────── */

/**
 * Feste Reihenfolge für Runden „reihum“ (Erwartungen, Karten einbringen,
 * Feedback). Gilt für die ganze Durchführung, damit das Feedback am Ende in
 * derselben Reihenfolge läuft wie die Erwartungsrunde am Anfang.
 */
export interface TurnsState {
  /** Teilnehmer-IDs in Reihenfolge */
  order: number[];
  /** Index der Person, die gerade dran ist (null = Runde nicht gestartet) */
  current: number | null;
  /** Reihenfolge als Liste groß auf dem Beamer */
  shown: boolean;
}

export const emptyTurns = (): TurnsState => ({ order: [], current: null, shown: false });

/** Wie eine neue Reihenfolge entsteht: Beitritt, Zufall oder erste Karte auf einer Wand */
export const TURN_SOURCES = ['joined', 'random', 'board'] as const;
export type TurnSource = (typeof TURN_SOURCES)[number];

/** Weiter/zurück; am Ende bleibt die letzte Person, vor dem Anfang endet die Runde nicht */
export function stepTurn(turns: TurnsState, delta: number): TurnsState {
  if (turns.order.length === 0) return turns;
  const from = turns.current ?? -1;
  const next = Math.min(turns.order.length - 1, Math.max(0, from + delta));
  return { ...turns, current: next };
}

/** Person um `delta` Plätze verschieben; „dran“ bleibt bei derselben Person */
export function moveTurn(turns: TurnsState, participantId: number, delta: number): TurnsState {
  const i = turns.order.indexOf(participantId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= turns.order.length) return turns;
  const order = [...turns.order];
  [order[i], order[j]] = [order[j]!, order[i]!];
  const currentId = turns.current === null ? null : turns.order[turns.current];
  return { ...turns, order, current: currentId === null || currentId === undefined ? turns.current : order.indexOf(currentId) };
}

/** Reihum im Steuerpult */
export interface TurnsHostView {
  order: { id: number; name: string; online: boolean }[];
  current: number | null;
  shown: boolean;
  /** Personen mit Namen, die noch nicht in der Reihenfolge stehen */
  missing: number;
}

/** Reihum auf dem Beamer: nur Namen */
export interface TurnsDisplayView {
  names: string[];
  current: number | null;
  shown: boolean;
}

/** Reihum auf dem eigenen Handy */
export interface MyTurnView {
  /** Eigene Position (0-basiert) und Länge der Runde */
  position: number;
  of: number;
  /** Wer gerade dran ist (null = noch niemand) */
  current: number | null;
}
