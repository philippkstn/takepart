import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './confirm.css';

/**
 * Eigene Rückfragen statt `window.confirm`/`window.prompt`: gleiches Aussehen
 * wie die übrigen Dialoge, blockiert den Tab nicht (Live-Ansichten laufen
 * weiter) und funktioniert in Beamer-/PWA-Fenstern, in denen Browser-Dialoge
 * unterdrückt werden können.
 *
 * `await confirm({ title, text, confirmLabel, danger })` → `true`/`false`,
 * `await prompt({ title, label, value, validate })` → Text oder `null`.
 * Escape/Klick daneben = Abbrechen, Enter = Bestätigen. Solange die Rückfrage
 * offen ist, erreichen Tasten keine anderen Fenster-Listener (Blättern,
 * Escape eines Dialogs darunter, ⌘Z).
 */

export interface ConfirmOptions {
  title: string;
  /** Erläuterung unter dem Titel */
  text?: string;
  /** Beschriftung des Bestätigen-Knopfs (Standard „OK“) */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Zerstörerische Aktion: roter Knopf */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  text?: string;
  /** Beschriftung des Eingabefelds */
  label: string;
  value?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
  /** Fehlermeldung oder `null` = gültig */
  validate?: (value: string) => string | null;
}

type Request =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

let nextId = 0;

interface Api {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

// Ohne Provider (sollte nicht vorkommen): sicher abbrechen statt still bestätigen
const ConfirmContext = createContext<Api>({
  confirm: async () => false,
  prompt: async () => null,
});

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const add = useCallback((r: Request) => setQueue((q) => [...q, r]), []);
  const api = useRef<Api>({
    confirm: (options) => new Promise((resolve) => add({ id: ++nextId, kind: 'confirm', options, resolve })),
    prompt: (options) => new Promise((resolve) => add({ id: ++nextId, kind: 'prompt', options, resolve })),
  });
  const current = queue[0];
  const done = (value: boolean | string | null) => {
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(value === true);
    else current.resolve(typeof value === 'string' ? value : null);
    setQueue((q) => q.slice(1));
  };

  return (
    <ConfirmContext.Provider value={api.current}>
      {children}
      {current && <ConfirmModal key={current.id} request={current} onDone={done} />}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext).confirm;
export const usePrompt = () => useContext(ConfirmContext).prompt;

function ConfirmModal({ request, onDone }: { request: Request; onDone: (value: boolean | string | null) => void }) {
  const { options } = request;
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const okButton = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(request.kind === 'prompt' ? (request.options.value ?? '') : '');
  const [error, setError] = useState<string | null>(null);

  const cancel = () => onDone(request.kind === 'confirm' ? false : null);
  const submit = () => {
    if (request.kind === 'confirm') return onDone(true);
    const message = request.options.validate?.(value) ?? null;
    if (message) {
      setError(message);
      input.current?.focus();
      return;
    }
    onDone(value);
  };
  const latest = useRef({ cancel, submit });
  latest.current = { cancel, submit };

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // Gefährliches nicht vorauswählen: Enter bestätigt trotzdem, aber der Fokus liegt auf „Abbrechen“
    if (request.kind === 'prompt') input.current?.select();
    else if (options.danger) box.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    else okButton.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      // Andere Fenster-Listener (Blättern, Escape darunter, ⌘Z) nicht erreichen
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        latest.current.cancel();
      } else if (e.key === 'Enter' && !e.isComposing) {
        const target = e.target as HTMLElement;
        // Enter auf einem Knopf löst dessen Klick aus
        if (target instanceof HTMLButtonElement) return;
        e.preventDefault();
        latest.current.submit();
      } else if (e.key === 'Tab') {
        // Fokus im Dialog halten
        const items = box.current?.querySelectorAll<HTMLElement>('button, input');
        if (!items?.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus?.({ preventScroll: true });
    };
  }, [request.kind, options.danger]);

  return (
    <div
      className="dialog-backdrop confirm-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={options.text ? `${id}-text` : undefined}
      onClick={cancel}
    >
      <div ref={box} className="dialog confirm-dialog card card-pad stack" onClick={(e) => e.stopPropagation()}>
        <h2 id={`${id}-title`} className="confirm-title">
          {options.title}
        </h2>
        {options.text && (
          <p id={`${id}-text`} className="muted confirm-text">
            {options.text}
          </p>
        )}
        {request.kind === 'prompt' && (
          <label className="stack-s">
            <span className="small muted">{request.options.label}</span>
            <input
              ref={input}
              className="input"
              value={value}
              inputMode={request.options.inputMode}
              aria-invalid={!!error}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
            {error && <span className="small confirm-error">{error}</span>}
          </label>
        )}
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" data-cancel onClick={cancel}>
            {options.cancelLabel ?? 'Abbrechen'}
          </button>
          <button ref={okButton} type="button" className={`btn ${options.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={submit}>
            {options.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Minuten-Eingabe (Komma erlaubt) für Countdown und Pause; `null` = abgebrochen */
export async function askMinutes(prompt: Api['prompt'], title: string, max: number, fallback = '15'): Promise<number | null> {
  const input = await prompt({
    title,
    label: 'Minuten',
    value: fallback,
    inputMode: 'decimal',
    confirmLabel: 'Starten',
    validate: (v) => {
      const n = Number(v.replace(',', '.'));
      return Number.isFinite(n) && n > 0 && n <= max ? null : `Bitte eine Zahl zwischen 1 und ${max} eingeben.`;
    },
  });
  return input === null ? null : Number(input.replace(',', '.'));
}
