import type { ParticipantPause, PauseVote } from '@slides/shared';
import { Check, Coffee, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { useCountdownMoments, type CountdownMoment } from '../../lib/countdownSound.ts';
import { formatRemaining } from '../Countdown.tsx';
import { pauseClock, usePauseTime } from '../PauseScreen.tsx';
import { useToast } from '../ui.tsx';
import '../pause.css';

const ENERGY = [1, 2, 3, 4, 5];

/**
 * Pause auf dem Handy: Restzeit, „Ich bin wieder da“ und – falls gestellt – die
 * Energie-Frage (1–5, jederzeit änderbar). Der Parkplatz bleibt über die Kopfzeile erreichbar.
 */
export function PauseActivity({
  pause,
  token,
  offset,
  parking,
}: {
  pause: ParticipantPause;
  token: string;
  offset: number;
  parking: boolean;
}) {
  const { remaining, over, soon } = usePauseTime(pause, offset);
  const toast = useToast();
  // Sofort zeigen, was angetippt wurde – die Ansicht vom Server folgt gleich
  const [pending, setPending] = useState<PauseVote | null>(null);
  const vote = { ...pause.vote, ...pending };

  const send = async (change: PauseVote) => {
    setPending((p) => ({ ...p, ...change }));
    try {
      await api('/api/p/pause', { body: change, participant: token });
    } catch (err) {
      toast(errorMessage(err), 'error');
      setPending(null);
    }
  };
  // Neue Ansicht vom Server: deren Stand gilt
  useEffect(() => setPending(null), [pause.vote?.energy, pause.vote?.ready]);

  return (
    <div className="stack p-pause anim-rise">
      <span className="muted row" style={{ justifyContent: 'center', gap: 6 }}>
        <Coffee size={18} aria-hidden /> Pause
      </span>
      {over ? (
        <p className="p-pause-over">Gleich geht es weiter</p>
      ) : (
        <p className={`p-pause-time tabular ${soon ? 'is-soon' : ''}`} role="timer" aria-live="off">
          {formatRemaining(remaining)}
        </p>
      )}
      <p className="muted" style={{ margin: 0 }}>
        {over ? 'Bitte wieder Platz nehmen.' : `Weiter um ${pauseClock(pause.endsAt, offset)} Uhr`}
      </p>

      {vote.ready ? (
        <div className="p-pause-ready" role="status">
          <Check aria-hidden /> <strong>Schön, dass du wieder da bist</strong>
          <button className="btn btn-small btn-ghost" onClick={() => void send({ ready: false })}>
            Doch noch nicht
          </button>
        </div>
      ) : (
        <button className="btn btn-primary btn-large" onClick={() => void send({ ready: true })}>
          <Check /> Ich bin wieder da
        </button>
      )}

      {pause.question && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <strong>Wie ist deine Energie?</strong>
          <div className="scale-buttons" role="group" aria-label="Energie von 1 bis 5">
            {ENERGY.map((n) => (
              <button key={n} aria-pressed={vote.energy === n} onClick={() => void send({ energy: n })}>
                {n}
              </button>
            ))}
          </div>
          <div className="row-between small faint">
            <span>1 = leer</span>
            <span>5 = voller Energie</span>
          </div>
        </div>
      )}
      {parking && <p className="small faint">Ideen für den Parkplatz kannst du oben jederzeit loswerden.</p>}
    </div>
  );
}

/** Hinweis eine Minute vor Ende und bei Ablauf der Pause – ohne Ton (den gibt es nur auf dem Beamer). */
export function PauseAlert({ pause, offset }: { pause: ParticipantPause | null | undefined; offset: number }) {
  const [moment, setMoment] = useState<CountdownMoment | null>(null);
  useCountdownMoments(pause ?? null, offset, setMoment);
  useEffect(() => {
    if (!moment) return;
    const t = window.setTimeout(() => setMoment(null), moment === 'warning' ? 6000 : 12000);
    return () => window.clearTimeout(t);
  }, [moment]);
  useEffect(() => {
    if (!pause) setMoment(null);
  }, [pause]);

  if (!moment) return null;
  return (
    <div className={`countdown-alert anim-pop ${moment === 'end' ? 'is-end' : ''}`} role="alert">
      <Coffee aria-hidden />
      <div className="grow">
        <strong>{moment === 'warning' ? 'Noch 1 Minute Pause' : 'Die Pause ist vorbei'}</strong>
        <div className="small">{moment === 'warning' ? 'Gleich geht es weiter.' : 'Bitte wieder Platz nehmen.'}</div>
      </div>
      <button className="icon-btn" aria-label="Schließen" onClick={() => setMoment(null)}>
        <X />
      </button>
    </div>
  );
}
