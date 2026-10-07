import { FileText, Presentation as PptIcon, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { extractPptxNotes, renderPdfPages } from '../../lib/importDeck.ts';

interface Props {
  presentationId: number;
  afterId: number | null;
  onClose: () => void;
  onDone: (count: number) => void;
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
  const [warning, setWarning] = useState<string | null>(null);
  const busy = phase.step !== 'idle';

  const start = async () => {
    if (!pdf) return;
    if (pdf.size > MAX_PDF_BYTES) return setError('Die PDF ist zu groß (höchstens 150 MB).');
    setError(null);
    setWarning(null);
    try {
      let notes: string[] = [];
      if (pptx) {
        setPhase({ step: 'notes' });
        notes = await extractPptxNotes(pptx);
      }
      const items: { asset: string; width: number; height: number; title: string; notes: string }[] = [];
      setPhase({ step: 'pages', done: 0, total: 0 });
      for await (const page of renderPdfPages(pdf)) {
        setPhase({ step: 'pages', done: page.index, total: page.total });
        const { asset } = await uploadImage(
          `/api/presentations/${presentationId}/assets?width=${page.width}&height=${page.height}`,
          page.full,
        );
        await uploadImage(`/api/assets/${asset}/thumb`, page.thumb, 'PUT');
        items.push({ asset, width: page.width, height: page.height, title: page.title, notes: notes[page.index] ?? '' });
        setPhase({ step: 'pages', done: page.index + 1, total: page.total });
      }
      if (pptx && notes.length !== items.length) {
        setWarning(
          `Die PowerPoint hat ${notes.length} sichtbare Folien, das PDF ${items.length} Seiten. Die Notizen wurden der Reihe nach zugeordnet – bitte kurz prüfen.`,
        );
      }
      setPhase({ step: 'saving' });
      await api(`/api/presentations/${presentationId}/slides/import`, { body: { afterId, items } });
      setPhase({ step: 'idle' });
      onDone(items.length);
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
        {warning && (
          <p className="small" style={{ color: 'var(--warn)' }}>
            {warning}
          </p>
        )}

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
