import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Spinner, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { MIN_PASSWORD_LENGTH } from '../../lib/passkey.ts';

interface UserItem {
  id: number;
  username: string;
  isAdmin: boolean;
  hasPassword: boolean;
  passkeys: number;
  presentations: number;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Kontoverwaltung für Admins. Präsentationen bleiben privat – auch Admins sehen nur die eigenen. */
export function UsersSettings({ ownId }: { ownId: number }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['users'], queryFn: () => api<UserItem[]>('/api/users') });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const onError = (err: unknown) => toast(errorMessage(err), 'error');

  const create = useMutation({
    mutationFn: () => api('/api/users', { body: { username: username.trim(), password, isAdmin } }),
    onSuccess: async () => {
      toast(`Konto „${username.trim()}“ angelegt`);
      setUsername('');
      setPassword('');
      setIsAdmin(false);
      await refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; password?: string; isAdmin?: boolean }) =>
      api(`/api/users/${id}`, { method: 'PATCH', body }),
    onSuccess: async (_data, vars) => {
      if (vars.password) {
        toast('Passwort gesetzt – das Konto wurde überall abgemeldet');
        setResetFor(null);
        setNewPassword('');
      }
      await refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  const submitReset = (e: FormEvent, id: number) => {
    e.preventDefault();
    update.mutate({ id, password: newPassword });
  };

  return (
    <section className="card card-pad stack">
      <div className="stack-s">
        <h2>Konten</h2>
        <p className="muted small">
          Jedes Konto sieht nur seine eigenen Präsentationen und Brandings. Neue Konten starten mit einem Passwort; Passkeys fügt jede
          Person danach selbst hinzu.
        </p>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : (
        <ul className="passkey-list">
          {list.data?.map((u) => (
            <li key={u.id} className="user-item">
              <div className="row">
                <UserRound size={18} />
                <div className="grow">
                  <strong>{u.username}</strong>
                  {u.id === ownId && <span className="faint"> (du)</span>}
                  <div className="small faint">
                    {u.presentations} Präsentationen · {u.passkeys} Passkeys{u.hasPassword && ' · Passwort'}
                    {u.lastLoginAt
                      ? ` · zuletzt angemeldet ${new Date(u.lastLoginAt).toLocaleDateString('de-DE')}`
                      : ' · noch nie angemeldet'}
                  </div>
                </div>
                <label
                  className="switch small"
                  title={u.id === ownId ? 'Das eigene Admin-Recht kann ein anderer Admin entziehen' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={u.isAdmin}
                    disabled={u.id === ownId || update.isPending}
                    onChange={(e) => update.mutate({ id: u.id, isAdmin: e.target.checked })}
                  />
                  Admin
                </label>
                {u.id !== ownId && (
                  <>
                    <button
                      className="icon-btn"
                      aria-label="Passwort zurücksetzen"
                      title="Passwort zurücksetzen"
                      onClick={() => {
                        setResetFor(resetFor === u.id ? null : u.id);
                        setNewPassword('');
                      }}
                    >
                      <KeyRound />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Konto löschen"
                      title="Konto löschen"
                      onClick={() =>
                        window.confirm(
                          `Konto „${u.username}“ löschen? Seine ${u.presentations} Präsentationen mit allen Durchführungen und Ergebnissen werden ebenfalls gelöscht.`,
                        ) && remove.mutate(u.id)
                      }
                    >
                      <Trash2 />
                    </button>
                  </>
                )}
              </div>
              {resetFor === u.id && (
                <form className="row" onSubmit={(e) => submitReset(e, u.id)}>
                  <input
                    className="input grow"
                    type="password"
                    placeholder={`Neues Passwort (mindestens ${MIN_PASSWORD_LENGTH} Zeichen)`}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    maxLength={200}
                    autoFocus
                  />
                  <button className="btn btn-primary" disabled={update.isPending || newPassword.length < MIN_PASSWORD_LENGTH}>
                    Setzen
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={submitCreate}>
        <div className="row">
          <input
            className="input grow"
            placeholder="Benutzername"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            maxLength={100}
          />
          <input
            className="input grow"
            type="password"
            placeholder={`Startpasswort (mind. ${MIN_PASSWORD_LENGTH} Zeichen)`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={200}
          />
        </div>
        <div className="row">
          <label className="switch small">
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
            Admin
          </label>
          <span className="grow" />
          <button
            className="btn btn-primary"
            disabled={create.isPending || username.trim().length < 2 || password.length < MIN_PASSWORD_LENGTH}
          >
            <Plus /> Konto anlegen
          </button>
        </div>
      </form>
    </section>
  );
}
