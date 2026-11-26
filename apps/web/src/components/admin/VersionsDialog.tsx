import { assetThumbUrl, changeFieldLabels, SLIDE_TYPE_LABELS, type SlideChangeKind, type SlideType } from '@slides/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw, Save, X } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api.ts';
import { useEscape } from '../../lib/useEscape.ts';
import { SlideIcon } from '../slideIcons.tsx';

type Reason = 'auto' | 'named' | 'import' | 'images' | 'google' | 'run' | 'restore';

const REASON_LABELS: Record<Reason, string> = {
  auto: 'Automatisch gesichert',
  named: 'Gespeichert',
  import: 'Vor einem PDF-Import',
  images: 'Vor „Folienbilder aktualisieren“',
  google: 'Vor dem Abgleich mit Google Slides',
  run: 'Beim Start einer Durchführung',
  restore: 'Vor einer Wiederherstellung',
};

const KIND_LABELS: Record<SlideChangeKind, string> = {
  added: 'neu',
  changed: 'geändert',
  removed: 'entfernt',
  moved: 'verschoben',
};

const META_LABELS: Record<string, string> = {
  title: 'Titel der Präsentation',
  brandId: 'Branding',
  shareSlides: 'Folien auf Handys',
  targetMinutes: 'Dauer',
};

interface Summary {
  initial: boolean;
  added: number;
  removed: number;
  changed: number;
  moved: number;
  meta: string[];
}

interface VersionItem {
  id: number;
  createdAt: string;
  reason: Reason;
  label: string | null;
  editors: string[];
  createdBy: string | null;
  slideCount: number;
  changes: Summary;
}

interface RestorePlan {
  changed: number;
  restored: number;
  removed: { id: number; type: SlideType; title: string; results: number }[];
}

interface Change {
  id: number;
  type: SlideType;
  title: string;
  kind: SlideChangeKind;
  fields: string[];
  asset: string | null;
  /** Version, aus der sich die Folie wiederherstellen lässt (`null`: entspricht schon dem jetzigen Stand) */
  restoreFrom: number | null;
}

interface VersionDetail {
  title: string;
  initial: boolean;
  meta: string[];
  changes: Change[];
  slides: { id: number; type: SlideType; title: string; asset: string | null; change: SlideChangeKind | null; restorable: boolean }[];
  plan: RestorePlan | null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const slidesText = (n: number) => count(n, 'Folie', 'Folien');

/** „vor 5 Min.“, „vor 3 Std.“, sonst Datum mit Uhrzeit */
function when(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  if (minutes < 12 * 60) return `vor ${Math.round(minutes / 60)} Std.`;
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

/** „ändert 2 Folien und entfernt 1“ – Nullen weglassen */
function planText(plan: RestorePlan): string | null {
  const parts = [
    plan.changed > 0 && `ändert ${slidesText(plan.changed)}`,
    plan.restored > 0 && `bringt ${slidesText(plan.restored)} zurück`,
    plan.removed.length > 0 && `entfernt ${slidesText(plan.removed.length)}`,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}`;
  return `Die ganze Version wiederherstellen ${list}${plan.removed.some((s) => s.results > 0) ? ' – darunter Folien mit Ergebnissen' : ''}.`;
}

/** Kurzfassung als kleine Marken: „2 geändert · 1 neu“ */
function SummaryBadges({ s }: { s: Summary }) {
  if (s.initial) return <span className="change-badge">erste Version</span>;
  const items: [SlideChangeKind, number][] = [
    ['changed', s.changed],
    ['added', s.added],
    ['removed', s.removed],
    ['moved', s.moved],
  ];
  const shown = items.filter(([, n]) => n > 0);
  if (shown.length === 0 && s.meta.length === 0) return <span className="small faint">keine Änderungen an Folien</span>;
  return (
    <span className="change-badges">
      {shown.map(([kind, n]) => (
        <span key={kind} className={`change-badge is-${kind}`}>
          {n} {KIND_LABELS[kind]}
        </span>
      ))}
      {s.meta.length > 0 && <span className="change-badge">{s.meta.map((m) => META_LABELS[m] ?? m).join(', ')}</span>}
    </span>
  );
}

function Thumb({ type, asset }: { type: SlideType; asset: string | null }) {
  return asset ? (
    <img className="slide-thumb" src={assetThumbUrl(asset)} alt="" loading="lazy" />
  ) : (
    <span className="slide-type-icon">
      <SlideIcon type={type} />
    </span>
  );
}

/**
 * Versionsverlauf als Zeitleiste: oben der jetzige Stand mit allem, was seit der
 * letzten Version geändert wurde, darunter die Versionen – jeweils mit den
 * Änderungen gegenüber der vorigen. Aufgeklappt: geänderte Folien hervorgehoben,
 * jede einzeln wiederherstellbar, dazu die ganze Version.
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
  /** Läuft gerade eine Durchführung oder ein Probelauf? Dann kein Wiederherstellen der ganzen Version */
  live: boolean;
  onClose: () => void;
  onRestored: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const key = ['versions', presentationId];
  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{ unsaved: boolean; current: Summary | null; versions: VersionItem[] }>(`/api/presentations/${presentationId}/versions`),
  });
  const [open, setOpen] = useState<number | 'current' | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  const detail = useQuery({
    queryKey: ['version', presentationId, open],
    queryFn: () => api<VersionDetail>(`/api/presentations/${presentationId}/versions/${open}`),
    enabled: open !== null,
  });

  const afterRestore = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ['version', presentationId] });
    onRestored(message);
  };

  const save = useMutation({
    mutationFn: (l: string) => api(`/api/presentations/${presentationId}/versions`, { body: { label: l } }),
    onSuccess: async () => {
      setLabel('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const restoreSlide = useMutation({
    mutationFn: ({ version, slideId }: { version: number; slideId: number }) =>
      api<{ inserted: boolean }>(`/api/presentations/${presentationId}/versions/${version}/slides/${slideId}/restore`, { body: {} }),
    onSuccess: (res) => afterRestore(res.inserted ? 'Folie wiederhergestellt und eingefügt' : 'Folie wiederhergestellt'),
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
        const items = lost.map((s) => `• ${s.title || SLIDE_TYPE_LABELS[s.type]} (${s.results} Einträge)`).join('\n');
        if (
          !window.confirm(
            `Diese Folien gibt es in der Version nicht. Ihre Ergebnisse aus früheren Durchführungen gingen verloren:\n\n${items}\n\nTrotzdem wiederherstellen?`,
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
      await afterRestore('Version wiederhergestellt');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const versions = list.data?.versions ?? [];
  const busy = restore.isPending || restoreSlide.isPending;

  const changesBlock = (d: VersionDetail, isCurrent: boolean) => (
    <>
      {d.initial && <p className="small muted">Die erste Version – ab hier zeichnet TakePart Änderungen auf.</p>}
      {d.meta.length > 0 && <p className="small">Geändert: {d.meta.map((m) => META_LABELS[m] ?? m).join(', ')}</p>}
      {d.changes.length > 0 && (
        <ul className="change-list">
          {d.changes.map((c) => (
            <li key={`${c.kind}-${c.id}`} className={`is-${c.kind}`}>
              <Thumb type={c.type} asset={c.asset} />
              <span className="grow change-text">
                <strong>{c.title || SLIDE_TYPE_LABELS[c.type]}</strong>
                <span className="small faint">
                  {SLIDE_TYPE_LABELS[c.type]}
                  {c.kind === 'changed' && ` · ${changeFieldLabels(c.fields).join(', ')}`}
                </span>
              </span>
              <span className={`change-badge is-${c.kind}`}>{KIND_LABELS[c.kind]}</span>
              {canEdit && c.restoreFrom !== null && (
                <button
                  className="btn btn-small btn-ghost"
                  disabled={busy}
                  title={
                    isCurrent
                      ? 'Diese Folie auf den Stand der letzten Version zurücksetzen'
                      : c.kind === 'removed'
                        ? 'Folie mit dem Stand vor dem Löschen zurückholen'
                        : 'Diese Folie auf den Stand dieser Version setzen'
                  }
                  onClick={() => restoreSlide.mutate({ version: c.restoreFrom!, slideId: c.id })}
                >
                  <RotateCcw /> {isCurrent ? 'Zurücksetzen' : c.kind === 'removed' ? 'Zurückholen' : 'Wiederherstellen'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div className="dialog-backdrop is-top" role="dialog" aria-modal="true" aria-labelledby="versions-title" onClick={onClose}>
      <div className="dialog dialog-wide card card-pad stack" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 id="versions-title" className="row">
            <History size={20} /> Versionsverlauf
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen" autoFocus={!canEdit}>
            <X />
          </button>
        </div>
        <p className="muted small">
          TakePart sichert automatisch nach zehn Minuten ohne Änderung, vor Importen, dem Abgleich mit Google Slides und jeder Durchführung.
          Einzelne Folien oder ganze Versionen lassen sich wiederherstellen – Ergebnisse früherer Durchführungen bleiben erhalten.
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
              placeholder="Jetzigen Stand benennen, z. B. „nach der Generalprobe“"
              value={label}
              autoFocus
              maxLength={120}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Name der Version"
              aria-describedby="version-label-count"
            />
            <button className="btn" disabled={!label.trim() || save.isPending}>
              <Save /> Version speichern
            </button>
          </form>
        )}
        {canEdit && label.length >= 90 && (
          <p
            id="version-label-count"
            className="small faint"
            style={label.length >= 120 ? { color: 'var(--danger)' } : undefined}
            aria-live="polite"
          >
            {label.length} von 120 Zeichen{label.length >= 120 && ' – länger geht nicht'}
          </p>
        )}
        {error && <div className="error-box">{error}</div>}

        {list.data && versions.length === 0 && !list.data.unsaved && <p className="small muted">Noch keine Versionen.</p>}
        <ol className="timeline">
          {list.data?.unsaved && list.data.current && (
            <li className={`timeline-item is-current ${open === 'current' ? 'is-open' : ''}`}>
              <button
                className="timeline-head"
                onClick={() => setOpen(open === 'current' ? null : 'current')}
                aria-expanded={open === 'current'}
              >
                <span className="timeline-dot" aria-hidden />
                <span className="grow">
                  <strong>Aktueller Stand</strong>
                  <span className="small faint" style={{ display: 'block' }}>
                    noch in keiner Version – kommt in die nächste
                  </span>
                </span>
                <SummaryBadges s={list.data.current} />
              </button>
              {open === 'current' && detail.data && <div className="timeline-body stack-s">{changesBlock(detail.data, true)}</div>}
            </li>
          )}
          {versions.map((v) => (
            <li key={v.id} className={`timeline-item ${v.label ? 'is-named' : ''} ${open === v.id ? 'is-open' : ''}`}>
              <button className="timeline-head" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}>
                <span className="timeline-dot" aria-hidden />
                <span className="grow">
                  <strong>{v.label ?? REASON_LABELS[v.reason]}</strong>
                  <span className="small faint" style={{ display: 'block' }}>
                    <time dateTime={v.createdAt} title={new Date(v.createdAt).toLocaleString('de-DE')}>
                      {when(v.createdAt)}
                    </time>
                    {' · '}
                    {slidesText(v.slideCount)}
                    {v.editors.length > 0 && ` · bearbeitet von ${v.editors.join(', ')}`}
                    {v.label && v.createdBy && ` · gespeichert von ${v.createdBy}`}
                  </span>
                </span>
                <SummaryBadges s={v.changes} />
              </button>
              {open === v.id && (
                <div className="timeline-body stack-s">
                  {detail.isLoading && <span className="small muted">Lädt …</span>}
                  {detail.data && (
                    <>
                      {changesBlock(detail.data, false)}
                      <span className="label">Alle Folien dieser Version</span>
                      <ol className="version-slides">
                        {detail.data.slides.map((s, i) => (
                          <li key={s.id} className={s.change ? `is-${s.change}` : ''} title={s.title}>
                            <span className="slide-num tabular">{i + 1}</span>
                            <Thumb type={s.type} asset={s.asset} />
                            <span className="small version-slide-title">{s.title || SLIDE_TYPE_LABELS[s.type]}</span>
                            {canEdit && s.restorable && (
                              <button
                                className="icon-btn"
                                disabled={busy}
                                aria-label={`Folie ${i + 1} aus dieser Version wiederherstellen`}
                                title="Diese Folie aus dieser Version wiederherstellen"
                                onClick={() => restoreSlide.mutate({ version: v.id, slideId: s.id })}
                              >
                                <RotateCcw size={16} />
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                      {detail.data.plan &&
                        (planText(detail.data.plan) ? (
                          canEdit && (
                            <div className="stack-s">
                              <p className="small muted">{planText(detail.data.plan)}</p>
                              <div className="row">
                                <button
                                  className="btn"
                                  disabled={live || busy}
                                  title={live ? 'Erst nach der Durchführung bzw. dem Probelauf' : undefined}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        'Die ganze Version wiederherstellen? Der jetzige Stand wird vorher als Version gesichert.',
                                      )
                                    ) {
                                      restore.mutate(v.id);
                                    }
                                  }}
                                >
                                  <RotateCcw /> {restore.isPending ? 'Stellt wieder her …' : 'Ganze Version wiederherstellen'}
                                </button>
                                {live && <span className="small faint">Nicht während einer Durchführung oder eines Probelaufs.</span>}
                              </div>
                            </div>
                          )
                        ) : (
                          <p className="small muted">Entspricht dem aktuellen Stand.</p>
                        ))}
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
