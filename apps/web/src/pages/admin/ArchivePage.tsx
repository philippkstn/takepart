import type { BoardConfig, BoardSummary, PublicSlide, SlideResults, SlideType } from '@slides/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronUp, Download, FileText, Radio, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { BoardProtocol } from '../../components/board/BoardProtocol.tsx';
import { FollowupButton, ProtocolShare, type ProtocolShareState } from '../../components/protocol/ProtocolShare.tsx';
import { RunNoteEditor } from '../../components/protocol/RunNoteEditor.tsx';
import { SlideResultsView } from '../../components/Results.tsx';
import { SlideIcon } from '../../components/slideIcons.tsx';
import { FullScreenSpinner, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';

interface ArchiveSlide {
  id: number;
  type: SlideType;
  typeLabel: string;
  headline: string;
  config: PublicSlide['config'];
  results: SlideResults | null;
  responses: number;
  posts: { id: number; authorName: string | null; text: string; column: number | null; status: string; votes: number }[];
  sentence: string | null;
  board: BoardSummary | null;
  teams: { name: string; members: string[] }[] | null;
  /** Protokollnotiz der Moderation */
  note: string | null;
}

interface RunResults {
  id: number;
  presentationId: number;
  title: string;
  startedAt: string;
  endedAt: string | null;
  participants: number;
  protocol: ProtocolShareState | null;
  slides: ArchiveSlide[];
}

export default function ArchivePage() {
  const runId = Number(useParams().runId);
  const navigate = useNavigate();
  const toast = useToast();
  const data = useQuery({ queryKey: ['run-results', runId], queryFn: () => api<RunResults>(`/api/runs/${runId}/results`) });
  const remove = useMutation({
    mutationFn: () => api(`/api/runs/${runId}`, { method: 'DELETE' }),
    onSuccess: () => navigate(data.data ? `/admin/p/${data.data.presentationId}` : '/admin'),
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (data.isLoading) return <FullScreenSpinner />;
  if (!data.data) return <main className="page">Nicht gefunden.</main>;
  const run = data.data;

  return (
    <main className="page stack">
      <div className="row-between">
        <div className="row">
          <Link to={`/admin/p/${run.presentationId}`} className="icon-btn" aria-label="Zurück">
            <ArrowLeft />
          </Link>
          <div>
            <h1>{run.title}</h1>
            <p className="muted small">
              {new Date(run.startedAt).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })} · {run.participants} Teilnehmende
            </p>
          </div>
        </div>
        <div className="row">
          {!run.endedAt && (
            <Link className="btn btn-primary" to={`/admin/live/${run.id}`}>
              <Radio /> Läuft noch – zum Steuerpult
            </Link>
          )}
          <Link className="btn" to={`/admin/runs/${run.id}/protokoll`}>
            <FileText /> Fotoprotokoll (PDF)
          </Link>
          <FollowupButton runId={run.id} />
          <a className="btn" href={`/api/runs/${run.id}/export.csv`} download>
            <Download /> CSV-Export
          </a>
          <button
            className="btn btn-danger"
            onClick={() => window.confirm('Diese Durchführung mit allen Ergebnissen endgültig löschen?') && remove.mutate()}
          >
            <Trash2 /> Löschen
          </button>
        </div>
      </div>

      <ProtocolShare key={run.protocol?.url ?? 'none'} runId={run.id} protocol={run.protocol} />

      {run.slides.map((s, i) => (
        <section key={s.id} className="card card-pad stack archive-slide">
          <div className="row">
            <span className="slide-num tabular">{i + 1}</span>
            <SlideIcon type={s.type} />
            <span className="label">{s.typeLabel}</span>
            <span className="grow" />
            {s.type !== 'content' && <span className="pill tabular">{s.responses} Antworten</span>}
          </div>
          {s.headline && <h2>{s.headline}</h2>}
          {s.sentence && <p className="sentence-preview">{s.sentence}</p>}
          {s.board && <BoardProtocol config={s.config as BoardConfig} summary={s.board} results={s.results} />}
          {s.teams && s.teams.length > 0 && (
            <div className="protocol-groups">
              {s.teams.map((t) => (
                <section key={t.name} className="protocol-group">
                  <h3>
                    {t.name} <span className="faint tabular">· {t.members.length}</span>
                  </h3>
                  <ul>
                    {t.members.map((m, j) => (
                      <li key={j}>{m}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {s.results && s.results.voters > 0 && s.type !== 'sentence' && s.type !== 'board' && (
            <SlideResultsView slide={{ id: s.id, type: s.type, position: i, config: s.config } as PublicSlide} results={s.results} />
          )}
          {s.posts.length > 0 && (
            <ul className="mod-list">
              {s.posts.map((p) => (
                <li key={p.id} className={`mod-item ${p.status === 'hidden' ? 'is-hidden' : ''}`}>
                  <div className="mod-text">
                    <span>{p.text}</span>
                    <span className="post-meta">
                      {p.authorName && <span>{p.authorName}</span>}
                      {s.type === 'pinboard' && p.column !== null && 'columns' in s.config && (
                        <span className="pill">{s.config.columns[p.column]}</span>
                      )}
                      {s.type === 'board' && p.column !== null && 'tags' in s.config && (
                        <span className="pill">{s.config.tags[p.column]}</span>
                      )}
                      {p.votes > 0 && (
                        <span className="pill">
                          <ChevronUp /> {p.votes}
                        </span>
                      )}
                      {p.status === 'answered' && <span className="pill pill-good">beantwortet</span>}
                      {p.status === 'hidden' && <span className="pill">ausgeblendet</span>}
                      {p.status === 'pending' && <span className="pill pill-warn">nicht freigegeben</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <RunNoteEditor key={s.id} runId={run.id} slideId={s.id} initial={s.note ?? ''} rows={2} />
        </section>
      ))}
    </main>
  );
}
