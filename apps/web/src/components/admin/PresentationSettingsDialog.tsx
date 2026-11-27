import type { BrandView } from '@slides/shared';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEscape } from '../../lib/useEscape.ts';

export interface PresentationSettings {
  brandId: number | null;
  brand: BrandView | null;
  shareSlides: boolean;
  targetMinutes: number | null;
}

/** Dauer-Feld (Text) → Minuten; leer = keine Angabe, ungültig = `undefined` (nicht speichern) */
function parseMinutes(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 600 ? n : undefined;
}

interface MinutesDraft {
  minutes: string;
  canEdit: boolean;
  onChange: (body: { targetMinutes: number | null }) => void;
}

/** Speichert die Dauer, wenn sie gültig ist und sich gegenüber dem zuletzt Gesendeten geändert hat */
function flushMinutes(draft: MinutesDraft, sent: { current: number | null }) {
  const v = parseMinutes(draft.minutes);
  if (!draft.canEdit || v === undefined || v === sent.current) return;
  sent.current = v;
  draft.onChange({ targetMinutes: v });
}

/**
 * Einstellungen der ganzen Präsentation (Branding, Folien auf Handys, Dauer).
 * Branding wählt nur der Eigentümer (es bestimmt, aus welchem Konto die Marke
 * kommt), den Rest alle mit Bearbeitungsrecht; sonst nur ansehen.
 */
export function PresentationSettingsDialog({
  settings,
  isOwner,
  canEdit,
  brands,
  plannedSum,
  onBrand,
  onChange,
  onClose,
}: {
  settings: PresentationSettings;
  isOwner: boolean;
  canEdit: boolean;
  /** Eigene Brandings (nur für den Eigentümer geladen) */
  brands: (BrandView & { id: number })[] | undefined;
  /** Summe der geplanten Minuten aller Folien */
  plannedSum: number;
  onBrand: (brandId: number | null) => void;
  onChange: (body: { shareSlides?: boolean; targetMinutes?: number | null }) => void;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState(settings.targetMinutes?.toString() ?? '');
  // Dauer beim Verlassen des Feldes speichern – und beim Schließen (Escape löst kein blur aus)
  const latest = useRef<MinutesDraft>({ minutes, canEdit, onChange });
  latest.current = { minutes, canEdit, onChange };
  /** Zuletzt gesendeter Stand – nicht vom Rendern überschrieben, damit Verlassen + Schließen nur einmal speichert */
  const sent = useRef(settings.targetMinutes);
  const saveMinutes = () => flushMinutes(latest.current, sent);
  useEffect(() => () => flushMinutes(latest.current, sent), []);
  useEscape(onClose);

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={onClose}>
      <div className="dialog card card-pad stack" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 id="settings-title">Einstellungen</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X />
          </button>
        </div>
        {!canEdit && <p className="small muted">Du kannst diese Präsentation nur ansehen.</p>}

        <label className="field">
          <span>Branding</span>
          <select
            className="select"
            value={settings.brandId ?? ''}
            disabled={!isOwner}
            onChange={(e) => onBrand(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Ohne Branding</option>
            {isOwner
              ? brands?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))
              : settings.brand && <option value={settings.brandId ?? ''}>{settings.brand.name}</option>}
          </select>
          <span className="small faint" style={{ fontWeight: 400 }}>
            {isOwner
              ? 'Farben und Logo auf Beamer und Handys.'
              : 'Das Branding wählt, wem die Präsentation gehört – es kommt aus dessen Konto.'}
          </span>
        </label>

        <label className="switch">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={settings.shareSlides}
            onChange={(e) => onChange({ shareSlides: e.target.checked })}
          />
          <span>
            Folien auf Handys zeigen
            <span className="small faint" style={{ display: 'block' }}>
              Bildfolien erscheinen auch auf den Handys der Teilnehmenden – mit Laserpointer und Zeichnungen.
            </span>
          </span>
        </label>

        <div className="field">
          <span>Dauer</span>
          <span className="row small muted" style={{ gap: 6 }}>
            <input
              className="input minutes-input"
              type="number"
              min={1}
              max={600}
              placeholder="–"
              inputMode="numeric"
              aria-label="Dauer (Min.)"
              readOnly={!canEdit}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              onBlur={saveMinutes}
              onKeyDown={(e) => e.key === 'Enter' && saveMinutes()}
            />
            Min.
            {plannedSum > 0 && <span className="tabular">· geplant: {plannedSum} Min. auf den Folien</span>}
          </span>
          <span className="small faint" style={{ fontWeight: 400 }}>
            Zeitrahmen des Vortrags – das Steuerpult zeigt die verstrichene Zeit daran gemessen.
          </span>
        </div>
      </div>
    </div>
  );
}
