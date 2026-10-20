import { EMPTY_SCHEDULE, isEmptySchedule, schedulePhases, type SlideSchedule } from '@slides/shared';
import { json, query, type Conn } from './db.ts';

/**
 * Ablaufplan je Folie (Spalten `planned_minutes`, `phases`, `auto_countdown`).
 * Gehört nicht zum `Slide`-Typ: erreicht nur Editor und Host, nie Beamer oder Publikum.
 */

export interface ScheduleRow {
  planned_minutes: number | null;
  phases: string | null;
  auto_countdown: number;
}

export const SCHEDULE_COLUMNS = 'planned_minutes, phases, auto_countdown';

export function scheduleFromRow(row: ScheduleRow): SlideSchedule {
  let phases: SlideSchedule['phases'] = [];
  if (row.phases) {
    const parsed = schedulePhases.safeParse(json(row.phases));
    if (parsed.success) phases = parsed.data;
  }
  return { plannedMinutes: row.planned_minutes ?? null, phases, autoCountdown: !!row.auto_countdown };
}

/** Werte für die drei Spalten (in der Reihenfolge von SCHEDULE_COLUMNS) */
export function scheduleValues(schedule: SlideSchedule = EMPTY_SCHEDULE): [number | null, string | null, number] {
  return [schedule.plannedMinutes, schedule.phases.length > 0 ? JSON.stringify(schedule.phases) : null, schedule.autoCountdown ? 1 : 0];
}

/** Ablaufplan aller Folien einer Präsentation (nur Folien mit Angaben) */
export async function loadSchedule(db: Conn, presentationId: number): Promise<Map<number, SlideSchedule>> {
  const rows = await query<ScheduleRow & { id: number }>(
    db,
    `SELECT id, ${SCHEDULE_COLUMNS} FROM slides
      WHERE presentation_id = ? AND (planned_minutes IS NOT NULL OR phases IS NOT NULL OR auto_countdown = 1)`,
    [presentationId],
  );
  const out = new Map<number, SlideSchedule>();
  for (const r of rows) {
    const s = scheduleFromRow(r);
    if (!isEmptySchedule(s)) out.set(r.id, s);
  }
  return out;
}
