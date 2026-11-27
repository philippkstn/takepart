import QRCode from 'qrcode';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LiveStatus } from '../lib/live.ts';

/* ───────────── Toasts ───────────── */

/** Optionale Aktion im Hinweis, z. B. „Rückgängig“ */
export interface ToastAction {
  label: string;
  run: () => void;
}
interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: ToastAction;
}
type PushToast = (text: string, kind?: Toast['kind'], action?: ToastAction) => void;
const ToastContext = createContext<PushToast>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<PushToast>(
    (text, kind = 'info', action) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, text, kind, action }]);
      // Mit Aktion länger stehen lassen, damit man sie noch erreicht
      window.setTimeout(() => dismiss(id), action ? 8000 : kind === 'error' ? 5000 : 2800);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''} ${t.action ? 'has-action' : ''}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ───────────── Kleinteile ───────────── */

export function Spinner() {
  return <div className="spinner" aria-label="Lädt" />;
}

export function FullScreenSpinner() {
  return (
    <div className="center-screen">
      <Spinner />
    </div>
  );
}

/** Das TakePart-Zeichen: drei Balken auf Orange. Gleiche Form wie public/favicon.svg. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#E0532F" />
      <rect x="8" y="17" width="4" height="7" rx="2" fill="#fff" />
      <rect x="14" y="10" width="4" height="14" rx="2" fill="#fff" />
      <rect x="20" y="13" width="4" height="11" rx="2" fill="#fff" />
    </svg>
  );
}

export function QrCode({ text, size, className }: { text: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#16181b', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [text]);
  return (
    <div
      className={`qr ${className ?? ''}`}
      style={size ? { width: size, height: size } : undefined}
      role="img"
      aria-label={`QR-Code für ${text}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function ConnectionBadge({ status }: { status: LiveStatus }) {
  if (status === 'open') return null;
  const text =
    status === 'connecting'
      ? 'Verbinde …'
      : status === 'reconnecting'
        ? 'Verbindung wird wiederhergestellt …'
        : status === 'ended'
          ? 'Beendet'
          : 'Getrennt';
  return (
    <div className="connection-badge" role="status">
      <span className="dot dot-live" /> {text}
    </div>
  );
}

/** Formatiert einen 6-stelligen Code lesbar: 123 456 */
export const formatCode = (code: string | null | undefined) => (code ? `${code.slice(0, 3)} ${code.slice(3)}` : '');

/** Adresse, unter der Teilnehmende beitreten – ohne https:// für die Anzeige. */
export const joinHost = () => location.host;
export const joinUrl = (code: string | null) => `${location.origin}/${code ?? ''}`;
