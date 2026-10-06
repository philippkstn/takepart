import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Play, Plus, Radio, Sparkles, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatCode, Spinner, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';

interface PresentationItem {
  id: number;
  title: string;
  updatedAt: string;
  slides: number;
  runs: number;
  liveRun: { id: number; code: string } | null;
}

export function useStartRun() {
  const navigate = useNavigate();
  const toast = useToast();
  return useMutation({
    mutationFn: (presentationId: number) => api<{ id: number }>(`/api/presentations/${presentationId}/runs`, { body: {} }),
    onSuccess: ({ id }) => navigate(`/admin/live/${id}`),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
}

export default function PresentationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const list = useQuery({ queryKey: ['presentations'], queryFn: () => api<PresentationItem[]>('/api/presentations') });
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState(true);
  const start = useStartRun();

  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/api/presentations', { body: { title, template } }),
    onSuccess: ({ id }) => navigate(`/admin/p/${id}`),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const loadDemo = useMutation({
    mutationFn: () => api<{ id: number }>('/api/presentations/demo', { body: {} }),
    onSuccess: ({ id }) => navigate(`/admin/p/${id}`),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const duplicate = useMutation({
    mutationFn: (id: number) => api(`/api/presentations/${id}/duplicate`, { body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presentations'] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/presentations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presentations'] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate();
  };

  return (
    <main className="page stack">
      <div className="row-between">
        <h1>Präsentationen</h1>
      </div>

      <form className="card card-pad create-form" onSubmit={submit}>
        <input
          className="input grow"
          placeholder="Titel der neuen Präsentation"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <label className="switch small">
          <input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} />
          Mit Startfolien
        </label>
        <button className="btn btn-primary" disabled={!title.trim() || create.isPending}>
          <Plus /> Anlegen
        </button>
      </form>

      {list.isLoading ? (
        <Spinner />
      ) : list.data?.length === 0 ? (
        <div className="empty stack" style={{ justifyItems: 'center' }}>
          <p>Noch keine Präsentation. Leg oben die erste an – oder schau dir zuerst alle Funktionen an.</p>
          <button className="btn btn-primary" onClick={() => loadDemo.mutate()} disabled={loadDemo.isPending}>
            <Sparkles /> Demo-Präsentation laden
          </button>
        </div>
      ) : (
        <ul className="pres-list">
          {list.data?.map((p) => (
            <li key={p.id} className="card pres-item anim-rise">
              <Link to={`/admin/p/${p.id}`} className="pres-main">
                <span className="pres-title">{p.title}</span>
                <span className="row small faint">
                  <span>{p.slides} Folien</span>
                  <span>·</span>
                  <span>{p.runs} Durchführungen</span>
                  <span>·</span>
                  <span>geändert {new Date(p.updatedAt).toLocaleDateString('de-DE')}</span>
                </span>
              </Link>
              <div className="row">
                {p.liveRun ? (
                  <Link className="btn btn-primary" to={`/admin/live/${p.liveRun.id}`}>
                    <span className="dot dot-live" style={{ background: '#fff' }} />
                    Live · {formatCode(p.liveRun.code)}
                  </Link>
                ) : (
                  <button className="btn btn-primary" onClick={() => start.mutate(p.id)} disabled={start.isPending || p.slides === 0}>
                    <Play /> Live starten
                  </button>
                )}
                <Link className="icon-btn" to={`/admin/p/${p.id}`} aria-label="Bearbeiten" title="Bearbeiten">
                  <Pencil />
                </Link>
                <button className="icon-btn" onClick={() => duplicate.mutate(p.id)} aria-label="Duplizieren" title="Duplizieren">
                  <Copy />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => {
                    if (confirmDelete(p.title)) remove.mutate(p.id);
                  }}
                  aria-label="Löschen"
                  title="Löschen"
                >
                  <Trash2 />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="small faint row">
        <Radio size={14} /> Eine Präsentation kann beliebig oft live gestartet werden; jede Durchführung wird mit ihren Ergebnissen
        archiviert.
      </p>
    </main>
  );
}

function confirmDelete(title: string) {
  return window.confirm(`„${title}“ mit allen Durchführungen und Ergebnissen löschen?`);
}
