import QRCode from 'qrcode';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LiveStatus } from '../lib/live.ts';

/* ───────────── Toasts ───────────── */

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}
const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`}>
            {t.text}
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
