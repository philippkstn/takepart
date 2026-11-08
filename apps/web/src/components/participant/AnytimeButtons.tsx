import type { ParkingView, ParticipantView } from '@slides/shared';
import { MessageCircleQuestion, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Compose, NameGate, PostItem, questionDone } from './Activities.tsx';
import { CardComposer, OwnCard } from './BoardActivity.tsx';

/**
 * Jederzeit offene Folien – Parkplatz (Sammel-Folie) und Q&A mit „jederzeit“ –,
 * erreichbar von jeder Folie aus über einen Knopf in der Kopfzeile.
 */
export function AnytimeButtons({ view, token }: { view: ParticipantView; token: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const current = view.parking.find((p) => p.slideId === open) ?? null;
  // Verschwindet die Folie (z. B. weil sie gerade gezeigt wird), schließt das Blatt
  useEffect(() => {
    if (open !== null && !current) setOpen(null);
  }, [open, current]);
  useEffect(() => {
    if (!current) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [current]);
  if (view.parking.length === 0) return null;
  return (
    <>
      {view.parking.map((p) => (
        <button key={p.slideId} className="pill parking-pill" title={p.title} aria-label={p.title} onClick={() => setOpen(p.slideId)}>
          {p.kind === 'qa' ? <MessageCircleQuestion /> : <Plus />}
          <span className="parking-label">{p.title}</span>
          <span className="parking-label-short">{p.kind === 'qa' ? 'Fragen' : 'Parken'}</span>
          {p.mine.length > 0 && <span className="tabular">· {p.mine.length}</span>}
        </button>
      ))}
      {current && (
        <div className="sheet-backdrop" onClick={() => setOpen(null)}>
          <div
            className="sheet card card-pad stack anim-rise"
            role="dialog"
            aria-label={current.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <h2>{current.title}</h2>
              <button className="icon-btn" aria-label="Schließen" onClick={() => setOpen(null)}>
                <X />
              </button>
            </div>
            {current.kind === 'qa' ? (
              <QuestionSheet parking={current} view={view} token={token} />
            ) : (
              <ParkingSheet parking={current} token={token} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ParkingSheet({ parking, token }: { parking: ParkingView; token: string }) {
  return (
    <>
      <CardComposer slideId={parking.slideId} tags={parking.tags} remaining={parking.remaining} token={token} placeholder="Deine Idee …" />
      {parking.mine.length > 0 && (
        <ul className="post-list">
          {parking.mine.map((p) => (
            <OwnCard key={p.id} post={p} tags={parking.tags} token={token} editable />
          ))}
        </ul>
      )}
    </>
  );
}

/** Fragen jederzeit: stellen und die eigenen im Blick – abgestimmt wird auf der Q&A-Folie selbst */
function QuestionSheet({ parking, view, token }: { parking: ParkingView; view: ParticipantView; token: string }) {
  return (
    <NameGate view={view} token={token} reason="Damit du gefragt werden kannst, erscheint dein Name bei deiner Frage.">
      <div className="stack">
        {parking.remaining > 0 ? (
          <Compose
            slideId={parking.slideId}
            done={questionDone(parking.moderated)}
            token={token}
            placeholder="Deine Frage …"
            maxLength={300}
            cta="Frage stellen"
          />
        ) : (
          <p className="small muted">Du hast hier schon sehr viele Fragen gestellt.</p>
        )}
        {parking.mine.length > 0 && (
          <div className="stack-s">
            <span className="label">Deine Fragen</span>
            <ul className="post-list">
              {parking.mine.map((p) => (
                <PostItem key={p.id} post={p} token={token} votable={false} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </NameGate>
  );
}
