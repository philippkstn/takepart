import { slideHeadline, type HostView } from '@slides/shared';
import { Eye, EyeOff, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Stage } from '../../components/Stage.tsx';
import { staticPreview } from '../../components/staticPreview.ts';
import { isBoolean, isNumber, usePref } from '../../lib/prefs.ts';

/** Schriftgrößen der Notizen in rem */
const NOTE_SIZES = [0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.4];
export const PANEL_MIN = 300;
export const PANEL_MAX = 900;
/** Mehr als diesen Anteil der Höhe darf die Vorschau nicht belegen, sonst bleibt für Notizen zu wenig */
const PREVIEW_SHARE = 0.45;

/**
 * Rechte Seitenleiste der Referentenansicht: nächste Folie, Notizen und die
 * Steuerung der aktuellen Folie. Breite (Ziehgriff `PanelResizer`) und
 * Schriftgröße der Notizen merkt sich der Browser. Wird die Vorschau so groß, dass für die
 * Notizen kaum Platz bleibt, schrumpft sie auf eine Zeile.
 */
export function PresenterSidebar({
  view,
  build,
  builds,
  children,
}: {
  view: HostView;
  build: number;
  builds: number;
  children: ReactNode;
}) {
  const [sizeIndex, setSizeIndex] = usePref('notes-size', 1, (v): v is number => isNumber(v) && v >= 0 && v < NOTE_SIZES.length);
  const [showPreview, setShowPreview] = usePref('next-preview', true, isBoolean);
  const fit = usePreviewFits();
  const slide = view.slide;
  const nextBuild = slide && build < builds;
  const hasNext = nextBuild || !!view.nextSlide;
  const previewVisible = hasNext && showPreview && fit.fits;

  const nextLabel = nextBuild
    ? `Animation ${build + 1} dieser Folie`
    : view.nextSlide
      ? slideHeadline(view.nextSlide) || `Folie ${view.slideIndex + 2}`
      : '';

  return (
    <aside ref={fit.ref} className="control-panel card" style={{ '--notes-size': `${NOTE_SIZES[sizeIndex]}rem` } as CSSProperties}>
      {hasNext && (
        <div className={`next-slide${previewVisible ? '' : ' is-compact'}`}>
          <div className="row-between">
            <span className="label">{previewVisible && nextBuild ? `Als Nächstes · Animation ${build + 1}` : 'Als Nächstes'}</span>
            <button
              className="icon-btn"
              onClick={() => setShowPreview(!showPreview)}
              aria-pressed={showPreview}
              title={showPreview ? 'Vorschau ausblenden' : 'Vorschau einblenden'}
              aria-label={showPreview ? 'Vorschau der nächsten Folie ausblenden' : 'Vorschau der nächsten Folie einblenden'}
            >
              {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {previewVisible ? (
            <div className="preview-frame">
              <Stage
                view={
                  nextBuild
                    ? staticPreview(slide, {
                        title: view.run.title,
                        brand: view.run.brand,
                        index: view.slideIndex,
                        count: view.slideCount,
                        code: view.run.code,
                        buildStep: build + 1,
                      })
                    : staticPreview(view.nextSlide!, {
                        title: view.run.title,
                        brand: view.run.brand,
                        index: view.slideIndex + 1,
                        count: view.slideCount,
                        code: view.run.code,
                        buildStep: 0,
                      })
                }
              />
            </div>
          ) : (
            <p className="next-slide-line">
              {nextLabel}
              {showPreview && !fit.fits && <span className="faint"> · Vorschau ausgeblendet, zu wenig Platz</span>}
            </p>
          )}
        </div>
      )}
      <div className="notes-box">
        <div className="row-between">
          <span className="label">Notizen</span>
          <span className="notes-zoom" role="group" aria-label="Schriftgröße der Notizen">
            <button
              className="icon-btn"
              onClick={() => setSizeIndex(Math.max(0, sizeIndex - 1))}
              disabled={sizeIndex === 0}
              aria-label="Notizen kleiner"
              title="Kleiner"
            >
              <Minus size={16} />
            </button>
            <span className="small faint tabular">{Math.round(NOTE_SIZES[sizeIndex]! * 100)} %</span>
            <button
              className="icon-btn"
              onClick={() => setSizeIndex(Math.min(NOTE_SIZES.length - 1, sizeIndex + 1))}
              disabled={sizeIndex === NOTE_SIZES.length - 1}
              aria-label="Notizen größer"
              title="Größer"
            >
              <Plus size={16} />
            </button>
          </span>
        </div>
        {view.notes ? <p className="notes-text">{view.notes}</p> : <p className="small faint">Keine Notizen zu dieser Folie.</p>}
      </div>
      {children}
    </aside>
  );
}

/** Ziehgriff am linken Rand – auch per Tastatur (Pfeiltasten) bedienbar. */
export function PanelResizer({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  // Die Bühne in der Mitte soll mindestens 420 px behalten
  const clamp = (w: number) => Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, window.innerWidth - 250 - 420 - 72, w)));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // Griff sitzt links: nach links ziehen macht die Leiste breiter
    onWidth(clamp(drag.current.w + drag.current.x - e.clientX));
  };
  const up = () => {
    drag.current = null;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') onWidth(clamp(width + step));
    else if (e.key === 'ArrowRight') onWidth(clamp(width - step));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite der Seitenleiste"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Ziehen, um die Breite zu ändern"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={() => onWidth(380)}
    />
  );
}

/**
 * Passt die Vorschau (16:9 der Leistenbreite) noch neben die Notizen? Nur im
 * dreispaltigen Layout – darunter steht die Leiste ohnehin unter der Bühne.
 */
function usePreviewFits() {
  const ref = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wide = window.matchMedia('(min-width: 1201px)');
    const update = () => {
      if (!wide.matches) return setFits(true);
      const previewHeight = ((el.clientWidth - 36) * 9) / 16 + 30;
      setFits(previewHeight <= PREVIEW_SHARE * (window.innerHeight - 110));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    wide.addEventListener('change', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      wide.removeEventListener('change', update);
    };
  }, []);
  return { ref, fits };
}
