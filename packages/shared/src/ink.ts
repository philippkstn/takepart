import type { InkEvent } from './state.ts';

/*
 * Laserpointer und Zeichnungen auf den Handys der Teilnehmenden.
 *
 * Die Moderation schickt bis zu 80 Nachrichten pro Sekunde. An bis zu 300 Handys
 * gehen sie nicht einzeln, sondern gesammelt: Der Server merkt sich zwischen zwei
 * Sendungen nur, was sich geändert hat (letzte Zeigerposition, neue Punkte je
 * Strich, ob gelöscht wurde), und verschickt das höchstens alle paar Dutzend
 * Millisekunden als eine Nachricht.
 */

/** Bühne ist immer 16:9 – darauf sind alle Koordinaten normiert. */
export const STAGE_RATIO = 16 / 9;

/** Gesammelte Änderungen seit der letzten Sendung an die Handys */
export interface PendingInk {
  clear: boolean;
  /** Neue Punkte je Strich, in der Reihenfolge des ersten Auftretens */
  strokes: Map<string, { points: [number, number][]; done: boolean }>;
  /** Letzte Zeigerposition, `'off'` = ausgeblendet, `undefined` = unverändert */
  pointer: { x: number; y: number } | 'off' | undefined;
}

export function emptyPendingInk(): PendingInk {
  return { clear: false, strokes: new Map(), pointer: undefined };
}

/** Ein Ereignis in die gesammelten Änderungen aufnehmen. */
export function collectInk(pending: PendingInk, event: InkEvent): void {
  switch (event.type) {
    case 'pointer':
      pending.pointer = { x: event.x, y: event.y };
      return;
    case 'pointer-off':
      pending.pointer = 'off';
      return;
    case 'clear':
      // Was vorher gezeichnet wurde, ist ohnehin weg
      pending.clear = true;
      pending.strokes.clear();
      return;
    case 'stroke': {
      const existing = pending.strokes.get(event.id);
      if (existing) {
        existing.points.push(...event.points);
        existing.done = event.done;
      } else {
        pending.strokes.set(event.id, { points: [...event.points], done: event.done });
      }
    }
  }
}

/**
 * Gesammelte Änderungen als Ereignisliste herausnehmen und zurücksetzen.
 * Reihenfolge: erst löschen, dann Striche, zuletzt der Zeiger.
 */
export function takeInk(pending: PendingInk): InkEvent[] {
  const events: InkEvent[] = [];
  if (pending.clear) events.push({ type: 'clear' });
  for (const [id, s] of pending.strokes) {
    if (s.points.length > 0) events.push({ type: 'stroke', id, points: s.points, done: s.done });
  }
  if (pending.pointer === 'off') events.push({ type: 'pointer-off' });
  else if (pending.pointer) events.push({ type: 'pointer', ...pending.pointer });
  pending.clear = false;
  pending.strokes = new Map();
  pending.pointer = undefined;
  return events;
}

/**
 * Wo liegt die Folie auf der 16:9-Bühne? Der Beamer setzt das Folienbild in
 * seinem eigenen Seitenverhältnis mittig hinein (Letterbox). Ergebnis in
 * Bühnen-Koordinaten (0…1) – das Handy zeigt genau diesen Ausschnitt.
 */
export function slideFrame(width: number, height: number): { x: number; y: number; w: number; h: number } {
  const ratio = width > 0 && height > 0 ? width / height : STAGE_RATIO;
  if (ratio >= STAGE_RATIO) {
    const h = STAGE_RATIO / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio / STAGE_RATIO;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}
