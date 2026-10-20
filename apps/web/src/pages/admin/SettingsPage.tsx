import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Spinner, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { authStatus, MIN_PASSWORD_LENGTH, passkeyError, registerPasskey, type Account } from '../../lib/passkey.ts';
import { BrandSettings } from './BrandSettings.tsx';
import { UsersSettings } from './UsersSettings.tsx';

interface Passkey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function SettingsPage() {
  const auth = useQuery({ queryKey: ['auth'], queryFn: authStatus });
  const passkeys = useQuery({ queryKey: ['passkeys'], queryFn: () => api<Passkey[]>('/api/auth/passkeys') });
  const account = auth.data?.account;

  return (
    <main className="page stack" style={{ maxWidth: 720 }}>
      <h1>Einstellungen</h1>
      {account ? <AccountSettings account={account} hasPasskey={!!passkeys.data?.length} /> : <Spinner />}
      <PasskeySettings list={passkeys.data} loading={passkeys.isLoading} hasPassword={!!account?.hasPassword} />
      {account?.isAdmin && <UsersSettings ownId={account.id} />}
      <BrandSettings />
    </main>
  );
}

function AccountSettings({ account, hasPasskey }: { account: Account; hasPasskey: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState(account.username);
  const [password, setPassword] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['auth'] });

  const rename = useMutation({
    mutationFn: () => api('/api/account', { method: 'PATCH', body: { username: username.trim() } }),
    onSuccess: async () => {
      toast('Benutzername gespeichert');
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const savePassword = useMutation({
    mutationFn: () => api('/api/account/password', { method: 'PUT', body: { password } }),
    onSuccess: async () => {
      toast(account.hasPassword ? 'Passwort geändert – andere Sitzungen sind abgemeldet' : 'Passwort angelegt');
      setPassword('');
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const removePassword = useMutation({
    mutationFn: () => api('/api/account/password', { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Passwort entfernt');
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    rename.mutate();
  };
  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    savePassword.mutate();
  };

  return (
    <section className="card card-pad stack">
      <div className="stack-s">
        <h2>Dein Konto</h2>
        <p className="muted small">
          Du meldest dich mit einem Passkey oder mit Benutzername und Passwort an – beides geht gleichzeitig.
          {account.isAdmin && ' Als Admin verwaltest du außerdem die Konten.'}
        </p>
      </div>
      <form className="row" onSubmit={submitName}>
        <label className="field grow">
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
        <button
          className="btn btn-ghost"
          style={{ alignSelf: 'end' }}
          disabled={rename.isPending || username.trim().length < 2 || username.trim() === account.username}
        >
          Speichern
        </button>
      </form>
      <form className="stack" onSubmit={submitPassword}>
        <label className="field">
          <span>
            {account.hasPassword ? 'Neues Passwort' : 'Passwort'} (mindestens {MIN_PASSWORD_LENGTH} Zeichen)
          </span>
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
        <div className="row">
          <button className="btn btn-primary" disabled={savePassword.isPending || password.length < MIN_PASSWORD_LENGTH}>
            {account.hasPassword ? 'Passwort ändern' : 'Passwort anlegen'}
          </button>
          {account.hasPassword && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!hasPasskey || removePassword.isPending}
              onClick={() =>
                window.confirm('Passwort entfernen? Danach geht die Anmeldung nur noch per Passkey.') && removePassword.mutate()
              }
            >
              <Trash2 /> Passwort entfernen
            </button>
          )}
        </div>
        {account.hasPassword && !hasPasskey && (
          <p className="small faint">Entfernen geht erst, wenn ein Passkey hinterlegt ist – sonst könntest du dich nicht mehr anmelden.</p>
        )}
      </form>
    </section>
  );
}

function PasskeySettings({ list, loading, hasPassword }: { list: Passkey[] | undefined; loading: boolean; hasPassword: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await registerPasskey(label.trim() || 'Weiterer Passkey');
      setLabel('');
      toast('Passkey hinzugefügt');
      await queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    } catch (err) {
      toast(passkeyError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['passkeys'] }),
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <section className="card card-pad stack">
      <div className="stack-s">
        <h2>Passkeys</h2>
        <p className="muted small">Mit jedem dieser Passkeys kannst du dich anmelden – z. B. Laptop und Handy fürs Steuerpult.</p>
      </div>
      {loading ? (
        <Spinner />
      ) : list?.length ? (
        <ul className="passkey-list">
          {list.map((p) => (
            <li key={p.id}>
              <KeyRound size={18} />
              <div className="grow">
                <strong>{p.label}</strong>
                <div className="small faint">
                  angelegt {new Date(p.createdAt).toLocaleDateString('de-DE')}
                  {p.lastUsedAt && ` · zuletzt benutzt ${new Date(p.lastUsedAt).toLocaleString('de-DE')}`}
                </div>
              </div>
              <button
                className="icon-btn"
                aria-label="Löschen"
                title={list.length <= 1 && !hasPassword ? 'Der letzte Passkey bleibt, solange es kein Passwort gibt' : 'Löschen'}
                disabled={list.length <= 1 && !hasPassword}
                onClick={() => window.confirm(`Passkey „${p.label}“ entfernen?`) && remove.mutate(p.id)}
              >
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small faint">Noch kein Passkey hinterlegt.</p>
      )}
      <div className="row">
        <input
          className="input grow"
          placeholder="Name, z. B. iPhone"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
        />
        <button className="btn btn-primary" onClick={add} disabled={busy}>
          <Plus /> Passkey hinzufügen
        </button>
      </div>
    </section>
  );
}
