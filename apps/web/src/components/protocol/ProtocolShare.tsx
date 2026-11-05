import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Copy, ExternalLink, Link2, Link2Off } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../../lib/api.ts';
import { useToast } from '../ui.tsx';
import './protocol-extra.css';

export interface ProtocolShareState {
  url: string;
  names: boolean;
  /** Folienbilder mitgeteilt */
  slides: boolean;
  /** Läuft automatisch ab (ISO); `null` = nie */
  expiresAt: string | null;
}

/** `YYYY-MM-DD` in Ortszeit */
function dateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ablauf am Ende des gewählten Tages (Ortszeit) */
function endOfDay(date: string) {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

const DEFAULT_EXPIRY_DAYS = 30;

/**
 * Fotoprotokoll teilen: eigener, zufälliger Link. Anders als die Folien-Freigabe
 * enthält er Kartentexte, Freitexte, Gruppen und – wenn nicht abgewählt – Namen.
 */
export function ProtocolShare({ runId, protocol }: { runId: number; protocol: ProtocolShareState | null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [withoutNames, setWithoutNames] = useState(protocol ? !protocol.names : false);
  const [withSlides, setWithSlides] = useState(protocol?.slides ?? false);
  const [expiry, setExpiry] = useState<string | null>(protocol?.expiresAt ? dateInput(new Date(protocol.expiresAt)) : null);
  const [busy, setBusy] = useState(false);
  const expired = !!protocol?.expiresAt && new Date(protocol.expiresAt).getTime() <= Date.now();
  const absolute = protocol ? `${location.origin}${protocol.url}` : '';

  const send = async (enabled: boolean, names = !withoutNames, slides = withSlides, until = expiry) => {
    setBusy(true);
    try {
      await api(`/api/runs/${runId}/protocol-share`, {
        body: { enabled, names, slides, expiresAt: until ? endOfDay(until) : null },
      });
      await queryClient.invalidateQueries({ queryKey: ['run-results', runId] });
      toast(enabled ? (protocol ? 'Einstellung gespeichert' : 'Link erzeugt') : 'Link zurückgezogen – er funktioniert nicht mehr');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absolute);
      toast('Link kopiert');
    } catch {
      toast('Kopieren nicht möglich – bitte den Link markieren', 'error');
    }
  };

  return (
    <section className="card card-pad protocol-share no-print">
      <h2 className="row">
        <Link2 size={20} /> Fotoprotokoll teilen
      </h2>
      <p className="protocol-share-warning">
        Anders als die Freigabe der Folien enthält dieser Link alle Kartentexte, Freitexte, Fragen und Gruppen
        {withoutNames ? '' : ' sowie die Namen in Gruppeneinteilung und Q&A'}
        {withSlides ? ', dazu alle Folien' : ''}. Wer den Link hat, kann alles lesen – nur an Beteiligte weitergeben.
      </p>
      <label className="row small">
        <input
          type="checkbox"
          checked={withoutNames}
          disabled={busy}
          onChange={(e) => {
            setWithoutNames(e.target.checked);
            if (protocol) void send(true, !e.target.checked);
          }}
        />
        Namen weglassen (Gruppeneinteilung nur mit Anzahl, Fragen ohne Namen)
      </label>
      <label className="row small">
        <input
          type="checkbox"
          checked={withSlides}
          disabled={busy}
          onChange={(e) => {
            setWithSlides(e.target.checked);
            if (protocol) void send(true, !withoutNames, e.target.checked);
          }}
        />
        Folien mitteilen (alle Folien in ihrer Reihenfolge, importierte Folien als Bild)
      </label>
      <div className="protocol-share-expiry small">
        <label className="row">
          <input
            type="checkbox"
            checked={expiry !== null}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.checked ? dateInput(new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000)) : null;
              setExpiry(next);
              if (protocol) void send(true, !withoutNames, withSlides, next);
            }}
          />
          Link läuft automatisch ab am
        </label>
        {expiry !== null && (
          <input
            className="input"
            type="date"
            value={expiry}
            min={dateInput(new Date())}
            disabled={busy}
            aria-label="Ablaufdatum"
            onChange={(e) => {
              const next = e.target.value;
              if (!next) return;
              setExpiry(next);
              if (protocol && next >= dateInput(new Date())) void send(true, !withoutNames, withSlides, next);
            }}
          />
        )}
        {expiry !== null && <span className="faint">(bis 23:59 Uhr, danach funktioniert der Link nicht mehr)</span>}
      </div>
      {expired && (
        <p className="small protocol-share-expired">
          Der Link ist am {new Date(protocol!.expiresAt!).toLocaleDateString('de-DE', { dateStyle: 'long' })} abgelaufen. Mit einem
          neuen Datum (oder ohne Ablauf) funktioniert derselbe Link wieder.
        </p>
      )}
      {protocol ? (
        <div className="protocol-share-link">
          <input className="input" readOnly value={absolute} aria-label="Link zum Fotoprotokoll" onFocus={(e) => e.target.select()} />
          <button className="btn btn-small" onClick={copy}>
            <Copy /> Kopieren
          </button>
          <a className="btn btn-small" href={protocol.url} target="_blank" rel="noopener">
            <ExternalLink /> Ansehen
          </a>
          <button
            className="btn btn-small btn-danger"
            disabled={busy}
            onClick={() => window.confirm('Link zurückziehen? Wer ihn hat, sieht das Protokoll dann nicht mehr.') && void send(false)}
          >
            <Link2Off /> Zurückziehen
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void send(true)}>
            <Link2 /> Link erzeugen
          </button>
        </div>
      )}
    </section>
  );
}

/** Neue Präsentation als Vorlage für den Folgetermin anlegen und im Editor öffnen */
export function FollowupButton({ runId, className = 'btn' }: { runId: number; className?: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const { id } = await api<{ id: number }>(`/api/runs/${runId}/followup`, {
        body: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      toast('Folgetermin angelegt');
      navigate(`/admin/p/${id}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  };
  return (
    <button className={className} onClick={create} disabled={busy} title="Neue Präsentation mit Rückblick und den vereinbarten Themen">
      <CalendarPlus /> Folgetermin anlegen
    </button>
  );
}
