import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Spinner, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { passkeyError, registerPasskey } from '../../lib/passkey.ts';
import { BrandSettings } from './BrandSettings.tsx';

interface Passkey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['passkeys'], queryFn: () => api<Passkey[]>('/api/auth/passkeys') });
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
    <main className="page stack" style={{ maxWidth: 720 }}>
      <h1>Einstellungen</h1>
      <section className="card card-pad stack">
        <div className="stack-s">
          <h2>Passkeys</h2>
          <p className="muted small">Mit jedem dieser Passkeys kannst du dich anmelden – z. B. Laptop und Handy fürs Steuerpult.</p>
        </div>
        {list.isLoading ? (
          <Spinner />
        ) : (
          <ul className="passkey-list">
            {list.data?.map((p) => (
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
                  disabled={(list.data?.length ?? 0) <= 1}
                  onClick={() => window.confirm(`Passkey „${p.label}“ entfernen?`) && remove.mutate(p.id)}
                >
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
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
      <BrandSettings />
    </main>
  );
}
