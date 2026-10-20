import { randomInt } from 'node:crypto';
import {
  clearSignals,
  drawPick,
  emptyPicker,
  ownSignals,
  pickCandidates,
  setSignal,
  signalInput,
  signalsView,
  teamsAt,
  type HostCommand,
  type ParticipantView,
  type PickerView,
  type PresenceView,
  type RunState,
  type Slide,
  type SignalsView,
} from '@slides/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { exec, query, type Conn, type Db } from './db.ts';
import { CommandError } from './errors.ts';
import type { LiveHub } from './live.ts';
import { PARTICIPANT_HEADER, participantByToken } from './participants.ts';
import { loadRunState, withRunLock } from './runs.ts';
import type { Snapshot } from './snapshot.ts';
import { teamName } from './teams.ts';

/**
 * Werkzeuge für die Moderation: Handzeichen der Teilnehmenden, Zufallsauswahl
 * („Wer startet?“) und Anwesenheit. Zustand in `RunState.signals` und
 * `RunState.picker`; wer verbunden ist, weiß nur der WebSocket-Hub (live.ts).
 */

export type ModerationCommand = Extract<HostCommand, { action: 'signals-clear' | 'pick-draw' | 'pick-show' | 'pick-hide' | 'pick-reset' }>;

export const isModerationCommand = (cmd: HostCommand): cmd is ModerationCommand =>
  cmd.action === 'signals-clear' || cmd.action.startsWith('pick-');

async function namedIds(db: Conn, runId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(db, 'SELECT id FROM participants WHERE run_id = ? AND name IS NOT NULL ORDER BY id', [runId]);
  return rows.map((r) => r.id);
}

/** Neuer Zustand nach einem Moderationsbefehl. `random(n)` ∈ [0, n) – auf dem Server kryptografisch. */
export async function applyModerationCommand(
  db: Conn,
  runId: number,
  state: RunState,
  slides: Slide[],
  cmd: ModerationCommand,
  now = Date.now(),
  random: (n: number) => number = (n) => randomInt(0, n),
): Promise<RunState> {
  const picker = state.picker ?? emptyPicker();
  switch (cmd.action) {
    case 'signals-clear':
      return clearSignals(state, cmd.kind, now);
    case 'pick-draw': {
      let group: number[] | null = null;
      if (cmd.team !== null) {
        const index = slides.findIndex((s) => s.id === state.slideId);
        const teams = teamsAt(slides, index, state.teams);
        group = teams?.groups[cmd.team] ?? null;
        if (!group) throw new CommandError('Diese Gruppe gibt es nicht (mehr)');
      }
      const named = await namedIds(db, runId);
      if (named.length === 0) throw new CommandError('Noch niemand hat einen Namen eingegeben');
      const next = drawPick(picker, pickCandidates(named, picker.drawn, group), random);
      if (!next) throw new CommandError(group ? 'In dieser Gruppe wurden schon alle gezogen' : 'Es wurden schon alle gezogen');
      return { ...state, picker: next };
    }
    case 'pick-show':
      if (picker.current === null) throw new CommandError('Erst jemanden ziehen');
      return { ...state, picker: { ...picker, shown: true } };
    case 'pick-hide':
      return { ...state, picker: { ...picker, shown: false } };
    case 'pick-reset':
      return { ...state, picker: emptyPicker() };
  }
}

/* ───────────── Ansichten ───────────── */

/** Gezogener Name, solange er noch einen Namen hat */
function pickedName(snap: Snapshot): string | null {
  const id = snap.run.state.picker?.current;
  return id == null ? null : (snap.names.get(id) ?? null);
}

export function displayPicked(snap: Snapshot): string | null {
  return snap.run.state.picker?.shown ? pickedName(snap) : null;
}

export function participantModeration(snap: Snapshot, participantId: number): Pick<ParticipantView, 'signals' | 'picked'> {
  return {
    signals: ownSignals(snap.run.state.signals, participantId, snap.now),
    // Erst wenn der Name auf dem Beamer steht – so kann die Moderation auch still ziehen
    picked: !!snap.run.state.picker?.shown && snap.run.state.picker.current === participantId,
  };
}

export function hostSignals(snap: Snapshot): SignalsView {
  return signalsView(snap.run.state.signals, snap.now, snap.names);
}

export function pickerView(snap: Snapshot): PickerView {
  const picker = snap.run.state.picker ?? emptyPicker();
  const named = [...snap.names.keys()];
  const teams = teamsAt(snap.slides, snap.index, snap.run.state.teams);
  return {
    current: pickedName(snap),
    shown: picker.shown && pickedName(snap) !== null,
    drawn: picker.drawn.length,
    remaining: pickCandidates(named, picker.drawn).length,
    groups: (teams?.groups ?? []).map((g, i) => ({ name: teamName(i), remaining: pickCandidates(named, picker.drawn, g).length })),
  };
}

/**
 * Anwesenheit: Namen und verbunden/getrennt – ohne IDs, die braucht das
 * Steuerpult nicht (die Zufallsauswahl läuft auf dem Server).
 */
export function presenceView(snap: Snapshot, online: ReadonlySet<number>): PresenceView {
  const people = [...snap.names].map(([id, name]) => ({ name, online: online.has(id) }));
  people.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'de'));
  let unnamedOnline = 0;
  for (const id of online) if (!snap.names.has(id)) unnamedOnline++;
  return {
    people,
    unnamed: { online: unnamedOnline, total: Math.max(0, snap.participantTotal - snap.names.size) },
  };
}

/* ───────────── Teilnehmer-Route ───────────── */

export function moderationRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  // Viele sitzen hinter derselben Firmen-IP: Limit pro Token
  const perParticipant = {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => String(req.headers[PARTICIPANT_HEADER] ?? req.ip),
      },
    },
  };

  /** Handzeichen setzen oder zurücknehmen – jederzeit, unabhängig von der Folie */
  app.post('/api/p/signal', perParticipant, async (request, reply) => {
    const header = request.headers[PARTICIPANT_HEADER];
    const p = await participantByToken(db, typeof header === 'string' ? header : undefined);
    if (!p) return reply.code(401).send({ error: 'Bitte erneut beitreten – die Sitzung ist abgelaufen' });
    const parsed = signalInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültiges Signal' });
    const { kind, active } = parsed.data;
    await withRunLock(p.runId, async () => {
      const run = await loadRunState(db, p.runId);
      if (!run || run.ended) return;
      const next = setSignal(run.state, kind, p.id, active, Date.now());
      await exec(db, 'UPDATE runs SET state = ? WHERE id = ?', [JSON.stringify(next), p.runId]);
    });
    live.notify(p.runId);
    return { ok: true };
  });
}
