import type { Slide } from '@slides/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, RefreshCw, Unlink, X } from 'lucide-react';
import { useState } from 'react';
import { useEscape } from '../../lib/useEscape.ts';
import { api, ApiError, errorMessage } from '../../lib/api.ts';
import { syncFromGoogle, type SyncProgress, type SyncResult } from '../../lib/googleSync.ts';

export interface SourceInfo {
  kind: 'google';
  url: string;
  autoSync: boolean;
  syncedHash: string | null;
  syncedAt: string | null;
  checkedAt: string | null;
  changed: boolean;
  error: string | null;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : 'noch nie';

export function syncSummary(r: SyncResult): string {
  if (r.noChange) return 'Google Slides: keine Änderungen seit dem letzten Abgleich.';
  const parts = [
    r.replaced > 0 && `${r.replaced} aktualisiert`,
    r.inserted > 0 && `${r.inserted} neu`,
    r.removed > 0 && `${r.removed} entfernt`,
    r.unchanged > 0 && `${r.unchanged} unverändert`,
  ].filter(Boolean);
  const text = `Google Slides abgeglichen: ${parts.join(', ') || 'keine Änderungen'}.`;
  return r.kept > 0 ? `${text} ${r.kept} in Google gelöschte Folien bleiben, weil sie Ergebnisse haben – bitte selbst prüfen.` : text;
}

/** Abgleich ausführen (Fortschritt, Fehler); von Editor-Banner, Auto-Abgleich und Dialog genutzt */
export function useGoogleSync(
  presentationId: number,
  data: { slides: Slide[]; sources: Record<string, { key: string | null; hash: string | null }>; source: SourceInfo | null } | undefined,
  onDone: (result: SyncResult) => void,
) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** `manual`: per Klick ausgelöst – dann darf bei vielen Löschungen nachgefragt werden */
  const run = async (manual = true) => {
    if (!data?.source || progress) return;
    setError(null);
    try {
      const result = await syncFromGoogle(
        presentationId,
        data.slides,
        data.sources,
        data.source.syncedHash,
        setProgress,
        manual
          ? (count, total) =>
              window.confirm(
                `In Google Slides fehlen ${count} von ${total} Folien. Diese Folien hier entfernen (Folien mit Ergebnissen bleiben)?`,
              )
          : undefined,
      );
      onDone(result);
    } catch (err) {
      // Jemand anderes hat gerade abgeglichen – dessen Ergebnis laden
      if (!(err instanceof ApiError && err.status === 409 && err.message.includes('schon abgeglichen'))) setError(errorMessage(err));
    } finally {
      setProgress(null);
      await queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
      await queryClient.invalidateQueries({ queryKey: ['versions', presentationId] });
    }
  };
  return { run, progress, error, clearError: () => setError(null) };
}

export function SyncProgressBar({ progress }: { progress: SyncProgress }) {
  const share = progress.step === 'pages' && progress.total ? (progress.done ?? 0) / progress.total : progress.step === 'saving' ? 1 : 0.05;
  return (
    <div className="stack-s" aria-live="polite">
      <span className="small muted">
        {progress.step === 'download' && 'Lade von Google Slides …'}
        {progress.step === 'pages' && `Folie ${Math.min((progress.done ?? 0) + 1, progress.total ?? 0)} von ${progress.total} …`}
        {progress.step === 'saving' && 'Speichere …'}
      </span>
      <div className="progress">
        <div style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * Verknüpfung mit Google Slides: Freigabelink eintragen („Jeder mit dem Link“),
 * Stand ansehen, abgleichen, lösen. Neue Fassungen erkennt der Server von selbst;
 * mit „automatisch“ gleicht der Editor beim Öffnen ab.
 */
export function GoogleSourceDialog({
  presentationId,
  source,
  sync,
  live,
  onClose,
}: {
  presentationId: number;
  source: SourceInfo | null;
  sync: ReturnType<typeof useGoogleSync>;
  live: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(source?.url ?? '');
  const [autoSync, setAutoSync] = useState(source?.autoSync ?? true);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
  useEscape(sync.progress ? null : onClose);

  const link = useMutation({
    mutationFn: () => api<SourceInfo>(`/api/presentations/${presentationId}/source`, { method: 'PUT', body: { url, autoSync } }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const setAuto = useMutation({
    mutationFn: (value: boolean) => api(`/api/presentations/${presentationId}/source`, { method: 'PATCH', body: { autoSync: value } }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });
  const check = useMutation({
    mutationFn: () => api<SourceInfo>(`/api/presentations/${presentationId}/source/check`, { body: {} }),
    onMutate: () => {
      setError(null);
      setChecked(null);
    },
    onSuccess: async (info) => {
      setChecked(info.error ? null : info.changed ? 'Bei Google gibt es eine neue Fassung.' : 'Keine Änderungen bei Google.');
      await refresh();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const unlink = useMutation({
    mutationFn: () => api(`/api/presentations/${presentationId}/source`, { method: 'DELETE' }),
    onSuccess: async () => {
      setUrl('');
      await refresh();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const busy = !!sync.progress;
  return (
    <div
      className="dialog-backdrop is-top"
      role="dialog"
      aria-modal="true"
      aria-labelledby="google-title"
      onClick={busy ? undefined : onClose}
    >
      <div className="dialog card card-pad stack" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 id="google-title">{source ? 'Google Slides' : 'Mit Google Slides verknüpfen'}</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Schließen" autoFocus={!!source}>
            <X />
          </button>
        </div>
        <p className="muted small">
          In Google Slides unter „Freigeben“ den allgemeinen Zugriff auf „Jeder mit dem Link“ stellen und den Link hier einfügen. TakePart
          holt Folienbilder, Sprechernotizen und Animationen und prüft regelmäßig auf Änderungen. Neue Folien erscheinen an der passenden
          Stelle, eigene Abstimmungen und Übungen dazwischen bleiben, wo sie sind. Vor jedem Abgleich entsteht eine Version.
        </p>
        <form
          className="stack-s"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) link.mutate();
          }}
        >
          <input
            className="input"
            type="url"
            placeholder="https://docs.google.com/presentation/d/…"
            autoFocus={!source}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Freigabelink"
            disabled={busy}
          />
          <label className="switch small">
            <input
              type="checkbox"
              checked={source ? source.autoSync : autoSync}
              onChange={(e) => (source ? setAuto.mutate(e.target.checked) : setAutoSync(e.target.checked))}
            />
            Beim Öffnen des Editors automatisch abgleichen (nie während einer Durchführung)
          </label>
          {(!source || url.trim() !== source.url) && (
            <div className="row">
              <button className="btn btn-primary" disabled={!url.trim() || link.isPending || busy}>
                <Link2 /> {link.isPending ? 'Prüfe Link …' : source ? 'Link ändern' : 'Verknüpfen'}
              </button>
            </div>
          )}
        </form>

        {source && (
          <div className="stack-s source-status">
            <span className="small">
              Zuletzt abgeglichen: <strong>{when(source.syncedAt)}</strong> · geprüft: {when(source.checkedAt)}
            </span>
            {checked && !busy && (
              <span className="small" role="status">
                {checked}
              </span>
            )}
            {source.changed && !busy && !checked && (
              <span className="small">{source.syncedHash ? 'Bei Google gibt es eine neue Fassung.' : 'Noch nicht abgeglichen.'}</span>
            )}
            {source.error && <div className="error-box">{source.error}</div>}
            {sync.progress && <SyncProgressBar progress={sync.progress} />}
            {sync.error && <div className="error-box">{sync.error}</div>}
            <div className="row">
              <button className="btn btn-primary" onClick={() => void sync.run()} disabled={busy || live}>
                <RefreshCw /> Jetzt abgleichen
              </button>
              <button className="btn" onClick={() => check.mutate()} disabled={busy || check.isPending}>
                Auf Änderungen prüfen
              </button>
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Verknüpfung lösen? Die Folien bleiben, werden aber nicht mehr aktualisiert.')) unlink.mutate();
                }}
              >
                <Unlink /> Lösen
              </button>
            </div>
            {live && <span className="small faint">Während einer Durchführung wird nicht abgeglichen.</span>}
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    </div>
  );
}
