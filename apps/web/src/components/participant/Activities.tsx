import { assetUrl, type ParticipantView, type PostView, type PublicSlide, type ResponsePayloads } from '@slides/shared';
import { Check, ChevronUp, Clock, Hourglass, Lock, MessageCircleQuestion, RotateCcw, Send, Star, Trophy } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { useCountdown } from '../../lib/live.ts';
import { BuildLayer } from '../BuildLayer.tsx';
import { useToast } from '../ui.tsx';

type Slide<T extends PublicSlide['type']> = Extract<PublicSlide, { type: T }>;
interface Props<T extends PublicSlide['type']> {
  view: ParticipantView;
  slide: Slide<T>;
  token: string;
}

const LETTERS = 'ABCDEFGHIJ';

/** Ruft die API als Teilnehmer*in auf und zeigt Fehler als Toast. */
function useSend(token: string) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const send = async (path: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      await api(path, { body, participant: token });
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { send, busy };
}

function Done({ children, onChange }: { children: ReactNode; onChange?: () => void }) {
  return (
    <div className="done-box">
      <span className="check">
        <Check />
      </span>
      <div className="grow">{children}</div>
      {onChange && (
        <button className="btn btn-small" onClick={onChange}>
          Ändern
        </button>
      )}
    </div>
  );
}

function Info({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="info-box">
      {icon}
      <div>{children}</div>
    </div>
  );
}

function Question({ kicker, text }: { kicker: string; text: string }) {
  return (
    <div className="stack-s anim-rise">
      <span className="p-kicker">{kicker}</span>
      {text && <h1 className="p-question">{text}</h1>}
    </div>
  );
}

function LockedNote() {
  return <Info icon={<Lock size={20} />}>Die Abstimmung ist geschlossen.</Info>;
}

/** Fragt einmalig den Namen ab (für Q&A und Quiz). */
function NameGate({ view, token, reason, children }: { view: ParticipantView; token: string; reason: string; children: ReactNode }) {
  const [name, setName] = useState('');
  const { send, busy } = useSend(token);
  if (view.name) return <>{children}</>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await send('/api/p/name', { name });
  };
  return (
    <form className="card card-pad stack anim-rise" onSubmit={submit}>
      <div className="stack-s">
        <h2>Wie heißt du?</h2>
        <p className="muted">{reason}</p>
      </div>
      <input
        className="input input-large"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        autoFocus
        placeholder="Dein Name"
      />
      <button className="btn btn-primary btn-large" disabled={busy || name.trim().length < 2}>
        Weiter
      </button>
    </form>
  );
}

/* ───────────── Aktivitäten ───────────── */

/** Importierte Folie zum Mitlesen; antippen öffnet sie groß zum Zoomen. */
function ImageSlide({ slide, step }: { slide: Slide<'image'>; step: number }) {
  // Ohne Bildkennung hat die Vortragende das Mitlesen ausgeschaltet.
  if (!slide.config.asset) return <Info icon={<Hourglass size={20} />}>Schau auf die Präsentation – gleich geht es weiter.</Info>;
  const src = assetUrl(slide.config.asset);
  // Noch nicht aufgedeckte Elemente bleiben auch hier verdeckt (ohne Animation)
  return (
    <div className="p-slide anim-rise">
      <img src={src} alt={slide.config.title || 'Aktuelle Folie'} width={slide.config.width} height={slide.config.height} />
      <BuildLayer builds={slide.config.builds} step={step} image={src} animate={false} slideId={slide.id} />
    </div>
  );
}

function Content({ slide }: { slide: Slide<'content'> }) {
  return (
    <div className="stack anim-rise">
      {slide.config.title && <h1 className="p-question">{slide.config.title}</h1>}
      {slide.config.body && (
        <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>
          {slide.config.body}
        </p>
      )}
      <Info icon={<Hourglass size={20} />}>Bleib dran – gleich geht es weiter.</Info>
    </div>
  );
}

function Choice({ view, slide, token }: Props<'choice'>) {
  const own = view.response as ResponsePayloads['choice'] | null;
  const [selected, setSelected] = useState<number[]>(own?.choices ?? []);
  const [editing, setEditing] = useState(!own);
  const { send, busy } = useSend(token);
  const { options, multiple } = slide.config;

  const toggle = (i: number) => setSelected((s) => (multiple ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i]));
  const submit = async () => {
    if (await send('/api/p/respond', { slideId: slide.id, payload: { choices: selected } })) setEditing(false);
  };

  return (
    <div className="stack">
      <Question kicker={multiple ? 'Mehrere Antworten möglich' : 'Eine Antwort wählen'} text={slide.config.question} />
      {own && !editing ? (
        <Done onChange={view.locked ? undefined : () => setEditing(true)}>
          <strong>Danke!</strong>
          <div className="small muted">{own.choices.map((i) => options[i]).join(', ')}</div>
        </Done>
      ) : view.locked ? (
        <LockedNote />
      ) : (
        <>
          <div className="options" role={multiple ? 'group' : 'radiogroup'}>
            {options.map((option, i) => (
              <button
                key={i}
                className="option"
                role={multiple ? 'checkbox' : 'radio'}
                aria-checked={selected.includes(i)}
                onClick={() => toggle(i)}
              >
                <span className="option-key">{multiple && selected.includes(i) ? <Check size={16} /> : LETTERS[i]}</span>
                {option}
              </button>
            ))}
          </div>
          <button className="btn btn-primary btn-large" onClick={submit} disabled={busy || selected.length === 0}>
            Abschicken <Send />
          </button>
        </>
      )}
    </div>
  );
}

function Scale({ view, slide, token }: Props<'scale'>) {
  const own = view.response as ResponsePayloads['scale'] | null;
  const [value, setValue] = useState<number | null>(own?.value ?? null);
  const [editing, setEditing] = useState(!own);
  const { send, busy } = useSend(token);
  const { max, minLabel, maxLabel } = slide.config;
  const submit = async () => {
    if (await send('/api/p/respond', { slideId: slide.id, payload: { value } })) setEditing(false);
  };
  return (
    <div className="stack">
      <Question kicker={`Skala 1–${max}`} text={slide.config.question} />
      {own && !editing ? (
        <Done onChange={view.locked ? undefined : () => setEditing(true)}>
          <strong>Danke!</strong> <span className="muted">Deine Bewertung: {own.value}</span>
        </Done>
      ) : view.locked ? (
        <LockedNote />
      ) : (
        <>
          <div className="scale-buttons" style={{ gridTemplateColumns: `repeat(${max <= 5 ? max : Math.ceil(max / 2)}, 1fr)` }}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <button key={n} aria-pressed={value === n} onClick={() => setValue(n)}>
                {n}
              </button>
            ))}
          </div>
          <div className="row-between small faint">
            <span>1 = {minLabel}</span>
            <span>
              {max} = {maxLabel}
            </span>
          </div>
          <button className="btn btn-primary btn-large" onClick={submit} disabled={busy || value === null}>
            Abschicken <Send />
          </button>
        </>
      )}
    </div>
  );
}

function Wordcloud({ view, slide, token }: Props<'wordcloud'>) {
  const own = view.response as ResponsePayloads['wordcloud'] | null;
  const n = slide.config.maxWords;
  const [words, setWords] = useState<string[]>(() => Array.from({ length: n }, (_, i) => own?.words[i] ?? ''));
  const [editing, setEditing] = useState(!own);
  const { send, busy } = useSend(token);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await send('/api/p/respond', { slideId: slide.id, payload: { words: words.filter((w) => w.trim()) } })) setEditing(false);
  };
  return (
    <div className="stack">
      <Question kicker={n === 1 ? 'Ein Begriff' : `Bis zu ${n} Begriffe`} text={slide.config.question} />
      {own && !editing ? (
        <Done onChange={view.locked ? undefined : () => setEditing(true)}>
          <strong>Danke!</strong> <span className="muted">{own.words.join(', ')}</span>
        </Done>
      ) : view.locked ? (
        <LockedNote />
      ) : (
        <form className="compose" onSubmit={submit}>
          {words.map((w, i) => (
            <input
              key={i}
              className="input input-large"
              value={w}
              maxLength={40}
              placeholder={n === 1 ? 'Dein Begriff' : `Begriff ${i + 1}`}
              onChange={(e) => setWords((ws) => ws.map((x, j) => (j === i ? e.target.value : x)))}
              autoFocus={i === 0}
            />
          ))}
          <button className="btn btn-primary btn-large" disabled={busy || words.every((w) => !w.trim())}>
            Abschicken <Send />
          </button>
        </form>
      )}
    </div>
  );
}

function Ranking({ view, slide, token }: Props<'ranking'>) {
  const own = view.response as ResponsePayloads['ranking'] | null;
  const [order, setOrder] = useState<number[]>(own?.order ?? []);
  const [editing, setEditing] = useState(!own);
  const { send, busy } = useSend(token);
  const { options } = slide.config;
  const toggle = (i: number) => setOrder((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]));
  const submit = async () => {
    if (await send('/api/p/respond', { slideId: slide.id, payload: { order } })) setEditing(false);
  };
  return (
    <div className="stack">
      <Question kicker="In Reihenfolge antippen – Wichtigstes zuerst" text={slide.config.question} />
      {own && !editing ? (
        <Done onChange={view.locked ? undefined : () => setEditing(true)}>
          <strong>Danke!</strong>
          <ol className="small muted" style={{ margin: '4px 0 0', paddingLeft: '1.2em' }}>
            {own.order.map((i) => (
              <li key={i}>{options[i]}</li>
            ))}
          </ol>
        </Done>
      ) : view.locked ? (
        <LockedNote />
      ) : (
        <>
          <div className="options">
            {options.map((option, i) => {
              const place = order.indexOf(i);
              return (
                <button key={i} className="option" aria-pressed={place >= 0} onClick={() => toggle(i)}>
                  <span className="option-key tabular">{place >= 0 ? place + 1 : ''}</span>
                  {option}
                </button>
              );
            })}
          </div>
          <div className="row">
            <button className="btn btn-primary btn-large grow" onClick={submit} disabled={busy || order.length !== options.length}>
              Abschicken <Send />
            </button>
            <button className="btn btn-large" onClick={() => setOrder([])} disabled={order.length === 0} aria-label="Zurücksetzen">
              <RotateCcw />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Quiz({ view, slide, token }: Props<'quiz'>) {
  const quiz = view.quiz!;
  const own = view.response as { choice: number } | null;
  const { send, busy } = useSend(token);
  const [offset] = useState(() => view.serverTime - Date.now());
  const remaining = useCountdown(quiz.phase === 'open' ? quiz.closesAt : null, offset);
  const { options, timeLimit } = slide.config;
  const correct = slide.config.correct;

  const answer = (i: number) => send('/api/p/respond', { slideId: slide.id, payload: { choice: i } });

  return (
    <NameGate view={view} token={token} reason="Für die Rangliste beim Quiz brauchen wir einen Namen.">
      <div className="stack">
        <Question kicker="Quizfrage" text={slide.config.question} />
        {quiz.phase === 'ready' && <Info icon={<Hourglass size={20} />}>Gleich geht es los – die Zeit läuft ab dem Start.</Info>}
        {quiz.phase === 'open' && remaining !== null && (
          <div className="countdown" aria-live="off">
            <div className="countdown-bar">
              <div style={{ width: `${(remaining / (timeLimit * 1000)) * 100}%` }} />
            </div>
            <span className="countdown-num tabular">{Math.ceil(remaining / 1000)}</span>
          </div>
        )}
        {(quiz.phase !== 'ready' || own) && (
          <div className="options">
            {options.map((option, i) => {
              const isCorrect = quiz.revealed && correct?.includes(i);
              return (
                <button
                  key={i}
                  className={`option ${isCorrect ? 'correct' : ''}`}
                  aria-pressed={own?.choice === i}
                  disabled={busy || !!own || quiz.phase !== 'open'}
                  onClick={() => answer(i)}
                >
                  <span className="option-key">{isCorrect ? <Check size={16} /> : LETTERS[i]}</span>
                  {option}
                </button>
              );
            })}
          </div>
        )}
        {own && !quiz.revealed && <Done>Antwort gespeichert – warte auf die Auflösung.</Done>}
        {!own && quiz.phase === 'closed' && <Info icon={<Clock size={20} />}>Die Zeit ist abgelaufen.</Info>}
        {quiz.revealed && own && (
          <div className="big-result anim-pop">
            <span className="num tabular">+{view.quizPoints ?? 0}</span>
            <span className="muted">{(view.quizPoints ?? 0) > 0 ? 'Richtig!' : 'Leider falsch'}</span>
          </div>
        )}
      </div>
    </NameGate>
  );
}

function Feedback({ view, slide, token }: Props<'feedback'>) {
  const own = view.response as ResponsePayloads['feedback'] | null;
  const [rating, setRating] = useState(own?.rating ?? 0);
  const [comment, setComment] = useState(own?.comment ?? '');
  const [editing, setEditing] = useState(!own);
  const { send, busy } = useSend(token);
  const submit = async () => {
    if (await send('/api/p/respond', { slideId: slide.id, payload: { rating, comment } })) setEditing(false);
  };
  return (
    <div className="stack">
      <Question kicker="Feedback" text={slide.config.question} />
      {own && !editing ? (
        <Done onChange={view.locked ? undefined : () => setEditing(true)}>
          <strong>Danke für dein Feedback!</strong>
        </Done>
      ) : view.locked ? (
        <LockedNote />
      ) : (
        <>
          <div className="star-input" role="radiogroup" aria-label="Bewertung">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                role="radio"
                aria-checked={rating === i}
                aria-label={`${i} Sterne`}
                className={rating >= i ? 'on' : ''}
                onClick={() => setRating(i)}
              >
                <Star />
              </button>
            ))}
          </div>
          {slide.config.withComment && (
            <textarea
              className="textarea"
              placeholder="Was möchtest du noch loswerden? (optional)"
              value={comment}
              maxLength={500}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
          <button className="btn btn-primary btn-large" onClick={submit} disabled={busy || rating === 0}>
            Abschicken <Send />
          </button>
        </>
      )}
    </div>
  );
}

function Sentence({ view, slide, token }: Props<'sentence'>) {
  const s = view.sentence!;
  const own = view.response as ResponsePayloads['sentence'] | null;
  const [word, setWord] = useState('');
  const { send, busy } = useSend(token);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await send('/api/p/respond', { slideId: slide.id, payload: { word } })) setWord('');
  };
  return (
    <div className="stack">
      <span className="p-kicker">{s.done ? 'Fertiger Satz' : `Runde ${s.round} · Welches Wort kommt als Nächstes?`}</span>
      <p className="sentence-text anim-rise">
        {s.text}
        {!s.done && <span className="gap">&nbsp;</span>}
      </p>
      {s.done ? (
        <Info icon={<Check size={20} />}>Der Satz ist fertig. Danke!</Info>
      ) : own ? (
        <Done>
          Dein Wort: <strong>{own.word}</strong>
          <div className="small muted">{s.revealed ? 'Die Runde wird gerade ausgewertet …' : 'Warte auf die Auswertung.'}</div>
        </Done>
      ) : s.revealed ? (
        <Info icon={<Hourglass size={20} />}>Die Runde wird gerade ausgewertet – gleich kommt das nächste Wort.</Info>
      ) : view.locked ? (
        <LockedNote />
      ) : (
        <form className="compose" onSubmit={submit}>
          <input
            className="input input-large"
            value={word}
            onChange={(e) => setWord(e.target.value.replace(/\s/g, ''))}
            placeholder="Ein Wort"
            maxLength={40}
            autoFocus
            autoCapitalize="off"
            enterKeyHint="send"
          />
          <button className="btn btn-primary btn-large" disabled={busy || !word.trim()}>
            Wort abschicken <Send />
          </button>
        </form>
      )}
    </div>
  );
}

/* ───────────── Beiträge ───────────── */

function PostItem({ post, token, votable }: { post: PostView; token: string; votable: boolean }) {
  const { send, busy } = useSend(token);
  return (
    <li className={`post ${post.status === 'answered' ? 'is-answered' : ''} ${post.status === 'pending' ? 'is-pending' : ''}`}>
      <div className="post-body">
        <span className="post-text">{post.text}</span>
        <span className="post-meta">
          {post.authorName && <span>{post.authorName}</span>}
          {post.mine && <span className="pill">Von dir</span>}
          {post.status === 'pending' && <span className="pill pill-warn">Wartet auf Freigabe</span>}
          {post.status === 'answered' && <span className="pill pill-good">Beantwortet</span>}
        </span>
      </div>
      {votable && post.status === 'visible' && (
        <button
          className="vote-btn"
          aria-pressed={!!post.voted}
          aria-label={post.voted ? 'Stimme zurücknehmen' : 'Hochvoten'}
          disabled={busy}
          onClick={() => send(`/api/p/posts/${post.id}/vote`, {})}
        >
          <ChevronUp />
          <span className="tabular">{post.votes}</span>
        </button>
      )}
      {votable && post.status !== 'visible' && post.votes > 0 && <span className="pill tabular">{post.votes}</span>}
    </li>
  );
}

function Compose({
  slide,
  token,
  placeholder,
  maxLength,
  columns,
  cta,
}: {
  slide: PublicSlide;
  token: string;
  placeholder: string;
  maxLength: number;
  columns?: string[];
  cta: string;
}) {
  const [text, setText] = useState('');
  const [column, setColumn] = useState(0);
  const { send, busy } = useSend(token);
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await send('/api/p/posts', { slideId: slide.id, text, column: columns ? column : undefined })) {
      setText('');
      toast(slide.type === 'qa' && slide.config.moderated ? 'Danke! Deine Frage erscheint nach der Freigabe.' : 'Abgeschickt');
    }
  };
  return (
    <form className="compose" onSubmit={submit}>
      {columns && (
        <div className="segmented" role="group" aria-label="Spalte" style={{ flexWrap: 'wrap', justifySelf: 'start' }}>
          {columns.map((c, i) => (
            <button type="button" key={i} aria-pressed={column === i} onClick={() => setColumn(i)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
      />
      <div className="row-between">
        <span className="char-count tabular">
          {text.length}/{maxLength}
        </span>
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          {cta} <Send />
        </button>
      </div>
    </form>
  );
}

function Open({ view, slide, token }: Props<'open'>) {
  return (
    <div className="stack">
      <Question kicker="Deine Antwort" text={slide.config.question} />
      {view.locked ? (
        <LockedNote />
      ) : (
        <Compose slide={slide} token={token} placeholder="Schreib hier …" maxLength={slide.config.maxLength} cta="Abschicken" />
      )}
      {view.posts.length > 0 && (
        <div className="stack-s">
          <span className="label">Deine Antworten</span>
          <ul className="post-list">
            {view.posts.map((p) => (
              <PostItem key={p.id} post={p} token={token} votable={false} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Brainstorm({ view, slide, token }: Props<'brainstorm'>) {
  return (
    <div className="stack">
      <Question kicker="Brainstorming – so viele Ideen wie du magst" text={slide.config.question} />
      {view.locked ? <LockedNote /> : <Compose slide={slide} token={token} placeholder="Deine Idee …" maxLength={280} cta="Idee teilen" />}
      {view.posts.length > 0 && (
        <ul className="post-list">
          {view.posts.map((p) => (
            <PostItem key={p.id} post={p} token={token} votable={slide.config.allowVotes && !view.locked} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Pinboard({ view, slide, token }: Props<'pinboard'>) {
  const { columns } = slide.config;
  return (
    <div className="stack">
      <Question kicker="Pinnwand" text={slide.config.title} />
      {view.locked ? (
        <LockedNote />
      ) : (
        <Compose slide={slide} token={token} placeholder="Deine Notiz …" maxLength={280} columns={columns} cta="Anpinnen" />
      )}
      <div className="pin-columns">
        {columns.map((c, i) => {
          const posts = view.posts.filter((p) => (p.column ?? 0) === i);
          if (posts.length === 0) return null;
          return (
            <section key={i} className="pin-column">
              <h3>{c}</h3>
              <ul className="post-list">
                {posts.map((p) => (
                  <PostItem key={p.id} post={p} token={token} votable={false} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Qa({ view, slide, token }: Props<'qa'>) {
  return (
    <NameGate view={view} token={token} reason="Damit du gefragt werden kannst, erscheint dein Name bei deiner Frage.">
      <div className="stack">
        <Question kicker="Fragen an die Vortragenden" text={slide.config.title} />
        {view.locked ? (
          <LockedNote />
        ) : (
          <Compose slide={slide} token={token} placeholder="Deine Frage …" maxLength={300} cta="Frage stellen" />
        )}
        {view.posts.length === 0 ? (
          <Info icon={<MessageCircleQuestion size={20} />}>Noch keine Fragen. Trau dich!</Info>
        ) : (
          <ul className="post-list">
            {view.posts.map((p) => (
              <PostItem key={p.id} post={p} token={token} votable={!view.locked} />
            ))}
          </ul>
        )}
      </div>
    </NameGate>
  );
}

function Leaderboard({ view }: { view: ParticipantView }) {
  return (
    <div className="big-result anim-pop">
      <Trophy size={40} />
      {view.rank ? (
        <>
          <span className="num tabular">Platz {view.rank.rank}</span>
          <span className="muted">
            {view.rank.points.toLocaleString('de-DE')} Punkte · {view.rank.of} Teilnehmende
          </span>
        </>
      ) : (
        <span className="muted">Die Rangliste wird gezeigt.</span>
      )}
    </div>
  );
}

export function ParticipantActivity({ view, token }: { view: ParticipantView; token: string }) {
  const slide = view.slide;
  if (view.leaderboard) return <Leaderboard view={view} />;
  if (!slide) return <Info icon={<Hourglass size={20} />}>Gleich geht es los.</Info>;
  switch (slide.type) {
    case 'content':
      return <Content slide={slide} />;
    case 'image':
      return <ImageSlide slide={slide} step={view.buildStep} />;
    case 'choice':
      return <Choice view={view} slide={slide} token={token} />;
    case 'scale':
      return <Scale view={view} slide={slide} token={token} />;
    case 'wordcloud':
      return <Wordcloud view={view} slide={slide} token={token} />;
    case 'ranking':
      return <Ranking view={view} slide={slide} token={token} />;
    case 'quiz':
      return <Quiz view={view} slide={slide} token={token} />;
    case 'feedback':
      return <Feedback view={view} slide={slide} token={token} />;
    case 'sentence':
      return <Sentence view={view} slide={slide} token={token} />;
    case 'open':
      return <Open view={view} slide={slide} token={token} />;
    case 'brainstorm':
      return <Brainstorm view={view} slide={slide} token={token} />;
    case 'pinboard':
      return <Pinboard view={view} slide={slide} token={token} />;
    case 'qa':
      return <Qa view={view} slide={slide} token={token} />;
  }
}
