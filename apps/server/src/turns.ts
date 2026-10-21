import { randomBytes, randomInt } from 'node:crypto';
import {
  appendTurns,
  liveTurns,
  moveTurn,
  myTurn,
  orderByFirstCard,
  removeTurn,
  shuffleTurns,
  stepTurn,
  type HostCommand,
  type MyTurnView,
  type RunState,
  type Slide,
  type TurnsDisplayView,
  type TurnsHostView,
  type TurnsState,
} from '@slides/shared';
import { exec, query, type Conn } from './db.ts';
import { CommandError } from './errors.ts';
import type { Snapshot } from './snapshot.ts';

/**
 * Reihum: eine feste Redereihenfolge für die ganze Durchführung (Erwartungsrunde,
 * Karten einbringen, Feedback in derselben Reihenfolge). Zustand in
 * `RunState.turns` (Teilnehmer-IDs); gelöschte oder unbekannte IDs fallen beim
 * Lesen heraus (`liveTurns`). Folienwechsel lassen Reihenfolge und „dran“ bewusst stehen.
 */

export type TurnsCommand = Extract<HostCommand, { action: `turns-${string}` }>;

export const isTurnsCommand = (cmd: HostCommand): cmd is TurnsCommand => cmd.action.startsWith('turns-');

/** Personen mit Namen in Beitrittsreihenfolge (Testteilnehmende im Probelauf zählen mit) */
async function namedInJoinOrder(db: Conn, runId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(db, 'SELECT id FROM participants WHERE run_id = ? AND name IS NOT NULL ORDER BY id', [runId]);
  return rows.map((r) => r.id);
}

/** Wand-Namen der Präsentation in Folienreihenfolge */
export function boardNames(slides: readonly Slide[]): string[] {
  const names: string[] = [];
  for (const s of slides) if (s.type === 'board' && s.config.board && !names.includes(s.config.board)) names.push(s.config.board);
  return names;
}

/** Rang der ersten Karte je Person auf der Wand `board` (alle Folien mit diesem Wand-Namen) */
async function firstCards(db: Conn, runId: number, slides: readonly Slide[], board: string): Promise<Map<number, number>> {
  const ids = slides.filter((s) => s.type === 'board' && s.config.board === board).map((s) => s.id);
  if (ids.length === 0) throw new CommandError('Diese Wand gibt es in der Präsentation nicht');
  const rows = await query<{ participant_id: number }>(
    db,
    `SELECT participant_id FROM posts
      WHERE run_id = ? AND slide_id IN (${ids.map(() => '?').join(',')}) AND participant_id IS NOT NULL
      GROUP BY participant_id ORDER BY MIN(created_at), MIN(id)`,
    [runId, ...ids],
  );
  // Rang statt Zeitpunkt: bei gleicher Millisekunde entscheidet die kleinere Karten-ID
  return new Map(rows.map((r, i) => [r.participant_id, i]));
}

/** Neuer Zustand nach einem Reihum-Befehl. `random(n)` ∈ [0, n) – auf dem Server kryptografisch. */
export async function applyTurnsCommand(
  db: Conn,
  runId: number,
  state: RunState,
  slides: readonly Slide[],
  cmd: TurnsCommand,
  random: (n: number) => number = (n) => randomInt(0, n),
): Promise<RunState> {
  const named = await namedInJoinOrder(db, runId);
  const turns: TurnsState = liveTurns(state.turns, new Set(named));
  const set = (next: TurnsState | null): RunState => ({ ...state, turns: next });
  switch (cmd.action) {
    case 'turns-make': {
      if (named.length === 0) throw new CommandError('Noch niemand hat einen Namen eingegeben');
      let order: number[];
      if (cmd.source === 'random') order = shuffleTurns(named, random);
      else if (cmd.source === 'board') {
        if (!cmd.board) throw new CommandError('Bitte eine Wand wählen');
        order = orderByFirstCard(named, await firstCards(db, runId, slides, cmd.board));
      } else order = named;
      return set({ order, current: null, shown: turns.shown });
    }
    case 'turns-fill': {
      const next = appendTurns(turns, named);
      if (next.order.length === turns.order.length) throw new CommandError('Es fehlt niemand mit Namen');
      return set(next);
    }
    case 'turns-add': {
      // Ohne Gerät: eigener Eintrag mit zufälligem Token, das nie jemand erhält (wie bei „Gruppen bilden“)
      const result = await exec(db, 'INSERT INTO participants (run_id, token, name) VALUES (?, ?, ?)', [
        runId,
        randomBytes(24).toString('base64url'),
        cmd.name,
      ]);
      return set(appendTurns(turns, [result.insertId]));
    }
    case 'turns-move':
      return set(moveTurn(turns, cmd.participantId, cmd.delta));
    case 'turns-remove':
      return set(removeTurn(turns, cmd.participantId));
    case 'turns-step':
      if (turns.order.length === 0) throw new CommandError('Erst eine Reihenfolge erzeugen');
      return set(stepTurn(turns, cmd.delta));
    case 'turns-go':
      if (cmd.index !== null && cmd.index >= turns.order.length) throw new CommandError('Diese Position gibt es nicht');
      return set({ ...turns, current: cmd.index });
    case 'turns-show':
      if (cmd.visible && turns.order.length === 0) throw new CommandError('Erst eine Reihenfolge erzeugen');
      return set({ ...turns, shown: cmd.visible });
    case 'turns-clear':
      return set(null);
  }
}

/* ───────────── Ansichten ───────────── */

const turnsOf = (snap: Snapshot) => liveTurns(snap.run.state.turns, snap.names);

/** Steuerpult: Namen, verbunden/getrennt, wer fehlt, Wände für „nach erster Karte“ */
export function turnsHostView(snap: Snapshot, online: ReadonlySet<number>): TurnsHostView {
  const turns = turnsOf(snap);
  const inOrder = new Set(turns.order);
  return {
    order: turns.order.map((id) => ({ id, name: snap.names.get(id)!, online: online.has(id) })),
    current: turns.current,
    shown: turns.shown,
    missing: [...snap.names.keys()].filter((id) => !inOrder.has(id)).length,
    boards: boardNames(snap.slides),
  };
}

/** Beamer: nur Namen, nie IDs; ohne Reihenfolge nichts */
export function displayTurns(snap: Snapshot): TurnsDisplayView | null {
  const turns = turnsOf(snap);
  if (turns.order.length === 0) return null;
  return { names: turns.order.map((id) => snap.names.get(id)!), current: turns.current, shown: turns.shown };
}

/** Handy: nur die eigene Stelle */
export function participantTurn(snap: Snapshot, participantId: number): MyTurnView | null {
  return myTurn(turnsOf(snap), participantId);
}
