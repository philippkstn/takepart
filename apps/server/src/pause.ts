import {
  pauseVoteInput,
  type DisplayPause,
  type HostCommand,
  type ParticipantPause,
  type PauseStats,
  type PauseVote,
  type RunState,
  type Slide,
} from '@slides/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { json, one, exec, type Db } from './db.ts';
import { CommandError } from './errors.ts';
import type { LiveHub } from './live.ts';
import { withRunLock } from './runs.ts';
import type { Snapshot } from './snapshot.ts';

/**
 * Pausenmodus: Die Moderation startet von jeder Folie aus eine Pause mit Dauer.
 * Beamer und Handys zeigen dann eine Pausenansicht; Teilnehmende melden sich
 * „wieder da“ und beantworten auf Wunsch eine Energie-Frage (1–5).
 *
 * Alles liegt in `runs.state` (`pause`, `pauseVotes`) – keine eigene Tabelle:
 * Rückmeldungen gelten nur für die laufende Pause, werden beim Start geleert
 * und beim Ende verworfen. Auch bei 300 Personen sind das nur wenige KB.
 */

export type PauseCommand = Extract<HostCommand, { action: 'pause-start' | 'pause-extend' | 'pause-end' }>;

/** Pause beenden (beim Blättern, Springen und über „Pause beenden“) */
export function endPause(s: RunState) {
  s.pause = null;
  delete s.pauseVotes;
}

/** Wendet einen Pausen-Befehl auf den (bereits kopierten) Zustand an. */
export function applyPauseCommand(s: RunState, cmd: PauseCommand, now: number) {
  switch (cmd.action) {
    case 'pause-start':
      s.pause = { endsAt: now + cmd.seconds * 1000, seconds: cmd.seconds, question: cmd.question };
      s.pauseVotes = {};
      // Ein Schwarzbild würde die Pausenansicht verdecken
      s.blank = null;
      break;
    case 'pause-extend': {
      if (!s.pause) throw new CommandError('Es läuft keine Pause');
      // Schon abgelaufen: die Verlängerung zählt ab jetzt
      s.pause = { ...s.pause, endsAt: Math.max(s.pause.endsAt, now) + cmd.seconds * 1000, seconds: s.pause.seconds + cmd.seconds };
      break;
    }
    case 'pause-end':
      endPause(s);
      break;
  }
}

/** Pausen-Folie erreicht: Pause mit ihrer voreingestellten Dauer starten */
export function startSlidePause(s: RunState, slide: Slide | undefined, now: number) {
  if (slide?.type !== 'pause') return;
  applyPauseCommand(s, { action: 'pause-start', seconds: slide.config.minutes * 60, question: slide.config.question }, now);
}

/** Rückmeldung einer Person übernehmen (zusammengeführt mit der bisherigen). */
export function applyPauseVote(state: RunState, participantId: number, vote: PauseVote): RunState {
  if (!state.pause) throw new CommandError('Gerade ist keine Pause');
  if (vote.energy !== undefined && !state.pause.question) throw new CommandError('In dieser Pause gibt es keine Energie-Frage');
  const before = state.pauseVotes?.[participantId] ?? {};
  return { ...state, pauseVotes: { ...state.pauseVotes, [participantId]: { ...before, ...vote } } };
}

export function pauseStats(state: RunState, connected: number): PauseStats | null {
  if (!state.pause) return null;
  const energy: PauseStats['energy'] = [0, 0, 0, 0, 0];
  let ready = 0;
  let sum = 0;
  let n = 0;
  for (const vote of Object.values(state.pauseVotes ?? {})) {
    if (vote.ready) ready++;
    if (vote.energy !== undefined && vote.energy >= 1 && vote.energy <= 5) {
      energy[vote.energy - 1]++;
      sum += vote.energy;
      n++;
    }
  }
  return { ready, connected, energy, energyAverage: n > 0 ? sum / n : null };
}

export function participantPause(state: RunState, participantId: number): ParticipantPause | null {
  if (!state.pause) return null;
  return { ...state.pause, vote: state.pauseVotes?.[participantId] ?? null };
}

export function displayPause(snap: Snapshot): DisplayPause | null {
  const { pause } = snap.run.state;
  if (!pause) return null;
  let contributions = 0;
  for (const n of snap.counts.values()) contributions += n;
  return { ...pause, contributions, participants: snap.participantTotal };
}

/** `POST /api/p/pause` – „wieder da“ und Energie, nur während einer Pause. */
export function pauseRoutes(
  app: FastifyInstance,
  db: Db,
  live: LiveHub,
  opts: {
    auth: (request: FastifyRequest, reply: FastifyReply) => Promise<{ id: number; runId: number } | null>;
    rateLimit: object;
  },
) {
  app.post('/api/p/pause', opts.rateLimit, async (request, reply) => {
    const p = await opts.auth(request, reply);
    if (!p) return;
    const parsed = pauseVoteInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültige Angabe' });
    try {
      // Unter der Sperre der Durchführung, sonst überschreiben sich gleichzeitige Rückmeldungen
      await withRunLock(p.runId, async () => {
        const run = await one<{ state: string }>(db, 'SELECT state FROM runs WHERE id = ? AND ended_at IS NULL', [p.runId]);
        if (!run) throw new CommandError('Diese Präsentation ist beendet');
        const next = applyPauseVote(json<RunState>(run.state), p.id, parsed.data);
        await exec(db, 'UPDATE runs SET state = ? WHERE id = ?', [JSON.stringify(next), p.runId]);
      });
    } catch (err) {
      if (err instanceof CommandError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    live.notify(p.runId);
    return { ok: true };
  });
}
