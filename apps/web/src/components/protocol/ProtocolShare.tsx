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
}

/**
 * Fotoprotokoll teilen: eigener, zufälliger Link. Anders als die Folien-Freigabe
 * enthält er Kartentexte, Freitexte, Gruppen und – wenn nicht abgewählt – Namen.
 */
export function ProtocolShare({ runId, protocol }: { runId: number; protocol: ProtocolShareState | null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [withoutNames, setWithoutNames] = useState(protocol ? !protocol.names : false);
  const [busy, setBusy] = useState(false);
  const absolute = protocol ? `${location.origin}${protocol.url}` : '';

  const send = async (enabled: boolean, names = !withoutNames) => {
    setBusy(true);
    try {
      await api(`/api/runs/${runId}/protocol-share`, { body: { enabled, names } });
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
        {withoutNames ? '' : ' sowie die Namen in Gruppeneinteilung und Q&A'}. Wer den Link hat, kann alles lesen – nur an Beteiligte
        weitergeben.
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
