import {
  fillTeams,
  makeTeams,
  type HostCommand,
  type ParticipantTeam,
  type ResponsePayloads,
  type RunState,
  type TeamMember,
  type TeamPerson,
  type TeamsView,
} from '@slides/shared';
import { randomBytes } from 'node:crypto';
import { exec, json, query, type Conn } from './db.ts';
import { CommandError } from './errors.ts';
import type { Snapshot } from './snapshot.ts';

/**
 * Gruppen bilden: Eingeteilt werden alle Personen mit Namen; die Kennzeichnung
 * (z. B. Rolle) kommt aus ihrer Antwort auf die Folie. Die Einteilung liegt in
 * `RunState.teams[slideId]` – ein Neustart verliert also nichts.
 */

export type TeamsCommand = Extract<HostCommand, { action: 'teams-make' | 'teams-fill' | 'teams-move' | 'teams-clear' | 'teams-add' }>;

export const isTeamsCommand = (cmd: HostCommand): cmd is TeamsCommand => cmd.action.startsWith('teams-');

export const teamName = (index: number) => `Gruppe ${index + 1}`;

async function loadPeople(db: Conn, runId: number, slideId: number): Promise<TeamPerson[]> {
  const rows = await query<{ id: number; payload: string | null }>(
    db,
    `SELECT p.id, r.payload FROM participants p
       LEFT JOIN responses r ON r.participant_id = p.id AND r.slide_id = ? AND r.round = 1
      WHERE p.run_id = ? AND p.name IS NOT NULL ORDER BY p.id`,
    [slideId, runId],
  );
  return rows.map((r) => ({ id: r.id, tag: r.payload ? json<ResponsePayloads['teams']>(r.payload).tag : null }));
}

/** Neuer Zustand nach einem Gruppen-Befehl (braucht Personen und Kennzeichnungen aus der Datenbank). */
export async function applyTeamsCommand(db: Conn, runId: number, state: RunState, cmd: TeamsCommand): Promise<RunState> {
  const next: RunState = structuredClone(state);
  const teams = { ...next.teams };
  const key = String(cmd.slideId);
  const current = teams[key] ?? [];
  switch (cmd.action) {
    case 'teams-make': {
      const people = await loadPeople(db, runId, cmd.slideId);
      if (people.length === 0) throw new CommandError('Noch niemand hat einen Namen eingegeben');
      teams[key] = makeTeams(people, { mode: cmd.mode, n: cmd.n, mix: cmd.mix });
      break;
    }
    case 'teams-fill': {
      if (current.length === 0) throw new CommandError('Erst Gruppen bilden');
      const people = await loadPeople(db, runId, cmd.slideId);
      const assigned = new Set(current.flat());
      const tags = new Map(people.map((p) => [p.id, p.tag]));
      teams[key] = fillTeams(
        current,
        people.filter((p) => !assigned.has(p.id)),
        (id) => tags.get(id) ?? null,
      );
      break;
    }
    case 'teams-move': {
      if (cmd.team !== null && cmd.team >= current.length) throw new CommandError('Unbekannte Gruppe');
      const without = current.map((t) => t.filter((id) => id !== cmd.participantId));
      if (cmd.team !== null) without[cmd.team]!.push(cmd.participantId);
      teams[key] = without;
      break;
    }
    case 'teams-clear':
      delete teams[key];
      break;
    case 'teams-add': {
      // Ohne Gerät: eigener Eintrag mit zufälligem Token, das nie jemand erhält
      const result = await exec(db, 'INSERT INTO participants (run_id, token, name) VALUES (?, ?, ?)', [
        runId,
        randomBytes(24).toString('base64url'),
        cmd.name,
      ]);
      const id = result.insertId;
      if (cmd.tag !== null) {
        await exec(db, 'INSERT INTO responses (run_id, slide_id, participant_id, payload) VALUES (?, ?, ?, ?)', [
          runId,
          cmd.slideId,
          id,
          JSON.stringify({ tag: cmd.tag }),
        ]);
      }
      if (current.length > 0) {
        const people = await loadPeople(db, runId, cmd.slideId);
        const tags = new Map(people.map((p) => [p.id, p.tag]));
        teams[key] = fillTeams(current, [{ id, tag: cmd.tag }], (pid) => tags.get(pid) ?? null);
      }
      break;
    }
  }
  next.teams = teams;
  return next;
}

/** Stand der aktuellen „Gruppen bilden“-Folie für Beamer (ohne IDs) und Steuerpult (mit IDs). */
export function teamsView(snap: Snapshot, withIds: boolean): TeamsView | null {
  const slide = snap.current;
  if (slide?.type !== 'teams') return null;
  const tags = new Map(snap.responses.map((r) => [r.participantId, (r.payload as ResponsePayloads['teams']).tag]));
  const member = (id: number): TeamMember => ({ ...(withIds && { id }), name: snap.names.get(id)!, tag: tags.get(id) ?? null });
  const assigned = snap.run.state.teams?.[slide.id] ?? [];
  const inTeam = new Set(assigned.flat());
  const byName = (a: TeamMember, b: TeamMember) => a.name.localeCompare(b.name, 'de');
  return {
    groups: assigned.map((ids, i) => ({
      name: teamName(i),
      members: ids
        .filter((id) => snap.names.has(id))
        .map(member)
        .sort(byName),
    })),
    unassigned: [...snap.names.keys()]
      .filter((id) => !inTeam.has(id))
      .map(member)
      .sort(byName),
    unnamed: Math.max(0, snap.participantTotal - snap.names.size),
  };
}

/**
 * Eigene Gruppe einer Person: aus der letzten Einteilung bis zur aktuellen Folie
 * (in Folienreihenfolge). So gelten Paare aus Schritt 2, bis eine spätere Folie
 * neu einteilt – auch wenn danach zurückgeblättert wird, zählt die Position.
 */
export function participantTeam(snap: Snapshot, participantId: number): ParticipantTeam | null {
  const teams = snap.run.state.teams;
  if (!teams || snap.index < 0) return null;
  for (let i = snap.index; i >= 0; i--) {
    const slide = snap.slides[i]!;
    if (slide.type !== 'teams') continue;
    const assigned = teams[slide.id];
    if (!assigned?.length) continue;
    const index = assigned.findIndex((t) => t.includes(participantId));
    if (index < 0) return null;
    return {
      slideId: slide.id,
      name: teamName(index),
      members: assigned[index]!.filter((id) => id !== participantId && snap.names.has(id)).map((id) => snap.names.get(id)!),
    };
  }
  return null;
}
