import type { BuildRegion, BuildsConfig } from '@slides/shared';
import { useRef, type CSSProperties } from 'react';
import './build.css';

/**
 * Aufbau-Animationen über einem Folienbild (Endzustand).
 *
 * - Elemente späterer Schritte: Abdeckung in der gemessenen Umgebungsfarbe
 * - Elemente des aktuellen Schritts: Abdeckung blendet zur richtigen Zeit aus
 *   (Verblassen) bzw. ein Bildausschnitt fliegt herein
 * - Elemente früherer Schritte: nichts – das Bild zeigt sie bereits
 *
 * Reihenfolge der Abdeckungen: früher aufgedeckte Elemente liegen OBEN. Liegt ein
 * Text (Schritt 2) auf einer Fläche (Schritt 1), deckt vor Schritt 1 die
 * Flächen-Abdeckung (Hintergrundfarbe) alles zu; danach bleibt die Text-Abdeckung
 * in der Farbe der Fläche sichtbar – genau wie in PowerPoint.
 */
export function BuildLayer({
  builds,
  step,
  image,
  animate,
  slideId,
}: {
  builds: BuildsConfig | undefined;
  step: number;
  image: string;
  /** false: Endzustand des Schritts sofort zeigen (Handy, Vorschau, verdeckter Tab) */
  animate: boolean;
  slideId: number;
}) {
  // Nur vorwärts animieren: Wer zurückblättert, sieht den Zustand sofort –
  // wie in PowerPoint. Die Entscheidung gilt pro (Folie, Schritt), damit
  // spätere Aktualisierungen eine laufende Animation nicht abbrechen.
  const seen = useRef<{ key: string; forward: boolean; slideId: number; step: number } | null>(null);
  const key = `${slideId}:${step}`;
  if (seen.current?.key !== key) {
    const prev = seen.current;
    const forward = prev === null || prev.slideId !== slideId ? step === 0 : step > prev.step;
    seen.current = { key, forward, slideId, step };
  }
  const play = animate && seen.current.forward;

  if (!builds?.enabled || builds.regions.length === 0) return null;
  const ordered = builds.regions.map((r, i) => ({ r, i })).sort((a, b) => a.r.step - b.r.step || a.r.at - b.r.at || a.i - b.i);
  const total = ordered.length;

  return (
    <div className="build-layer" aria-hidden>
      {ordered.map(({ r, i }, order) => {
        if (r.step < step) return null;
        if (r.step === step && !play) return null;
        const z = total - order; // früher aufgedeckt → weiter oben
        const box: CSSProperties = { left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h), zIndex: z };
        if (r.step > step) return <div key={`${slideId}-${i}-hidden`} className="build-mask" style={{ ...box, background: r.fill }} />;
        // aktueller Schritt: Aufdecken animieren (Schlüssel enthält den Schritt → läuft genau einmal)
        const timing = { '--at': `${r.at}ms`, '--dur': `${Math.max(r.dur, 1)}ms` } as CSSProperties;
        if (r.effect.startsWith('fly') || r.effect === 'zoom') {
          return (
            <div key={`${slideId}-${step}-${i}`} style={{ display: 'contents' }}>
              {/* Abdeckung erst entfernen, wenn der Ausschnitt gelandet ist – sonst wäre das
                  Element während des Flugs doppelt zu sehen */}
              <div
                className="build-mask build-cut"
                style={{ ...box, ...timing, '--at': `${r.at + r.dur}ms`, background: r.fill } as CSSProperties}
              />
              {/* Der Ausschnitt stammt aus dem Endzustand und enthielte auch Elemente, die
                  erst später erscheinen (z. B. Text in einem hereinfliegenden Kasten). Deren
                  Abdeckungen fliegen deshalb im Ausschnitt mit. Nach der Landung verschwindet
                  er; dann übernehmen die regulären Abdeckungen darunter. */}
              <div
                className={`build-crop build-${r.effect}`}
                style={{ ...box, ...timing, ...cropStyle(r, image), zIndex: total + 1 }}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) e.currentTarget.style.visibility = 'hidden';
                }}
              >
                {ordered.map(({ r: o, i: j }, innerOrder) =>
                  j !== i && revealedAfter(o, r) && intersects(o, r) ? (
                    <div
                      key={j}
                      className="build-mask"
                      style={{
                        left: pct((o.x - r.x) / r.w),
                        top: pct((o.y - r.y) / r.h),
                        width: pct(o.w / r.w),
                        height: pct(o.h / r.h),
                        zIndex: total - innerOrder,
                        background: o.fill,
                      }}
                    />
                  ) : null,
                )}
              </div>
            </div>
          );
        }
        return (
          <div
            key={`${slideId}-${step}-${i}`}
            className={`build-mask ${r.effect === 'appear' ? 'build-cut' : 'build-fade'}`}
            style={{ ...box, ...timing, background: r.fill }}
          />
        );
      })}
    </div>
  );
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

/** Erscheint `o` erst nach dem Start von `r`? */
const revealedAfter = (o: BuildRegion, r: BuildRegion) => o.step > r.step || (o.step === r.step && o.at > r.at);

const intersects = (a: BuildRegion, b: BuildRegion) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Bildausschnitt des Elements und Startposition außerhalb der Folie. */
function cropStyle(r: BuildRegion, image: string): CSSProperties {
  const size = `${100 / r.w}% ${100 / r.h}%`;
  const position = `${r.w >= 1 ? 0 : (r.x / (1 - r.w)) * 100}% ${r.h >= 1 ? 0 : (r.y / (1 - r.h)) * 100}%`;
  const from =
    r.effect === 'fly-left'
      ? `translateX(${(-(r.x + r.w) / r.w) * 100}%)`
      : r.effect === 'fly-right'
        ? `translateX(${((1 - r.x) / r.w) * 100}%)`
        : r.effect === 'fly-top'
          ? `translateY(${(-(r.y + r.h) / r.h) * 100}%)`
          : r.effect === 'fly-bottom'
            ? `translateY(${((1 - r.y) / r.h) * 100}%)`
            : 'scale(0.3)';
  return { backgroundImage: `url(${image})`, backgroundSize: size, backgroundPosition: position, '--from': from } as CSSProperties;
}
