import { plannedTotal, slideHeadline, SLIDE_TYPE_LABELS, type Slide } from '@slides/shared';
import { Blocks, Copy, Heading, Trash2, X } from 'lucide-react';
import { SlideIcon } from '../slideIcons.tsx';

/** Statt des Formulars bei Mehrfachauswahl: Übersicht und gemeinsame Aktionen */
export function SelectionPanel({
  slides,
  numberOf,
  plannedOf,
  canEdit,
  modKey,
  onDuplicate,
  onRemove,
  onSaveBlock,
  onStartSection,
  onClear,
}: {
  /** Ausgewählte Folien in Listenreihenfolge */
  slides: Slide[];
  numberOf: (slideId: number) => number;
  plannedOf: (slideId: number) => number | null;
  canEdit: boolean;
  /** Anzeige der Befehlstaste (⌘ oder Strg) */
  modKey: string;
  onDuplicate: () => void;
  onRemove: () => void;
  onSaveBlock: () => void;
  /** Abschnitt an der ersten ausgewählten Folie beginnen – `null`, wenn dort schon einer beginnt */
  onStartSection: (() => void) | null;
  onClear: () => void;
}) {
  const minutes = plannedTotal(slides.map((s) => plannedOf(s.id)));
  return (
    <section className="card card-pad stack selection-panel" aria-live="polite">
      <div className="row-between">
        <h2>{slides.length} Folien ausgewählt</h2>
        <button className="btn btn-small btn-ghost" onClick={onClear} title="Escape">
          <X /> Auswahl aufheben
        </button>
      </div>
      {minutes > 0 && <p className="small muted tabular">geplant: {minutes} Min.</p>}
      <ol className="selection-list">
        {slides.map((s) => (
          <li key={s.id}>
            <span className="slide-num tabular">{numberOf(s.id)}</span>
            <SlideIcon type={s.type} size={16} />
            <span className="grow selection-title">{slideHeadline(s) || <em className="faint">{SLIDE_TYPE_LABELS[s.type]}</em>}</span>
          </li>
        ))}
      </ol>
      {canEdit && (
        <>
          <div className="selection-actions">
            <button className="btn" onClick={onDuplicate}>
              <Copy /> Duplizieren <kbd className="menu-hint">{modKey}+D</kbd>
            </button>
            <button className="btn" onClick={onSaveBlock}>
              <Blocks /> Als Baustein speichern …
            </button>
            {onStartSection && (
              <button className="btn" onClick={onStartSection}>
                <Heading /> Abschnitt hier beginnen
              </button>
            )}
            <button className="btn btn-danger" onClick={onRemove}>
              <Trash2 /> Löschen <kbd className="menu-hint">Entf</kbd>
            </button>
          </div>
          <p className="small faint">Ziehen oder Alt + ↑/↓ verschiebt alle ausgewählten Folien zusammen, in ihrer Reihenfolge.</p>
        </>
      )}
    </section>
  );
}
