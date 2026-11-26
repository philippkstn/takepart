import { assetThumbUrl, SLIDE_TYPE_LABELS, type SlideType } from '@slides/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw, Save, X } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api.ts';
import { SlideIcon } from '../slideIcons.tsx';

type Reason = 'auto' | 'named' | 'import' | 'images' | 'google' | 'run' | 'restore';

const REASON_LABELS: Record<Reason, string> = {
  auto: 'Automatisch gesichert',
  named: 'Gespeichert',
  import: 'Vor einem PDF-Import',
  images: 'Vor „Folienbilder aktualisieren“',
  google: 'Vor dem Abgleich mit Google Slides',
  run: 'Beim Start einer Durchführung',
  restore: 'Vor dem Wiederherstellen einer Version',
};

interface VersionItem {
  id: number;
  createdAt: string;
  reason: Reason;
  label: string | null;
  editors: string[];
  createdBy: string | null;
  slideCount: number;
}

interface RestorePlan {
  changed: number;
  restored: number;
  removed: { id: number; type: SlideType; title: string; results: number }[];
}

interface VersionDetail {
  title: string;
  slides: { id: number; type: SlideType; title: string; asset: string | null }[];
  plan: RestorePlan;
}

const when = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Versionen einer Präsentation: automatisch nach einer Bearbeitungspause, vor
 * Import, Bildertausch, Google-Abgleich und Durchführung, dazu benannte. Jede
 * lässt sich ansehen und wiederherstellen – an Ort und Stelle, Ergebnisse bleiben.
 */
export function VersionsDialog({
  presentationId,
  canEdit,
  live,
  onClose,
  onRestored,
}: {
  presentationId: number;
  canEdit: boolean;
  /** Läuft gerade eine Durchführung oder ein Probelauf? Dann kein Wiederherstellen */
  live: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ['versions', presentationId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<{ unsaved: boolean; versions: VersionItem[] }>(`/api/presentations/${presentationId}/versions`),
  });
  const [open, setOpen] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['version', presentationId, open],
    queryFn: () => api<VersionDetail>(`/api/presentations/${presentationId}/versions/${open}`),
    enabled: open !== null,
  });

  const save = useMutation({
    mutationFn: (l: string) => api(`/api/presentations/${presentationId}/versions`, { body: { label: l } }),
    onSuccess: async () => {
      setLabel('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const restore = useMutation({
    mutationFn: async (vid: number) => {
      try {
        return await api(`/api/presentations/${presentationId}/versions/${vid}/restore`, { body: {} });
      } catch (err) {
        const plan = err instanceof ApiError && err.status === 409 ? (err.data as { plan?: RestorePlan } | null)?.plan : undefined;
        if (!plan) throw err;
        const lost = plan.removed.filter((s) => s.results > 0);
        const list = lost.map((s) => `• ${s.title || SLIDE_TYPE_LABELS[s.type]} (${s.results} Einträge)`).join('\n');
        if (
          !window.confirm(
            `Diese Folien gibt es in der Version nicht. Ihre Ergebnisse aus früheren Durchführungen gingen verloren:\n\n${list}\n\nTrotzdem wiederherstellen?`,
          )
        ) {
          return null;
        }
        return api(`/api/presentations/${presentationId}/versions/${vid}/restore`, { body: { dropResults: true } });
      }
    },
    onSuccess: async (res) => {
      if (res === null) return;
      setOpen(null);
      await queryClient.invalidateQueries({ queryKey: key });
      onRestored();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const versions = list.data?.versions ?? [];

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="versions-title" onClick={onClose}>
      <div className="dialog dialog-wide card card-pad stack" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 id="versions-title" className="row">
            <History size={20} /> Versionen
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X />
          </button>
        </div>
        <p className="muted small">
          TakePart sichert automatisch, sobald zehn Minuten niemand mehr geändert hat, und vor Importen, dem Abgleich mit Google Slides und
          jeder Durchführung. Wiederherstellen ändert die Folien an Ort und Stelle – Ergebnisse früherer Durchführungen bleiben erhalten.
        </p>
        {canEdit && (
          <form
            className="share-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (label.trim()) save.mutate(label.trim());
            }}
          >
            <input
              className="input"
              placeholder="z. B. Stand nach der Generalprobe"
              value={label}
              maxLength={120}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Name der Version"
            />
            <button className="btn btn-primary" disabled={!label.trim() || save.isPending}>
              <Save /> Version speichern
            </button>
          </form>
        )}
        {list.data?.unsaved && (
          <p className="small faint">Die letzten Änderungen sind noch in keiner Version – sie kommen in die nächste.</p>
        )}
        {error && <div className="error-box">{error}</div>}

        {versions.length === 0 && list.data && <p className="small muted">Noch keine Versionen.</p>}
        <ol className="version-list">
          {versions.map((v) => (
            <li key={v.id} className={open === v.id ? 'is-open' : ''}>
              <button className="version-item" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}>
                <span className="grow">
                  <strong>{v.label ?? REASON_LABELS[v.reason]}</strong>
                  <span className="small faint" style={{ display: 'block' }}>
                    {when(v.createdAt)} · {v.slideCount} Folien
                    {v.editors.length > 0 && ` · bearbeitet von ${v.editors.join(', ')}`}
                    {v.label && v.createdBy && ` · von ${v.createdBy}`}
                  </span>
                </span>
              </button>
              {open === v.id && (
                <div className="version-detail stack-s">
                  {detail.isLoading && <span className="small muted">Lädt …</span>}
                  {detail.data && (
                    <>
                      <ol className="version-slides">
                        {detail.data.slides.map((s, i) => (
                          <li key={s.id} title={s.title}>
                            <span className="slide-num tabular">{i + 1}</span>
                            {s.asset ? (
                              <img className="slide-thumb" src={assetThumbUrl(s.asset)} alt="" loading="lazy" />
                            ) : (
                              <span className="slide-type-icon">
                                <SlideIcon type={s.type} />
                              </span>
                            )}
                            <span className="small version-slide-title">{s.title || SLIDE_TYPE_LABELS[s.type]}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="small muted">
                        Wiederherstellen ändert {detail.data.plan.changed} Folien, bringt {detail.data.plan.restored} zurück und entfernt{' '}
                        {detail.data.plan.removed.length}
                        {detail.data.plan.removed.some((s) => s.results > 0) && ' – darunter Folien mit Ergebnissen'}.
                      </p>
                      {canEdit && (
                        <div className="row">
                          <button
                            className="btn"
                            disabled={live || restore.isPending}
                            title={live ? 'Erst nach der Durchführung bzw. dem Probelauf' : undefined}
                            onClick={() => {
                              if (window.confirm('Diese Version wiederherstellen? Der jetzige Stand wird vorher als Version gesichert.')) {
                                restore.mutate(v.id);
                              }
                            }}
                          >
                            <RotateCcw /> {restore.isPending ? 'Stellt wieder her …' : 'Diese Version wiederherstellen'}
                          </button>
                          {live && <span className="small faint">Nicht während einer Durchführung oder eines Probelaufs.</span>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
