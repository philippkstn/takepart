import type { ParticipantView } from '@slides/shared';
import { useCallback, useEffect, useState } from 'react';
import { LegalLinks } from '../components/LegalLinks.tsx';
import { Link } from 'react-router';
import { ParticipantActivity } from '../components/participant/Activities.tsx';
import { ParkingButton } from '../components/participant/BoardActivity.tsx';
import { CountdownAlert } from '../components/participant/CountdownAlert.tsx';
import { PauseActivity, PauseAlert } from '../components/participant/PauseActivity.tsx';
import { PickedAlert, SignalButton } from '../components/participant/SignalBar.tsx';
import { CallbackNotice } from '../components/participant/Breakout.tsx';
import { CountdownBadge } from '../components/Countdown.tsx';
import { PhaseBanner } from '../components/participant/PhaseBanner.tsx';
import { TurnStrip } from '../components/participant/TurnStrip.tsx';
import { BrandMark, ConnectionBadge, FullScreenSpinner } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { brandStyle } from '../lib/brand.ts';
import { useLive } from '../lib/live.ts';
import { usePreload } from '../lib/slideImage.ts';
import './participant.css';

const storageKey = (code: string) => `slides:participant:${code}`;

function readToken(code: string): string | undefined {
  try {
    return localStorage.getItem(storageKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(code: string, token: string) {
  try {
    localStorage.setItem(storageKey(code), token);
  } catch {
    /* privater Modus: Token gilt dann nur für diesen Tab */
  }
}

/** Breite auf dem Desktop: Kartenwand, Pinnwand und freigegebene Folien nutzen den Platz, Sammeln etwas schmaler */
function mainWidth(view: ParticipantView): string {
  const slide = view.slide;
  if (!slide || view.leaderboard) return '';
  if (slide.type === 'pinboard') return 'is-wide';
  if (slide.type === 'image' && slide.config.asset) return 'is-slide';
  // Sammeln: erst mit eigenen Karten breiter (Formular und Karten nebeneinander), vorher schmal und mittig
  if (slide.type === 'board') return slide.config.mode !== 'collect' ? 'is-wide' : view.posts.length > 0 ? 'is-medium' : '';
  return '';
}

/**
 * Neu aufbauen bei jeder Folie (und Runde beim Satz-Spiel) – außer zwischen
 * Bildfolien: Die bleiben stehen, damit das nächste Bild ohne schwarzen
 * Zwischenstand und ohne erneutes Hereingleiten wechselt.
 */
function activityKey(view: ParticipantView): string {
  if (view.slide?.type === 'image' && view.slide.config.asset && !view.leaderboard) return 'image';
  return `${view.slide?.id ?? 'none'}-${view.sentence?.round ?? 0}`;
}

export default function ParticipantPage({ code }: { code: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const join = useCallback(async () => {
    setJoinError(null);
    try {
      const res = await api<{ token: string }>('/api/join', { body: { code, token: readToken(code) } });
      writeToken(code, res.token);
      setToken(res.token);
    } catch (err) {
      setJoinError(errorMessage(err));
    }
  }, [code]);

  useEffect(() => {
    void join();
  }, [join]);

  const { view, status, offset, handoutUrl: endedHandout } = useLive<ParticipantView>(token ? `token=${encodeURIComponent(token)}` : null);
  const handoutUrl = endedHandout ?? view?.handoutUrl ?? null;
  usePreload(view?.preload ?? []);

  if (joinError) {
    return (
      <div className="p-shell takepart-scope">
        <main className="p-main home">
          <div className="card card-pad stack anim-rise">
            <h1>Das hat nicht geklappt</h1>
            <p className="muted">{joinError}</p>
            <div className="row">
              <button className="btn btn-primary" onClick={join}>
                Nochmal versuchen
              </button>
              <Link className="btn" to="/">
                Anderen Code eingeben
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (status === 'ended' || status === 'rejected' || view?.run.ended) {
    return (
      <div className="p-shell takepart-scope">
        <main className="p-main home">
          <div className="card card-pad stack anim-rise" style={{ textAlign: 'center' }}>
            <h1>Danke fürs Mitmachen!</h1>
            <p className="muted">Diese Präsentation ist beendet.</p>
            {handoutUrl && (
              <Link className="btn btn-primary" to={handoutUrl}>
                Folien &amp; Ergebnisse ansehen
              </Link>
            )}
            <Link className="btn" to="/">
              Zur Startseite
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (!view || !token) return <FullScreenSpinner />;

  return (
    <div className="p-shell takepart-scope" style={brandStyle(view.run.brand)}>
      <div className="p-top">
        <header className="p-header">
          <span className="p-brand">
            {view.run.brand?.logoUrl ? (
              <img className="p-logo" src={view.run.brand.logoUrl} alt={view.run.brand.name} />
            ) : (
              <BrandMark size={24} />
            )}
            <span className="p-title">{view.run.title}</span>
          </span>
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {/* Eigene Gruppe auch auf späteren Folien im Blick */}
            {view.team && view.slide?.id !== view.team.slideId && (
              <span className="pill" title={view.team.members.length > 0 ? `mit ${view.team.members.join(', ')}` : undefined}>
                {view.team.name}
              </span>
            )}
            <ParkingButton parking={view.parking} token={token} />
            <SignalButton signals={view.signals} offset={offset} token={token} />
            {/* Phasen stehen groß darunter (PhaseBanner) */}
            {!view.countdown?.phases?.length && <CountdownBadge countdown={view.countdown} offset={offset} className="pill p-countdown" />}
            {handoutUrl && (
              <Link className="pill" to={handoutUrl} target="_blank">
                Folien
              </Link>
            )}
            {view.slideCount > 0 && view.slideIndex >= 0 && (
              <span className="pill tabular">
                {view.slideIndex + 1} / {view.slideCount}
              </span>
            )}
          </span>
        </header>
        {/* In der Pause zählt nur die Pausenzeit */}
        {!view.pause && <PhaseBanner countdown={view.countdown} offset={offset} />}
        {!view.pause && <TurnStrip turn={view.myTurn} />}
      </div>
      <ConnectionBadge status={status} />
      {/* Hinweise oben stapeln, statt sich zu überdecken */}
      <div className="p-alerts">
        <CountdownAlert countdown={view.countdown} offset={offset} />
        <PauseAlert pause={view.pause} offset={offset} />
        <PickedAlert picked={view.picked} />
      </div>
      {/* Kartenwand: auf dem Desktop breiter, damit Gruppen und Felder nebeneinander passen */}
      <main className={`p-main ${view.pause ? '' : mainWidth(view)}`}>
        <CallbackNotice callback={view.callback} offset={offset} />
        {view.pause && <PauseActivity pause={view.pause} token={token} offset={offset} parking={view.parking.length > 0} />}
        {/* Während der Pause nur versteckt, damit angefangene Eingaben (z. B. eine Karte) erhalten bleiben */}
        <div className="p-activity" hidden={!!view.pause}>
          <ParticipantActivity key={activityKey(view)} view={view} token={token} />
        </div>
      </main>
      <footer className="p-footer">
        <LegalLinks imprint={false} />
      </footer>
    </div>
  );
}
