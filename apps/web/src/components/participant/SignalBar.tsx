import { SIGNAL_KINDS, SIGNAL_LABELS, type SignalKind } from '@slides/shared';
import { Check, Coffee, Gauge, Hand, MessageCircleQuestion, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { useServerNow } from '../../lib/serverNow.ts';
import './signals.css';

const ICONS: Record<SignalKind, ReactNode> = {
  fast: <Gauge aria-hidden />,
  question: <MessageCircleQuestion aria-hidden />,
  break: <Coffee aria-hidden />,
};

const HINTS: Record<SignalKind, string> = {
  fast: 'Das Tempo ist mir gerade zu hoch',
  question: 'Ich habe eine Frage',
  break: 'Ich bräuchte eine kurze Pause',
};

/**
 * Handzeichen: dezenter Knopf im Kopf, darunter ein Blatt mit den Signalen.
 * Nur die Moderation sieht sie (nie der Beamer). Ein Signal erlischt nach drei
 * Minuten – gezählt wird anhand des Ablaufzeitpunkts vom Server.
 */
export function SignalButton({
  signals,
  offset,
  token,
}: {
  signals: Partial<Record<SignalKind, number>> | undefined;
  offset: number;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<SignalKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expiries = Object.values(signals ?? {});
  const now = useServerNow(offset, expiries.length > 0, 1000);
  const active = SIGNAL_KINDS.filter((k) => (signals?.[k] ?? 0) > now);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = async (kind: SignalKind) => {
    setBusy(kind);
    setError(null);
    try {
      await api('/api/p/signal', { body: { kind, active: !active.includes(kind) }, participant: token });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const label = active.length > 0 ? `Handzeichen: ${active.map((k) => SIGNAL_LABELS[k]).join(', ')}` : 'Handzeichen geben';
  return (
    <>
      <button
        className={`pill signal-pill ${active.length > 0 ? 'pill-accent' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
      >
        <Hand aria-hidden />
        {active.length > 0 && <span className="tabular">{active.length}</span>}
      </button>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet card card-pad stack anim-rise" role="dialog" aria-label="Handzeichen" onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <h2>Handzeichen</h2>
              <button className="icon-btn" aria-label="Schließen" onClick={() => setOpen(false)}>
                <X />
              </button>
            </div>
            <p className="small muted">
              Nur die Moderation sieht, wie viele ein Zeichen geben – ohne Namen. Es erlischt nach drei Minuten.
            </p>
            <div className="signal-list">
              {SIGNAL_KINDS.map((kind) => {
                const on = active.includes(kind);
                const left = on ? Math.max(1, Math.ceil((signals![kind]! - now) / 60_000)) : 0;
                return (
                  <button
                    key={kind}
                    className={`signal-option ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    disabled={busy !== null}
                    onClick={() => toggle(kind)}
                  >
                    {ICONS[kind]}
                    <span className="grow">
                      <strong>{SIGNAL_LABELS[kind]}</strong>
                      <span className="small muted">{on ? `Aktiv · noch ${left} Min. · Tippen nimmt es zurück` : HINTS[kind]}</span>
                    </span>
                    {on && <Check aria-hidden className="signal-check" />}
                  </button>
                );
              })}
            </div>
            {error && (
              <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Bei der Zufallsauswahl gezogen: Hinweis oben, bis er geschlossen wird oder jemand anderes dran ist */
export function PickedAlert({ picked }: { picked: boolean | undefined }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!picked) setDismissed(false);
  }, [picked]);
  if (!picked || dismissed) return null;
  return (
    <div className="countdown-alert picked-alert anim-pop" role="alert">
      <Hand aria-hidden />
      <div className="grow">
        <strong>Du bist dran!</strong>
        <div className="small">Du wurdest per Zufall ausgewählt.</div>
      </div>
      <button className="icon-btn" aria-label="Schließen" onClick={() => setDismissed(true)}>
        <X />
      </button>
    </div>
  );
}
