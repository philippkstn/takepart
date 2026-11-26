import { sameValue } from '@slides/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.ts';

/**
 * Ein Feld einer Folie, das mehrere Personen zugleich bearbeiten können
 * (Konfiguration, Sprechernotizen).
 *
 * - Speichert verzögert und immer nur eine Anfrage zugleich; jede Anfrage trägt
 *   den Stand mit, auf dem die Änderung beruht (`base`). Der Server führt
 *   Änderungen verschiedener Personen an verschiedenen Feldern zusammen.
 * - Ändert jemand anderes das Feld, während hier nichts ungespeichert ist,
 *   übernimmt es den neuen Stand sofort.
 * - Widersprechen sich die Änderungen (409), bleibt der eigene Entwurf erhalten
 *   und die Person entscheidet. Passiert das erst beim Verlassen der Folie, wird
 *   der Entwurf gemerkt und beim nächsten Öffnen der Folie zur Wahl gestellt.
 */

export type FieldStatus = 'idle' | 'pending' | 'saved' | 'error' | 'conflict';

/** Entwürfe, deren Speichern beim Verlassen der Folie in einen Konflikt lief */
const parked = new Map<string, unknown>();
const parkedListeners = new Set<(key: string) => void>();

export function parkedConflicts(): string[] {
  return [...parked.keys()];
}

export function onParkedConflict(listener: (key: string) => void): () => void {
  parkedListeners.add(listener);
  return () => parkedListeners.delete(listener);
}

export function useSyncedField<T>({
  key,
  server,
  send,
  fromConflict,
  delay = 600,
}: {
  /** Eindeutig je Folie und Feld, z. B. `config:12` */
  key: string;
  /** Aktueller Stand laut Server (aus dem Query-Cache) */
  server: T;
  /** Speichert `value` auf Basis von `base`; liefert den gespeicherten (ggf. zusammengeführten) Stand */
  send: (value: T, base: T) => Promise<T>;
  /** Aktueller Stand aus der Antwort bei 409 */
  fromConflict: (data: unknown) => T | undefined;
  delay?: number;
}): {
  value: T;
  set: (value: T) => void;
  status: FieldStatus;
  error: string | null;
  /** Stand der anderen Person bei einem Konflikt */
  theirs: T | undefined;
  resolve: (choice: 'mine' | 'theirs') => void;
} {
  const initialParked = parked.get(key) as T | undefined;
  const [value, setValue] = useState<T>(initialParked ?? server);
  const [status, setStatus] = useState<FieldStatus>(initialParked !== undefined ? 'conflict' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<T | undefined>(initialParked !== undefined ? server : undefined);

  const base = useRef<T>(server);
  const draft = useRef<T>(initialParked ?? server);
  const dirty = useRef(initialParked !== undefined);
  const inflight = useRef(false);
  const conflicted = useRef(initialParked !== undefined);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const sendRef = useRef(send);
  sendRef.current = send;
  const conflictRef = useRef(fromConflict);
  conflictRef.current = fromConflict;

  // Gemerkter Entwurf ist jetzt hier in Bearbeitung
  useEffect(() => {
    parked.delete(key);
  }, [key]);

  // Fremde Änderungen übernehmen, solange hier nichts ungespeichert ist
  useEffect(() => {
    if (dirty.current || inflight.current || conflicted.current) return;
    if (sameValue(server, base.current) && sameValue(server, draft.current)) return;
    base.current = server;
    draft.current = server;
    setValue(server);
  }, [server]);

  const flush = useCallback(async (): Promise<void> => {
    if (inflight.current || conflicted.current || !dirty.current) return;
    inflight.current = true;
    const sending = draft.current;
    dirty.current = false;
    try {
      const saved = await sendRef.current(sending, base.current);
      inflight.current = false;
      if (dirty.current) {
        // Inzwischen weiter getippt: Der Entwurf beruht auf dem Gesendeten, nicht auf dem
        // (evtl. mit fremden Änderungen zusammengeführten) Ergebnis – sonst überschriebe
        // der nächste Stand die fremden Änderungen ohne Zusammenführung.
        base.current = sending;
        void flush();
        return;
      }
      base.current = saved;
      draft.current = saved;
      if (mounted.current) {
        // Zusammengeführten Stand zeigen (enthält Änderungen anderer an anderen Feldern)
        if (!sameValue(saved, sending)) setValue(saved);
        setStatus('saved');
        setError(null);
      }
    } catch (err) {
      inflight.current = false;
      dirty.current = true;
      if (err instanceof ApiError && err.status === 409) {
        const current = conflictRef.current(err.data);
        conflicted.current = true;
        if (!mounted.current) {
          parked.set(key, draft.current);
          for (const l of parkedListeners) l(key);
          return;
        }
        setTheirs(current);
        setStatus('conflict');
        return;
      }
      if (mounted.current) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Nicht gespeichert');
      }
    }
  }, [key]);

  const set = useCallback(
    (next: T) => {
      draft.current = next;
      dirty.current = true;
      setValue(next);
      if (conflicted.current) return;
      setStatus('pending');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        void flush();
      }, delay);
    },
    [delay, flush],
  );

  const resolve = useCallback(
    (choice: 'mine' | 'theirs') => {
      const current = theirs ?? base.current;
      conflicted.current = false;
      setTheirs(undefined);
      base.current = current;
      if (choice === 'theirs') {
        draft.current = current;
        dirty.current = false;
        setValue(current);
        setStatus('idle');
        return;
      }
      dirty.current = true;
      setStatus('pending');
      void flush();
    },
    [theirs, flush],
  );

  // Beim Verlassen der Folie Ausstehendes sofort speichern
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (conflicted.current && dirty.current) {
        parked.set(key, draft.current);
        return;
      }
      void flush();
    };
  }, [key, flush]);

  return { value, set, status, error, theirs, resolve };
}
