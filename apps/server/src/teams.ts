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

/**
 * Kennzeichnung je Person für eine „Gruppen bilden“-Folie: die Antwort auf dieser
 * Folie, sonst die letzte auf einer anderen Gruppen-Folie mit denselben
 * Kennzeichnungen – so muss niemand seine Rolle zweimal angeben.
 */
export async function loadTeamTags(db: Conn, runId: number, slideId: number): Promise<Map<number, number | null>> {
  const rows = await query<{ participant_id: number; slide_id: number; payload: string; config: string }>(
    db,
    `SELECT r.participant_id, r.slide_id, r.payload, s.config FROM responses r JOIN slides s ON s.id = r.slide_id
      WHERE r.run_id = ? AND s.type = 'teams' ORDER BY r.slide_id = ?, r.updated_at, r.id`,
    [runId, slideId],
  );
  const own = rows.find((r) => r.slide_id === slideId);
  const current = own ? json<{ tags: string[] }>(own.config).tags : null;
  const tagsOf = await query<{ config: string }>(db, 'SELECT config FROM slides WHERE id = ?', [slideId]);
  const wanted = JSON.stringify(current ?? (tagsOf[0] ? json<{ tags: string[] }>(tagsOf[0].config).tags : []));
  const tags = new Map<number, number | null>();
  // Spätere Zeilen überschreiben frühere; die eigene Folie kommt zuletzt
  for (const r of rows) {
    if (r.slide_id !== slideId && JSON.stringify(json<{ tags: string[] }>(r.config).tags) !== wanted) continue;
    tags.set(r.participant_id, json<ResponsePayloads['teams']>(r.payload).tag);
  }
  return tags;
}

async function loadPeople(db: Conn, runId: number, slideId: number): Promise<TeamPerson[]> {
  const rows = await query<{ id: number }>(db, 'SELECT id FROM participants WHERE run_id = ? AND name IS NOT NULL ORDER BY id', [runId]);
  const tags = await loadTeamTags(db, runId, slideId);
  return rows.map((r) => ({ id: r.id, tag: tags.get(r.id) ?? null }));
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
      teams[key] = makeTeams(people, { mode: cmd.mode, n: cmd.n, mix: cmd.mix, pools: cmd.pools });
      next.teamPools = { ...next.teamPools };
      if (cmd.pools) next.teamPools[key] = cmd.pools;
      else delete next.teamPools[key];
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
        Math.random,
        next.teamPools?.[key],
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
      if (next.teamPools) {
        next.teamPools = { ...next.teamPools };
        delete next.teamPools[key];
      }
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
        teams[key] = fillTeams(current, [{ id, tag: cmd.tag }], (pid) => tags.get(pid) ?? null, Math.random, next.teamPools?.[key]);
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
  const tags = snap.teamTags;
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
