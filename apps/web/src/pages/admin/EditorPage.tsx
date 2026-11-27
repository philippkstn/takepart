import {
  BOARD_MODE_HINTS,
  BOARD_MODE_LABELS,
  BOARD_MODES,
  buildSteps,
  SLIDE_TYPE_HINTS,
  SLIDE_TYPE_LABELS,
  CREATABLE_SLIDE_TYPES,
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
  type SectionChange,
} from '@slides/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Archive,
  Blocks,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileUp,
  Heading,
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
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { InsertPicker, SaveBlockDialog } from '../../components/admin/BlockPicker.tsx';
import { RehearsalList } from '../../components/admin/RehearsalList.tsx';
import { ImportDialog, isPdf, isPptx } from '../../components/admin/ImportDialog.tsx';
import { initials, SlideList, type SlideMenuRequest } from '../../components/admin/SlideList.tsx';
import { SelectionPanel } from '../../components/admin/SelectionPanel.tsx';
import { useSlideSelection } from '../../components/admin/useSlideSelection.ts';
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
  /** Abschnitte der Folienliste: Titel je Folie, an der einer beginnt */
  sections?: Record<string, string>;
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
  const [importing, setImporting] = useState(false);
  /** Ins Fenster gezogene Dateien für den PDF-Import */
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>(undefined);
  const [fileOver, setFileOver] = useState(false);
  const [replacing, setReplacing] = useState(false);
  /** Hinter welcher Folie der Einfügen-Dialog bzw. der PDF-Import einfügt (Rechtsklick oder +) */
  const [insertAfter, setInsertAfter] = useState<number | null>(null);
  const [inserting, setInserting] = useState(false);
  const [menu, setMenu] = useState<SlideMenuRequest | null>(null);
  const [importMenu, setImportMenu] = useState<{ x: number; y: number; above?: number } | null>(null);
  /** Welche Folien „Als Baustein speichern“ vorschlägt (eine: ab dieser Folie, mehrere: genau die Auswahl) */
  const [savingBlock, setSavingBlock] = useState<number[] | null>(null);
  /** Folie, an der gerade ein Abschnitt benannt wird */
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [showRehearsals, setShowRehearsals] = useState(false);
  const start = useStartRun();

  const slides = pres.data?.slides ?? [];
  const plannedOf = (slideId: number) => slidePlannedMinutes(pres.data?.schedule?.[slideId]);
  const plannedSum = plannedTotal(slides.map((s) => plannedOf(s.id)));
  const selected = slides.find((s) => s.id === selectedId) ?? slides[0] ?? null;
  /** Mehrfachauswahl (Umschalt/⌘-Klick) – liegt über `selectedId` */
  const selection = useSlideSelection(
    slides.map((s) => s.id),
    selected?.id ?? null,
    setSelectedId,
  );
  const sections = pres.data?.sections ?? {};
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
  /** Mehrfachauswahl: mehrere Folien in einem Schritt löschen bzw. duplizieren */
  const removeSlides = useMutation({
    mutationFn: (ids: number[]) => api(`/api/presentations/${id}/slides/delete`, { body: { ids } }),
    onSuccess: refresh,
    onError,
  });
  const duplicateSlides = useMutation({
    mutationFn: (ids: number[]) => api<{ ids: number[] }>(`/api/presentations/${id}/slides/duplicate`, { body: { ids } }),
    onSuccess: async ({ ids }) => {
      await refresh();
      selection.select(ids);
      toast(`${ids.length} Folien dupliziert`);
    },
    onError,
  });
  const reorder = useMutation({
    mutationFn: ({ ids, sections: changes }: { ids: number[]; sections: SectionChange[] }) =>
      api(`/api/presentations/${id}/order`, { method: 'PUT', body: { ids, sections: changes } }),
    onMutate: ({ ids, sections: changes }) => {
      queryClient.setQueryData<Presentation>(key, (p) => {
        if (!p) return p;
        const next = { ...p.sections };
        for (const c of changes) {
          if (c.section) next[c.id] = c.section;
          else delete next[c.id];
        }
        return { ...p, slides: ids.map((sid) => p.slides.find((s) => s.id === sid)!), sections: next };
      });
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

  const askRemove = (slideId: number) => {
    const warn = pres.data!.liveRun ? ' Antworten in der laufenden Durchführung gehen dabei verloren.' : '';
    if (!window.confirm(`Folie löschen?${warn}`)) return;
    // Danach die Nachbarfolie auswählen statt zurück an den Anfang zu springen
    const i = slides.findIndex((s) => s.id === slideId);
    const neighbour = slideId === selected?.id ? (slides[i + 1] ?? slides[i - 1]) : undefined;
    removeSlide.mutate(slideId, { onSuccess: () => neighbour && setSelectedId(neighbour.id) });
  };
  /** Löschen aus Liste, Menü oder Übersicht: eine Folie wie bisher, mehrere mit einer Rückfrage für alle */
  const askRemoveMany = (ids: number[]) => {
    if (ids.length === 1) return askRemove(ids[0]!);
    const warn = pres.data!.liveRun ? ' Antworten in der laufenden Durchführung gehen dabei verloren.' : '';
    if (!window.confirm(`${ids.length} Folien löschen?${warn}`)) return;
    // Danach die nächste verbleibende Folie auswählen
    const last = Math.max(...ids.map((sid) => slides.findIndex((s) => s.id === sid)));
    const neighbour = slides.slice(last + 1).find((s) => !ids.includes(s.id)) ?? [...slides].reverse().find((s) => !ids.includes(s.id));
    removeSlides.mutate(ids, { onSuccess: () => neighbour && setSelectedId(neighbour.id) });
  };
  const duplicateMany = (ids: number[]) => (ids.length === 1 ? duplicateSlide.mutate(ids[0]!) : duplicateSlides.mutate(ids));

  const openInsert = (afterId: number | null) => {
    setInsertAfter(afterId);
    setInserting(true);
  };
  const openImport = (afterId: number | null, files?: File[]) => {
    setInsertAfter(afterId);
    setDroppedFiles(files);
    setImporting(true);
  };
  /** Menü unter einem Knopf öffnen */
  const below = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4, above: r.top - 4 };
  };

  /** PDF/PPTX aus dem Dateimanager in den Editor ziehen → Import hinter der ausgewählten Folie */
  const hasFiles = (e: ReactDragEvent) => canEdit && e.dataTransfer.types.includes('Files');
  const fileDrop = {
    onDragOver: (e: ReactDragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setFileOver(true);
    },
    onDragLeave: (e: ReactDragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false);
    },
    onDrop: (e: ReactDragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setFileOver(false);
      const files = [...e.dataTransfer.files].filter((f) => isPdf(f) || isPptx(f));
      if (files.length === 0) return toast('Hier lassen sich PDF- und PowerPoint-Dateien ablegen', 'error');
      openImport(selected?.id ?? null, files);
    },
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
        {canHost && (
          <RehearsalButton
            presentationId={id}
            running={pres.data.rehearsalRun}
            disabled={slides.length === 0 || start.isPending}
            onStart={start.mutate}
            label
          />
        )}
        {!canHost ? null : pres.data.liveRun ? (
          <Link className="btn btn-primary" to={`/admin/live/${pres.data.liveRun.id}`}>
            <span className="dot dot-live dot-ink" /> Live · {formatCode(pres.data.liveRun.code)}
          </Link>
        ) : (
          <button className="btn btn-primary" onClick={() => start.mutate(id)} disabled={slides.length === 0 || start.isPending}>
            <Play /> Live starten
          </button>
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
        {slides.length > 0 && (
          <SlideList
            presentationId={id}
            slides={slides}
            sections={sections}
            plannedOf={plannedOf}
            selectedId={selected?.id ?? null}
            selection={selection}
            onSelect={setSelectedId}
            canEdit={canEdit}
            othersOn={othersOn}
            editingSection={editingSection}
            onEditingSection={setEditingSection}
            onMenu={setMenu}
            onReorder={(ids, changes) => reorder.mutate({ ids, sections: changes })}
            onRemove={askRemoveMany}
            onDuplicate={duplicateMany}
            asideProps={{ className: fileOver ? 'is-file-over' : '', ...fileDrop }}
          >
            {canEdit && (
              <div className="slide-list-actions">
                <button className="btn btn-block btn-primary" onClick={() => openInsert(selected?.id ?? null)}>
                  <Plus /> Folie hinzufügen
                </button>
                <button
                  className="btn btn-block"
                  aria-haspopup="menu"
                  aria-expanded={!!importMenu}
                  onClick={(e) => setImportMenu(below(e.currentTarget))}
                >
                  <FileUp /> Importieren <ChevronDown size={16} />
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
            {fileOver && <div className="file-over-hint">PDF hier ablegen, um sie zu importieren</div>}
          </SlideList>
        )}

        {selection.multi ? (
          <SelectionPanel
            slides={slides.filter((s) => selection.has(s.id))}
            numberOf={(sid) => slides.findIndex((s) => s.id === sid) + 1}
            plannedOf={plannedOf}
            canEdit={canEdit}
            modKey={modKey}
            onDuplicate={() => duplicateMany(selection.ids)}
            onRemove={() => askRemoveMany(selection.ids)}
            onSaveBlock={() => setSavingBlock(selection.ids)}
            onStartSection={sections[selection.ids[0]!] ? null : () => setEditingSection(selection.ids[0]!)}
            onClear={selection.clear}
          />
        ) : selected ? (
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
          <div className={`editor-empty card card-pad stack ${fileOver ? 'is-file-over' : ''}`} {...fileDrop}>
            <h2>Wie möchtest du anfangen?</h2>
            {canEdit ? (
              <div className="start-options">
                <button className="start-option" onClick={() => openInsert(null)}>
                  <Plus />
                  <strong>Folie anlegen</strong>
                  <span className="small muted">Abstimmung, Quiz, Q&amp;A, Kartenwand … oder ein fertiger Übungsbaustein</span>
                </button>
                <button className="start-option" onClick={() => openImport(null)}>
                  <FileUp />
                  <strong>PDF importieren</strong>
                  <span className="small muted">Vorhandene Folien übernehmen – oder die PDF einfach hierher ziehen</span>
                </button>
                <button className="start-option" onClick={() => setShowGoogle(true)}>
                  <Link2 />
                  <strong>Google Slides verknüpfen</strong>
                  <span className="small muted">Folien übernehmen und bei Änderungen aktuell halten</span>
                </button>
                <button className="start-option" onClick={() => loadDemo.mutate()} disabled={loadDemo.isPending}>
                  <Sparkles />
                  <strong>Demo ansehen</strong>
                  <span className="small muted">Beispielfolien mit allen Funktionen zum Ausprobieren</span>
                </button>
              </div>
            ) : (
              <p className="muted">Noch keine Folien.</p>
            )}
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
          above={menu.above}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Danach einfügen …', icon: <Plus />, run: () => openInsert(menu.slideId) },
            { label: 'PDF danach importieren …', icon: <FileUp />, run: () => openImport(menu.slideId) },
            {
              label: menu.ids.length > 1 ? `${menu.ids.length} Folien duplizieren` : 'Duplizieren',
              icon: <Copy />,
              hint: `${modKey}+D`,
              run: () => duplicateMany(menu.ids),
            },
            ...(menu.moveUp ? [{ label: 'Nach oben', icon: <ArrowUp />, hint: 'Alt+↑', run: menu.moveUp }] : []),
            ...(menu.moveDown ? [{ label: 'Nach unten', icon: <ArrowDown />, hint: 'Alt+↓', run: menu.moveDown }] : []),
            {
              label: menu.sectionTitle ? 'Abschnitt umbenennen …' : 'Abschnitt hier beginnen',
              icon: <Heading />,
              run: () => setEditingSection(menu.slideId),
            },
            { label: 'Als Baustein speichern …', icon: <Blocks />, run: () => setSavingBlock(menu.ids) },
            {
              label: menu.ids.length > 1 ? `${menu.ids.length} Folien löschen` : 'Löschen',
              icon: <Trash2 />,
              hint: 'Entf',
              danger: true,
              run: () => askRemoveMany(menu.ids),
            },
          ]}
        />
      )}
      {importMenu && (
        <SlideMenu
          x={importMenu.x}
          y={importMenu.y}
          above={importMenu.above}
          onClose={() => setImportMenu(null)}
          items={[
            { label: 'PDF importieren …', icon: <FileUp />, run: () => openImport(selected?.id ?? null) },
            {
              label: pres.data.source ? 'Google Slides …' : 'Google Slides verknüpfen …',
              icon: <Link2 />,
              run: () => setShowGoogle(true),
            },
            ...(slides.some((s) => s.type === 'image')
              ? [{ label: 'Folienbilder aktualisieren …', icon: <RefreshCw />, run: () => setReplacing(true) }]
              : []),
          ]}
        />
      )}
      {inserting && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="insert-title" onClick={() => setInserting(false)}>
          <div className="dialog card card-pad stack" onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <h2 id="insert-title">
                {insertAfter === null ? 'Folie hinzufügen' : `Nach Folie ${slides.findIndex((s) => s.id === insertAfter) + 1} einfügen`}
              </h2>
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
          startId={savingBlock[0]!}
          ids={savingBlock.length > 1 ? savingBlock : undefined}
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
          initialFiles={droppedFiles}
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

/** Anzeige der Befehlstaste in Tastenhinweisen */
const modKey = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Strg';

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

/** Aufklappmenü: Aktionen einer Folie (Rechtsklick, „…“) und Import */
function SlideMenu({
  x,
  y,
  above,
  items,
  onClose,
}: {
  x: number;
  y: number;
  /** Unterkante, falls das Menü unten keinen Platz hat und über dem Knopf aufgehen soll */
  above?: number;
  items: { label: string; icon: ReactNode; run: () => void; danger?: boolean; hint?: string }[];
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
    // Nur echtes Scrollen schließt – nicht das Nachrutschen der Seite, wenn eine andere Folie geöffnet wird
    window.addEventListener('wheel', onClose, { passive: true });
    window.addEventListener('touchmove', onClose, { passive: true });
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('wheel', onClose);
      window.removeEventListener('touchmove', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  // Am Fensterrand nach innen klappen
  const height = 40 * items.length + 8;
  const top =
    y + height <= window.innerHeight - 8
      ? y
      : above !== undefined && above - height >= 8
        ? above - height
        : window.innerHeight - height - 8;
  const style = { left: Math.min(x, window.innerWidth - 240), top: Math.max(8, top) };
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
          <span className="grow">{it.label}</span>
          {it.hint && <kbd className="menu-hint">{it.hint}</kbd>}
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
