import {
  buildSentence,
  sentenceStart,
  SLIDE_TYPE_HINTS,
  SLIDE_TYPE_LABELS,
  SLIDE_TYPES,
  slideHeadline,
  type BrandView,
  type DisplayView,
  type Slide,
  type SlideType,
} from '@slides/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Archive, Copy, Palette, Play, Plus, Radio, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { SlideForm } from '../../components/admin/SlideForm.tsx';
import { SlideIcon } from '../../components/slideIcons.tsx';
import { Stage } from '../../components/Stage.tsx';
import { formatCode, FullScreenSpinner, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useStartRun } from './PresentationsPage.tsx';

interface Presentation {
  id: number;
  title: string;
  brandId: number | null;
  brand: BrandView | null;
  slides: Slide[];
  liveRun: { id: number; code: string } | null;
}

interface RunItem {
  id: number;
  code: string | null;
  startedAt: string;
  endedAt: string | null;
  participants: number;
}

export default function EditorPage() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['presentation', id];
  const pres = useQuery({ queryKey: key, queryFn: () => api<Presentation>(`/api/presentations/${id}`) });
  const runs = useQuery({ queryKey: ['runs', id], queryFn: () => api<RunItem[]>(`/api/presentations/${id}/runs`) });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const start = useStartRun();

  const slides = pres.data?.slides ?? [];
  const selected = slides.find((s) => s.id === selectedId) ?? slides[0] ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const onError = (err: unknown) => toast(errorMessage(err), 'error');

  const addSlide = useMutation({
    mutationFn: (type: SlideType) =>
      api<{ id: number }>(`/api/presentations/${id}/slides`, { body: { type, afterId: selected?.id ?? null } }),
    onSuccess: async ({ id: newId }) => {
      setAdding(false);
      await refresh();
      setSelectedId(newId);
    },
    onError,
  });
  const loadDemo = useMutation({
    mutationFn: () => api(`/api/presentations/${id}/demo-slides`, { body: {} }),
    onSuccess: refresh,
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
    onError,
  });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api<(BrandView & { id: number })[]>('/api/brands') });
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
          className="title-input"
          defaultValue={pres.data.title}
          maxLength={200}
          aria-label="Titel"
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t && t !== pres.data!.title) rename.mutate(t);
          }}
        />
        <label className="brand-select">
          <Palette size={16} aria-hidden />
          <span className="visually-hidden">Branding</span>
          <select
            className="select"
            value={pres.data.brandId ?? ''}
            onChange={(e) => setBrand.mutate(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Ohne Branding</option>
            {brands.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {pres.data.liveRun ? (
          <Link className="btn btn-primary" to={`/admin/live/${pres.data.liveRun.id}`}>
            <span className="dot dot-live" style={{ background: '#fff' }} /> Live · {formatCode(pres.data.liveRun.code)}
          </Link>
        ) : (
          <button className="btn btn-primary" onClick={() => start.mutate(id)} disabled={slides.length === 0 || start.isPending}>
            <Play /> Live starten
          </button>
        )}
      </div>

      <div className="editor-grid">
        <aside className="slide-list card">
          <ol>
            {slides.map((s, i) => (
              <li key={s.id} className={s.id === selected?.id ? 'is-selected' : ''}>
                <button className="slide-item" onClick={() => setSelectedId(s.id)}>
                  <span className="slide-num tabular">{i + 1}</span>
                  <span className="slide-type-icon">
                    <SlideIcon type={s.type} />
                  </span>
                  <span className="slide-item-text">
                    <span className="slide-item-type">{SLIDE_TYPE_LABELS[s.type]}</span>
                    <span className="slide-item-title">{slideHeadline(s) || <em className="faint">ohne Titel</em>}</span>
                  </span>
                </button>
                {s.id === selected?.id && (
                  <div className="slide-actions">
                    <button className="icon-btn" aria-label="Nach oben" onClick={() => move(s.id, -1)} disabled={i === 0}>
                      <ArrowUp />
                    </button>
                    <button className="icon-btn" aria-label="Nach unten" onClick={() => move(s.id, 1)} disabled={i === slides.length - 1}>
                      <ArrowDown />
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
          <button className="btn btn-block" onClick={() => setAdding((a) => !a)}>
            <Plus /> Folie hinzufügen
          </button>
          {adding && (
            <div className="type-picker anim-rise">
              {SLIDE_TYPES.map((t) => (
                <button key={t} className="type-option" onClick={() => addSlide.mutate(t)} disabled={addSlide.isPending}>
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
            </div>
          )}
        </aside>

        {selected ? (
          <SlideEditor key={selected.id} slide={selected} presentation={pres.data} index={slides.indexOf(selected)} />
        ) : (
          <div className="empty stack" style={{ gridColumn: 'span 2', justifyItems: 'center' }}>
            <p>Noch keine Folien. Füge links die erste hinzu – oder lade den Demo-Foliensatz mit allen Funktionen.</p>
            <button className="btn btn-primary" onClick={() => loadDemo.mutate()} disabled={loadDemo.isPending}>
              <Sparkles /> Demo-Folien laden
            </button>
          </div>
        )}
      </div>

      {runs.data && runs.data.length > 0 && (
        <section className="card card-pad stack runs-section">
          <h2 className="row">
            <Archive size={20} /> Durchführungen
          </h2>
          <ul className="run-list">
            {runs.data.map((r) => (
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
        </section>
      )}
    </main>
  );
}

/** Formular + Vorschau einer Folie. Änderungen werden nach kurzer Pause gespeichert. */
function SlideEditor({ slide, presentation, index }: { slide: Slide; presentation: Presentation; index: number }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(slide.config);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saved'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(draft);

  const save = async (config: Slide['config']) => {
    try {
      const res = await api<{ config: Slide['config'] }>(`/api/slides/${slide.id}`, { method: 'PATCH', body: { config } });
      setError(null);
      setSaving('saved');
      queryClient.setQueryData<Presentation>(
        ['presentation', presentation.id],
        (p) => p && { ...p, slides: p.slides.map((s) => (s.id === slide.id ? ({ ...s, config: res.config } as Slide) : s)) },
      );
    } catch (err) {
      setError(errorMessage(err));
      setSaving('idle');
    }
  };

  const onChange = (config: Slide['config']) => {
    setDraft(config);
    latest.current = config;
    setSaving('pending');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void save(config);
    }, 600);
  };

  // Beim Verlassen ausstehende Änderungen sofort speichern.
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        void api(`/api/slides/${slide.id}`, { method: 'PATCH', body: { config: latest.current } }).catch(() => {});
      }
    },
    [slide.id],
  );

  const previewSlide = { ...slide, config: draft } as Slide;
  const preview: DisplayView = {
    kind: 'display',
    run: { id: 0, title: presentation.title, code: '123456', ended: false, brand: presentation.brand },
    serverTime: Date.now(),
    participants: 0,
    slide: previewSlide,
    slideIndex: index,
    slideCount: presentation.slides.length,
    locked: false,
    resultsVisible: false,
    answers: 0,
    results: null,
    quiz: previewSlide.type === 'quiz' ? { phase: 'ready', closesAt: null, revealed: false } : null,
    sentence:
      previewSlide.type === 'sentence'
        ? {
            text: buildSentence(previewSlide.config.start, []),
            start: sentenceStart(previewSlide.config.start),
            appended: [],
            round: 1,
            revealed: false,
            done: false,
          }
        : null,
    posts: [],
    spotlight: null,
    leaderboard: null,
    showJoin: false,
  };

  return (
    <>
      <section className="card card-pad slide-form">
        <div className="row-between">
          <h2 className="row">
            <SlideIcon type={slide.type} size={20} /> {SLIDE_TYPE_LABELS[slide.type]}
          </h2>
          <span className="small faint" aria-live="polite">
            {saving === 'pending' ? 'Speichert …' : saving === 'saved' ? 'Gespeichert' : ''}
          </span>
        </div>
        <form className="stack" onSubmit={(e) => e.preventDefault()}>
          <SlideForm slide={slide} value={draft} onChange={onChange} />
        </form>
        {error && <div className="error-box">{error}</div>}
      </section>
      <section className="preview-col">
        <span className="label">Vorschau Beamer</span>
        <div className="preview-frame">
          <Stage view={preview} />
        </div>
      </section>
    </>
  );
}
