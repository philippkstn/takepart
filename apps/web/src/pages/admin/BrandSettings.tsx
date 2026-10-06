import { LOGO_MAX_BYTES, LOGO_TYPES, type BrandView } from '@slides/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Spinner, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { brandStyle, contrast } from '../../lib/brand.ts';

type Brand = BrandView & { id: number; used: number };

const EMPTY = { name: '', accent: '#2563C9', chart: '#2563C9' };

/** Kräftiges Rot (Farbton um 0°)? */
function isRed(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max !== r || max - min < 0.35) return false;
  const hue = (60 * (g - b)) / (max - min);
  return hue < 20 && hue > -20;
}

/** Kontrast-Hinweise: Diagrammfarbe braucht ≥ 3:1 auf hellem und dunklem Hintergrund. */
function colorHints(accent: string, chart: string): string[] {
  const hints: string[] = [];
  const valid = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
  if (!valid(accent) || !valid(chart)) return hints;
  if (contrast(chart, '#ffffff') < 3) hints.push('Diagrammfarbe ist auf hellem Hintergrund schwach (Kontrast unter 3:1).');
  if (contrast(chart, '#1b1b1e') < 3) hints.push('Diagrammfarbe ist auf dunklem Hintergrund schwach (Kontrast unter 3:1).');
  if (isRed(chart)) hints.push('Rot als Diagrammfarbe wirkt schnell wie „schlecht“ – für Balken besser eine Zweitfarbe nehmen.');
  return hints;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="color-field">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input className="input" value={value} maxLength={7} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </span>
    </label>
  );
}

function BrandForm({ initial, onDone }: { initial?: Brand; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(initial ? { name: initial.name, accent: initial.accent, chart: initial.chart } : EMPTY);
  const [busy, setBusy] = useState(false);
  const hints = colorHints(form.accent, form.chart);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (initial) await api(`/api/brands/${initial.id}`, { method: 'PATCH', body: form });
      else await api('/api/brands', { body: form });
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      onDone();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="brand-form stack" onSubmit={submit}>
      <label className="field">
        <span>Name</span>
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} autoFocus />
      </label>
      <div className="form-2col">
        <ColorField label="Akzentfarbe (Buttons, Hervorhebungen)" value={form.accent} onChange={(accent) => setForm({ ...form, accent })} />
        <ColorField label="Diagrammfarbe (Balken)" value={form.chart} onChange={(chart) => setForm({ ...form, chart })} />
      </div>
      {hints.map((h) => (
        <p key={h} className="small" style={{ color: 'var(--warn)' }}>
          {h}
        </p>
      ))}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !form.name.trim()}>
          Speichern
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function BrandCard({ brand }: { brand: Brand }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['brands'] });
  const onError = (err: unknown) => toast(errorMessage(err), 'error');

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!(LOGO_TYPES as readonly string[]).includes(file.type)) throw new Error('Bitte PNG, SVG, JPEG oder WebP wählen');
      if (file.size > LOGO_MAX_BYTES) throw new Error('Das Logo ist zu groß (höchstens 512 KB)');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
        reader.readAsDataURL(file);
      });
      await api(`/api/brands/${brand.id}/logo`, { method: 'PUT', body: { dataUrl } });
    },
    onSuccess: refresh,
    onError,
  });
  const removeLogo = useMutation({
    mutationFn: () => api(`/api/brands/${brand.id}/logo`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({ mutationFn: () => api(`/api/brands/${brand.id}`, { method: 'DELETE' }), onSuccess: refresh, onError });

  if (editing) return <BrandForm initial={brand} onDone={() => setEditing(false)} />;

  return (
    <li className="brand-card" style={brandStyle(brand)}>
      <div className="brand-logo">
        {brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : <span className="faint small">kein Logo</span>}
      </div>
      <div className="grow stack-s">
        <strong>{brand.name}</strong>
        <div className="row small muted">
          <span className="swatch" style={{ background: brand.accent }} /> {brand.accent}
          <span className="swatch" style={{ background: brand.chart }} /> {brand.chart}
          <span className="faint">· {brand.used === 1 ? '1 Präsentation' : `${brand.used} Präsentationen`}</span>
        </div>
        <div className="brand-sample" aria-hidden>
          <span className="btn btn-primary btn-small">Abschicken</span>
          <span className="sample-bar" />
        </div>
      </div>
      <div className="row">
        <label className="icon-btn" title="Logo hochladen" aria-label="Logo hochladen">
          <ImagePlus />
          <input
            type="file"
            accept={LOGO_TYPES.join(',')}
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
        </label>
        {brand.logoUrl && (
          <button className="icon-btn" title="Logo entfernen" aria-label="Logo entfernen" onClick={() => removeLogo.mutate()}>
            <X />
          </button>
        )}
        <button className="icon-btn" title="Bearbeiten" aria-label="Bearbeiten" onClick={() => setEditing(true)}>
          <Pencil />
        </button>
        <button
          className="icon-btn"
          title="Löschen"
          aria-label="Löschen"
          onClick={() => {
            const note = brand.used > 0 ? ` ${brand.used} Präsentation(en) laufen danach ohne Branding.` : '';
            if (window.confirm(`Branding „${brand.name}“ löschen?${note}`)) remove.mutate();
          }}
        >
          <Trash2 />
        </button>
      </div>
    </li>
  );
}

export function BrandSettings() {
  const list = useQuery({ queryKey: ['brands'], queryFn: () => api<Brand[]>('/api/brands') });
  const [creating, setCreating] = useState(false);
  return (
    <section className="card card-pad stack">
      <div className="row-between">
        <div className="stack-s">
          <h2>Brandings</h2>
          <p className="muted small">Logo und Farben für Präsentationen, z. B. für Kunden. Ohne Branding bleibt alles neutral.</p>
        </div>
        {!creating && (
          <button className="btn" onClick={() => setCreating(true)}>
            <Plus /> Neues Branding
          </button>
        )}
      </div>
      {creating && <BrandForm onDone={() => setCreating(false)} />}
      {list.isLoading ? (
        <Spinner />
      ) : list.data?.length === 0 && !creating ? (
        <div className="empty">Noch keine Brandings.</div>
      ) : (
        <ul className="brand-list">
          {list.data?.map((b) => (
            <BrandCard key={b.id} brand={b} />
          ))}
        </ul>
      )}
    </section>
  );
}
