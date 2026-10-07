import type { DisplayView } from '@slides/shared';
import { useQuery } from '@tanstack/react-query';
import { Maximize, Minimize } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { InkOverlay } from '../components/Ink.tsx';
import { Stage } from '../components/Stage.tsx';
import { ConnectionBadge, FullScreenSpinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
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
  const { view, status, offset, ink } = useLive<DisplayView>(`display=${encodeURIComponent(token)}`);
  const auth = useQuery({ queryKey: ['auth'], queryFn: authStatus });
  const isHost = !!auth.data?.loggedIn;
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const runId = view?.run.id;

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
    window.addEventListener('mousemove', onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', onMove);
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
        <Stage view={view} offset={offset} overlay={<InkOverlay ink={ink} />} />
      </div>
      <Preload urls={view.preload} />
      <ConnectionBadge status={status} />
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
