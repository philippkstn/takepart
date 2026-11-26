/**
 * Gemeinsames Bearbeiten einer Präsentation: Rollen, Nachrichten des Editor-
 * WebSockets und das Zusammenführen paralleler Änderungen an einer Folie.
 */

export type PresentationRole = 'view' | 'edit' | 'host' | 'owner';

export const ROLE_LABELS: Record<PresentationRole, string> = {
  view: 'Ansehen',
  edit: 'Bearbeiten',
  host: 'Moderieren',
  owner: 'Vollzugriff',
};

export const ROLE_HINTS: Record<Exclude<PresentationRole, 'owner'>, string> = {
  view: 'Folien ansehen und für sich duplizieren',
  edit: 'Folien bearbeiten, Versionen wiederherstellen, exportieren (mit allen Ergebnissen und Namen)',
  host: 'Zusätzlich durchführen, steuern und das Archiv sehen',
};

const RANK: Record<PresentationRole, number> = { view: 1, edit: 2, host: 3, owner: 4 };
export const roleAtLeast = (role: PresentationRole | null | undefined, min: PresentationRole) => !!role && RANK[role] >= RANK[min];

/** Wer gerade im Editor ist (nur flüchtig, an der Verbindung) */
export interface EditorPresence {
  /** Kennung des Browser-Tabs */
  id: string;
  name: string;
  slideId: number | null;
}

/** Was sich geändert hat – der Editor lädt daraufhin neu */
export interface EditChange {
  /** Tab, der die Änderung auslöste (der ignoriert sie) */
  by: string | null;
  /** Benutzername der ändernden Person */
  who: string | null;
  /** Betroffene Folien; ohne Angabe: alles neu laden */
  slides?: number[];
  /** Folien hinzugefügt, gelöscht oder umsortiert */
  structure?: boolean;
  /** Versionen oder Google-Verknüpfung geändert */
  versions?: boolean;
  source?: boolean;
}

export type EditorServerMessage =
  | { type: 'presence'; editors: EditorPresence[]; self: string }
  | ({ type: 'changed' } & EditChange)
  /** Zugriff entzogen oder Präsentation gelöscht */
  | { type: 'gone' };

export type EditorClientMessage = { type: 'focus'; slideId: number | null };

/** Kennung eines Editor-Tabs (Header `X-Edit-Client`) */
export const EDIT_CLIENT_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** JSON mit sortierten Schlüsseln – gleiche Inhalte ergeben gleiche Zeichenketten */
export const stableJson = (value: unknown) => JSON.stringify(stable(value)) ?? 'undefined';

export const sameValue = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/**
 * Drei-Wege-Zusammenführung auf oberster Ebene einer Folienkonfiguration.
 * Je Feld gilt: Wer es geändert hat, gewinnt; haben beide es verschieden
 * geändert, ist das ein Konflikt (dann bleibt der fremde Wert im Ergebnis).
 */
export function mergeConfig(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
): { merged: Record<string, unknown>; conflicts: string[] } {
  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])) {
    const b = base[key];
    const m = mine[key];
    const t = theirs[key];
    let value: unknown;
    if (sameValue(m, b) || sameValue(m, t)) value = t;
    else if (sameValue(t, b)) value = m;
    else {
      conflicts.push(key);
      value = t;
    }
    if (value !== undefined) merged[key] = value;
  }
  return { merged, conflicts };
}
