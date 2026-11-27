import { useCallback, useEffect, useState } from 'react';

/**
 * Mehrfachauswahl in der Folienliste – liegt über der einfachen Auswahl des
 * Editors (`selectedId`): Die Zusatzauswahl gilt nur, solange sie die gerade
 * gewählte Folie enthält. Jedes einfache `setSelectedId(x)` (Klick, neue Folie,
 * Löschen …) wählt damit von selbst wieder nur eine Folie.
 *
 * Umschalt+Klick wählt einen Bereich (ab dem Anker), ⌘/Strg+Klick einzelne
 * Folien dazu oder ab; Escape hebt die Mehrfachauswahl auf.
 */
export function useSlideSelection(order: number[], selectedId: number | null, setSelectedId: (id: number) => void) {
  const [extra, setExtra] = useState<{ ids: number[]; anchor: number } | null>(null);

  const valid = extra !== null && selectedId !== null && extra.ids.includes(selectedId);
  const present = new Set(order);
  // In Listenreihenfolge, ohne inzwischen gelöschte Folien
  const ids = valid ? order.filter((id) => extra.ids.includes(id)) : selectedId !== null && present.has(selectedId) ? [selectedId] : [];
  const anchor = valid ? extra.anchor : selectedId;

  const set = useCallback(
    (next: number[], focus: number, nextAnchor: number) => {
      setExtra(next.length > 1 ? { ids: next, anchor: nextAnchor } : null);
      setSelectedId(focus);
    },
    [setSelectedId],
  );

  /** Bereich vom Anker bis `id` (Umschalt+Klick, Umschalt+↑/↓) */
  const range = (id: number) => {
    const from = anchor !== null ? order.indexOf(anchor) : -1;
    const to = order.indexOf(id);
    if (from < 0 || to < 0) return set([id], id, id);
    set(order.slice(Math.min(from, to), Math.max(from, to) + 1), id, anchor!);
  };

  /** Klick auf eine Folie mit den Tasten der Mehrfachauswahl */
  const click = (id: number, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.shiftKey) return range(id);
    if (e.metaKey || e.ctrlKey) {
      if (ids.includes(id)) {
        const rest = ids.filter((x) => x !== id);
        // Die letzte Folie bleibt ausgewählt
        if (rest.length === 0) return;
        return set(rest, id === selectedId ? rest[0]! : selectedId!, rest.includes(anchor ?? -1) ? anchor! : rest[0]!);
      }
      return set([...ids, id], id, id);
    }
    set([id], id, id);
  };

  /** Mehrfachauswahl aufheben – die gerade gewählte Folie bleibt */
  const clear = useCallback(() => setExtra(null), []);

  // Escape hebt die Auswahl auf – nicht, solange ein Menü, Dialog oder Ziehen die Taste braucht
  const multi = ids.length > 1;
  useEffect(() => {
    if (!multi) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.context-menu, .dialog-backdrop')) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multi, clear]);

  return {
    /** Ausgewählte Folien in Listenreihenfolge (mindestens die gewählte) */
    ids,
    multi,
    has: (id: number) => ids.includes(id),
    click,
    range,
    /** Mehrere Folien auswählen (z. B. nach dem Duplizieren oder ein ganzer Abschnitt) */
    select: (next: number[], focus = next[0]) => focus !== undefined && set(next, focus, next[0]!),
    clear,
  };
}

export type SlideSelection = ReturnType<typeof useSlideSelection>;
