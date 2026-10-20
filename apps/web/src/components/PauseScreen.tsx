import type { DisplayPause } from '@slides/shared';
import { Coffee } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCountdown } from '../lib/live.ts';
import { formatRemaining } from './Countdown.tsx';
import { formatCode, joinHost, joinUrl, QrCode } from './ui.tsx';
import './pause.css';

/** Uhrzeit, zu der die Pause endet – in der Zeit des Geräts (endsAt ist Serverzeit) */
export function pauseClock(endsAt: number, offset: number): string {
  return new Date(endsAt - offset).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Restzeit der Pause; „bald“ = letzte Minute (nur bei Pausen über einer Minute) */
export function usePauseTime(pause: { endsAt: number; seconds: number }, offset: number) {
  const remaining = useCountdown(pause.endsAt, offset) ?? 0;
  return { remaining, over: remaining <= 0, soon: remaining > 0 && remaining <= 60_000 && pause.seconds > 60 };
}

/**
 * Pausenansicht auf der Bühne: liegt über Folie und Zeichnungen (nur ein
 * Schwarzbild liegt noch darüber). Großer Countdown, Uhrzeit des Endes,
 * Beitritt für Nachzügler und ein kurzer Rückblick.
 */
export function PauseScreen({ pause, code, offset }: { pause: DisplayPause | null | undefined; code: string | null; offset: number }) {
  return (
    <AnimatePresence>
      {pause && (
        <motion.div
          className="pause-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <PauseContent pause={pause} code={code} offset={offset} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PauseContent({ pause, code, offset }: { pause: DisplayPause; code: string | null; offset: number }) {
  const { remaining, over, soon } = usePauseTime(pause, offset);
  const progress = Math.min(1, Math.max(0, remaining / (pause.seconds * 1000)));
  const recap = [
    pause.contributions > 0 && `${pause.contributions} ${pause.contributions === 1 ? 'Beitrag' : 'Beiträge'}`,
    pause.participants > 0 && `${pause.participants} Teilnehmende`,
  ].filter(Boolean);
  return (
    <>
      <div className="pause-main" role="timer" aria-live="off">
        <span className="pause-kicker">
          <Coffee aria-hidden /> Pause
        </span>
        {over ? (
          <p className="pause-over">Gleich geht es weiter</p>
        ) : (
          <p className={`pause-time tabular ${soon ? 'is-soon' : ''}`}>{formatRemaining(remaining)}</p>
        )}
        <div className="pause-progress" aria-hidden>
          <div style={{ transform: `scaleX(${progress})` }} />
        </div>
        <p className="pause-until">{over ? 'Bitte wieder Platz nehmen' : `Weiter um ${pauseClock(pause.endsAt, offset)} Uhr`}</p>
        <AnimatePresence>
          {soon && (
            <motion.p
              className="pause-soon"
              role="status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              Noch 1 Minute
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <footer className="pause-foot">
        <span className="pause-recap">{recap.length > 0 && `Bisher: ${recap.join(' · ')}`}</span>
        {code && (
          <div className="pause-join">
            <div className="pause-join-text">
              <span>Noch nicht dabei?</span>
              <strong>{joinHost()}</strong>
              <span>
                Code <strong className="tabular">{formatCode(code)}</strong>
              </span>
            </div>
            <QrCode text={joinUrl(code)} className="pause-join-qr" />
          </div>
        )}
      </footer>
    </>
  );
}
