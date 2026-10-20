import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router';
import { LegalLinks } from '../components/LegalLinks.tsx';
import { ProtocolView, type ProtocolData } from '../components/protocol/ProtocolView.tsx';
import { FullScreenSpinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';

/**
 * Geteiltes Fotoprotokoll (`/p/:token`) – ohne Admin-Navigation, druckbar.
 * Enthält Kartentexte und Freitexte; Namen nur, wenn die Moderation sie nicht weggelassen hat.
 */
export default function ProtocolSharePage() {
  const { token = '' } = useParams();
  const data = useQuery({
    queryKey: ['protocol', token],
    queryFn: () => api<ProtocolData>(`/api/protocol/${encodeURIComponent(token)}`),
    retry: false,
  });

  if (data.isLoading) return <FullScreenSpinner />;
  if (!data.data) {
    return (
      <div className="center-screen">
        <div className="card card-pad stack" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1>Nicht verfügbar</h1>
          <p className="muted">Dieses Fotoprotokoll wurde nicht (mehr) geteilt.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ProtocolView
        run={data.data}
        toolbar={
          <div className="protocol-toolbar no-print">
            <span className="grow" />
            <span className="small faint">Im Druckdialog „Als PDF sichern“ wählen.</span>
            <button className="btn btn-primary" onClick={() => window.print()}>
              <Printer /> Als PDF speichern
            </button>
          </div>
        }
      />
      <footer className="protocol-footer no-print">
        <LegalLinks />
      </footer>
    </>
  );
}
