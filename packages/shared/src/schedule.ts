import { z } from 'zod';
import type { Countdown, CountdownPhase } from './state.ts';

/* ───────────── Soll-Zeiten, Ablaufplan und Phasen-Countdown ─────────────
 * Je Folie optional: geplante Dauer, eine Phasenfolge für den Countdown und ob
 * der Countdown beim Betreten der Folie startet. Liegt in eigenen Spalten an
 * `slides` (nicht im typabhängigen config) und erreicht nur Editor und Host.
 */

export const MAX_PHASES = 8;
export const MAX_PLANNED_MINUTES = 600;
/** Höchstdauer eines Countdowns (wie beim einfachen Countdown) */
export const MAX_COUNTDOWN_SECONDS = 4 * 3600;

export const schedulePhase = z.object({
  /** Leer erlaubt – dann heißt sie „Phase n“ */
  label: z.string().trim().max(60, 'Höchstens 60 Zeichen'),
  minutes: z.number().int('Bitte ganze Minuten').min(1, 'Mindestens 1 Minute').max(240, 'Höchstens 240 Minuten'),
});
export type SchedulePhase = z.infer<typeof schedulePhase>;

export const schedulePhases = z
  .array(schedulePhase)
  .max(MAX_PHASES, `Höchstens ${MAX_PHASES} Phasen`)
  .refine((phases) => phases.reduce((sum, p) => sum + p.minutes, 0) * 60 <= MAX_COUNTDOWN_SECONDS, 'Höchstens 4 Stunden insgesamt');

export const plannedMinutes = z.number().int().min(1).max(MAX_PLANNED_MINUTES).nullable();

/** Änderungen über PATCH /api/slides/:id – alle Felder optional */
export const scheduleInput = z.object({
  plannedMinutes: plannedMinutes.optional(),
  phases: schedulePhases.optional(),
  autoCountdown: z.boolean().optional(),
});

export interface SlideSchedule {
  plannedMinutes: number | null;
  phases: SchedulePhase[];
  autoCountdown: boolean;
}

export const EMPTY_SCHEDULE: SlideSchedule = { plannedMinutes: null, phases: [], autoCountdown: false };

export function isEmptySchedule(s: SlideSchedule): boolean {
  return s.plannedMinutes === null && s.phases.length === 0 && !s.autoCountdown;
}

export function phaseLabel(label: string, index: number): string {
  return label.trim() || `Phase ${index + 1}`;
}

/**
 * Countdown, den eine Folie startet: ihre Phasen (falls vorhanden), sonst ihre
 * Soll-Dauer, sonst keiner.
 */
export function scheduleCountdown(schedule: SlideSchedule | undefined, now: number): Countdown | null {
  if (!schedule) return null;
  if (schedule.phases.length > 0) {
    const phases: CountdownPhase[] = schedule.phases.map((p, i) => ({ label: phaseLabel(p.label, i), seconds: p.minutes * 60 }));
    const seconds = Math.min(
      MAX_COUNTDOWN_SECONDS,
      phases.reduce((sum, p) => sum + p.seconds, 0),
    );
    return { endsAt: now + seconds * 1000, seconds, phases };
  }
  if (schedule.plannedMinutes !== null) {
    const seconds = Math.min(MAX_COUNTDOWN_SECONDS, schedule.plannedMinutes * 60);
    return { endsAt: now + seconds * 1000, seconds };
  }
  return null;
}

export interface PhaseInfo {
  /** 0-basiert; nach Ablauf die letzte Phase */
  index: number;
  count: number;
  label: string;
  /** Ende der aktuellen Phase (Serverzeit, ms) */
  endsAt: number;
  /** Dauer der aktuellen Phase in Sekunden – für den Fortschritt */
  seconds: number;
  next: CountdownPhase | null;
  /** Alle Phasen sind abgelaufen */
  done: boolean;
}

/**
 * Aktuelle Phase eines Countdowns – rein aus Startzeit (`endsAt - seconds`) und
 * Phasendauern berechnet, damit kein Server-Timer laufen muss. An einer Grenze
 * gilt schon die nächste Phase. Ohne Phasen: null.
 */
export function currentPhase(countdown: Countdown | null | undefined, now: number): PhaseInfo | null {
  const phases = countdown?.phases;
  if (!countdown || !phases || phases.length === 0) return null;
  let end = countdown.endsAt - countdown.seconds * 1000;
  for (const [index, phase] of phases.entries()) {
    end += phase.seconds * 1000;
    const last = index === phases.length - 1;
    if (now < end || last) {
      return {
        index,
        count: phases.length,
        label: phase.label,
        endsAt: last ? countdown.endsAt : end,
        seconds: phase.seconds,
        next: phases[index + 1] ?? null,
        done: now >= countdown.endsAt,
      };
    }
  }
  return null;
}

/**
 * Countdown um `seconds` verlängern – bei Phasen die aktuelle Phase. Ist er schon
 * abgelaufen, endet er `seconds` nach jetzt.
 */
export function extendCountdown(countdown: Countdown, seconds: number, now: number): Countdown {
  const overdue = Math.max(0, Math.ceil((now - countdown.endsAt) / 1000));
  const delta = Math.min(seconds + overdue, Math.max(0, MAX_COUNTDOWN_SECONDS - countdown.seconds));
  const next: Countdown = { ...countdown, endsAt: countdown.endsAt + delta * 1000, seconds: countdown.seconds + delta };
  if (countdown.phases && countdown.phases.length > 0) {
    const index = currentPhase(countdown, now)!.index;
    next.phases = countdown.phases.map((p, i) => (i === index ? { ...p, seconds: p.seconds + delta } : p));
  }
  return next;
}

/* ───────────── Ablaufplan: Soll/Ist ───────────── */

export interface PlanStatus {
  /** Geplante Minuten aller Folien vor der aktuellen */
  before: number;
  /** Geplante Minuten bis einschließlich der aktuellen Folie */
  through: number;
  /** Positiv: vor dem Plan, negativ: hinter dem Plan (ganze Minuten) */
  delta: number;
}

/**
 * Soll/Ist-Abgleich. Wer vor dem geplanten Beginn der aktuellen Folie dort ist,
 * liegt vor dem Plan; wer länger braucht als bis zu ihrem geplanten Ende
 * (Summe bis einschließlich), dahinter; dazwischen im Plan.
 */
export function planStatus(planned: (number | null)[], currentIndex: number, elapsedMs: number): PlanStatus {
  const sum = (to: number) => planned.slice(0, Math.max(0, to)).reduce<number>((acc, m) => acc + (m ?? 0), 0);
  const before = sum(currentIndex);
  const through = currentIndex >= 0 ? sum(currentIndex + 1) : 0;
  const elapsed = elapsedMs / 60000;
  let delta = 0;
  if (elapsed < before) delta = Math.floor(before - elapsed);
  else if (elapsed > through) delta = -Math.floor(elapsed - through);
  return { before, through, delta };
}

export function formatPlanDelta(delta: number): string {
  if (delta === 0) return 'im Plan';
  return `${Math.abs(delta)} Min. ${delta > 0 ? 'vor' : 'hinter'} Plan`;
}

/** Summe der geplanten Minuten */
export function plannedTotal(planned: (number | null)[]): number {
  return planned.reduce<number>((acc, m) => acc + (m ?? 0), 0);
}

/** Geplante Dauer einer Folie: Soll-Dauer, sonst Summe ihrer Phasen */
export function slidePlannedMinutes(schedule: SlideSchedule | undefined): number | null {
  if (!schedule) return null;
  if (schedule.plannedMinutes !== null) return schedule.plannedMinutes;
  const phases = schedule.phases.reduce((acc, p) => acc + p.minutes, 0);
  return phases > 0 ? phases : null;
}
