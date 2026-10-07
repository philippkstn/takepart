import { assetUrl, SLIDE_TYPE_LABELS, type DisplayView, type PostView, type PublicSlide } from '@slides/shared';
import { ChevronUp, EyeOff, MessageCircleQuestion, Trophy, Users } from 'lucide-react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { brandStyle } from '../lib/brand.ts';
import { useCountdown } from '../lib/live.ts';
import { SlideResultsView } from './Results.tsx';
import { SentenceStage } from './SentenceStage.tsx';
import { formatCode, joinHost, joinUrl, QrCode } from './ui.tsx';
import './stage.css';

/**
 * Die Bühne: zeigt eine Folie so, wie sie auf dem Beamer bzw. im geteilten
 * Bildschirm erscheint. Alle Maße in em, die Schriftgröße folgt der Fläche
 * (Container Query), damit die Vorschau im Steuerpult genauso aussieht.
 */
export function Stage({ view, offset = 0, overlay }: { view: DisplayView; offset?: number; overlay?: ReactNode }) {
  const slide = view.slide;
  // Importierte Folien laufen randlos, ohne Kopfzeile – wie in PowerPoint.
  const image = !view.leaderboard && slide?.type === 'image' ? slide : null;
  // Verdeckte Fenster bekommen keine Animationsframes – dort ohne Übergang
  // umschalten, damit eine Folie nie unsichtbar mitten im Einblenden hängt.
  const visible = usePageVisible();
  const slideKey = view.leaderboard ? 'leaderboard' : `slide-${slide?.id ?? 'none'}`;
  const content = view.leaderboard ? (
    <LeaderboardStage view={view} />
  ) : slide ? (
    <SlideStage view={view} slide={slide} offset={offset} />
  ) : (
    <div className="stage-empty">Noch keine Folie</div>
  );
  return (
    <MotionConfig reducedMotion="user">
      <div className="stage" style={brandStyle(view.run.brand)}>
        <div className="stage-inner">
          {image ? (
            <ImageStage key="image" slide={image} animate={visible} />
          ) : (
            <>
              <header className="stage-top">
                {view.run.brand?.logoUrl && <img className="stage-logo" src={view.run.brand.logoUrl} alt={view.run.brand.name} />}
                <span className="stage-stats">
                  <span title="Verbunden">
                    <Users /> <span className="tabular">{view.participants}</span>
                  </span>
                </span>
              </header>

              <main className="stage-main">
                {visible ? (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={slideKey}
                      className="stage-slide"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      {content}
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  <div key={slideKey} className="stage-slide">
                    {content}
                  </div>
                )}
              </main>
            </>
          )}

          <AnimatePresence>
            {view.spotlight && (
              <motion.div
                className="spotlight"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <motion.div
                  className="spotlight-card"
                  initial={{ scale: 0.94, y: 16 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {slide?.type === 'qa' && (
                    <span className="spotlight-kicker">
                      <MessageCircleQuestion /> Frage
                    </span>
                  )}
                  <p className="spotlight-text">{view.spotlight.text}</p>
                  <div className="spotlight-meta">
                    {view.spotlight.authorName && <span>{view.spotlight.authorName}</span>}
                    {view.spotlight.votes > 0 && (
                      <span className="stage-pill">
                        <ChevronUp /> {view.spotlight.votes}
                      </span>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {view.showJoin && view.run.code && (
              <motion.div className="join-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <JoinPanel code={view.run.code} />
              </motion.div>
            )}
          </AnimatePresence>
          {overlay}
        </div>
      </div>
    </MotionConfig>
  );
}

/** Importierte Folie: Bild im 16:9-Rahmen, Folienwechsel als kurze Überblendung. */
function ImageStage({ slide, animate }: { slide: Extract<PublicSlide, { type: 'image' }>; animate: boolean }) {
  const src = assetUrl(slide.config.asset);
  const alt = slide.config.title || 'Folie';
  return (
    <div className="stage-image">
      {animate ? (
        <AnimatePresence initial={false}>
          <motion.img
            key={slide.id}
            src={src}
            alt={alt}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        </AnimatePresence>
      ) : (
        <img key={slide.id} src={src} alt={alt} />
      )}
    </div>
  );
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

function JoinPanel({ code }: { code: string }) {
  return (
    <div className="join-panel">
      <div className="join-qr">
        <QrCode text={joinUrl(code)} className="join-qr-svg" />
      </div>
      <div className="join-text">
        <span className="join-step">Gehe auf</span>
        <span className="join-host">{joinHost()}</span>
        <span className="join-step">und gib den Code ein</span>
        <span className="join-code tabular">{formatCode(code)}</span>
      </div>
    </div>
  );
}

function Headline({ kicker, text }: { kicker: string; text: string }) {
  return (
    <div className="stage-head">
      <span className="stage-kicker">{kicker}</span>
      {text && <h1 className="stage-title">{text}</h1>}
    </div>
  );
}

function HiddenResults({ answers }: { answers: number }) {
  return (
    <div className="stage-waiting">
      <EyeOff />
      <span>
        <strong className="tabular">{answers}</strong> {answers === 1 ? 'Antwort' : 'Antworten'} – Ergebnisse folgen
      </span>
    </div>
  );
}

function AnswerCount({ answers }: { answers: number }) {
  return (
    <span className="stage-pill">
      <span className="tabular">{answers}</span> {answers === 1 ? 'Antwort' : 'Antworten'}
    </span>
  );
}

function SlideStage({ view, slide, offset }: { view: DisplayView; slide: PublicSlide; offset: number }) {
  const label = SLIDE_TYPE_LABELS[slide.type];
  switch (slide.type) {
    case 'content':
      return (
        <div className={`stage-content ${slide.config.showJoin && view.run.code ? 'with-join' : ''}`}>
          <div className="stack-l">
            {slide.config.title && <h1 className="stage-title stage-title-xl">{slide.config.title}</h1>}
            {slide.config.body && <p className="stage-body">{slide.config.body}</p>}
          </div>
          {slide.config.showJoin && view.run.code && <JoinPanel code={view.run.code} />}
        </div>
      );

    case 'sentence':
      return <SentenceStage slideId={slide.id} sentence={view.sentence!} answers={view.answers} />;

    case 'quiz':
      return <QuizStage view={view} slide={slide} offset={offset} />;

    case 'qa':
      return (
        <>
          <div className="row-between">
            <Headline kicker="Fragen & Antworten" text={slide.config.title} />
          </div>
          {view.posts.length === 0 ? (
            <div className="stage-waiting">
              <MessageCircleQuestion /> <span>Noch keine Fragen – stellt sie gern über euer Handy</span>
            </div>
          ) : (
            <PostGrid posts={view.posts.filter((p) => p.status !== 'answered').slice(0, 8)} layout="list" showVotes />
          )}
        </>
      );

    case 'open':
    case 'brainstorm':
      return (
        <>
          <div className="row-between stage-head-row">
            <Headline kicker={label} text={slide.config.question} />
            <AnswerCount answers={view.answers} />
          </div>
          {!view.resultsVisible ? (
            <HiddenResults answers={view.answers} />
          ) : (
            <PostGrid posts={view.posts.slice(0, 30)} layout="cards" showVotes={slide.type === 'brainstorm' && slide.config.allowVotes} />
          )}
        </>
      );

    case 'pinboard':
      return (
        <>
          <div className="row-between stage-head-row">
            <Headline kicker="Pinnwand" text={slide.config.title} />
            <AnswerCount answers={view.answers} />
          </div>
          {!view.resultsVisible ? (
            <HiddenResults answers={view.answers} />
          ) : (
            <div className="pinboard" style={{ gridTemplateColumns: `repeat(${slide.config.columns.length}, minmax(0, 1fr))` }}>
              {slide.config.columns.map((c, i) => (
                <section key={i} className="pinboard-col">
                  <h2 className="pinboard-title">{c}</h2>
                  <PostGrid posts={view.posts.filter((p) => (p.column ?? 0) === i)} layout="list" />
                </section>
              ))}
            </div>
          )}
        </>
      );

    default: {
      const question = 'question' in slide.config ? slide.config.question : '';
      return (
        <>
          <div className="row-between stage-head-row">
            <Headline kicker={label} text={question} />
            <AnswerCount answers={view.answers} />
          </div>
          <div className="stage-results">
            {view.results ? (
              <SlideResultsView slide={slide} results={view.results} maxComments={3} />
            ) : (
              <HiddenResults answers={view.answers} />
            )}
          </div>
        </>
      );
    }
  }
}

function QuizStage({ view, slide, offset }: { view: DisplayView; slide: Extract<PublicSlide, { type: 'quiz' }>; offset: number }) {
  const quiz = view.quiz!;
  const remaining = useCountdown(quiz.phase === 'open' ? quiz.closesAt : null, offset);
  const limit = slide.config.timeLimit * 1000;
  return (
    <>
      <div className="row-between stage-head-row">
        <Headline kicker="Quizfrage" text={slide.config.question} />
        {quiz.phase === 'open' && remaining !== null ? (
          <div className="quiz-timer" style={{ ['--p' as string]: `${(remaining / limit) * 360}deg` }}>
            <span className="tabular">{Math.ceil(remaining / 1000)}</span>
          </div>
        ) : (
          <AnswerCount answers={view.answers} />
        )}
      </div>
      <div className="stage-results">
        {view.results ? (
          <SlideResultsView slide={slide} results={view.results} />
        ) : (
          <ol className="quiz-options">
            {slide.config.options.map((o, i) => (
              <li key={i}>
                <span className="quiz-letter">{'ABCDEF'[i]}</span>
                {o}
              </li>
            ))}
          </ol>
        )}
      </div>
      {quiz.phase === 'open' && (
        <div className="stage-footer-note">
          <strong className="tabular">{view.answers}</strong> {view.answers === 1 ? 'Antwort' : 'Antworten'}
        </div>
      )}
    </>
  );
}

function PostGrid({ posts, layout, showVotes = false }: { posts: PostView[]; layout: 'cards' | 'list'; showVotes?: boolean }) {
  return (
    <LayoutGroup>
      <ul className={layout === 'cards' ? 'post-cards' : 'post-rows'}>
        <AnimatePresence initial={false}>
          {posts.map((p) => (
            <motion.li
              key={p.id}
              layout
              className="stage-post"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <span className="stage-post-text">{p.text}</span>
              {(p.authorName || (showVotes && p.votes > 0)) && (
                <span className="stage-post-meta">
                  {p.authorName && <span>{p.authorName}</span>}
                  {showVotes && p.votes > 0 && (
                    <span className="stage-pill">
                      <ChevronUp /> <span className="tabular">{p.votes}</span>
                    </span>
                  )}
                </span>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </LayoutGroup>
  );
}

function LeaderboardStage({ view }: { view: DisplayView }) {
  const board = view.leaderboard ?? [];
  const max = Math.max(1, ...board.map((e) => e.points));
  return (
    <>
      <Headline kicker="Quiz" text="Rangliste" />
      {board.length === 0 ? (
        <div className="stage-waiting">
          <Trophy /> <span>Noch keine Punkte</span>
        </div>
      ) : (
        <ol className="leaderboard">
          {board.map((e) => (
            <li key={e.participantId} className={e.rank === 1 ? 'is-first' : ''}>
              <span className="lb-rank tabular">{e.rank}</span>
              <span className="lb-name">{e.name}</span>
              <span className="lb-bar">
                <span style={{ width: `${(e.points / max) * 100}%` }} />
              </span>
              <span className="lb-points tabular">{e.points.toLocaleString('de-DE')}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
