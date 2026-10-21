import { describe, expect, it } from 'vitest';
import {
  currentPhase,
  extendCountdown,
  skipPhase,
  formatPlanDelta,
  planStatus,
  scheduleCountdown,
  schedulePhases,
  slidePlannedMinutes,
  type Countdown,
} from './index.ts';

const MIN = 60_000;
// Paararbeit: 15 Min. Gespräch – Rollenwechsel 15 Min. – 10 Min. allein Karten schreiben
const pairWork = {
  plannedMinutes: null,
  autoCountdown: false,
  phases: [
    { label: 'Gespräch', minutes: 15 },
    { label: 'Rollenwechsel', minutes: 15 },
    { label: '', minutes: 10 },
  ],
};

describe('Phasen-Countdown', () => {
  const start = 1_000_000;
  const cd = scheduleCountdown(pairWork, start)!;

  it('baut den Countdown aus den Phasen (Summe, Bezeichnung „Phase n“ als Ersatz)', () => {
    expect(cd.seconds).toBe(40 * 60);
    expect(cd.endsAt).toBe(start + 40 * MIN);
    expect(cd.phases!.map((p) => p.label)).toEqual(['Gespräch', 'Rollenwechsel', 'Phase 3']);
  });

  it('leitet die aktuelle Phase aus der Zeit ab', () => {
    expect(currentPhase(cd, start)).toMatchObject({ index: 0, label: 'Gespräch', endsAt: start + 15 * MIN, done: false });
    expect(currentPhase(cd, start + 15 * MIN - 1)!.index).toBe(0);
    // An der Grenze gilt schon die nächste Phase
    const second = currentPhase(cd, start + 15 * MIN)!;
    expect(second).toMatchObject({ index: 1, count: 3, label: 'Rollenwechsel', endsAt: start + 30 * MIN, seconds: 900 });
    expect(second.next).toEqual({ label: 'Phase 3', seconds: 600 });
    expect(currentPhase(cd, start + 35 * MIN)).toMatchObject({ index: 2, next: null, done: false });
    // Nach Ablauf: letzte Phase, erledigt
    expect(currentPhase(cd, start + 50 * MIN)).toMatchObject({ index: 2, done: true, endsAt: start + 40 * MIN });
  });

  it('ohne Phasen gibt es keine Phase, Soll-Dauer startet einen einfachen Countdown', () => {
    const simple = scheduleCountdown({ plannedMinutes: 5, phases: [], autoCountdown: true }, start)!;
    expect(simple).toEqual({ endsAt: start + 5 * MIN, seconds: 300 });
    expect(currentPhase(simple, start)).toBeNull();
    expect(scheduleCountdown({ plannedMinutes: null, phases: [], autoCountdown: true }, start)).toBeNull();
  });

  it('verlängert die aktuelle Phase', () => {
    const longer = extendCountdown(cd, 60, start + 20 * MIN);
    expect(longer.seconds).toBe(41 * 60);
    expect(longer.phases!.map((p) => p.seconds)).toEqual([900, 960, 600]);
    expect(currentPhase(longer, start + 30 * MIN)!.index).toBe(1);
    expect(currentPhase(longer, start + 31 * MIN)!.index).toBe(2);
  });

  it('springt zur nächsten Phase und beendet in der letzten den Countdown', () => {
    // 5 Minuten in Phase 1 (15 Min.): 10 Minuten Rest werden übersprungen
    const skipped = skipPhase(cd, start + 5 * MIN);
    expect(skipped.phases).toEqual(cd.phases);
    expect(skipped.endsAt).toBe(cd.endsAt - 10 * MIN);
    expect(currentPhase(skipped, start + 5 * MIN)).toMatchObject({ index: 1, endsAt: start + 20 * MIN });
    const last = skipPhase(skipPhase(skipped, start + 5 * MIN), start + 5 * MIN);
    expect(currentPhase(last, start + 5 * MIN)).toMatchObject({ index: 2, done: true });
    expect(last.endsAt).toBe(start + 5 * MIN);
  });

  it('verlängert einen abgelaufenen Countdown ab jetzt', () => {
    const simple: Countdown = { endsAt: start, seconds: 60 };
    const later = extendCountdown(simple, 60, start + 30_000);
    expect(later.endsAt).toBe(start + 90_000);
  });

  it('prüft Phasen: höchstens 8, ganze Minuten, Bezeichnung höchstens 60 Zeichen', () => {
    expect(schedulePhases.safeParse(Array.from({ length: 9 }, () => ({ label: 'x', minutes: 1 }))).success).toBe(false);
    expect(schedulePhases.safeParse([{ label: 'x', minutes: 1.5 }]).success).toBe(false);
    expect(schedulePhases.safeParse([{ label: 'x'.repeat(61), minutes: 1 }]).success).toBe(false);
    expect(schedulePhases.safeParse(pairWork.phases).success).toBe(true);
  });
});

describe('Ablaufplan', () => {
  const planned = [5, null, 10, 20];

  it('vor, im und hinter dem Plan', () => {
    // Folie 3 (Index 2) beginnt laut Plan nach 5 Min. und endet nach 15 Min.
    expect(planStatus(planned, 2, 2 * MIN)).toEqual({ before: 5, through: 15, delta: 3 });
    expect(planStatus(planned, 2, 10 * MIN).delta).toBe(0);
    expect(planStatus(planned, 2, 23.5 * MIN).delta).toBe(-8);
    expect(formatPlanDelta(3)).toBe('3 Min. vor Plan');
    expect(formatPlanDelta(-8)).toBe('8 Min. hinter Plan');
    expect(formatPlanDelta(0)).toBe('im Plan');
  });

  it('geplante Dauer einer Folie: Soll-Dauer, sonst Summe der Phasen', () => {
    expect(slidePlannedMinutes(pairWork)).toBe(40);
    expect(slidePlannedMinutes({ ...pairWork, plannedMinutes: 45 })).toBe(45);
    expect(slidePlannedMinutes(undefined)).toBeNull();
  });
});
