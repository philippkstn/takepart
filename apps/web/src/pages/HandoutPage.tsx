import type { HandoutData } from '@slides/shared';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router';
import { LegalLinks } from '../components/LegalLinks.tsx';
import { SlideResultsView } from '../components/Results.tsx';
import { BrandMark, FullScreenSpinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { brandStyle } from '../lib/brand.ts';
import './handout.css';
import './participant.css';

/**
 * Freigegebene Folien und Ergebnisse für Teilnehmende. Enthält nur Folien und
 * zusammengefasste Ergebnisse – keine Namen, Freitexte oder Fragen.
 */
export default function HandoutPage() {
  const { token = '' } = useParams();
  const data = useQuery({
    queryKey: ['handout', token],
    queryFn: () => api<HandoutData>(`/api/handout/${encodeURIComponent(token)}`),
    retry: false,
  });

  if (data.isLoading) return <FullScreenSpinner />;
  if (!data.data) {
    return (
      <div className="center-screen">
        <div className="card card-pad stack" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1>Nicht verfügbar</h1>
          <p className="muted">Diese Folien wurden nicht (mehr) freigegeben.</p>
        </div>
      </div>
    );
  }
  const h = data.data;

  return (
    <div className="handout" style={brandStyle(h.brand)}>
      <header className="handout-head">
        <span className="row">
          {h.brand?.logoUrl ? <img className="p-logo" src={h.brand.logoUrl} alt={h.brand.name} /> : <BrandMark size={28} />}
          <span>
            <h1>{h.title}</h1>
            <span className="small muted">{new Date(h.date).toLocaleDateString('de-DE', { dateStyle: 'long' })}</span>
          </span>
        </span>
        <button className="btn no-print" onClick={() => window.print()}>
          <Printer /> Als PDF speichern
        </button>
      </header>

      <main className="handout-slides">
        {h.slides.map((s, i) => (
          <section key={i} className={`handout-slide handout-${s.type}`}>
            {/* Nicht lazy: „Als PDF speichern“ druckt sonst nicht geladene Folien als leere Seiten */}
            {s.type === 'image' && <img src={s.image} alt={s.title || `Folie ${i + 1}`} width={s.width} height={s.height} />}
            {s.type === 'content' && (
              <div className="handout-card">
                {s.title && <h2>{s.title}</h2>}
                {s.body && (
                  <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                    {s.body}
                  </p>
                )}
              </div>
            )}
            {s.type === 'sentence' && (
              <div className="handout-card">
                <span className="label">Gemeinsam geschriebener Satz</span>
                <p className="handout-sentence">{s.sentence}</p>
              </div>
            )}
            {s.type === 'results' && (
              <div className="handout-card">
                <span className="label">
                  Ergebnis · {s.results.voters} {s.results.voters === 1 ? 'Antwort' : 'Antworten'}
                </span>
                {'question' in s.slide.config && s.slide.config.question && <h2>{s.slide.config.question}</h2>}
                <SlideResultsView slide={s.slide} results={s.results} showComments={false} />
              </div>
            )}
          </section>
        ))}
      </main>

      <footer className="p-footer no-print">
        <LegalLinks />
      </footer>
    </div>
  );
}
