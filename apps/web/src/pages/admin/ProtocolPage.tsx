import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ProtocolView, printProtocol, type ProtocolData } from '../../components/protocol/ProtocolView.tsx';
import { FollowupButton, ProtocolShare, type ProtocolShareState } from '../../components/protocol/ProtocolShare.tsx';
import { RunNoteEditor } from '../../components/protocol/RunNoteEditor.tsx';
import { RunTimes } from '../../components/protocol/RunTimes.tsx';
import { FullScreenSpinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { isBoolean, usePref } from '../../lib/prefs.ts';

interface RunResults extends ProtocolData {
  id: number;
  presentationId: number;
  protocol: ProtocolShareState | null;
}

/**
 * Fotoprotokoll einer Durchführung (Admin). „Als PDF speichern“ nutzt den
 * Druckdialog des Browsers; auf dem Server läuft dafür nichts. Notizen der
 * Moderation lassen sich hier noch ergänzen, der Link zum Teilen erzeugen.
 * „Folien mitdrucken“ merkt sich der Browser (reine Ansichtssache).
 */
export default function ProtocolPage() {
  const runId = Number(useParams().runId);
  const data = useQuery({ queryKey: ['run-results', runId], queryFn: () => api<RunResults>(`/api/runs/${runId}/results`) });
  const run = data.data;
  const [withSlides, setWithSlides] = usePref('protocol-slides', false, isBoolean);

  if (data.isLoading) return <FullScreenSpinner />;
  if (!run) return <main className="page">Nicht gefunden.</main>;

  return (
    <ProtocolView
      run={run}
      showSlides={withSlides}
      toolbar={
        <>
          <div className="protocol-toolbar no-print">
            <Link to={`/admin/runs/${run.id}`} className="btn btn-ghost">
              <ArrowLeft /> Zum Archiv
            </Link>
            <span className="grow" />
            <label className="row small">
              <input type="checkbox" checked={withSlides} onChange={(e) => setWithSlides(e.target.checked)} />
              Folien mitdrucken
            </label>
            <span className="small faint">Im Druckdialog „Als PDF sichern“ wählen – Querformat ist voreingestellt.</span>
            <FollowupButton runId={run.id} />
            <button className="btn btn-primary" onClick={() => void printProtocol()}>
              <Printer /> Als PDF speichern
            </button>
          </div>
          {run.endedAt && (
            <section className="card card-pad no-print row small">
              <strong>Zeitraum</strong>
              <RunTimes key={`${run.startedAt}-${run.endedAt}`} runId={run.id} startedAt={run.startedAt} endedAt={run.endedAt} />
            </section>
          )}
          <ProtocolShare key={`${run.protocol?.url ?? 'none'}-${run.protocol?.expiresAt ?? ''}`} runId={run.id} protocol={run.protocol} />
        </>
      }
      noteEditor={(s) => <RunNoteEditor key={s.id} runId={run.id} slideId={s.id} initial={s.note ?? ''} rows={2} />}
    />
  );
}
