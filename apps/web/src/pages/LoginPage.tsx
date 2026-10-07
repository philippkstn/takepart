import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { BrandMark, FullScreenSpinner } from '../components/ui.tsx';
import { authStatus, loginWithPasskey, passkeyError, registerPasskey } from '../lib/passkey.ts';
import './participant.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['auth'], queryFn: authStatus });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState('');

  if (status.isLoading) return <FullScreenSpinner />;
  if (status.data?.loggedIn) return <Navigate to="/admin" replace />;
  const firstSetup = status.data && !status.data.hasPasskey;

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['auth'] });
    navigate('/admin', { replace: true });
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginWithPasskey();
      await done();
    } catch (err) {
      setError(passkeyError(err));
    } finally {
      setBusy(false);
    }
  };

  const setup = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerPasskey('Erster Passkey', setupToken.trim());
      await done();
    } catch (err) {
      setError(passkeyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-shell">
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
                Noch ist kein Passkey hinterlegt. Gib den Setup-Token ein – er steht im Server-Log (oder als SETUP_TOKEN in der
                Konfiguration) – und lege deinen ersten Passkey an.
              </p>
            </div>
            <label className="field">
              <span>Setup-Token</span>
              <input className="input" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" required />
            </label>
            {error && <div className="error-box">{error}</div>}
            <button className="btn btn-primary btn-large btn-block" disabled={busy || !setupToken.trim()}>
              <KeyRound /> Passkey anlegen
            </button>
          </form>
        ) : (
          <div className="card card-pad stack anim-rise">
            <div className="stack-s">
              <h1>Anmelden</h1>
              <p className="muted">Mit deinem Passkey – Fingerabdruck, Gesicht oder Geräte-PIN.</p>
            </div>
            {error && <div className="error-box">{error}</div>}
            <button className="btn btn-primary btn-large btn-block" onClick={login} disabled={busy}>
              <KeyRound /> Mit Passkey anmelden
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
