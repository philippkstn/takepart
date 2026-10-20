import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { SiteFooter } from '../components/LegalLinks.tsx';
import { BrandMark, FullScreenSpinner } from '../components/ui.tsx';
import {
  authStatus,
  loginWithPasskey,
  loginWithPassword,
  MIN_PASSWORD_LENGTH,
  passkeyError,
  registerPasskey,
  setupWithPassword,
} from '../lib/passkey.ts';
import './participant.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['auth'], queryFn: authStatus });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [setupMethod, setSetupMethod] = useState<'passkey' | 'password'>('passkey');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (status.isLoading) return <FullScreenSpinner />;
  if (status.data?.loggedIn) return <Navigate to="/admin" replace />;
  const firstSetup = !!status.data?.setupNeeded;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(passkeyError(err));
    } finally {
      setBusy(false);
    }
  };

  const setup = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      setupMethod === 'passkey'
        ? registerPasskey('Erster Passkey', { setupToken: setupToken.trim(), username: username.trim() })
        : setupWithPassword(username.trim(), password, setupToken.trim()),
    );
  };

  const loginPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(() => loginWithPassword(username.trim(), password));
  };

  const setupReady =
    !!setupToken.trim() && username.trim().length >= 2 && (setupMethod === 'passkey' || password.length >= MIN_PASSWORD_LENGTH);

  return (
    <div className="p-shell takepart-scope">
      <main className="p-main home">
        <div className="home-brand anim-rise">
          <BrandMark size={40} />
          <span className="display-font">TakePart</span>
        </div>
        {firstSetup ? (
          <form className="card card-pad stack anim-rise" onSubmit={setup}>
            <div className="stack-s">
              <h1>Einrichten</h1>
              <p className="muted">
                Noch gibt es kein Konto. Gib den Setup-Token ein – er steht im Server-Log (oder als SETUP_TOKEN in der Konfiguration) – und
                lege dein Admin-Konto mit Passkey oder Passwort an. Weitere Konten legst du danach in den Einstellungen an.
              </p>
            </div>
            <label className="field">
              <span>Setup-Token</span>
              <input className="input" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" required />
            </label>
            <div className="segmented" role="group" aria-label="Anmeldeart" style={{ justifySelf: 'start' }}>
              <button type="button" aria-pressed={setupMethod === 'passkey'} onClick={() => setSetupMethod('passkey')}>
                Passkey
              </button>
              <button type="button" aria-pressed={setupMethod === 'password'} onClick={() => setSetupMethod('password')}>
                Passwort
              </button>
            </div>
            <label className="field">
              <span>Benutzername</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                maxLength={100}
                required
              />
            </label>
            {setupMethod === 'password' && (
              <>
                <label className="field">
                  <span>Passwort (mindestens {MIN_PASSWORD_LENGTH} Zeichen)</span>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    maxLength={200}
                    required
                  />
                </label>
              </>
            )}
            {error && <div className="error-box">{error}</div>}
            <button className="btn btn-primary btn-large btn-block" disabled={busy || !setupReady}>
              {setupMethod === 'passkey' ? (
                <>
                  <KeyRound /> Passkey anlegen
                </>
              ) : (
                <>
                  <LogIn /> Einrichten und anmelden
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="card card-pad stack anim-rise">
            <div className="stack-s">
              <h1>Anmelden</h1>
              <p className="muted">Mit deinem Passkey – Fingerabdruck, Gesicht oder Geräte-PIN – oder mit Benutzername und Passwort.</p>
            </div>
            {error && <div className="error-box">{error}</div>}
            <button className="btn btn-primary btn-large btn-block" onClick={() => void run(loginWithPasskey)} disabled={busy}>
              <KeyRound /> Mit Passkey anmelden
            </button>
            <form className="stack login-password" onSubmit={loginPassword}>
              <label className="field">
                <span>Benutzername</span>
                <input
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  maxLength={100}
                  required
                />
              </label>
              <label className="field">
                <span>Passwort</span>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  maxLength={200}
                  required
                />
              </label>
              <button className="btn btn-ghost btn-large btn-block" disabled={busy || !username.trim() || !password}>
                <LogIn /> Mit Passwort anmelden
              </button>
            </form>
          </div>
        )}
      </main>
      <SiteFooter>
        <Link to="/">Zur Teilnahme</Link>
      </SiteFooter>
    </div>
  );
}
