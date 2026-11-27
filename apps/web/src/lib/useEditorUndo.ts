import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useToast } from '../components/ui.tsx';
import { api, ApiError, errorMessage } from './api.ts';

/**
 * Rückgängig für strukturelle Änderungen im Editor (Löschen, Verschieben,
 * Einfügen/Duplizieren). Der Stapel liegt nur im Speicher dieses Tabs und
 * kennt nur eigene Aktionen.
 *
 * Löschen sichert vorher serverseitig eine Version (`DELETE …?undo=1` liefert
 * ihre ID); Rückgängig stellt die Folie daraus mit alter ID an alter Stelle
 * wieder her – samt Notizen, Ablaufplan, Google-Kennung und Bildern
 * (`version_assets`). Ergebnisse kommen nicht zurück, deshalb fragt das Löschen
 * bei Folien mit Ergebnissen echter Durchführungen weiterhin nach.
 */

type Entry =
  | { key: number; kind: 'delete'; slideId: number; versionId: number }
  | { key: number; kind: 'order'; before: number[]; after: number[] }
  | { key: number; kind: 'insert'; ids: number[] };

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'key'> : never) : never;

const MAX_ENTRIES = 20;
const CHANGED = 'Die Folienliste wurde inzwischen geändert – das lässt sich nicht mehr rückgängig machen';

const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Tastendruck in einem Textfeld oder bei offenem Dialog: Browser-Undo bzw. Dialog hat Vorrang */
const ownsUndo = (target: EventTarget | null) => {
  const el = target instanceof HTMLElement ? target : null;
  if (el && (el.isContentEditable || el.closest('input, textarea, select'))) return true;
  return !!document.querySelector('[aria-modal="true"], .dialog-backdrop');
};

export function useEditorUndo({
  presentationId,
  enabled,
  select,
}: {
  presentationId: number;
  /** Bearbeitungsrecht – ohne bleibt ⌘Z beim Browser */
  enabled: boolean;
  /** Folie nach dem Rückgängigmachen auswählen */
  select: (slideId: number) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const stack = useRef<Entry[]>([]);
  const nextKey = useRef(1);
  const running = useRef(false);

  // Andere Präsentation, neuer Stapel
  useEffect(() => {
    stack.current = [];
  }, [presentationId]);

  const queryKey = ['presentation', presentationId];
  const currentIds = useCallback(
    () => queryClient.getQueryData<{ slides: { id: number }[] }>(['presentation', presentationId])?.slides.map((s) => s.id) ?? null,
    [queryClient, presentationId],
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const push = (entry: NewEntry) => {
    const key = nextKey.current++;
    stack.current = [...stack.current, { ...entry, key } as Entry].slice(-MAX_ENTRIES);
    return key;
  };

  /**
   * Folie löschen; bei Ergebnissen echter Durchführungen vorher fragen.
   * `null` = abgebrochen. `snapshot: false` legt keine Version an.
   */
  const deleteSlide = async (slideId: number, snapshot: boolean): Promise<{ versionId: number | null } | null> => {
    const url = (drop: boolean) => `/api/slides/${slideId}?undo=1${drop ? '&dropResults=1' : ''}${snapshot ? '' : '&version=0'}`;
    try {
      return await api<{ versionId: number | null }>(url(false), { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) throw err;
      const live = !!(err.data as { live?: boolean } | null)?.live;
      const lost = live
        ? 'Antworten der laufenden Durchführung gehen dabei verloren'
        : 'Ergebnisse früherer Durchführungen gehen dabei verloren';
      if (!window.confirm(`Folie löschen? ${lost} – auch „Rückgängig“ bringt sie nicht zurück.`)) return null;
      return api<{ versionId: number | null }>(url(true), { method: 'DELETE' });
    }
  };

  const undoEntry = async (entry: Entry) => {
    if (entry.kind === 'delete') {
      await api(`/api/presentations/${presentationId}/versions/${entry.versionId}/slides/${entry.slideId}/restore`, { body: {} });
      await refresh();
      select(entry.slideId);
      toast('Folie wiederhergestellt');
    } else if (entry.kind === 'order') {
      const now = currentIds();
      if (!now || !sameIds(now, entry.after)) {
        await refresh();
        return toast(CHANGED, 'error');
      }
      await api(`/api/presentations/${presentationId}/order`, { method: 'PUT', body: { ids: entry.before } });
      await refresh();
      toast('Verschieben rückgängig gemacht');
    } else {
      const now = currentIds() ?? [];
      const first = now.indexOf(entry.ids[0]!);
      const neighbour = now.slice(0, Math.max(first, 0)).reverse().find((id) => !entry.ids.includes(id));
      // Eine Version genügt für den ganzen Schritt (unbenannte Versionen sind begrenzt)
      let removed = 0;
      for (const id of entry.ids) {
        if ((await deleteSlide(id, removed === 0)) === null) break;
        removed++;
      }
      await refresh();
      // Abgebrochen: Schritt bleibt auf dem Stapel
      if (removed === 0) return void (stack.current = [...stack.current, entry]);
      if (neighbour !== undefined) select(neighbour);
      toast(removed === 1 ? 'Einfügen rückgängig gemacht' : `${removed} Folien wieder entfernt`);
    }
  };

  /** Letzten Schritt (oder einen bestimmten, z. B. aus dem Hinweis) rückgängig machen */
  const undo = async (key?: number) => {
    if (running.current) return;
    const entry = key === undefined ? stack.current.at(-1) : stack.current.find((e) => e.key === key);
    if (!entry) return;
    // Gelingt es nicht, gelingt es auch später nicht – der Schritt fällt so oder so weg
    stack.current = stack.current.filter((e) => e !== entry);
    running.current = true;
    try {
      await undoEntry(entry);
    } catch (err) {
      await refresh();
      // 409 beim Wiederherstellen: Folie passt nicht mehr zum Format – Meldung des Servers
      if (err instanceof ApiError && err.status === 409) toast(entry.kind === 'delete' ? err.message : CHANGED, 'error');
      else if (err instanceof ApiError && err.status === 404) toast('Die Folie lässt sich nicht mehr wiederherstellen', 'error');
      else toast(errorMessage(err), 'error');
    } finally {
      running.current = false;
    }
  };
  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (ownsUndo(e.target) || stack.current.length === 0) return;
      e.preventDefault();
      void undoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  return {
    /** Folie löschen mit „Rückgängig“ im Hinweis; `false`, wenn abgebrochen oder fehlgeschlagen */
    remove: async (slideId: number): Promise<boolean> => {
      try {
        const done = await deleteSlide(slideId, true);
        if (!done) return false;
        await refresh();
        if (done.versionId === null) {
          toast('Folie gelöscht');
        } else {
          const key = push({ kind: 'delete', slideId, versionId: done.versionId });
          toast('Folie gelöscht', 'info', { label: 'Rückgängig', run: () => void undoRef.current(key) });
        }
        return true;
      } catch (err) {
        toast(errorMessage(err), 'error');
        return false;
      }
    },
    /** Erfolgreiches Verschieben merken */
    recordOrder: (before: number[] | null, after: number[]) => {
      if (before && !sameIds(before, after)) push({ kind: 'order', before, after });
    },
    /** Neu angelegte Folien merken (Einfügen, Bausteine, Duplizieren) */
    recordInsert: (ids: number[]) => {
      if (ids.length > 0) push({ kind: 'insert', ids });
    },
    /** Aktuelle Reihenfolge aus dem Cache (vor einem optimistischen Verschieben) */
    currentIds,
  };
}
