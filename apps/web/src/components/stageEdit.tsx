import { createContext, createElement, useContext, type ComponentType, type ReactNode } from 'react';

/**
 * Bearbeitungsmodus der Bühne: Nur der Editor setzt diesen Kontext (über
 * `admin/InlineEdit.tsx`). Ohne ihn – Beamer, Steuerpult, Handys – rendert die
 * Bühne dieselben Elemente wie immer, ohne contentEditable.
 */
export type StageTextProps = {
  as: 'h1' | 'p' | 'span';
  className?: string;
  /** Feld in `slide.config`, z. B. `question`, `title`, `task` */
  field: string;
  /** Eintrag einer Liste (z. B. `options`) */
  index?: number;
  value: string;
  /** Hinweis im leeren Feld (nur beim Bearbeiten sichtbar) */
  placeholder?: string;
  /** Zeilenumbrüche erlaubt (Fließtext, Aufgabe); sonst beendet Enter */
  multiline?: boolean;
};

export type StageEditApi = { Text: ComponentType<StageTextProps> };

export const StageEditContext = createContext<StageEditApi | null>(null);

/** Ist die Bühne gerade im Editor bearbeitbar? */
export function useStageEdit(): StageEditApi | null {
  return useContext(StageEditContext);
}

/** Text auf der Bühne: im Editor bearbeitbar, sonst wie bisher (leer → nichts) */
export function StageText(props: StageTextProps): ReactNode {
  const edit = useContext(StageEditContext);
  if (edit) return <edit.Text {...props} />;
  return props.value ? createElement(props.as, { className: props.className }, props.value) : null;
}
