import { slideConfigSchemas, type Slide } from '@slides/shared';
import {
  createContext,
  createElement,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { StageEditContext, type StageEditApi, type StageTextProps } from '../stageEdit.tsx';
import './inlineEdit.css';

/**
 * Direkt auf der Folie bearbeiten: Die Vorschau im Editor wird mit diesem
 * Provider zur Eingabefläche für die wichtigsten Texte. Gleiche Quelle wie das
 * Formular (`field.value`/`field.set` aus `useSyncedField`) – Speichern,
 * Konflikte und gemeinsames Bearbeiten laufen unverändert darüber.
 */
type Config = Slide['config'];

type Ctx = {
  type: Slide['type'];
  /** Immer der neueste Stand – Eingaben bauen darauf auf, nie auf einem alten Render */
  config: { current: Config };
  onChange: (config: Config) => void;
};

const InlineCtx = createContext<Ctx | null>(null);
const API: StageEditApi = { Text: InlineText };

export function InlineEditProvider({
  slide,
  onChange,
  children,
}: {
  slide: Slide;
  /** `null` = nur ansehen (keine Bearbeitung auf der Folie) */
  onChange: ((config: Config) => void) | null;
  children: ReactNode;
}) {
  const config = useRef(slide.config);
  config.current = slide.config;
  const ctx = useMemo<Ctx | null>(
    () => (onChange && slide.type !== 'image' ? { type: slide.type, config, onChange } : null),
    [slide.type, onChange],
  );
  if (!ctx) return children;
  return (
    <InlineCtx.Provider value={ctx}>
      <StageEditContext.Provider value={API}>{children}</StageEditContext.Provider>
    </InlineCtx.Provider>
  );
}

/** Grenzen eines Textfelds aus dem Zod-Schema der Folie (`null`: Feld gibt es bei diesem Typ nicht) */
function limitsOf(type: Slide['type'], field: string, list: boolean): { max: number; required: boolean } | null {
  const shape = (slideConfigSchemas[type] as unknown as { shape: Record<string, unknown> }).shape;
  type Schema = { def?: { type?: string }; unwrap?: () => Schema; element?: Schema; maxLength?: number | null; minLength?: number | null };
  let schema = shape[field] as Schema | undefined;
  // `.default(…)` umschließt das eigentliche Schema (Klassennamen überleben das Minifizieren nicht – daher `def.type`)
  if (schema?.def?.type === 'default' && schema.unwrap) schema = schema.unwrap();
  if (list) schema = schema?.def?.type === 'array' ? schema.element : undefined;
  if (!schema || typeof schema.maxLength !== 'number') return null;
  return { max: schema.maxLength, required: (schema.minLength ?? 0) > 0 };
}

function withValue(config: Config, field: string, index: number | undefined, text: string): Config {
  const c = config as Record<string, unknown>;
  if (index === undefined) return { ...c, [field]: text } as Config;
  const list = Array.isArray(c[field]) ? [...(c[field] as string[])] : [];
  list[index] = text;
  return { ...c, [field]: list } as Config;
}

function caretToEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Editierbarer Text mit Schrift und Größe der Bühne (contentEditable, nur
 * Klartext). Enter beendet einzeilige Felder, Escape verwirft die Eingabe seit
 * dem Anklicken. Den Text im DOM setzt die Komponente nur, solange niemand
 * darin tippt – sonst sprängen Cursor und Leerzeichen.
 */
function InlineText({ as, className = '', field, index, value, placeholder = 'Text eingeben', multiline = false }: StageTextProps) {
  const ctx = useContext(InlineCtx);
  const ref = useRef<HTMLElement>(null);
  const focused = useRef(false);
  const start = useRef(value);
  /** Escape hat schon zurückgesetzt – Blur muss nichts mehr tun */
  const discarded = useRef(false);
  const limits = ctx ? limitsOf(ctx.type, field, index !== undefined) : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !focused.current && el.textContent !== value) el.textContent = value;
  }, [value]);

  // Feld gibt es bei diesem Typ nicht: wie auf dem Beamer
  if (!ctx || !limits) return value ? createElement(as, { className }, value) : null;
  const { max, required } = limits;

  const clean = (text: string) => (multiline ? text : text.replace(/\s*[\r\n]+\s*/g, ' '));
  const commit = (text: string) => ctx.onChange(withValue(ctx.config.current, field, index, text));

  return createElement(as, {
    ref,
    className: `${className} inline-edit`,
    contentEditable: 'plaintext-only',
    suppressContentEditableWarning: true,
    role: 'textbox',
    'aria-label': placeholder,
    'aria-multiline': multiline,
    'data-placeholder': placeholder,
    spellCheck: true,
    onFocus: () => {
      focused.current = true;
      start.current = value;
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      focused.current = false;
      if (discarded.current) {
        discarded.current = false;
        return;
      }
      // Pflichtfeld (Option) leer gelassen: zurück zum Stand vor dem Bearbeiten
      const el = e.currentTarget;
      if (required && !(el.textContent ?? '').trim()) {
        commit(start.current);
        el.textContent = start.current;
      }
    },
    onInput: (e: FormEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const raw = el.textContent ?? '';
      let text = clean(raw);
      if (text.length > max) text = text.slice(0, max);
      // Leer gelöscht: übrig gebliebenes <br> entfernen, sonst greift der Platzhalter (:empty) nicht
      if (!text && el.firstChild) el.textContent = '';
      else if (text !== raw) {
        el.textContent = text;
        caretToEnd(el);
      }
      commit(text);
    },
    onPaste: (e: ClipboardEvent<HTMLElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      const selected = window.getSelection()?.toString().length ?? 0;
      const room = max - (el.textContent?.length ?? 0) + selected;
      const text = clean(e.clipboardData.getData('text/plain')).slice(0, Math.max(0, room));
      // insertText löst ein normales input-Ereignis aus und hält Cursor und Rückgängig intakt
      if (text) document.execCommand('insertText', false, text);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const el = e.currentTarget;
      if (e.key === 'Escape') {
        e.preventDefault();
        commit(start.current);
        el.textContent = start.current;
        discarded.current = true;
        el.blur();
      } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        el.blur();
      } else if (
        e.key.length === 1 &&
        !e.metaKey &&
        !e.ctrlKey &&
        (el.textContent?.length ?? 0) - (window.getSelection()?.toString().length ?? 0) >= max
      ) {
        // Zeichenlimit aus dem Schema: weitere Zeichen gar nicht erst annehmen
        e.preventDefault();
      }
    },
  });
}
