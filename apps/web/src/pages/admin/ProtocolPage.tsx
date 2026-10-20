import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ProtocolView, type ProtocolData } from '../../components/protocol/ProtocolView.tsx';
import { FollowupButton, ProtocolShare, type ProtocolShareState } from '../../components/protocol/ProtocolShare.tsx';
import { RunNoteEditor } from '../../components/protocol/RunNoteEditor.tsx';
import { FullScreenSpinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';

interface RunResults extends ProtocolData {
  id: number;
  presentationId: number;
  protocol: ProtocolShareState | null;
}

/**
 * Fotoprotokoll einer Durchführung (Admin). „Als PDF speichern“ nutzt den
 * Druckdialog des Browsers; auf dem Server läuft dafür nichts. Notizen der
 * Moderation lassen sich hier noch ergänzen, der Link zum Teilen erzeugen.
 */
export default function ProtocolPage() {
  const runId = Number(useParams().runId);
  const data = useQuery({ queryKey: ['run-results', runId], queryFn: () => api<RunResults>(`/api/runs/${runId}/results`) });
  const run = data.data;

  if (data.isLoading) return <FullScreenSpinner />;
  if (!run) return <main className="page">Nicht gefunden.</main>;

  return (
    <ProtocolView
      run={run}
      toolbar={
        <>
          <div className="protocol-toolbar no-print">
            <Link to={`/admin/runs/${run.id}`} className="btn btn-ghost">
              <ArrowLeft /> Zum Archiv
            </Link>
            <span className="grow" />
            <span className="small faint">Im Druckdialog „Als PDF sichern“ wählen – Querformat ist voreingestellt.</span>
            <FollowupButton runId={run.id} />
            <button className="btn btn-primary" onClick={() => window.print()}>
              <Printer /> Als PDF speichern
            </button>
          </div>
          <ProtocolShare key={run.protocol?.url ?? 'none'} runId={run.id} protocol={run.protocol} />
        </>
      }
      noteEditor={(s) => <RunNoteEditor key={s.id} runId={run.id} slideId={s.id} initial={s.note ?? ''} rows={2} />}
    />
  );
}
