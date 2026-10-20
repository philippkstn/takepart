import {
  breakoutAssignment,
  doneTeams,
  makeCallback,
  teamIndexOf,
  teamLabel,
  teamVisibleCards,
  toggleTeamDone,
  type BreakoutView,
  type HostCommand,
  type MyTeamView,
  type RunState,
  type Slide,
  type TeamAssignment,
} from '@slides/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { BoardSlide } from './board.ts';
import { exec, type Db } from './db.ts';
import { CommandError } from './errors.ts';
import type { LiveHub } from './live.ts';
import { PARTICIPANT_HEADER, participantByToken } from './participants.ts';
import { loadRunState, withRunLock } from './runs.ts';
import { loadSlides, type Snapshot, type SnapshotPost } from './snapshot.ts';

/**
 * Breakout: Gruppen aus „Gruppen bilden“ sammeln getrennt Karten (Kartenwand-Folie
 * mit `perTeam`), melden sich fertig, und die Moderation ruft alle zurück ins
 * Plenum. Alles liegt in der Datenbank (`posts.team`, `RunState.teamDone`,
 * `RunState.callback`).
 */

/** Einteilung, nach der die aktuelle Folie gruppenweise sammelt – sonst null */
export function currentAssignment(snap: Snapshot): TeamAssignment | null {
  const slide = snap.current;
  if (slide?.type !== 'board') return null;
  return breakoutAssignment(snap.slides, slide, snap.run.state.teams);
}

/** Stand je Arbeitsgruppe für Beamer und Steuerpult */
export function breakoutView(snap: Snapshot): BreakoutView | null {
  const assignment = currentAssignment(snap);
  if (!assignment || !snap.current) return null;
  const done = new Set(doneTeams(snap.run.state.teamDone?.[snap.current.id], assignment.teams.length));
  const teams = assignment.teams.map((ids, index) => ({
    index,
    name: teamLabel(index),
    cards: snap.posts.filter((p) => p.team === index && p.status === 'visible').length,
    members: ids.length,
    done: done.has(index),
  }));
  return { teams, done: done.size };
}

/** Eigene Arbeitsgruppe einer Person auf der aktuellen Folie */
export function myTeamView(snap: Snapshot, participantId: number): MyTeamView | null {
  const assignment = currentAssignment(snap);
  const index = teamIndexOf(assignment, participantId);
  if (!assignment || index === null || !snap.current) return null;
  return {
    index,
    name: teamLabel(index),
    done: doneTeams(snap.run.state.teamDone?.[snap.current.id], assignment.teams.length).includes(index),
    members: assignment.teams[index]!.filter((id) => id !== participantId && snap.names.has(id)).map((id) => snap.names.get(id)!),
  };
}

/** Karten, die eine Person beim gruppenweisen Sammeln sieht – nie die fremder Gruppen */
export function breakoutPosts(snap: Snapshot, participantId: number): SnapshotPost[] | null {
  const assignment = currentAssignment(snap);
  if (!assignment) return null;
  return teamVisibleCards(snap.posts, participantId, teamIndexOf(assignment, participantId));
}

/** Arbeitsgruppe für eine neue Karte (null: Folie sammelt nicht gruppenweise oder Person ohne Gruppe) */
export function teamForNewCard(slides: Slide[], slide: BoardSlide, state: RunState, participantId: number): number | null {
  return teamIndexOf(breakoutAssignment(slides, slide, state.teams), participantId);
}

export type BreakoutCommand = Extract<HostCommand, { action: 'team-done' | 'callback' }>;

/** Host-Befehle für Fertig-Meldungen und Sammelruf (verändert `s`) */
export function applyBreakoutCommand(s: RunState, cmd: BreakoutCommand, now: number) {
  if (cmd.action === 'callback') {
    s.callback = cmd.callback ? makeCallback(cmd.callback.text, cmd.callback.minutes, now) : null;
    return;
  }
  s.teamDone = { ...s.teamDone, [cmd.slideId]: toggleTeamDone(s.teamDone?.[cmd.slideId], cmd.team, cmd.done) };
}

export function breakoutRoutes(app: FastifyInstance, db: Db, live: LiveHub) {
  const limit = {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => String(req.headers[PARTICIPANT_HEADER] ?? req.ip),
      },
    },
  };

  /** „Unsere Gruppe ist fertig“ – jede Person der Gruppe kann es setzen und zurücknehmen */
  app.post('/api/p/team-done', limit, async (request, reply) => {
    const header = request.headers[PARTICIPANT_HEADER];
    const p = await participantByToken(db, typeof header === 'string' ? header : undefined);
    if (!p) return reply.code(401).send({ error: 'Bitte erneut beitreten – die Sitzung ist abgelaufen' });
    const body = z.object({ slideId: z.number().int(), done: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Eingabe' });
    const { slideId, done } = body.data;
    try {
      await withRunLock(p.runId, async () => {
        const run = await loadRunState(db, p.runId);
        if (!run || run.ended) throw new CommandError('Diese Präsentation ist beendet');
        if (run.state.slideId !== slideId) throw new CommandError('Diese Folie ist nicht mehr aktiv');
        const slides = await loadSlides(db, run.presentationId);
        const slide = slides.find((s) => s.id === slideId);
        if (slide?.type !== 'board') throw new CommandError('Hier wird nicht in Gruppen gearbeitet');
        const assignment = breakoutAssignment(slides, slide, run.state.teams);
        if (!assignment) throw new CommandError('Hier wird nicht in Gruppen gearbeitet');
        const team = teamIndexOf(assignment, p.id);
        if (team === null) throw new CommandError('Du bist keiner Gruppe zugeteilt');
        const state: RunState = {
          ...run.state,
          teamDone: { ...run.state.teamDone, [slideId]: toggleTeamDone(run.state.teamDone?.[slideId], team, done) },
        };
        await exec(db, 'UPDATE runs SET state = ? WHERE id = ?', [JSON.stringify(state), p.runId]);
      });
    } catch (err) {
      if (err instanceof CommandError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    live.notify(p.runId);
    return { ok: true };
  });
}
