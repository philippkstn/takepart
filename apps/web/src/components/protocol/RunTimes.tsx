import { useQueryClient } from '@tanstack/react-query';
import { Clock, Pencil } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { useToast } from '../ui.tsx';

/** `datetime-local`-Wert (Ortszeit des Browsers) aus einem Zeitpunkt */
function localInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function durationLabel(startedAt: string, endedAt: string) {
  const minutes = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000);
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

/**
 * Zeitraum einer beendeten Durchführung – nachträglich korrigierbar, etwa wenn
 * sie erst am nächsten Tag beendet wurde. Bestimmt die Dauer in Archiv und Fotoprotokoll.
 */
export function RunTimes({ runId, startedAt, endedAt }: { runId: number; startedAt: string; endedAt: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(() => localInput(startedAt));
  const [end, setEnd] = useState(() => localInput(endedAt));
  const [busy, setBusy] = useState(false);
  const valid = !!start && !!end && new Date(end).getTime() > new Date(start).getTime();

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/runs/${runId}/times`, {
        method: 'PATCH',
        body: { startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString() },
      });
      await queryClient.invalidateQueries({ queryKey: ['run-results', runId] });
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
      toast('Zeitraum gespeichert');
      setEditing(false);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    const s = new Date(startedAt);
    const e = new Date(endedAt);
    const sameDay = s.toDateString() === e.toDateString();
    return (
      <span className="run-times">
        <Clock size={14} aria-hidden />
        <span className="tabular">
          {s.toLocaleTimeString('de-DE', { timeStyle: 'short' })} –{' '}
          {sameDay ? e.toLocaleTimeString('de-DE', { timeStyle: 'short' }) : e.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}{' '}
          · {durationLabel(startedAt, endedAt)}
        </span>
        <button
          className="btn btn-ghost btn-small no-print"
          onClick={() => {
            setStart(localInput(startedAt));
            setEnd(localInput(endedAt));
            setEditing(true);
          }}
        >
          <Pencil /> Dauer anpassen
        </button>
      </span>
    );
  }

  return (
    <form
      className="run-times-form no-print"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
    >
      <label className="stack-s small">
        Beginn
        <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
      </label>
      <label className="stack-s small">
        Ende
        <input className="input" type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
      </label>
      <span className="small muted tabular">{valid ? durationLabel(start, end) : 'Ende muss nach dem Beginn liegen'}</span>
      <button className="btn btn-primary btn-small" type="submit" disabled={!valid || busy}>
        Speichern
      </button>
      <button className="btn btn-ghost btn-small" type="button" disabled={busy} onClick={() => setEditing(false)}>
        Abbrechen
      </button>
    </form>
  );
}
