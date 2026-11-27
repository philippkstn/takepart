import { BLANK_TEMPLATE_ID, DEFAULT_TEMPLATE_ID, SLIDE_TYPE_LABELS, templateMinutes, TEMPLATES } from '@slides/shared';
import { useMutation } from '@tanstack/react-query';
import { Clock, FilePlus2, Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../../lib/api.ts';
import { useEscape } from '../../lib/useEscape.ts';
import { SlideIcon } from '../slideIcons.tsx';

/** Dauer und Folienzahl je Vorlage – ändern sich nicht, einmal berechnet */
const GALLERY = TEMPLATES.map((t) => ({ ...t, minutes: templateMinutes(t) }));

/**
 * Neue Präsentation anlegen: Titel und Vorlage aus der Galerie (`TEMPLATES` in shared)
 * oder „Leer beginnen“. Auswahl über echte Radio-Knöpfe – Pfeiltasten wechseln die Karte.
 */
export function NewPresentationDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const chosen = GALLERY.find((t) => t.id === templateId);
  const fallbackTitle = chosen?.name ?? 'Neue Präsentation';
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/api/presentations', { body: { title: title.trim() || fallbackTitle, templateId } }),
    onSuccess: ({ id }) => navigate(`/admin/p/${id}`),
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!create.isPending) create.mutate();
  };

  return (
    <div className="dialog-backdrop is-top" role="dialog" aria-modal="true" aria-labelledby="new-pres-title" onClick={onClose}>
      <form className="dialog dialog-wide card card-pad stack" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="row-between">
          <h2 id="new-pres-title">Neue Präsentation</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X />
          </button>
        </div>
        <label className="field">
          <span>Titel</span>
          <input
            className="input"
            autoFocus
            placeholder={fallbackTitle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </label>
        <fieldset className="template-gallery">
          <legend className="label">Vorlage</legend>
          <label className={`template-card${templateId === BLANK_TEMPLATE_ID ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="template"
              className="visually-hidden"
              checked={templateId === BLANK_TEMPLATE_ID}
              onChange={() => setTemplateId(BLANK_TEMPLATE_ID)}
            />
            <span className="template-name">Leer beginnen</span>
            <span className="template-text small muted">Ohne Folien – du importierst ein Deck oder fügst Bausteine ein.</span>
            <span className="template-meta small faint">
              <FilePlus2 size={14} aria-hidden /> 0 Folien
            </span>
          </label>
          {GALLERY.map((t) => (
            <label key={t.id} className={`template-card${templateId === t.id ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="template"
                className="visually-hidden"
                checked={templateId === t.id}
                onChange={() => setTemplateId(t.id)}
              />
              <span className="template-name">{t.name}</span>
              <span className="template-text small muted">{t.description}</span>
              <span className="template-meta small faint">
                <span className="pres-meta-icon">
                  <Clock size={14} aria-hidden /> {t.minutes} Min.
                </span>
                <span>{t.slides.length} Folien</span>
              </span>
              <span className="template-sketch" aria-hidden title={t.slides.map((s) => SLIDE_TYPE_LABELS[s.type]).join(' → ')}>
                {t.slides.map((s, i) => (
                  <SlideIcon key={i} type={s.type} size={14} />
                ))}
              </span>
              <span className="visually-hidden">Für: {t.audience}</span>
            </label>
          ))}
        </fieldset>
        {chosen && (
          <p className="small muted">Für: {chosen.audience}. Notizen und Ablaufplan je Folie sind dabei, alles lässt sich anpassen.</p>
        )}
        {error && <div className="error-box">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            <Plus /> {create.isPending ? 'Lege an …' : 'Anlegen'}
          </button>
        </div>
      </form>
    </div>
  );
}
