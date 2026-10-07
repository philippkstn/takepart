import type { ParticipantView } from '@slides/shared';
import { useCallback, useEffect, useState } from 'react';
import { LegalLinks } from '../components/LegalLinks.tsx';
import { Link } from 'react-router';
import { ParticipantActivity } from '../components/participant/Activities.tsx';
import { BrandMark, ConnectionBadge, FullScreenSpinner } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { brandStyle } from '../lib/brand.ts';
import { useLive } from '../lib/live.ts';
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

  const { view, status } = useLive<ParticipantView>(token ? `token=${encodeURIComponent(token)}` : null);

  if (joinError) {
    return (
      <div className="p-shell">
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
      <div className="p-shell">
        <main className="p-main home">
          <div className="card card-pad stack anim-rise" style={{ textAlign: 'center' }}>
            <h1>Danke fürs Mitmachen!</h1>
            <p className="muted">Diese Präsentation ist beendet.</p>
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
    <div className="p-shell" style={brandStyle(view.run.brand)}>
      <header className="p-header">
        <span className="p-brand">
          {view.run.brand?.logoUrl ? (
            <img className="p-logo" src={view.run.brand.logoUrl} alt={view.run.brand.name} />
          ) : (
            <BrandMark size={24} />
          )}
          <span className="p-title">{view.run.title}</span>
        </span>
        {view.slideCount > 0 && view.slideIndex >= 0 && (
          <span className="pill tabular">
            {view.slideIndex + 1} / {view.slideCount}
          </span>
        )}
      </header>
      <ConnectionBadge status={status} />
      <main className="p-main">
        <ParticipantActivity key={`${view.slide?.id ?? 'none'}-${view.sentence?.round ?? 0}`} view={view} token={token} />
      </main>
      <footer className="p-footer">
        <LegalLinks imprint={false} />
      </footer>
    </div>
  );
}
