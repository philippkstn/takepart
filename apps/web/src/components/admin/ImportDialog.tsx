import { FileText, Presentation as PptIcon, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { planNotes, type BuildsConfig, type NotesPlan, type PptxSlideInfo, type RawBuildRegion } from '@slides/shared';
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
  const [withBuilds, setWithBuilds] = useState(true);
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
      const items: { asset: string; width: number; height: number; title: string; notes: string; builds?: BuildsConfig }[] = [];
      let animated = 0;
      let skippedRegions = 0;
      // Aufbau-Bereiche einer Seite – nur bei sicherer Zuordnung zur PPTX-Folie
      const raw = (i: number): RawBuildRegion[] => {
        const slide = withBuilds ? (plan as NotesPlan | null)?.pages[i]?.slide : null;
        return slide?.regions?.length ? slide.regions : [];
      };
      setPhase({ step: 'pages', done: 0, total: 0 });
      const select = (total: number) => {
        plan = planNotes(slides, total, includeHidden);
        const p = plan;
        return (i: number) => p.pages[i]?.include ?? true;
      };
      for await (const page of renderPdfPages(pdf, select, raw)) {
        const wanted = plan!.pages.filter((p) => p.include).length;
        setPhase({ step: 'pages', done: items.length, total: wanted });
        const { asset } = await uploadImage(
          `/api/presentations/${presentationId}/assets?width=${page.width}&height=${page.height}`,
          page.full,
        );
        await uploadImage(`/api/assets/${asset}/thumb`, page.thumb, 'PUT');
        const regions = raw(page.index);
        const slideInfo = plan!.pages[page.index]?.slide;
        // Seitenverhältnis von PDF und PPTX muss passen, sonst säßen die Abdeckungen daneben
        const fits = slideInfo?.aspect ? Math.abs(page.width / page.height - slideInfo.aspect) < 0.01 : false;
        // Elemente auf Foto oder Verlauf ließen sich nicht sauber abdecken – die sind von Anfang an sichtbar
        const covered = regions.flatMap((r, k) => {
          const fill = page.fills[k];
          return fill ? [{ ...r, fill }] : [];
        });
        skippedRegions += regions.length - covered.length;
        // Klicks ohne verbliebene Elemente entfallen, sonst gäbe es „leere“ Klicks
        const clicks = [...new Set(covered.map((r) => r.step).filter((x) => x > 0))].sort((a, b) => a - b);
        const renumbered = covered.map((r) => ({ ...r, step: r.step === 0 ? 0 : clicks.indexOf(r.step) + 1 }));
        const builds: BuildsConfig | undefined =
          renumbered.length > 0 && fits ? { enabled: true, steps: clicks.length, regions: renumbered } : undefined;
        if (builds) animated++;
        items.push({
          asset,
          width: page.width,
          height: page.height,
          title: page.title,
          notes: plan!.pages[page.index]?.notes ?? '',
          builds,
        });
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
      if (animated > 0) note = [note, `${animated} Folien mit Animationen übernommen.`].filter(Boolean).join(' ');
      if (skippedRegions > 0) {
        note = [note, `${skippedRegions} Elemente auf Bild- oder Verlaufshintergrund sind ohne Animation sofort sichtbar.`].join(' ');
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
          Seite wird eine Folie, zwischen die du interaktive Elemente setzen kannst. Lädst du zusätzlich die .pptx hoch, kommen
          Sprechernotizen und Aufbau-Animationen (Elemente, die nach und nach erscheinen) mit. Videos, Ausgangs- und Bewegungseffekte werden
          nicht übernommen.
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
              Für Notizen und Animationen – dieselbe Präsentation als .pptx
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
        {pptx && (
          <label className="switch small">
            <input type="checkbox" checked={withBuilds} disabled={busy} onChange={(e) => setWithBuilds(e.target.checked)} />
            <span>
              Animationen übernehmen
              <span className="faint" style={{ display: 'block' }}>
                Elemente erscheinen wie in PowerPoint nach und nach – pro Folie im Editor abschaltbar
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
