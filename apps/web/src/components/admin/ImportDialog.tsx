import { FileText, Presentation as PptIcon, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { planNotes, type NotesPlan, type PptxSlideInfo } from '@slides/shared';
import { extractPptxNotes, renderPdfPages } from '../../lib/importDeck.ts';

interface Props {
  presentationId: number;
  afterId: number | null;
  onClose: () => void;
  /** `note`: Hinweis zur Zuordnung der Notizen (übersprungene/abweichende Folien) */
  onDone: (count: number, note: string | null) => void;
}

type Phase = { step: 'idle' } | { step: 'notes' } | { step: 'pages'; done: number; total: number } | { step: 'saving' };

const MAX_PDF_BYTES = 150 * 1024 * 1024;

async function uploadImage(path: string, blob: Blob, method = 'POST') {
  const res = await fetch(path, { method, headers: { 'Content-Type': blob.type }, body: blob, credentials: 'same-origin' });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Upload fehlgeschlagen (${res.status})`);
  }
  return res.json() as Promise<{ asset: string }>;
}

/**
 * Folien importieren: PDF (Pflicht) plus optional die PPTX für Sprechernotizen.
 * Gerendert wird im Browser, Seite für Seite hochgeladen.
 */
export function ImportDialog({ presentationId, afterId, onClose, onDone }: Props) {
  const [pdf, setPdf] = useState<File | null>(null);
  const [pptx, setPptx] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);
  const busy = phase.step !== 'idle';

  const start = async () => {
    if (!pdf) return;
    if (pdf.size > MAX_PDF_BYTES) return setError('Die PDF ist zu groß (höchstens 150 MB).');
    setError(null);
    try {
      let slides: PptxSlideInfo[] | null = null;
      if (pptx) {
        setPhase({ step: 'notes' });
        slides = await extractPptxNotes(pptx);
      }
      let plan: NotesPlan | null = null;
      const items: { asset: string; width: number; height: number; title: string; notes: string }[] = [];
      setPhase({ step: 'pages', done: 0, total: 0 });
      const select = (total: number) => {
        plan = planNotes(slides, total, includeHidden);
        const p = plan;
        return (i: number) => p.pages[i]?.include ?? true;
      };
      for await (const page of renderPdfPages(pdf, select)) {
        const wanted = plan!.pages.filter((p) => p.include).length;
        setPhase({ step: 'pages', done: items.length, total: wanted });
        const { asset } = await uploadImage(
          `/api/presentations/${presentationId}/assets?width=${page.width}&height=${page.height}`,
          page.full,
        );
        await uploadImage(`/api/assets/${asset}/thumb`, page.thumb, 'PUT');
        items.push({ asset, width: page.width, height: page.height, title: page.title, notes: plan!.pages[page.index]?.notes ?? '' });
        setPhase({ step: 'pages', done: items.length, total: wanted });
      }
      const done = plan as NotesPlan | null;
      let note: string | null = null;
      if (done && slides) {
        const visible = slides.filter((x) => !x.hidden).length;
        if (done.mode === 'mismatch') {
          note = `Die PowerPoint hat ${slides.length} Folien (${visible} sichtbar), das PDF ${done.pages.length} Seiten. Die Notizen wurden der Reihe nach zugeordnet – bitte kurz prüfen.`;
        } else if (done.skippedHidden > 0) {
          note = `${done.skippedHidden} ausgeblendete Folien wurden übersprungen.`;
        }
      }
      setPhase({ step: 'saving' });
      await api(`/api/presentations/${presentationId}/slides/import`, { body: { afterId, items } });
      setPhase({ step: 'idle' });
      onDone(items.length, note);
    } catch (err) {
      setPhase({ step: 'idle' });
      setError(errorMessage(err));
    }
  };

  const progress = phase.step === 'pages' && phase.total > 0 ? phase.done / phase.total : null;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="dialog card card-pad stack">
        <div className="row-between">
          <h2 id="import-title">Folien importieren</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Schließen">
            <X />
          </button>
        </div>
        <p className="muted small">
          Exportiere deine Präsentation in PowerPoint, Keynote oder Google Slides als <strong>PDF</strong> und lade sie hier hoch. Jede
          Seite wird eine Folie, zwischen die du interaktive Elemente setzen kannst. Animationen und Videos werden dabei nicht übernommen.
        </p>

        <label className={`file-drop ${pdf ? 'has-file' : ''}`}>
          <FileText />
          <span className="grow">
            <strong>{pdf ? pdf.name : 'PDF auswählen'}</strong>
            <span className="small faint" style={{ display: 'block' }}>
              {pdf ? `${(pdf.size / 1024 / 1024).toFixed(1)} MB` : 'Pflicht – die Folien selbst'}
            </span>
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
          />
        </label>

        <label className={`file-drop ${pptx ? 'has-file' : ''}`}>
          <PptIcon />
          <span className="grow">
            <strong>{pptx ? pptx.name : 'PowerPoint (optional)'}</strong>
            <span className="small faint" style={{ display: 'block' }}>
              Nur für die Sprechernotizen – dieselbe Präsentation als .pptx
            </span>
          </span>
          <input
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => setPptx(e.target.files?.[0] ?? null)}
          />
        </label>

        {pptx && (
          <label className="switch small">
            <input type="checkbox" checked={includeHidden} disabled={busy} onChange={(e) => setIncludeHidden(e.target.checked)} />
            <span>
              Ausgeblendete Folien mit importieren
              <span className="faint" style={{ display: 'block' }}>
                Nur relevant, wenn das PDF sie enthält (z. B. Export aus Google Slides)
              </span>
            </span>
          </label>
        )}

        {phase.step !== 'idle' && (
          <div className="stack-s" aria-live="polite">
            <span className="small muted">
              {phase.step === 'notes' && 'Lese Sprechernotizen …'}
              {phase.step === 'pages' &&
                (phase.total ? `Folie ${Math.min(phase.done + 1, phase.total)} von ${phase.total} …` : 'Öffne PDF …')}
              {phase.step === 'saving' && 'Speichere Folien …'}
            </span>
            <div className="progress">
              <div style={{ width: `${(progress ?? (phase.step === 'saving' ? 1 : 0.05)) * 100}%` }} />
            </div>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}

        <div className="row">
          <button className="btn btn-primary" onClick={start} disabled={!pdf || busy}>
            <Upload /> Importieren
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
