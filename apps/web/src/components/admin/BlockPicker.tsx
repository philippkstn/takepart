import {
  blockSlides,
  BUILTIN_BLOCKS,
  isEmptySchedule,
  MAX_BATCH_SLIDES,
  SLIDE_TYPE_LABELS,
  uniqueBoardName,
  type BatchSlide,
  type CustomBlock,
  type Slide,
  type SlideBlock,
  type SlideSchedule,
} from '@slides/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Blocks, Trash2, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { useToast } from '../ui.tsx';

/**
 * Übungsbausteine im Editor: vordefinierte Folienfolgen (aus `blocks.ts`) und
 * eigene, gespeicherte Bausteine. Eingefügt wird alles auf einmal über
 * `POST /api/presentations/:id/slides/batch` – samt Ablaufplan (Phasen, Soll-Dauer)
 * der Folien, falls der Baustein einen mitbringt.
 */

const boardsOf = (slides: Slide[]) => slides.flatMap((s) => (s.type === 'board' ? [s.config.board] : []));

/** Reiter „Folien“ / „Bausteine“ für Seitenleiste und Einfügen-Dialog */
export function InsertPicker({
  typePicker,
  slides,
  disabled,
  onInsert,
}: {
  typePicker: ReactNode;
  slides: Slide[];
  disabled: boolean;
  onInsert: (slides: BatchSlide[]) => void;
}) {
  const [tab, setTab] = useState<'slides' | 'blocks'>('slides');
  return (
    <div className="stack-s">
      <span className="segmented insert-tabs" role="group" aria-label="Was einfügen?">
        <button aria-pressed={tab === 'slides'} onClick={() => setTab('slides')}>
          Folien
        </button>
        <button aria-pressed={tab === 'blocks'} onClick={() => setTab('blocks')}>
          Bausteine
        </button>
      </span>
      {tab === 'slides' ? typePicker : <BlockPicker slides={slides} disabled={disabled} onInsert={onInsert} />}
    </div>
  );
}

function BlockPicker({ slides, disabled, onInsert }: { slides: Slide[]; disabled: boolean; onInsert: (slides: BatchSlide[]) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const custom = useQuery({ queryKey: ['blocks'], queryFn: () => api<CustomBlock[]>('/api/blocks') });
  const remove = useMutation({
    mutationFn: (blockId: number) => api(`/api/blocks/${blockId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blocks'] }),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  /** Baustein mit Kartenwand: erst nach dem Namen der Wand fragen */
  const [asking, setAsking] = useState<{ block: SlideBlock; board: string } | null>(null);
  const taken = boardsOf(slides);

  const pickBuiltin = (block: SlideBlock) => {
    if (block.board) setAsking({ block, board: uniqueBoardName(block.board, taken) });
    else onInsert(toBatch(blockSlides(block, undefined, { boards: taken })));
  };

  /** Eigene Bausteine: jede Wand bekommt einen freien Namen, damit nichts mit vorhandenen Karten zusammenfällt. */
  const pickCustom = (block: CustomBlock) => {
    const used = [...taken];
    const rename = new Map<string, string>();
    for (const s of block.slides) {
      if (s.type !== 'board') continue;
      const name = (s.config as { board?: string }).board ?? 'Karten';
      if (rename.has(name)) continue;
      const unique = uniqueBoardName(name, used);
      rename.set(name, unique);
      used.push(unique);
    }
    onInsert(
      block.slides.map((s) => {
        if (s.type === 'board')
          return { ...s, config: { ...(s.config as object), board: rename.get((s.config as { board?: string }).board ?? 'Karten') } };
        // Rückblick einer Feedback-Folie folgt einer mitgebrachten, umbenannten Wand
        const recall = s.type === 'feedback' ? (s.config as { recall?: string }).recall : undefined;
        if (recall && rename.has(recall)) return { ...s, config: { ...(s.config as object), recall: rename.get(recall) } };
        return s;
      }),
    );
  };

  return (
    <div className="type-picker anim-rise">
      {BUILTIN_BLOCKS.map((block) =>
        asking?.block.id === block.id ? (
          <form
            key={block.id}
            className="block-board-form stack-s"
            onSubmit={(e) => {
              e.preventDefault();
              const board = asking.board.trim();
              if (board) onInsert(toBatch(blockSlides(block, board, { boards: taken })));
            }}
          >
            <strong>{block.name}</strong>
            <label className="field">
              Name der Kartenwand
              <input
                className="input"
                autoFocus
                maxLength={60}
                value={asking.board}
                onChange={(e) => setAsking({ block, board: e.target.value })}
              />
            </label>
            {taken.some((b) => b.trim().toLowerCase() === asking.board.trim().toLowerCase()) && (
              <span className="small faint">Diese Wand gibt es schon – die neuen Folien arbeiten dann mit denselben Karten.</span>
            )}
            <div className="row">
              <button className="btn btn-primary btn-small" type="submit" disabled={disabled || !asking.board.trim()}>
                Einfügen
              </button>
              <button className="btn btn-small" type="button" onClick={() => setAsking(null)}>
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <button key={block.id} className="type-option" onClick={() => pickBuiltin(block)} disabled={disabled}>
            <span className="slide-type-icon">
              <Blocks size={18} />
            </span>
            <span>
              <strong>{block.name}</strong>
              <span className="small faint" style={{ display: 'block' }}>
                {block.description} · {countLabel(blockSlides(block).length)}
              </span>
            </span>
          </button>
        ),
      )}
      {custom.data && custom.data.length > 0 && <span className="label type-picker-label">Eigene Bausteine</span>}
      {custom.data?.map((block) => (
        <div key={block.id} className="block-custom">
          <button className="type-option grow" onClick={() => pickCustom(block)} disabled={disabled}>
            <span className="slide-type-icon">
              <Blocks size={18} />
            </span>
            <span>
              <strong>{block.name}</strong>
              <span className="small faint" style={{ display: 'block' }}>
                {[...new Set(block.slides.map((s) => SLIDE_TYPE_LABELS[s.type]))].join(', ')} · {countLabel(block.slides.length)}
              </span>
            </span>
          </button>
          <button
            className="icon-btn"
            aria-label={`Baustein „${block.name}“ löschen`}
            title="Baustein löschen"
            onClick={() => {
              if (window.confirm(`Eigenen Baustein „${block.name}“ löschen?`)) remove.mutate(block.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      ))}
      <p className="small faint type-picker-label">Eigene Bausteine speicherst du per Rechtsklick auf eine Folie.</p>
    </div>
  );
}

/** Baustein-Folien für die Batch-Route: fehlende Angaben im Ablaufplan auffüllen */
function toBatch(slides: ReturnType<typeof blockSlides>): BatchSlide[] {
  return slides.map(({ schedule, ...s }) => ({
    ...s,
    notes: s.notes ?? '',
    ...(schedule
      ? {
          schedule: {
            plannedMinutes: schedule.plannedMinutes ?? null,
            phases: schedule.phases ?? [],
            autoCountdown: !!schedule.autoCountdown,
          },
        }
      : {}),
  }));
}

const countLabel = (n: number) => `${n} ${n === 1 ? 'Folie' : 'Folien'}`;

/** Folien ab der gewählten als eigenen Baustein speichern (ohne importierte Bild-Folien). */
export function SaveBlockDialog({
  slides,
  notes,
  schedule = {},
  startId,
  onClose,
}: {
  slides: Slide[];
  notes: Record<string, string>;
  /** Ablaufplan je Folie – wird mitgespeichert */
  schedule?: Record<string, SlideSchedule>;
  startId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const startIndex = Math.max(
    0,
    slides.findIndex((s) => s.id === startId),
  );
  const [from, setFrom] = useState(startIndex + 1);
  const [to, setTo] = useState(startIndex + 1);
  const [name, setName] = useState('');
  const range = slides.slice(Math.min(from, to) - 1, Math.max(from, to));
  const usable = range.filter((s) => s.type !== 'image');
  const skipped = range.length - usable.length;

  const save = useMutation({
    mutationFn: () =>
      api('/api/blocks', {
        body: {
          name,
          slides: usable.map((s): BatchSlide => {
            const plan = schedule[s.id];
            return {
              type: s.type,
              config: s.config,
              notes: notes[s.id] ?? '',
              ...(plan && !isEmptySchedule(plan) ? { schedule: plan } : {}),
            };
          }),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['blocks'] });
      toast(`Baustein „${name.trim()}“ gespeichert`);
      onClose();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && usable.length > 0 && usable.length <= MAX_BATCH_SLIDES) save.mutate();
  };
  const clamp = (v: number) => Math.max(1, Math.min(slides.length, Math.round(v) || 1));

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="save-block-title" onClick={onClose}>
      <form className="dialog card card-pad stack" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="row-between">
          <h2 id="save-block-title">Als Baustein speichern</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Schließen">
            <X />
          </button>
        </div>
        <label className="field">
          Name
          <input
            className="input"
            autoFocus
            maxLength={100}
            value={name}
            placeholder="z. B. Retro mit Maßnahmen"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="row" style={{ gap: 8 }}>
          <label className="row small" style={{ gap: 6 }}>
            Folie
            <input
              className="input minutes-input"
              type="number"
              min={1}
              max={slides.length}
              value={from}
              onChange={(e) => setFrom(clamp(Number(e.target.value)))}
            />
          </label>
          <label className="row small" style={{ gap: 6 }}>
            bis
            <input
              className="input minutes-input"
              type="number"
              min={1}
              max={slides.length}
              value={to}
              onChange={(e) => setTo(clamp(Number(e.target.value)))}
            />
          </label>
        </div>
        <p className="small muted">
          {countLabel(usable.length)} mit Einstellungen, Sprechernotizen und Ablaufplan
          {skipped > 0 && ` – ${skipped} importierte ${skipped === 1 ? 'Folie wird' : 'Folien werden'} übersprungen`}
          {usable.length > MAX_BATCH_SLIDES && ` – höchstens ${MAX_BATCH_SLIDES} Folien`}. Antworten und Ergebnisse werden nicht
          gespeichert.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={save.isPending || !name.trim() || usable.length === 0 || usable.length > MAX_BATCH_SLIDES}
          >
            Speichern
          </button>
        </div>
      </form>
    </div>
  );
}
