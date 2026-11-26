import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS, roleAtLeast, type PresentationRole } from '@slides/shared';
import { Copy, Download, Eye, FlaskConical, Pencil, Play, Plus, Radio, Sparkles, Trash2, Upload, UserMinus, Users } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
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
  rehearsalRun: { id: number } | null;
  /** Eigene Rolle – `owner` bei eigenen Präsentationen */
  role: PresentationRole;
  /** Eigentümer bei geteilten Präsentationen */
  ownerName: string | null;
  /** Eigene Präsentationen: mit wie vielen Konten geteilt */
  sharedWith: number;
}

export function useStartRun() {
  const navigate = useNavigate();
  const toast = useToast();
  return useMutation({
    /** Zahl: echte Durchführung; mit `rehearsal`: Probelauf (nicht im Archiv, blockiert keinen echten Start) */
    mutationFn: (arg: number | { presentationId: number; rehearsal: boolean }) => {
      const { presentationId, rehearsal } = typeof arg === 'number' ? { presentationId: arg, rehearsal: false } : arg;
      return api<{ id: number }>(`/api/presentations/${presentationId}/runs`, { body: { rehearsal } });
    },
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
  const fileInput = useRef<HTMLInputElement>(null);

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
  /** Geteilte Präsentation abgeben */
  const leave = useMutation({
    mutationFn: (id: number) => api(`/api/presentations/${id}/shares/me`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presentations'] }),
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch('/api/presentations/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => null)) as { id?: number; error?: string } | null;
      if (!res.ok || !data?.id) throw new Error(data?.error ?? `Fehler ${res.status}`);
      return data.id;
    },
    onSuccess: (id) => {
      toast('Präsentation importiert');
      navigate(`/admin/p/${id}`);
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importFile.mutate(file);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate();
  };

  return (
    <main className="page stack">
      <div className="row-between">
        <h1>Präsentationen</h1>
        <button
          className="btn btn-ghost"
          onClick={() => fileInput.current?.click()}
          disabled={importFile.isPending}
          title="Eine exportierte .takepart-Datei samt Durchführungen übernehmen"
        >
          <Upload /> {importFile.isPending ? 'Importiere …' : 'Importieren'}
        </button>
        <input ref={fileInput} type="file" accept=".takepart,application/gzip" hidden onChange={pickFile} />
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
                {/* Ohne Trennpunkte: beim Umbrechen bliebe sonst einer am Zeilenende stehen */}
                <span className="pres-meta small faint">
                  <span>
                    {p.slides} {p.slides === 1 ? 'Folie' : 'Folien'}
                  </span>
                  <span>
                    {p.runs} {p.runs === 1 ? 'Durchführung' : 'Durchführungen'}
                  </span>
                  <span>geändert {new Date(p.updatedAt).toLocaleDateString('de-DE')}</span>
                  {p.sharedWith > 0 && (
                    <span className="pres-meta-icon">
                      <Users size={14} aria-hidden /> geteilt mit {p.sharedWith}
                    </span>
                  )}
                  {p.ownerName && (
                    <span className="pres-meta-icon">
                      <Users size={14} aria-hidden /> von {p.ownerName}, Rolle: {ROLE_LABELS[p.role]}
                    </span>
                  )}
                </span>
              </Link>
              <div className="row">
                {!roleAtLeast(p.role, 'host') ? null : p.liveRun ? (
                  <Link className="btn btn-primary" to={`/admin/live/${p.liveRun.id}`}>
                    <span className="dot dot-live dot-ink" />
                    Live · {formatCode(p.liveRun.code)}
                  </Link>
                ) : (
                  <button className="btn btn-primary" onClick={() => start.mutate(p.id)} disabled={start.isPending || p.slides === 0}>
                    <Play /> Live starten
                  </button>
                )}
                {/* Probelauf nur im Editor – die Liste bleibt schlank */}
                <Link
                  className="icon-btn"
                  to={`/admin/p/${p.id}`}
                  aria-label={roleAtLeast(p.role, 'edit') ? 'Bearbeiten' : 'Ansehen'}
                  title={roleAtLeast(p.role, 'edit') ? 'Bearbeiten' : 'Ansehen'}
                >
                  {roleAtLeast(p.role, 'edit') ? <Pencil /> : <Eye />}
                </Link>
                <button className="icon-btn" onClick={() => duplicate.mutate(p.id)} aria-label="Duplizieren" title="Duplizieren">
                  <Copy />
                </button>
                {roleAtLeast(p.role, 'edit') && (
                  <a
                    className="icon-btn"
                    href={`/api/presentations/${p.id}/export`}
                    download
                    aria-label="Exportieren"
                    title="Exportieren – mit allen Durchführungen, Namen und Antworten"
                  >
                    <Download />
                  </a>
                )}
                {p.role === 'owner' ? (
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
                ) : (
                  <button
                    className="icon-btn"
                    onClick={() => {
                      if (window.confirm(`„${p.title}“ nicht mehr mit dir teilen?`)) leave.mutate(p.id);
                    }}
                    aria-label="Nicht mehr mit mir teilen"
                    title="Nicht mehr mit mir teilen"
                  >
                    <UserMinus />
                  </button>
                )}
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

/** Probelauf starten bzw. zum laufenden Probelauf – als Symbol-Knopf neben „Live starten“ */
export function RehearsalButton({
  presentationId,
  running,
  disabled,
  onStart,
  label = false,
}: {
  presentationId: number;
  running: { id: number } | null;
  disabled: boolean;
  onStart: (arg: { presentationId: number; rehearsal: boolean }) => void;
  label?: boolean;
}) {
  if (running)
    return (
      <Link
        className={label ? 'btn' : 'icon-btn'}
        to={`/admin/live/${running.id}`}
        aria-label="Zum laufenden Probelauf"
        title="Zum laufenden Probelauf"
      >
        <FlaskConical /> {label && 'Probelauf läuft'}
      </Link>
    );
  return (
    <button
      className={label ? 'btn' : 'icon-btn'}
      onClick={() => onStart({ presentationId, rehearsal: true })}
      disabled={disabled}
      aria-label="Probelauf starten"
      title="Probelauf starten – mit Testteilnehmenden, wird nicht archiviert"
    >
      <FlaskConical /> {label && 'Probelauf'}
    </button>
  );
}
