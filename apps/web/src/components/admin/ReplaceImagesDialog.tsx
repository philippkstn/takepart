import { alignPages, planNotes, type PptxSlideInfo } from '@slides/shared';
import { FileText, Presentation as PptIcon, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { extractPptxNotes, pdfPageTitles, renderPdfPages } from '../../lib/importDeck.ts';
import { uploadPage } from '../../lib/uploadPage.ts';

interface Props {
  presentationId: number;
  /** Bildfolien in Folienreihenfolge (Titel = Überschrift beim Import) */
  imageSlides: { id: number; title: string }[];
  onClose: () => void;
  onDone: (count: number) => void;
}

type Phase = { step: 'idle' } | { step: 'pages'; done: number; total: number } | { step: 'saving' };

/**
 * Folienbilder aktualisieren: dieselbe Präsentation erneut als PDF hochladen.
 * Jede Seite ersetzt der Reihe nach das Bild einer vorhandenen Bildfolie – Folien,
 * Animationen, Notizen und Ergebnisse bleiben. Dabei entstehen auch Druckbild und
 * Textebene (ältere Importe haben beides nicht).
 */
export function ReplaceImagesDialog({ presentationId, imageSlides, onClose, onDone }: Props) {
  const [pdf, setPdf] = useState<File | null>(null);
  const [pptx, setPptx] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const busy = phase.step !== 'idle';

  const start = async () => {
    if (!pdf) return;
    setError(null);
    try {
      // Mit PPTX: ausgeblendete Folien überspringen, falls das PDF sie enthält
      const info: PptxSlideInfo[] | null = pptx ? await extractPptxNotes(pptx) : null;
      setPhase({ step: 'pages', done: 0, total: imageSlides.length });
      const titles = await pdfPageTitles(pdf);
      const plan = planNotes(info, titles.length, false);
      const pages = titles.map((_, i) => i).filter((i) => plan.pages[i]?.include ?? true);
      const match = alignPages(
        imageSlides.map((s) => s.title),
        pages.map((i) => titles[i]!),
      );
      if (!match) {
        throw new Error(
          `Das PDF hat ${pages.length} Seiten, die Präsentation ${imageSlides.length} Bildfolien, und nicht jede Folie hat eine Seite mit ` +
            'derselben Überschrift. Bitte denselben Foliensatz exportieren – sonst ließen sich die Bilder nicht sicher zuordnen.',
        );
      }
      // PDF-Seite → Bildfolie
      const slideOf = new Map(match.map((p, k) => [pages[p]!, imageSlides[k]!.id]));
      const items: { slideId: number; asset: string; width: number; height: number; title: string }[] = [];
      for await (const page of renderPdfPages(pdf, () => (i) => slideOf.has(i))) {
        const asset = await uploadPage(presentationId, page);
        items.push({ slideId: slideOf.get(page.index)!, asset, width: page.width, height: page.height, title: page.title });
        setPhase({ step: 'pages', done: items.length, total: imageSlides.length });
      }
      setPhase({ step: 'saving' });
      await api(`/api/presentations/${presentationId}/slides/replace-images`, { body: { items } });
      setPhase({ step: 'idle' });
      onDone(items.length);
    } catch (err) {
      setPhase({ step: 'idle' });
      setError(errorMessage(err));
    }
  };

  const progress = phase.step === 'pages' && phase.total > 0 ? phase.done / phase.total : null;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="replace-title">
      <div className="dialog card card-pad stack">
        <div className="row-between">
          <h2 id="replace-title">Folienbilder aktualisieren</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Schließen">
            <X />
          </button>
        </div>
        <p className="muted small">
          Lade dieselbe Präsentation erneut als PDF hoch. Die {imageSlides.length} importierten Folien bekommen der Reihe nach das neue
          Bild – in hoher Auflösung und mit kopierbarem Text fürs Fotoprotokoll. Folien, Animationen, Notizen und alle Ergebnisse bleiben
          erhalten. Enthält das PDF zusätzliche Seiten, wird über die Überschriften zugeordnet.
        </p>

        <label className={`file-drop ${pdf ? 'has-file' : ''}`}>
          <FileText />
          <span className="grow">
            <strong>{pdf ? pdf.name : 'PDF auswählen'}</strong>
            <span className="small faint" style={{ display: 'block' }}>
              {pdf ? `${(pdf.size / 1024 / 1024).toFixed(1)} MB` : 'Pflicht'}
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
              Nur nötig, wenn das PDF ausgeblendete Folien enthält (z. B. Export aus Google Slides)
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
              {phase.step === 'pages' && `Folie ${Math.min(phase.done + 1, phase.total)} von ${phase.total} …`}
              {phase.step === 'saving' && 'Speichere …'}
            </span>
            <div className="progress">
              <div style={{ width: `${(progress ?? (phase.step === 'saving' ? 1 : 0.05)) * 100}%` }} />
            </div>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}

        <div className="row">
          <button className="btn btn-primary" onClick={start} disabled={!pdf || busy}>
            <RefreshCw /> Bilder aktualisieren
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
