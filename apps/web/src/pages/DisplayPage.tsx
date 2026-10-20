import type { DisplayMessage, DisplayView } from '@slides/shared';
import { useQuery } from '@tanstack/react-query';
import { EyeOff, Maximize, Minimize, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CountdownPopup } from '../components/CountdownPopup.tsx';
import { InkOverlay } from '../components/Ink.tsx';
import { Stage } from '../components/Stage.tsx';
import { ConnectionBadge, FullScreenSpinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { playEnd, playWarning, useCountdownMoments, useCountdownSounds } from '../lib/countdownSound.ts';
import { useLive } from '../lib/live.ts';
import { usePresenterKeys } from '../lib/presenterKeys.ts';
import { authStatus } from '../lib/passkey.ts';
import './display.css';

/**
 * Beamer-Ansicht über einen geheimen Anzeige-Link. Sie kann nichts steuern –
 * außer du bist im selben Browser angemeldet: Dann blättern Pfeiltasten,
 * Leertaste und Presenter durch Folien und Animationen, B/W schaltet Schwarz-
 * bzw. Weißbild.
 */
export default function DisplayPage() {
  const { token = '' } = useParams();
  const { view, status, offset, ink, send } = useLive<DisplayView>(`display=${encodeURIComponent(token)}`);
  const wasHidden = useVisibilityReport(status === 'open', send);
  const auth = useQuery({ queryKey: ['auth'], queryFn: authStatus });
  const isHost = !!auth.data?.loggedIn;
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const runId = view?.run.id;
  const sound = useCountdownSounds(view?.countdown ?? null, offset);
  // Pause: dieselben Töne eine Minute vor Ende und bei Ablauf
  useCountdownMoments(view?.pause ?? null, offset, (moment) => (moment === 'warning' ? playWarning() : playEnd()));

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Mauszeiger und Knopf nach kurzer Zeit ausblenden.
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), 2500);
    const onMove = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2500);
    };
    // Bildschirmfreigabe: Wechselt die Moderation ins Steuerpult, sofort ausblenden
    const onBlur = () => {
      window.clearTimeout(timer);
      setIdle(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('blur', onBlur);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Angemeldet: Tasten und Presenter steuern die Präsentation direkt von hier
  usePresenterKeys(
    isHost && runId ? (cmd) => api(`/api/runs/${runId}/command`, { body: cmd }).catch(() => {}) : null,
    view?.blank ?? null,
    (e) => {
      // F bzw. die „Präsentation starten“-Taste vieler Presenter (F5): Vollbild
      if (e.key === 'f' || e.key === 'F' || e.key === 'F5') {
        e.preventDefault();
        toggleFullscreen();
        return true;
      }
      return false;
    },
    !!view?.pause,
  );

  if (status === 'rejected') {
    return (
      <div className="center-screen">
        <div className="card card-pad stack" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1>Anzeige-Link ungültig</h1>
          <p className="muted">Der Link wurde erneuert oder die Präsentation gelöscht. Öffne den aktuellen Link aus dem Steuerpult.</p>
        </div>
      </div>
    );
  }
  if (status === 'ended') {
    return (
      <div className="center-screen">
        <h1 className="display-font" style={{ fontSize: '3rem' }}>
          Danke!
        </h1>
      </div>
    );
  }
  if (!view) return <FullScreenSpinner />;

  return (
    <div className={`display-page ${idle ? 'is-idle' : ''}`}>
      {/* Feste 16:9-Bühne: Laserpointer und Zeichnungen liegen so exakt wie im Steuerpult */}
      <div className="display-box">
        <Stage
          view={view}
          offset={offset}
          overlay={
            <>
              <InkOverlay ink={ink} />
              <CountdownPopup countdown={view.countdown} offset={offset} />
            </>
          }
        />
      </div>
      <Preload urls={view.preload} />
      {wasHidden.shown && (
        <div className="display-hidden-note" role="status">
          <EyeOff size={16} aria-hidden />
          <span>
            Dieses Fenster war verdeckt – Browser zeichnen verdeckte Fenster nicht neu. Für Beamer oder Bildschirmfreigabe sichtbar lassen.
          </span>
          <button className="icon-btn" onClick={wasHidden.dismiss} aria-label="Hinweis schließen">
            <X size={16} />
          </button>
        </div>
      )}
      <ConnectionBadge status={status} />
      {(view.countdown || view.pause) && sound.locked && (
        <button className="display-sound btn btn-small" onClick={sound.unlock} title="Ton für den Countdown freigeben">
          <VolumeX /> Ton aktivieren
        </button>
      )}
      <button
        className="display-fs icon-btn"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? 'Vollbild verlassen' : 'Vollbild'}
        title="Vollbild (F)"
      >
        {fullscreen ? <Minimize /> : <Maximize />}
      </button>
    </div>
  );
}

/**
 * Meldet dem Server, ob dieses Fenster sichtbar ist (Page Visibility API) – das
 * Steuerpult zeigt so an, wenn der Beamer verdeckt oder minimiert ist. War das
 * Fenster länger verdeckt, erscheint beim Zurückkommen kurz ein Hinweis, nur hier.
 */
function useVisibilityReport(open: boolean, send: (msg: DisplayMessage) => void) {
  const [shown, setShown] = useState(false);
  // Nach jedem (Neu-)Verbinden den aktuellen Stand melden
  useEffect(() => {
    if (!open) return;
    const report = () => send({ type: 'visibility', hidden: document.visibilityState === 'hidden' });
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [open, send]);
  useEffect(() => {
    let hiddenAt: number | null = null;
    let timer: number | undefined;
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > 1500) {
        setShown(true);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setShown(false), 8000);
      }
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onChange);
    };
  }, []);
  return { shown, dismiss: useCallback(() => setShown(false), []) };
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

/** Bild der nächsten Folie schon laden, damit der Wechsel nicht flackert. */
function Preload({ urls }: { urls: string[] }) {
  useEffect(() => {
    for (const url of urls) new Image().src = url;
  }, [urls.join('|')]);
  return null;
}
