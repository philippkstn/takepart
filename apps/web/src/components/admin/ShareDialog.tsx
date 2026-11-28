import { ROLE_HINTS, ROLE_LABELS } from '@slides/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { useEscape } from '../../lib/useEscape.ts';
import { useConfirm } from '../../components/ConfirmDialog.tsx';

type ShareRole = 'view' | 'edit' | 'host';
const SHARE_ROLES: ShareRole[] = ['view', 'edit', 'host'];

interface Share {
  userId: number;
  username: string;
  role: ShareRole;
}

/**
 * Präsentation mit anderen Konten dieser Installation teilen (nur der Eigentümer).
 * Wer bearbeiten darf, arbeitet gleichzeitig im selben Editor.
 */
export function ShareDialog({ presentationId, onClose }: { presentationId: number; onClose: () => void }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const key = ['shares', presentationId];
  const shares = useQuery({ queryKey: key, queryFn: () => api<Share[]>(`/api/presentations/${presentationId}/shares`) });
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<ShareRole>('edit');
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const save = useMutation({
    mutationFn: (body: { username: string; role: ShareRole }) =>
      api<Share>(`/api/presentations/${presentationId}/shares`, { method: 'PUT', body }),
    onSuccess: async () => {
      setUsername('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (userId: number) => api(`/api/presentations/${presentationId}/shares/${userId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={onClose}>
      <div className="dialog card card-pad stack" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 id="share-title">Präsentation teilen</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X />
          </button>
        </div>
        <p className="muted small">
          Mit anderen Konten dieser TakePart-Installation. Wer bearbeiten darf, arbeitet gleichzeitig mit dir im Editor – Änderungen
          erscheinen sofort, jede Bearbeitung landet in den Versionen.
        </p>
        <form
          className="share-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) save.mutate({ username: username.trim(), role });
          }}
        >
          <input
            className="input"
            placeholder="Benutzername"
            autoFocus
            value={username}
            autoComplete="off"
            maxLength={100}
            onChange={(e) => setUsername(e.target.value)}
            aria-label="Benutzername"
          />
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as ShareRole)} aria-label="Rolle">
            {SHARE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={!username.trim() || save.isPending}>
            <UserPlus /> Teilen
          </button>
        </form>
        <p className="small faint">{ROLE_HINTS[role]}</p>
        {error && <div className="error-box">{error}</div>}

        {shares.data && shares.data.length > 0 ? (
          <ul className="share-list">
            {shares.data.map((s) => (
              <li key={s.userId}>
                <strong className="grow">{s.username}</strong>
                <select
                  className="select"
                  value={s.role}
                  aria-label={`Rolle von ${s.username}`}
                  onChange={(e) => save.mutate({ username: s.username, role: e.target.value as ShareRole })}
                >
                  {SHARE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-btn"
                  aria-label={`Freigabe für ${s.username} entfernen`}
                  onClick={async () => {
                    if (await confirm({ title: `${s.username} den Zugriff entziehen?`, confirmLabel: 'Entziehen', danger: true }))
                      remove.mutate(s.userId);
                  }}
                >
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          shares.data && <p className="small muted">Noch mit niemandem geteilt.</p>
        )}
      </div>
    </div>
  );
}
