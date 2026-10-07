import { buildSteps, topWords, type HostCommand, type HostView, type PostView } from '@slides/shared';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Crosshair,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Maximize2,
  MessageSquareOff,
  MousePointer2,
  PenLine,
  Play,
  QrCode as QrIcon,
  RefreshCw,
  RotateCcw,
  Share2,
  Square,
  Timer,
  Trophy,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { SlideResultsView } from '../../components/Results.tsx';
import { SlideIcon } from '../../components/slideIcons.tsx';
import { InkInput, InkOverlay, type InkTool } from '../../components/Ink.tsx';
import { Stage } from '../../components/Stage.tsx';
import { staticPreview } from '../../components/staticPreview.ts';
import { ConnectionBadge, formatCode, FullScreenSpinner, joinHost, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import { usePresenterKeys } from '../../lib/presenterKeys.ts';
import { useRequireHost } from './AdminLayout.tsx';
import './admin.css';

export default function ControlPage() {
  const runId = Number(useParams().runId);
  const { loading, loggedIn } = useRequireHost();
  const { view, status, offset, ink, sendInk } = useLive<HostView>(loggedIn ? `run=${runId}` : null);
  const [tool, setTool] = useState<InkTool>('none');
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const command = async (cmd: HostCommand) => {
    setBusy(true);
    try {
      await api(`/api/runs/${runId}/command`, { body: cmd });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Tastatur und Presenter wie in PowerPoint (siehe presenterKeys.ts)
  usePresenterKeys(command, view?.display.blank ?? null);

  if (loading) return <FullScreenSpinner />;
  if (!loggedIn) return <Navigate to="/login" replace />;
  if (status === 'rejected') return <Navigate to="/admin" replace />;
  if (!view) return <FullScreenSpinner />;

  const displayUrl = `${location.origin}/d/${view.displayToken}`;
  const slide = view.slide;
  const build = view.display.buildStep;
  const builds = slide ? buildSteps(slide) : 0;
  const blank = view.display.blank;
  const ended = view.run.ended;

  const end = async () => {
    const handoutNote = view.handoutUrl
      ? ''
      : '\n\nHinweis: Folien und Ergebnisse sind nicht freigegeben. Gibst du sie erst nach dem Ende frei, erreicht der Link die Teilnehmenden nicht mehr automatisch.';
    if (
      !window.confirm(
        `Durchführung beenden? Teilnehmende können danach nicht mehr antworten. Die Ergebnisse bleiben gespeichert.${handoutNote}`,
      )
    )
      return;
    try {
      await api(`/api/runs/${runId}/end`, { body: {} });
      navigate(`/admin/runs/${runId}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} kopiert`);
    } catch {
      toast('Kopieren nicht möglich', 'error');
    }
  };

  return (
    <div className="control">
      <ConnectionBadge status={status} />
      <header className="control-head">
        <Link to={`/admin/p/${view.presentationId}`} className="icon-btn" aria-label="Zur Präsentation">
          <ArrowLeft />
        </Link>
        <div className="grow control-title">
          <strong>{view.run.title}</strong>
          <span className="small muted">
            {joinHost()} · Code <strong className="tabular">{formatCode(view.run.code)}</strong>
          </span>
        </div>
        <PresenterClock view={view} offset={offset} onReset={() => command({ action: 'timer-reset' })} />
        <span className="pill" title="Verbundene Teilnehmende">
          <Users /> <span className="tabular">{view.participants}</span>
        </span>
        <div className="row control-head-actions">
          <a className="btn btn-small" href={displayUrl} target="slides-display" rel="noopener">
            <Maximize2 /> Beamer öffnen
          </a>
          <button className="btn btn-small" onClick={() => copy(displayUrl, 'Anzeige-Link')} title="Anzeige-Link kopieren">
            <Copy /> Link
          </button>
          <button
            className="icon-btn"
            title="Anzeige-Link erneuern (alter Link funktioniert dann nicht mehr)"
            aria-label="Anzeige-Link erneuern"
            onClick={async () => {
              if (window.confirm('Neuen Anzeige-Link erzeugen? Geöffnete Beamer-Fenster werden getrennt.')) {
                await api(`/api/runs/${runId}/display-token`, { body: {} }).catch((err) => toast(errorMessage(err), 'error'));
              }
            }}
          >
            <RefreshCw />
          </button>
          {!ended && (
            <button className="btn btn-small btn-danger" onClick={end}>
              <Square /> Beenden
            </button>
          )}
        </div>
      </header>

      <div className="control-grid">
        <aside className="control-slides">
          <ol>
            {view.slides.map((s, i) => (
              <li key={s.id}>
                <button
                  className={`control-slide ${s.id === slide?.id ? 'is-current' : ''}`}
                  onClick={() => command({ action: 'goto', slideId: s.id })}
                  disabled={busy || ended}
                >
                  <span className="slide-num tabular">{i + 1}</span>
                  {s.thumb ? <img className="slide-thumb" src={s.thumb} alt="" loading="lazy" /> : <SlideIcon type={s.type} />}
                  <span className="grow control-slide-title">{s.headline || <em className="faint">ohne Titel</em>}</span>
                  {s.responses > 0 && <span className="pill tabular">{s.responses}</span>}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="control-center">
          <div className="preview-frame">
            <Stage
              // Du siehst die Folie weiter – nur der Beamer ist dunkel (Hinweis unten)
              view={blank ? { ...view.display, blank: null } : view.display}
              offset={offset}
              overlay={
                <>
                  <InkOverlay ink={ink} />
                  <InkInput tool={tool} send={sendInk} />
                  {blank && (
                    <button className={`blank-badge is-${blank}`} onClick={() => command({ action: 'blank', mode: null })}>
                      {blank === 'black' ? 'Beamer schwarz' : 'Beamer weiß'} · zurück mit B, W oder Weiter
                    </button>
                  )}
                </>
              }
            />
          </div>
          <div className="ink-tools" role="toolbar" aria-label="Zeigen und Zeichnen">
            <div className="segmented">
              <button aria-pressed={tool === 'none'} onClick={() => setTool('none')} title="Normal">
                <MousePointer2 size={15} /> Aus
              </button>
              <button aria-pressed={tool === 'pointer'} onClick={() => setTool('pointer')} title="Laserpointer auf dem Beamer">
                <Crosshair size={15} /> Laserpointer
              </button>
              <button aria-pressed={tool === 'pen'} onClick={() => setTool('pen')} title="Auf die Folie zeichnen">
                <PenLine size={15} /> Stift
              </button>
            </div>
            <button className="btn btn-small" onClick={() => sendInk({ type: 'clear' })} disabled={ink.strokes.length === 0}>
              <Eraser /> Zeichnung löschen
            </button>
          </div>
          <div className="control-nav">
            <button
              className="btn btn-large"
              onClick={() => command({ action: 'step', delta: -1 })}
              disabled={busy || (view.slideIndex <= 0 && build === 0)}
              aria-label="Zurück"
            >
              <ChevronLeft />
            </button>
            <span className="control-pos">
              <span className="tabular muted">
                {view.slideIndex + 1} / {view.slideCount}
              </span>
              {builds > 0 && (
                <span className="small faint tabular" title="Aufgedeckte Animationsschritte dieser Folie">
                  Animation {build} / {builds}
                </span>
              )}
            </span>
            <button
              className="btn btn-large btn-ink"
              onClick={() => command({ action: 'step', delta: 1 })}
              disabled={busy || (view.slideIndex >= view.slideCount - 1 && build >= builds)}
              aria-label={build < builds ? 'Nächste Animation' : 'Nächste Folie'}
            >
              Weiter <ChevronRight />
            </button>
          </div>
          <div className="control-toggles">
            <button
              className={`btn btn-small ${view.resultsVisible ? '' : 'btn-ink'}`}
              onClick={() => command({ action: 'results', visible: !view.resultsVisible })}
            >
              {view.resultsVisible ? <EyeOff /> : <Eye />} {view.resultsVisible ? 'Ergebnisse verbergen' : 'Ergebnisse zeigen'}
            </button>
            <button
              className={`btn btn-small ${view.showJoin ? 'btn-ink' : ''}`}
              onClick={() => command({ action: 'join', visible: !view.showJoin })}
            >
              <QrIcon /> {view.showJoin ? 'Beitritt ausblenden' : 'Beitritt einblenden'}
            </button>
            {slide && slide.type !== 'content' && slide.type !== 'image' && (
              <button
                className={`btn btn-small ${view.locked ? 'btn-ink' : ''}`}
                onClick={() => command({ action: 'lock', slideId: slide.id, locked: !view.locked })}
              >
                {view.locked ? <LockOpen /> : <Lock />} {view.locked ? 'Antworten wieder öffnen' : 'Antworten schließen'}
              </button>
            )}
            {view.spotlight && (
              <button className="btn btn-small btn-ink" onClick={() => command({ action: 'spotlight', postId: null })}>
                <X /> Einblendung beenden
              </button>
            )}
            <span className="segmented" role="group" aria-label="Bildschirm abdunkeln">
              <button
                aria-pressed={blank === 'black'}
                onClick={() => command({ action: 'blank', mode: blank === 'black' ? null : 'black' })}
                title="Schwarzbild (Taste B oder .)"
              >
                <Square size={15} fill="currentColor" /> Schwarz
              </button>
              <button
                aria-pressed={blank === 'white'}
                onClick={() => command({ action: 'blank', mode: blank === 'white' ? null : 'white' })}
                title="Weißbild (Taste W oder ,)"
              >
                <Square size={15} /> Weiß
              </button>
            </span>
            <HandoutToggle runId={runId} url={view.handoutUrl} />
          </div>
        </section>

        <aside className="control-panel card">
          {slide && build < builds ? (
            <div className="next-slide">
              <span className="label">Als Nächstes · Animation {build + 1}</span>
              <div className="preview-frame">
                <Stage
                  view={staticPreview(slide, {
                    title: view.run.title,
                    brand: view.run.brand,
                    index: view.slideIndex,
                    count: view.slideCount,
                    code: view.run.code,
                    buildStep: build + 1,
                  })}
                />
              </div>
            </div>
          ) : (
            view.nextSlide && (
              <div className="next-slide">
                <span className="label">Als Nächstes</span>
                <div className="preview-frame">
                  <Stage
                    view={staticPreview(view.nextSlide, {
                      title: view.run.title,
                      brand: view.run.brand,
                      index: view.slideIndex + 1,
                      count: view.slideCount,
                      code: view.run.code,
                      buildStep: 0,
                    })}
                  />
                </div>
              </div>
            )
          )}
          <div className="notes-box">
            <span className="label">Notizen</span>
            {view.notes ? <p className="notes-text">{view.notes}</p> : <p className="small faint">Keine Notizen zu dieser Folie.</p>}
          </div>
          {slide ? <Panel view={view} command={command} busy={busy} /> : <p className="muted">Keine Folie ausgewählt.</p>}
        </aside>
      </div>
    </div>
  );
}

type Cmd = (cmd: HostCommand) => Promise<void>;

function Panel({ view, command, busy }: { view: HostView; command: Cmd; busy: boolean }) {
  const slide = view.slide!;
  const clear = () => {
    if (window.confirm('Alle Antworten dieser Folie in dieser Durchführung löschen?'))
      void command({ action: 'clear-responses', slideId: slide.id });
  };

  switch (slide.type) {
    case 'image':
    case 'content':
      return (
        <div className="stack">
          <h3>{slide.type === 'image' ? 'Folie' : 'Textfolie'}</h3>
          <p className="muted small">Hier gibt es nichts zu steuern. Mit „Weiter“ geht es zur nächsten Folie.</p>
        </div>
      );

    case 'sentence': {
      const s = view.sentence!;
      const words = s.words ?? [];
      const top = topWords(words);
      return (
        <div className="stack">
          <div className="row-between">
            <h3>Runde {s.round}</h3>
            <span className="pill tabular">{view.answers} Wörter</span>
          </div>
          <p className="sentence-preview">{s.text}</p>
          {s.done ? (
            <button className="btn" onClick={() => command({ action: 'sentence-done', slideId: slide.id, done: false })}>
              <RotateCcw /> Weiterschreiben
            </button>
          ) : (
            <>
              <button
                className={`btn ${s.revealed ? '' : 'btn-primary'}`}
                onClick={() => command({ action: 'sentence-reveal', slideId: slide.id, revealed: !s.revealed })}
                disabled={busy}
              >
                {s.revealed ? <EyeOff /> : <Eye />} {s.revealed ? 'Antworten ausblenden' : 'Antworten einblenden'}
              </button>
              {top.length > 0 && (
                <div className="stack-s">
                  <span className="label">{top.length > 1 ? 'Gleichstand – wähle ein Wort' : 'Häufigstes Wort'}</span>
                  <div className="row">
                    {top.map((w) => (
                      <button
                        key={w.key}
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => command({ action: 'sentence-append', slideId: slide.id, word: w.word })}
                      >
                        „{w.word}“ anhängen
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {words.length > 0 && (
                <ul className="word-table">
                  {words.slice(0, 30).map((w) => (
                    <li key={w.key}>
                      <span className="grow">{w.word}</span>
                      <span className="tabular faint">{w.count}×</span>
                      <button
                        className="btn btn-small btn-ghost"
                        disabled={busy}
                        onClick={() => command({ action: 'sentence-append', slideId: slide.id, word: w.word })}
                      >
                        anhängen
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <AppendOwn onAppend={(word) => command({ action: 'sentence-append', slideId: slide.id, word })} />
            </>
          )}
          <div className="row panel-footer">
            <button
              className="btn btn-small"
              disabled={busy || s.text === ''}
              onClick={() => command({ action: 'sentence-undo', slideId: slide.id })}
            >
              <Undo2 /> Letztes Wort zurück
            </button>
            {!s.done && (
              <button className="btn btn-small" onClick={() => command({ action: 'sentence-done', slideId: slide.id, done: true })}>
                <Check /> Satz fertig
              </button>
            )}
            <button
              className="btn btn-small btn-danger"
              onClick={() =>
                window.confirm('Satz auf den Anfang zurücksetzen?') && command({ action: 'sentence-reset', slideId: slide.id })
              }
            >
              <RotateCcw /> Neu beginnen
            </button>
          </div>
        </div>
      );
    }

    case 'quiz': {
      const q = view.quiz!;
      return (
        <div className="stack">
          <div className="row-between">
            <h3>Quiz</h3>
            <span className="pill tabular">{view.answers} Antworten</span>
          </div>
          <div className="row">
            {q.phase === 'ready' && (
              <button className="btn btn-primary" onClick={() => command({ action: 'quiz-start', slideId: slide.id })} disabled={busy}>
                <Play /> Frage starten ({slide.config.timeLimit} s)
              </button>
            )}
            {q.phase === 'open' && (
              <button className="btn" onClick={() => command({ action: 'quiz-close', slideId: slide.id })} disabled={busy}>
                <Square /> Zeit stoppen
              </button>
            )}
            {q.phase === 'closed' && !q.revealed && (
              <button className="btn btn-primary" onClick={() => command({ action: 'quiz-reveal', slideId: slide.id })} disabled={busy}>
                <Check /> Auflösen
              </button>
            )}
            {q.revealed && (
              <button
                className={`btn ${view.state.leaderboard ? 'btn-ink' : 'btn-primary'}`}
                onClick={() => command({ action: 'leaderboard', visible: !view.state.leaderboard })}
              >
                <Trophy /> {view.state.leaderboard ? 'Rangliste ausblenden' : 'Rangliste zeigen'}
              </button>
            )}
          </div>
          {view.results && <SlideResultsView slide={slide} results={view.results} />}
          <Leaderboard view={view} />
          <div className="row panel-footer">
            <button
              className="btn btn-small btn-danger"
              onClick={() =>
                window.confirm('Quizfrage zurücksetzen und alle Antworten dazu löschen?') &&
                command({ action: 'clear-responses', slideId: slide.id })
              }
            >
              <RotateCcw /> Frage zurücksetzen
            </button>
          </div>
        </div>
      );
    }

    case 'qa':
    case 'brainstorm':
    case 'pinboard':
    case 'open':
      return <PostPanel view={view} command={command} onClear={clear} />;

    default:
      return (
        <div className="stack">
          <div className="row-between">
            <h3>Ergebnisse</h3>
            <span className="pill tabular">{view.answers} Antworten</span>
          </div>
          {view.results && view.answers > 0 ? (
            <SlideResultsView slide={slide} results={view.results} />
          ) : (
            <p className="muted small">Noch keine Antworten.</p>
          )}
          <div className="row panel-footer">
            <button className="btn btn-small btn-danger" onClick={clear} disabled={view.answers === 0}>
              <MessageSquareOff /> Antworten löschen
            </button>
          </div>
        </div>
      );
  }
}

function AppendOwn({ onAppend }: { onAppend: (word: string) => void }) {
  const [word, setWord] = useState('');
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (word.trim()) {
          onAppend(word.trim());
          setWord('');
        }
      }}
    >
      <input
        className="input grow"
        placeholder="Eigenes Wort oder Satzzeichen"
        value={word}
        onChange={(e) => setWord(e.target.value)}
        maxLength={60}
      />
      <button className="btn" disabled={!word.trim()}>
        Anhängen
      </button>
    </form>
  );
}

function Leaderboard({ view }: { view: HostView }) {
  if (view.leaderboard.length === 0) return null;
  return (
    <div className="stack-s">
      <span className="label">Rangliste ({view.leaderboard.length})</span>
      <ol className="word-table">
        {view.leaderboard.slice(0, 10).map((e) => (
          <li key={e.participantId}>
            <span className="tabular faint" style={{ minWidth: '2ch' }}>
              {e.rank}.
            </span>
            <span className="grow">{e.name}</span>
            <span className="tabular">{e.points.toLocaleString('de-DE')}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PostPanel({ view, command, onClear }: { view: HostView; command: Cmd; onClear: () => void }) {
  const slide = view.slide!;
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const pending = view.posts.filter((p) => p.status === 'pending');
  const visible = view.posts.filter((p) => p.status === 'visible');
  const rest = view.posts.filter((p) => p.status === 'answered' || p.status === 'hidden');
  const columns = slide.type === 'pinboard' ? slide.config.columns : null;

  return (
    <div className="stack">
      <div className="row-between">
        <h3>{slide.type === 'qa' ? 'Fragen' : 'Beiträge'}</h3>
        <div className="segmented">
          <button aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>
            Aktuell
          </button>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            Alle ({view.posts.length})
          </button>
        </div>
      </div>
      {view.posts.length === 0 && <p className="muted small">Noch keine Beiträge.</p>}

      {pending.length > 0 && (
        <div className="stack-s">
          <span className="label">Warten auf Freigabe ({pending.length})</span>
          <ul className="mod-list">
            {pending.map((p) => (
              <ModItem key={p.id} post={p} command={command} spotlight={view.state.spotlight} columns={columns} />
            ))}
          </ul>
        </div>
      )}
      {visible.length > 0 && (
        <div className="stack-s">
          <span className="label">Sichtbar ({visible.length})</span>
          <ul className="mod-list">
            {visible.map((p) => (
              <ModItem key={p.id} post={p} command={command} spotlight={view.state.spotlight} columns={columns} qa={slide.type === 'qa'} />
            ))}
          </ul>
        </div>
      )}
      {filter === 'all' && rest.length > 0 && (
        <div className="stack-s">
          <span className="label">Beantwortet & ausgeblendet ({rest.length})</span>
          <ul className="mod-list">
            {rest.map((p) => (
              <ModItem key={p.id} post={p} command={command} spotlight={view.state.spotlight} columns={columns} />
            ))}
          </ul>
        </div>
      )}
      <div className="row panel-footer">
        <button className="btn btn-small btn-danger" onClick={onClear} disabled={view.posts.length === 0}>
          <MessageSquareOff /> Alle löschen
        </button>
      </div>
    </div>
  );
}

function ModItem({
  post,
  command,
  spotlight,
  columns,
  qa,
}: {
  post: PostView;
  command: Cmd;
  spotlight: number | null;
  columns: string[] | null;
  qa?: boolean;
}) {
  const isSpot = spotlight === post.id;
  return (
    <li className={`mod-item ${isSpot ? 'is-spot' : ''} ${post.status === 'hidden' ? 'is-hidden' : ''}`}>
      <div className="mod-text">
        <span>{post.text}</span>
        <span className="post-meta">
          {post.authorName && <span>{post.authorName}</span>}
          {columns && post.column !== null && <span className="pill">{columns[post.column]}</span>}
          {post.votes > 0 && (
            <span className="pill">
              <ChevronUp /> {post.votes}
            </span>
          )}
          {post.status === 'answered' && <span className="pill pill-good">beantwortet</span>}
          {post.status === 'hidden' && <span className="pill">ausgeblendet</span>}
        </span>
      </div>
      <div className="mod-actions">
        {post.status === 'pending' && (
          <button
            className="btn btn-small btn-primary"
            onClick={() => command({ action: 'post-status', postId: post.id, status: 'visible' })}
          >
            <Check /> Freigeben
          </button>
        )}
        {post.status === 'visible' && (
          <button
            className={`btn btn-small ${isSpot ? 'btn-ink' : ''}`}
            onClick={() => command({ action: 'spotlight', postId: isSpot ? null : post.id })}
          >
            <Maximize2 /> {isSpot ? 'Groß aus' : 'Groß zeigen'}
          </button>
        )}
        {qa && post.status === 'visible' && (
          <button
            className="btn btn-small"
            title="Als beantwortet markieren – verschwindet auch aus dem Großformat"
            onClick={() => command({ action: 'post-status', postId: post.id, status: 'answered' })}
          >
            <Check /> Beantwortet
          </button>
        )}
        {post.status !== 'hidden' ? (
          <button
            className="icon-btn"
            title="Ausblenden"
            aria-label="Ausblenden"
            onClick={() => command({ action: 'post-status', postId: post.id, status: 'hidden' })}
          >
            <EyeOff />
          </button>
        ) : (
          <button
            className="icon-btn"
            title="Wieder zeigen"
            aria-label="Wieder zeigen"
            onClick={() => command({ action: 'post-status', postId: post.id, status: 'visible' })}
          >
            <Eye />
          </button>
        )}
      </div>
    </li>
  );
}

/** Vortragsdauer, Ziel-Dauer und Uhrzeit für die Referentenansicht. */
function PresenterClock({ view, offset, onReset }: { view: HostView; offset: number; onReset: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const start = view.state.timerStartedAt ?? view.startedAt;
  const elapsed = Math.max(0, now + offset - start);
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  const over = view.targetMinutes !== null && elapsed > view.targetMinutes * 60000;
  return (
    <span className={`presenter-clock ${over ? 'is-over' : ''}`}>
      <button
        className="clock-timer tabular"
        onClick={() => window.confirm('Vortragszeit auf 0 setzen?') && onReset()}
        title="Vortragszeit – klicken zum Zurücksetzen"
      >
        <Timer size={15} />
        {minutes}:{String(seconds).padStart(2, '0')}
        {view.targetMinutes !== null && <span className="faint"> / {view.targetMinutes}:00</span>}
      </button>
      <span className="clock-now tabular" title="Uhrzeit">
        {new Date(now).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </span>
  );
}

/** Folien und Ergebnisse für Teilnehmende freigeben. */
function HandoutToggle({ runId, url }: { runId: number; url: string | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api(`/api/runs/${runId}/handout`, { body: { enabled: !url } });
      toast(url ? 'Freigabe zurückgezogen' : 'Folien und Ergebnisse freigegeben');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row" style={{ gap: 4 }}>
      <button
        className={`btn btn-small ${url ? 'btn-ink' : ''}`}
        onClick={toggle}
        disabled={busy}
        title="Folien und zusammengefasste Ergebnisse für Teilnehmende"
      >
        <Share2 /> {url ? 'Freigabe zurückziehen' : 'Folien freigeben'}
      </button>
      {url && (
        <a className="icon-btn" href={url} target="_blank" rel="noopener" title="Freigabe ansehen" aria-label="Freigabe ansehen">
          <ExternalLink />
        </a>
      )}
    </span>
  );
}
