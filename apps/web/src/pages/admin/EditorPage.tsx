import {
  BOARD_MODE_HINTS,
  BOARD_MODE_LABELS,
  BOARD_MODES,
  buildSteps,
  SLIDE_TYPE_HINTS,
  SLIDE_TYPE_LABELS,
  CREATABLE_SLIDE_TYPES,
  assetThumbUrl,
  slideHeadline,
  type BatchSlide,
  EMPTY_SCHEDULE,
  plannedTotal,
  slidePlannedMinutes,
  type SlideSchedule,
  type BrandView,
  type Slide,
  type SlideType,
  ROLE_LABELS,
  roleAtLeast,
  type PresentationRole,
} from '@slides/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Archive,
  Blocks,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileUp,
  History,
  Layers,
  Link2,
  Palette,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Sparkles,
  Timer,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { InsertPicker, SaveBlockDialog } from '../../components/admin/BlockPicker.tsx';
import { RehearsalList } from '../../components/admin/RehearsalList.tsx';
import { ImportDialog } from '../../components/admin/ImportDialog.tsx';
import { ReplaceImagesDialog } from '../../components/admin/ReplaceImagesDialog.tsx';
import { SlideForm } from '../../components/admin/SlideForm.tsx';
import { ScheduleFields } from '../../components/admin/ScheduleFields.tsx';
import { SlideIcon } from '../../components/slideIcons.tsx';
import { Stage } from '../../components/Stage.tsx';
import { staticPreview } from '../../components/staticPreview.ts';
import { formatCode, FullScreenSpinner, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { needsRefit, refitBuilds } from '../../lib/refitBuilds.ts';
import { RehearsalButton, useStartRun } from './PresentationsPage.tsx';
import { ShareDialog } from '../../components/admin/ShareDialog.tsx';
import { VersionsDialog } from '../../components/admin/VersionsDialog.tsx';
import { GoogleSourceDialog, SyncProgressBar, syncSummary, useGoogleSync, type SourceInfo } from '../../components/admin/GoogleSource.tsx';
import { useEditSession } from '../../lib/editSession.ts';
import { onParkedConflict, useSyncedField } from '../../lib/syncedField.ts';
import { ApiError } from '../../lib/api.ts';
import { authStatus } from '../../lib/passkey.ts';

interface Presentation {
  id: number;
  title: string;
  brandId: number | null;
  brand: BrandView | null;
  shareSlides: boolean;
  targetMinutes: number | null;
  slides: Slide[];
  /** Sprechernotizen je Folien-ID (nur für dich, nie für Beamer/Publikum) */
  notes: Record<string, string>;
  /** Ablaufplan je Folien-ID (Soll-Dauer, Phasen, Auto-Start) */
  schedule?: Record<string, SlideSchedule>;
  liveRun: { id: number; code: string } | null;
  rehearsalRun: { id: number; code: string } | null;
  /** Änderungszähler je Folien-ID */
  revs: Record<string, number>;
  /** Eigene Rolle (geteilte Präsentationen) */
  role: PresentationRole;
  /** Eigentümer, wenn die Präsentation mit mir geteilt ist */
  ownerName: string | null;
  /** Google-Kennung und Prüfsumme je Bildfolie */
  sources: Record<string, { key: string | null; hash: string | null }>;
  source: SourceInfo | null;
}

interface RunItem {
  id: number;
  code: string | null;
  startedAt: string;
  endedAt: string | null;
  participants: number;
  rehearsal: boolean;
}

export default function EditorPage() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['presentation', id];
  const pres = useQuery({ queryKey: key, queryFn: () => api<Presentation>(`/api/presentations/${id}`) });
  const role = pres.data?.role ?? 'view';
  const canEdit = roleAtLeast(role, 'edit');
  const canHost = roleAtLeast(role, 'host');
  const isOwner = role === 'owner';
  const runs = useQuery({
    queryKey: ['runs', id],
    queryFn: () => api<RunItem[]>(`/api/presentations/${id}/runs`),
    enabled: canHost,
  });
  const navigate = useNavigate();
  const session = useEditSession(id, () => {
    toast('Du hast keinen Zugriff mehr auf diese Präsentation', 'error');
    navigate('/admin');
  });
  const me = useQuery({ queryKey: ['auth'], queryFn: authStatus }).data?.account?.username ?? null;
  /** Anzeigename in der Anwesenheit – das eigene Konto in einem anderen Fenster als „du“ */
  const shown = (name: string) => (name === me ? 'du (anderes Fenster)' : name);
  const [sharing, setSharing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showGoogle, setShowGoogle] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  /** Hinter welcher Folie der Einfügen-Dialog bzw. der PDF-Import einfügt (Rechtsklick oder +) */
  const [insertAfter, setInsertAfter] = useState<number | null>(null);
  const [inserting, setInserting] = useState(false);
  const [menu, setMenu] = useState<{ slideId: number; x: number; y: number } | null>(null);
  /** Ab welcher Folie „Als Baustein speichern“ vorschlägt */
  const [savingBlock, setSavingBlock] = useState<number | null>(null);
  const [showRehearsals, setShowRehearsals] = useState(false);
  const start = useStartRun();

  const slides = pres.data?.slides ?? [];
  const plannedOf = (slideId: number) => slidePlannedMinutes(pres.data?.schedule?.[slideId]);
  const plannedSum = plannedTotal(slides.map((s) => plannedOf(s.id)));
  const selected = slides.find((s) => s.id === selectedId) ?? slides[0] ?? null;
  const { focus } = session;
  useEffect(() => focus(selected?.id ?? null), [focus, selected?.id]);
  /** Wer außer mir auf welcher Folie ist */
  const othersOn = (slideId: number) => session.editors.filter((e) => e.slideId === slideId).map((e) => shown(e.name));

  // Konflikt beim Verlassen einer Folie: Bescheid geben, beim Öffnen der Folie wählen
  useEffect(
    () =>
      onParkedConflict((k) => {
        const slideId = Number(k.split(':')[1]);
        const n = (queryClient.getQueryData<Presentation>(['presentation', id])?.slides.findIndex((s) => s.id === slideId) ?? -1) + 1;
        toast(`Folie ${n || ''} wurde zugleich von jemand anderem geändert – öffne sie, um zu entscheiden`, 'error');
      }),
    [id, queryClient, toast],
  );

  const googleSync = useGoogleSync(id, pres.data, (result) => toast(syncSummary(result)));
  const live = !!pres.data?.liveRun;
  // Automatischer Abgleich beim Öffnen: verknüpft, neue Fassung, Bearbeitungsrecht, keine Durchführung
  const autoSynced = useRef(false);
  useEffect(() => {
    const src = pres.data?.source;
    if (autoSynced.current || !src || !canEdit || live) return;
    autoSynced.current = true;
    if (src.autoSync && src.changed && !src.error) void googleSync.run(false);
  }, [pres.data?.source, canEdit, live, googleSync]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const onError = (err: unknown) => toast(errorMessage(err), 'error');

  const addSlide = useMutation({
    mutationFn: ({ type, config, afterId }: { type: SlideType; config?: unknown; afterId: number | null }) =>
      api<{ id: number }>(`/api/presentations/${id}/slides`, { body: { type, afterId, config } }),
    onSuccess: async ({ id: newId }) => {
      setAdding(false);
      setInserting(false);
      await refresh();
      setSelectedId(newId);
    },
    onError,
  });
  /** Mehrere Folien auf einmal (Übungsbausteine) */
  const addBatch = useMutation({
    mutationFn: ({ slides: batch, afterId }: { slides: BatchSlide[]; afterId: number | null }) =>
      api<{ ids: number[] }>(`/api/presentations/${id}/slides/batch`, { body: { afterId, slides: batch } }),
    onSuccess: async ({ ids }) => {
      setAdding(false);
      setInserting(false);
      await refresh();
      if (ids[0] !== undefined) setSelectedId(ids[0]);
      toast(`${ids.length} ${ids.length === 1 ? 'Folie' : 'Folien'} eingefügt`);
    },
    onError,
  });
  const removeRehearsals = useMutation({
    mutationFn: () => api(`/api/presentations/${id}/rehearsals`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runs', id] });
      await refresh();
    },
    onError,
  });
  const loadDemo = useMutation({
    mutationFn: () => api(`/api/presentations/${id}/demo-slides`, { body: {} }),
    onSuccess: refresh,
    onError,
  });
  /** Abdeckungen schon importierter Animationen an die Folienbilder anpassen (ohne Neuimport) */
  const refit = useMutation({
    mutationFn: async () => {
      const todo = slides.filter(needsRefit);
      for (const s of todo) {
        const builds = await refitBuilds(s);
        await api(`/api/slides/${s.id}`, { method: 'PATCH', body: { config: { ...s.config, builds } } });
      }
      return todo.length;
    },
    onSuccess: async (n) => {
      await refresh();
      toast(`Animationen auf ${n} ${n === 1 ? 'Folie' : 'Folien'} nachgebessert`);
    },
    onError,
  });
  const removeSlide = useMutation({
    mutationFn: (slideId: number) => api(`/api/slides/${slideId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });
  const duplicateSlide = useMutation({
    mutationFn: (slideId: number) => api<{ id: number }>(`/api/slides/${slideId}/duplicate`, { body: {} }),
    onSuccess: async ({ id: newId }) => {
      await refresh();
      setSelectedId(newId);
    },
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api(`/api/presentations/${id}/order`, { method: 'PUT', body: { ids } }),
    onMutate: (ids) => {
      queryClient.setQueryData<Presentation>(key, (p) => p && { ...p, slides: ids.map((sid) => p.slides.find((s) => s.id === sid)!) });
    },
    onSettled: refresh,
    onError: (err) => {
      // Inzwischen hat jemand Folien hinzugefügt oder gelöscht – neu geladen, bitte noch einmal
      if (err instanceof ApiError && err.status === 409)
        toast('Die Folienliste hat sich gerade geändert – bitte noch einmal verschieben', 'error');
      else onError(err);
    },
  });
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api<(BrandView & { id: number })[]>('/api/brands'),
    enabled: isOwner,
  });
  const updateSettings = useMutation({
    mutationFn: (body: { shareSlides?: boolean; targetMinutes?: number | null }) =>
      api(`/api/presentations/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
    onError,
  });
  const setBrand = useMutation({
    mutationFn: (brandId: number | null) => api(`/api/presentations/${id}`, { method: 'PATCH', body: { brandId } }),
    onSuccess: refresh,
    onError,
  });
  const rename = useMutation({
    mutationFn: (title: string) => api(`/api/presentations/${id}`, { method: 'PATCH', body: { title } }),
    onError,
  });

  if (pres.isLoading) return <FullScreenSpinner />;
  if (!pres.data) return <main className="page">Präsentation nicht gefunden.</main>;

  const move = (slideId: number, delta: number) => {
    const ids = slides.map((s) => s.id);
    const i = ids.indexOf(slideId);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };

  return (
    <main className="editor">
      <div className="editor-head">
        <Link to="/admin" className="icon-btn" aria-label="Zurück">
          <ArrowLeft />
        </Link>
        <input
          // Neuer Titel von jemand anderem: Feld neu aufbauen
          key={pres.data.title}
          className="title-input"
          defaultValue={pres.data.title}
          maxLength={200}
          aria-label="Titel"
          readOnly={!canEdit}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t && t !== pres.data!.title) rename.mutate(t);
          }}
        />
        <EditorsBar editors={session.editors.map((e) => shown(e.name))} />
        {/* Bewusst zurückhaltend: Symbol statt Knopf */}
        <button className="icon-btn" onClick={() => setShowVersions(true)} aria-label="Versionsverlauf" title="Versionsverlauf">
          <History />
        </button>
        {isOwner && (
          <button className="btn" onClick={() => setSharing(true)}>
            <Users /> Teilen
          </button>
        )}
        {!canHost ? null : pres.data.liveRun ? (
          <Link className="btn btn-primary" to={`/admin/live/${pres.data.liveRun.id}`}>
            <span className="dot dot-live" style={{ background: '#fff' }} /> Live · {formatCode(pres.data.liveRun.code)}
          </Link>
        ) : (
          <button className="btn btn-primary" onClick={() => start.mutate(id)} disabled={slides.length === 0 || start.isPending}>
            <Play /> Live starten
          </button>
        )}
        {canHost && (
          <RehearsalButton
            presentationId={id}
            running={pres.data.rehearsalRun}
            disabled={slides.length === 0 || start.isPending}
            onStart={start.mutate}
            label
          />
        )}
      </div>
      {pres.data.ownerName && (
        <p className="small muted shared-note">
          Geteilt von <strong>{pres.data.ownerName}</strong> · deine Rolle: {ROLE_LABELS[role]}
        </p>
      )}
      {googleSync.progress && (
        <div className="card card-pad google-banner">
          <SyncProgressBar progress={googleSync.progress} />
        </div>
      )}
      {!googleSync.progress && pres.data.source?.changed && pres.data.source.syncedHash && canEdit && (
        <div className="card card-pad google-banner row-between">
          <span className="small">Bei Google Slides gibt es eine neue Fassung dieser Präsentation.</span>
          <button className="btn btn-small btn-primary" onClick={() => void googleSync.run()} disabled={live}>
            <RefreshCw /> {live ? 'Nach der Durchführung abgleichen' : 'Jetzt abgleichen'}
          </button>
        </div>
      )}
      {googleSync.error && !showGoogle && (
        <div className="error-box google-banner">
          Abgleich mit Google Slides: {googleSync.error}{' '}
          <button className="btn btn-small btn-ghost" onClick={googleSync.clearError}>
            Schließen
          </button>
        </div>
      )}

      <div className="editor-settings">
        <label className="brand-select">
          <Palette size={16} aria-hidden />
          <span className="visually-hidden">Branding</span>
          <select
            className="select"
            value={pres.data.brandId ?? ''}
            disabled={!isOwner}
            title={isOwner ? undefined : 'Das Branding legt fest, wem die Präsentation gehört'}
            onChange={(e) => setBrand.mutate(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Ohne Branding</option>
            {isOwner
              ? brands.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))
              : pres.data.brand && <option value={pres.data.brandId ?? ''}>{pres.data.brand.name}</option>}
          </select>
        </label>
        <label className="switch small">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={pres.data.shareSlides}
            onChange={(e) => updateSettings.mutate({ shareSlides: e.target.checked })}
          />
          Folien auf Handys zeigen
        </label>
        <label className="row small muted" style={{ gap: 6 }}>
          <Timer size={16} aria-hidden />
          Dauer
          <input
            key={pres.data.targetMinutes ?? ''}
            className="input minutes-input"
            type="number"
            min={1}
            max={600}
            placeholder="–"
            readOnly={!canEdit}
            defaultValue={pres.data.targetMinutes ?? ''}
            onBlur={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              if (v !== pres.data!.targetMinutes) updateSettings.mutate({ targetMinutes: v });
            }}
          />
          Min.
        </label>
        {plannedSum > 0 && (
          <span className="small muted tabular" title="Summe der geplanten Minuten aller Folien">
            geplant: {plannedSum} Min.
            {pres.data.targetMinutes !== null && ` von ${pres.data.targetMinutes}`}
          </span>
        )}
      </div>

      <div className="editor-grid">
        <aside className="slide-list card">
          <ol>
            {slides.map((s, i) => (
              <li
                key={s.id}
                className={s.id === selected?.id ? 'is-selected' : ''}
                onContextMenu={(e) => {
                  if (!canEdit) return;
                  e.preventDefault();
                  setSelectedId(s.id);
                  setMenu({ slideId: s.id, x: e.clientX, y: e.clientY });
                }}
              >
                <button className="slide-item" onClick={() => setSelectedId(s.id)}>
                  <span className="slide-num tabular">{i + 1}</span>
                  {s.type === 'image' ? (
                    <img className="slide-thumb" src={assetThumbUrl(s.config.asset)} alt="" loading="lazy" />
                  ) : (
                    <span className="slide-type-icon">
                      <SlideIcon type={s.type} />
                    </span>
                  )}
                  <span className="slide-item-text">
                    <span className="slide-item-type">
                      {SLIDE_TYPE_LABELS[s.type]}
                      {plannedOf(s.id) !== null && <span className="tabular"> · {plannedOf(s.id)} Min.</span>}
                    </span>
                    <span className="slide-item-title">{slideHeadline(s) || <em className="faint">ohne Titel</em>}</span>
                  </span>
                  {othersOn(s.id).length > 0 && (
                    <span className="slide-presence" title={`Gerade hier: ${othersOn(s.id).join(', ')}`}>
                      {othersOn(s.id).map((n) => (
                        <span key={n} className="editor-chip is-small" aria-hidden>
                          {initials(n)}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
                {s.id === selected?.id && canEdit && (
                  <div className="slide-actions">
                    <button className="icon-btn" aria-label="Nach oben" onClick={() => move(s.id, -1)} disabled={i === 0}>
                      <ArrowUp />
                    </button>
                    <button className="icon-btn" aria-label="Nach unten" onClick={() => move(s.id, 1)} disabled={i === slides.length - 1}>
                      <ArrowDown />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Danach einfügen"
                      title="Danach einfügen (auch per Rechtsklick)"
                      onClick={() => {
                        setInsertAfter(s.id);
                        setInserting(true);
                      }}
                    >
                      <Plus />
                    </button>
                    <button className="icon-btn" aria-label="Duplizieren" onClick={() => duplicateSlide.mutate(s.id)}>
                      <Copy />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Löschen"
                      onClick={() => {
                        const warn = pres.data!.liveRun ? ' Antworten in der laufenden Durchführung gehen dabei verloren.' : '';
                        if (window.confirm(`Folie löschen?${warn}`)) removeSlide.mutate(s.id);
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {canEdit && (
            <div className="slide-list-actions">
              <button className="btn btn-block" onClick={() => setAdding((a) => !a)}>
                <Plus /> Folie hinzufügen
              </button>
              <button
                className="btn btn-block"
                onClick={() => {
                  setInsertAfter(selected?.id ?? null);
                  setImporting(true);
                }}
              >
                <FileUp /> PDF importieren
              </button>
              {slides.some((s) => s.type === 'image') && (
                <button
                  className="btn btn-block"
                  onClick={() => setReplacing(true)}
                  title="Dieselbe Präsentation erneut als PDF hochladen – schärfere Bilder und kopierbarer Text, Ergebnisse bleiben"
                >
                  <RefreshCw /> Folienbilder aktualisieren
                </button>
              )}
              <button
                className="btn btn-block"
                onClick={() => setShowGoogle(true)}
                title="Folien aus Google Slides übernehmen und aktuell halten"
              >
                <Link2 /> {pres.data.source ? 'Google Slides …' : 'Google Slides verknüpfen'}
              </button>
              {slides.some(needsRefit) && (
                <button
                  className="btn btn-block"
                  onClick={() => refit.mutate()}
                  disabled={refit.isPending}
                  title="Abdeckungen älterer Importe an die Folienbilder anpassen, damit vor dem Aufdecken nichts durchscheint"
                >
                  <Layers /> {refit.isPending ? 'Bessere nach …' : 'Animationen nachbessern'}
                </button>
              )}
            </div>
          )}
          {adding && canEdit && (
            <InsertPicker
              slides={slides}
              disabled={addSlide.isPending || addBatch.isPending}
              onInsert={(batch) => addBatch.mutate({ slides: batch, afterId: selected?.id ?? null })}
              typePicker={
                <TypePicker
                  disabled={addSlide.isPending}
                  board={lastBoard(slides, selected)}
                  onPick={(type, config) => addSlide.mutate({ type, config, afterId: selected?.id ?? null })}
                />
              }
            />
          )}
        </aside>

        {selected ? (
          <SlideEditor
            key={selected.id}
            slide={selected}
            presentation={pres.data}
            index={slides.indexOf(selected)}
            readOnly={!canEdit}
            lastEditor={session.lastEditor[selected.id] ?? null}
            others={othersOn(selected.id)}
            me={me}
          />
        ) : (
          <div className="empty stack" style={{ gridColumn: 'span 2', justifyItems: 'center' }}>
            <p>Noch keine Folien. Füge links die erste hinzu – oder lade den Demo-Foliensatz mit allen Funktionen.</p>
            <button className="btn btn-primary" onClick={() => loadDemo.mutate()} disabled={!canEdit || loadDemo.isPending}>
              <Sparkles /> Demo-Folien laden
            </button>
          </div>
        )}
      </div>

      {runs.data && runs.data.length > 0 && (
        <section className="card card-pad stack runs-section">
          <div className="row-between">
            <h2 className="row">
              <Archive size={20} /> Durchführungen
            </h2>
            {runs.data.filter((r) => r.endedAt).length >= 2 && (
              <Link className="btn btn-small" to={`/admin/p/${id}/vergleich`}>
                Durchführungen vergleichen
              </Link>
            )}
          </div>
          <ul className="run-list">
            {runs.data
              .filter((r) => !r.rehearsal)
              .map((r) => (
                <li key={r.id}>
                  <span className="grow">
                    <strong>{new Date(r.startedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
                    <span className="small faint"> · {r.participants} Teilnehmende</span>
                  </span>
                  {r.endedAt ? (
                    <Link className="btn btn-small" to={`/admin/runs/${r.id}`}>
                      Ergebnisse
                    </Link>
                  ) : (
                    <Link className="btn btn-small btn-primary" to={`/admin/live/${r.id}`}>
                      <Radio /> Live
                    </Link>
                  )}
                </li>
              ))}
          </ul>
          <RehearsalList
            runs={runs.data.filter((r) => r.rehearsal)}
            open={showRehearsals}
            onToggle={() => setShowRehearsals((v) => !v)}
            onRemoveAll={() => {
              if (window.confirm('Alle Probeläufe dieser Präsentation löschen – auch einen laufenden?')) removeRehearsals.mutate();
            }}
          />
        </section>
      )}
      {menu && (
        <SlideMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Danach einfügen …',
              icon: <Plus />,
              run: () => {
                setInsertAfter(menu.slideId);
                setInserting(true);
              },
            },
            {
              label: 'PDF danach importieren …',
              icon: <FileUp />,
              run: () => {
                setInsertAfter(menu.slideId);
                setImporting(true);
              },
            },
            { label: 'Duplizieren', icon: <Copy />, run: () => duplicateSlide.mutate(menu.slideId) },
            { label: 'Als Baustein speichern …', icon: <Blocks />, run: () => setSavingBlock(menu.slideId) },
            {
              label: 'Löschen',
              icon: <Trash2 />,
              danger: true,
              run: () => {
                const warn = pres.data!.liveRun ? ' Antworten in der laufenden Durchführung gehen dabei verloren.' : '';
                if (window.confirm(`Folie löschen?${warn}`)) removeSlide.mutate(menu.slideId);
              },
            },
          ]}
        />
      )}
      {inserting && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="insert-title" onClick={() => setInserting(false)}>
          <div className="dialog card card-pad stack" onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <h2 id="insert-title">Nach Folie {slides.findIndex((s) => s.id === insertAfter) + 1} einfügen</h2>
              <button className="icon-btn" onClick={() => setInserting(false)} aria-label="Schließen">
                <X />
              </button>
            </div>
            <InsertPicker
              slides={slides}
              disabled={addSlide.isPending || addBatch.isPending}
              onInsert={(batch) => addBatch.mutate({ slides: batch, afterId: insertAfter })}
              typePicker={
                <TypePicker
                  disabled={addSlide.isPending}
                  board={lastBoard(slides, slides.find((s) => s.id === insertAfter) ?? null)}
                  onPick={(type, config) => addSlide.mutate({ type, config, afterId: insertAfter })}
                />
              }
            />
          </div>
        </div>
      )}
      {savingBlock !== null && (
        <SaveBlockDialog
          slides={slides}
          notes={pres.data.notes}
          schedule={pres.data.schedule}
          startId={savingBlock}
          onClose={() => setSavingBlock(null)}
        />
      )}
      {sharing && <ShareDialog presentationId={id} onClose={() => setSharing(false)} />}
      {showVersions && (
        <VersionsDialog
          presentationId={id}
          canEdit={canEdit}
          live={!!pres.data.liveRun || !!pres.data.rehearsalRun}
          onClose={() => setShowVersions(false)}
          onRestored={async (message) => {
            toast(message);
            await refresh();
          }}
        />
      )}
      {showGoogle && (
        <GoogleSourceDialog
          presentationId={id}
          source={pres.data.source}
          sync={googleSync}
          live={live}
          onClose={() => setShowGoogle(false)}
        />
      )}
      {replacing && (
        <ReplaceImagesDialog
          presentationId={id}
          imageSlides={slides.flatMap((s) => (s.type === 'image' ? [{ id: s.id, title: s.config.title }] : []))}
          onClose={() => setReplacing(false)}
          onDone={async (count) => {
            setReplacing(false);
            toast(`${count} Folienbilder aktualisiert`);
            await refresh();
          }}
        />
      )}
      {importing && (
        <ImportDialog
          presentationId={id}
          afterId={insertAfter}
          onClose={() => setImporting(false)}
          onDone={async (count, note) => {
            setImporting(false);
            const text = `${count} ${count === 1 ? 'Folie' : 'Folien'} importiert`;
            toast(note ? `${text}. ${note}` : text, note?.includes('prüfen') ? 'error' : 'info');
            await refresh();
          }}
        />
      )}
    </main>
  );
}

const initials = (name: string) =>
  name.startsWith('du (')
    ? 'Du'
    : name
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join('') || '?';

/** Wer außer mir gerade in diesem Editor ist */
function EditorsBar({ editors }: { editors: string[] }) {
  const unique = [...new Set(editors)];
  if (unique.length === 0) return null;
  return (
    <span className="editors-bar" title={`Gerade im Editor: ${unique.join(', ')}`} aria-label={`Gerade im Editor: ${unique.join(', ')}`}>
      {unique.slice(0, 5).map((n) => (
        <span key={n} className="editor-chip">
          {initials(n)}
        </span>
      ))}
      {unique.length > 5 && <span className="small muted">+{unique.length - 5}</span>}
    </span>
  );
}

/** Name der Kartenwand, mit der ein neuer Schritt weiterarbeitet: die letzte vor der Auswahl. */
/** Auswahl des Folientyps – in der Seitenleiste oder im Einfügen-Dialog */
function TypePicker({
  onPick,
  disabled,
  board,
}: {
  onPick: (type: SlideType, config?: unknown) => void;
  disabled: boolean;
  /** Wand, mit der neue Kartenwand-Schritte weiterarbeiten */
  board: string;
}) {
  return (
    <div className="type-picker anim-rise">
      {CREATABLE_SLIDE_TYPES.filter((t) => t !== 'board').map((t) => (
        <button key={t} className="type-option" onClick={() => onPick(t)} disabled={disabled}>
          <span className="slide-type-icon">
            <SlideIcon type={t} />
          </span>
          <span>
            <strong>{SLIDE_TYPE_LABELS[t]}</strong>
            <span className="small faint" style={{ display: 'block' }}>
              {SLIDE_TYPE_HINTS[t]}
            </span>
          </span>
        </button>
      ))}
      <span className="label type-picker-label">Workshop: {SLIDE_TYPE_LABELS.board}</span>
      {BOARD_MODES.map((mode) => (
        <button key={mode} className="type-option" disabled={disabled} onClick={() => onPick('board', { mode, board })}>
          <span className="slide-type-icon">
            <SlideIcon type="board" />
          </span>
          <span>
            <strong>{BOARD_MODE_LABELS[mode]}</strong>
            <span className="small faint" style={{ display: 'block' }}>
              {BOARD_MODE_HINTS[mode]}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Kontextmenü einer Folie (Rechtsklick in der Folienliste) */
function SlideMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: { label: string; icon: ReactNode; run: () => void; danger?: boolean }[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  // Am Fensterrand nach innen klappen
  const style = { left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 48 * items.length - 16) };
  return (
    <div ref={ref} className="context-menu" role="menu" style={style}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={it.danger ? 'is-danger' : ''}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

function lastBoard(slides: Slide[], selected: Slide | null): string {
  const upTo = selected ? slides.slice(0, slides.indexOf(selected) + 1) : slides;
  const found = [...upTo].reverse().find((s) => s.type === 'board') ?? slides.find((s) => s.type === 'board');
  return found?.type === 'board' ? found.config.board : 'Karten';
}

/** Antwort des Servers auf das Speichern einer Folie (auch der aktuelle Stand bei einem Konflikt) */
interface SlideState {
  config: Slide['config'];
  notes: string;
  schedule: SlideSchedule;
  rev: number;
}

const conflictState = (data: unknown) => (data as { current?: SlideState } | null)?.current;

/** Speichert ein Feld der Folie auf Basis des zuletzt bekannten Stands und trägt das Ergebnis in den Cache ein */
function useSlideSaver(presentationId: number, slideId: number) {
  const queryClient = useQueryClient();
  return async (body: Record<string, unknown>) => {
    const state = await api<SlideState>(`/api/slides/${slideId}`, { method: 'PATCH', body });
    queryClient.setQueryData<Presentation>(
      ['presentation', presentationId],
      (p) =>
        p && {
          ...p,
          slides: p.slides.map((s) => (s.id === slideId ? ({ ...s, config: state.config } as Slide) : s)),
          notes: { ...p.notes, [slideId]: state.notes },
          schedule: { ...p.schedule, [slideId]: state.schedule },
          revs: { ...p.revs, [slideId]: state.rev },
        },
    );
    return state;
  };
}

/** Hinweis, wenn eigene und fremde Änderungen an derselben Stelle kollidieren */
function ConflictBar({
  who,
  me,
  what,
  onResolve,
}: {
  who: string | null;
  /** Eigener Benutzername – dasselbe Konto in einem anderen Fenster */
  me: string | null;
  what: string;
  onResolve: (c: 'mine' | 'theirs') => void;
}) {
  const self = !!who && who === me;
  return (
    <div className="conflict-bar" role="alert">
      <span className="grow small">
        {self ? (
          <>Du hast {what} gerade in einem anderen Fenster geändert. Welche Fassung soll gelten?</>
        ) : (
          <>
            {who ? <strong>{who}</strong> : 'Jemand anderes'} hat {what} gerade auch geändert. Welche Fassung soll gelten?
          </>
        )}
      </span>
      <button type="button" className="btn btn-small" onClick={() => onResolve('theirs')}>
        {self ? 'Andere Fassung übernehmen' : who ? `Fassung von ${who} übernehmen` : 'Andere Fassung übernehmen'}
      </button>
      <button type="button" className="btn btn-small btn-primary" onClick={() => onResolve('mine')}>
        Meine behalten
      </button>
    </div>
  );
}

/** Formular + Vorschau einer Folie. Änderungen werden nach kurzer Pause gespeichert. */
function SlideEditor({
  slide,
  presentation,
  index,
  readOnly,
  lastEditor,
  others,
  me,
}: {
  slide: Slide;
  presentation: Presentation;
  index: number;
  readOnly: boolean;
  /** Wer diese Folie zuletzt geändert hat (von anderen) */
  lastEditor: string | null;
  /** Wer außer mir gerade auf dieser Folie ist */
  others: string[];
  me: string | null;
}) {
  const queryClient = useQueryClient();
  const saveSlide = useSlideSaver(presentation.id, slide.id);
  const field = useSyncedField<Slide['config']>({
    key: `config:${slide.id}`,
    server: slide.config,
    send: async (config, baseConfig) => (await saveSlide({ config, baseConfig })).config,
    fromConflict: (data) => conflictState(data)?.config,
  });
  const draft = field.value;

  const previewSlide = { ...slide, config: draft } as Slide;
  const steps = buildSteps(previewSlide);
  // Vorschau eines Aufbau-Schritts; ohne Auswahl der Endzustand
  const [step, setStep] = useState<{ slideId: number; value: number } | null>(null);
  const previewStep = step?.slideId === slide.id ? Math.min(step.value, steps) : steps;
  const preview = staticPreview(previewSlide, {
    title: presentation.title,
    brand: presentation.brand,
    index,
    count: presentation.slides.length,
    buildStep: previewStep,
  });

  return (
    <>
      <section className="card card-pad slide-form">
        <div className="row-between">
          <h2 className="row">
            <SlideIcon type={slide.type} size={20} /> {SLIDE_TYPE_LABELS[slide.type]}
          </h2>
          <span className="small faint" aria-live="polite">
            {readOnly
              ? 'Nur ansehen'
              : field.status === 'pending'
                ? 'Speichert …'
                : field.status === 'saved'
                  ? 'Gespeichert'
                  : others.length > 0
                    ? `Auch hier: ${others.join(', ')}`
                    : ''}
          </span>
        </div>
        {field.status === 'conflict' && <ConflictBar who={lastEditor} me={me} what="diese Folie" onResolve={field.resolve} />}
        <form className="stack" onSubmit={(e) => e.preventDefault()}>
          <fieldset className="plain-fieldset stack" disabled={readOnly}>
            <SlideForm
              slide={slide}
              value={draft}
              onChange={field.set}
              boards={[...new Set(presentation.slides.flatMap((s) => (s.type === 'board' ? [s.config.board] : [])))]}
            />
          </fieldset>
        </form>
        {field.error && <div className="error-box">{field.error}</div>}
        <NotesField
          key={slide.id}
          slideId={slide.id}
          presentationId={presentation.id}
          server={presentation.notes[slide.id] ?? ''}
          readOnly={readOnly}
          lastEditor={lastEditor}
          me={me}
        />
        <ScheduleFields
          key={`schedule-${slide.id}`}
          slideId={slide.id}
          initial={presentation.schedule?.[slide.id] ?? EMPTY_SCHEDULE}
          readOnly={readOnly}
          onSaved={(schedule) =>
            queryClient.setQueryData<Presentation>(
              ['presentation', presentation.id],
              (p) => p && { ...p, schedule: { ...p.schedule, [slide.id]: schedule } },
            )
          }
        />
      </section>
      <section className="preview-col">
        <div className="row-between">
          <span className="label">Vorschau Beamer</span>
          {steps > 0 && (
            <span className="build-stepper small">
              <button
                className="icon-btn"
                onClick={() => setStep({ slideId: slide.id, value: Math.max(0, previewStep - 1) })}
                disabled={previewStep <= 0}
                aria-label="Vorheriger Animationsschritt"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="tabular muted">
                {previewStep === 0 ? 'Start' : `Klick ${previewStep}`} / {steps}
              </span>
              <button
                className="icon-btn"
                onClick={() => setStep({ slideId: slide.id, value: Math.min(steps, previewStep + 1) })}
                disabled={previewStep >= steps}
                aria-label="Nächster Animationsschritt"
              >
                <ChevronRight size={16} />
              </button>
            </span>
          )}
        </div>
        <div className="preview-frame">
          <Stage view={preview} />
        </div>
      </section>
    </>
  );
}

/** Sprechernotizen einer Folie – erscheinen nur in der Referentenansicht. */
function NotesField({
  slideId,
  presentationId,
  server,
  readOnly,
  lastEditor,
  me,
}: {
  slideId: number;
  presentationId: number;
  server: string;
  readOnly: boolean;
  lastEditor: string | null;
  me: string | null;
}) {
  const saveSlide = useSlideSaver(presentationId, slideId);
  const field = useSyncedField<string>({
    key: `notes:${slideId}`,
    server,
    delay: 700,
    send: async (notes, baseNotes) => (await saveSlide({ notes, baseNotes })).notes,
    fromConflict: (data) => conflictState(data)?.notes,
  });

  return (
    <label className="field">
      <span className="row-between">
        Sprechernotizen
        <span className="faint" style={{ fontWeight: 500 }}>
          {field.status === 'pending'
            ? 'Speichert …'
            : field.status === 'saved'
              ? 'Gespeichert'
              : field.status === 'error'
                ? 'Nicht gespeichert'
                : 'nur in der Referentenansicht'}
        </span>
      </span>
      {field.status === 'conflict' && <ConflictBar who={lastEditor} me={me} what="die Notizen" onResolve={field.resolve} />}
      <textarea
        className="textarea"
        rows={4}
        maxLength={20000}
        value={field.value}
        readOnly={readOnly}
        placeholder="Was du zu dieser Folie sagen möchtest …"
        onChange={(e) => field.set(e.target.value)}
      />
    </label>
  );
}
