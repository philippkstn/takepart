import { MonitorPlay, MonitorStop } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { BrandMark, FullScreenSpinner } from '../components/ui.tsx';
import { usePublicConfig } from '../lib/publicConfig.ts';
import { connectTeams, displayTokenFrom, teamsTabUrl, type TeamsSdk } from '../lib/msteams.ts';
import DisplayPage from './DisplayPage.tsx';

/**
 * Microsoft-Teams-App (siehe apps/server/src/msteams.ts):
 *   /teams/einrichten   Konfigurationsseite beim Hinzufügen zum Meeting (Anzeige-Link einfügen)
 *   /teams/tab/:token   Seitenleiste („Auf Bühne teilen“) und Meeting-Bühne (Beamer-Ansicht)
 * Ist die Teams-App auf dem Server ausgeschaltet, zeigen beide nur einen Hinweis.
 */

type Teams = { state: 'loading' } | { state: 'outside' } | { state: 'ready'; sdk: TeamsSdk; frameContext: string | undefined };

function useTeams(): Teams {
  const [teams, setTeams] = useState<Teams>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    void connectTeams().then(async (sdk) => {
      if (!sdk) return alive && setTeams({ state: 'outside' });
      const context = await sdk.app.getContext().catch(() => null);
      if (alive) setTeams({ state: 'ready', sdk, frameContext: context?.page.frameContext });
    });
    return () => {
      alive = false;
    };
  }, []);
  return teams;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="center-screen takepart-scope">
      <div className="card card-pad stack" style={{ maxWidth: 420, textAlign: 'center', justifyItems: 'center' }}>
        <BrandMark />
        <h1 style={{ fontSize: '1.25rem' }}>{title}</h1>
        <div className="muted stack-s">{children}</div>
      </div>
    </div>
  );
}

function Disabled() {
  return (
    <Notice title="Teams-App ausgeschaltet">
      <p>Auf diesem TakePart-Server ist die Teams-App nicht eingeschaltet. Nutze den Anzeige-Link im Browser und teile das Fenster.</p>
    </Notice>
  );
}

/** Beim Hinzufügen der App zu einem Meeting: Anzeige-Link aus dem Steuerpult einfügen */
export function TeamsConfigPage() {
  const config = usePublicConfig();
  const teams = useTeams();
  const [input, setInput] = useState('');
  const token = displayTokenFrom(input, location.origin);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const sdk = teams.state === 'ready' ? teams.sdk : null;
  useEffect(() => {
    if (!sdk) return;
    sdk.pages.config.registerOnSaveHandler((event) => {
      const current = tokenRef.current;
      if (!current) return event.notifyFailure('Anzeige-Link fehlt');
      sdk.pages.config
        .setConfig({
          entityId: 'takepart-display',
          suggestedDisplayName: 'TakePart',
          contentUrl: teamsTabUrl(location.origin, current),
          websiteUrl: `${location.origin}/d/${current}`,
        })
        .then(() => event.notifySuccess())
        .catch(() => event.notifyFailure('Speichern fehlgeschlagen'));
    });
  }, [sdk]);
  useEffect(() => {
    sdk?.pages.config.setValidityState(!!token);
  }, [sdk, token]);

  if (!config || teams.state === 'loading') return <FullScreenSpinner />;
  if (!config.teams) return <Disabled />;
  if (teams.state === 'outside')
    return (
      <Notice title="Nur in Microsoft Teams">
        <p>Diese Seite öffnet Teams, wenn du TakePart zu einem Meeting hinzufügst.</p>
      </Notice>
    );

  const invalid = input.trim() !== '' && !token;
  return (
    <main className="takepart-scope stack" style={{ padding: 20, maxWidth: 560 }}>
      <div className="row" style={{ gap: 10 }}>
        <BrandMark />
        <h1 style={{ fontSize: '1.25rem' }}>TakePart im Meeting</h1>
      </div>
      <p className="muted">
        Starte die Präsentation in TakePart und kopiere im Steuerpult den Anzeige-Link. Er zeigt dieselbe Beamer-Ansicht auf der
        Meeting-Bühne – Folien, Ergebnisse und Countdown, live für alle im Meeting.
      </p>
      <label className="field">
        <span>Anzeige-Link</span>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`${location.origin}/d/…`}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          autoFocus
        />
      </label>
      {invalid && (
        <p className="error-box" role="alert">
          Das ist kein Anzeige-Link dieses Servers. Er beginnt mit {location.origin}/d/
        </p>
      )}
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Gilt für eine Durchführung. Erneuerst du den Link im Steuerpult oder startest neu, trägst du ihn hier über „Einstellungen“
        des Tabs neu ein.
      </p>
    </main>
  );
}

/** Seitenleiste und Meeting-Bühne laden diese Seite; der Teams-Kontext entscheidet, was erscheint */
export function TeamsTabPage() {
  const config = usePublicConfig();
  const teams = useTeams();
  const { token = '' } = useParams();

  if (!config || teams.state === 'loading') return <FullScreenSpinner />;
  if (!config.teams) return <Disabled />;
  if (teams.state === 'outside')
    return (
      <Notice title="Nur in Microsoft Teams">
        <p>
          Im Browser öffnest du die Beamer-Ansicht über den <a href={`/d/${token}`}>Anzeige-Link</a>.
        </p>
      </Notice>
    );
  if (teams.frameContext === 'meetingStage') return <DisplayPage embedded />;
  return <SidePanel sdk={teams.sdk} token={token} />;
}

function SidePanel({ sdk, token }: { sdk: TeamsSdk; token: string }) {
  const [canShare, setCanShare] = useState<boolean | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    try {
      sdk.meeting.getAppContentStageSharingCapabilities((err, result) => {
        if (alive) setCanShare(!err && !!result?.doesAppHaveSharePermission);
      });
    } catch {
      setCanShare(false);
    }
    // Teams meldet Änderungen des Teilen-Zustands nicht – kurz nachfragen
    const poll = () => {
      try {
        sdk.meeting.getAppContentStageSharingState((err, result) => {
          if (alive && !err) setSharing(!!result?.isAppSharing);
        });
      } catch {
        /* außerhalb eines Meetings */
      }
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sdk]);

  const share = () => {
    setError(null);
    sdk.meeting.shareAppContentToStage((err) => {
      if (err) setError('Teilen hat nicht geklappt. Nur Organisation und Referierende dürfen die Bühne teilen.');
      else setSharing(true);
    }, teamsTabUrl(location.origin, token));
  };
  const stop = () => {
    setError(null);
    sdk.meeting.stopSharingAppContentToStage((err) => {
      if (err) setError('Beenden hat nicht geklappt – nutze „Präsentation beenden“ in Teams.');
      else setSharing(false);
    });
  };

  return (
    <main className="takepart-scope stack" style={{ padding: 16 }}>
      <div className="row" style={{ gap: 10 }}>
        <BrandMark size={24} />
        <h1 style={{ fontSize: '1.1rem' }}>TakePart</h1>
      </div>
      {canShare === null ? null : canShare ? (
        <>
          <p className="muted">
            Zeigt die Beamer-Ansicht auf der Meeting-Bühne – jede Person sieht Folien und Ergebnisse live in ihrem Teams-Fenster.
            Gesteuert wird wie gewohnt im Steuerpult.
          </p>
          {sharing ? (
            <button className="btn btn-block" onClick={stop}>
              <MonitorStop /> Teilen beenden
            </button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={share}>
              <MonitorPlay /> Auf Bühne teilen
            </button>
          )}
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Gäste ohne Microsoft-Konto sehen geteilte Apps nicht – für sie den Teilnahme-Link oder QR-Code zeigen.
          </p>
        </>
      ) : (
        <p className="muted">Die Moderation zeigt TakePart auf der Meeting-Bühne. Teilen dürfen nur Organisation und Referierende.</p>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
