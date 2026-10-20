import type { Countdown } from '@slides/shared';
import { Timer } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useCountdownMoments, type CountdownMoment } from '../lib/countdownSound.ts';
import { momentText } from './countdownText.ts';

/**
 * Countdown-Hinweis auf der Bühne: fährt eine Minute vor Ende, beim
 * Phasenwechsel und bei Ablauf von unten ein (der Ton dazu kommt aus useCountdownSounds).
 */
export function CountdownPopup({ countdown, offset }: { countdown: Countdown | null; offset: number }) {
  const [moment, setMoment] = useState<CountdownMoment | null>(null);
  useCountdownMoments(countdown, offset, setMoment);
  useEffect(() => {
    if (!moment) return;
    const t = window.setTimeout(() => setMoment(null), moment.kind === 'end' ? 15000 : moment.kind === 'phase' ? 10000 : 7000);
    return () => window.clearTimeout(t);
  }, [moment]);
  useEffect(() => {
    if (!countdown) setMoment(null);
  }, [countdown]);

  return (
    <AnimatePresence>
      {moment && (
        <motion.div
          key={`${moment.kind}:${moment.phase?.index ?? 0}`}
          className={`stage-countdown-popup ${moment.kind === 'end' ? 'is-end' : ''} ${moment.kind === 'phase' ? 'is-phase' : ''}`}
          role="alert"
          initial={{ y: '140%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '140%', opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Timer aria-hidden />
          <span className="stage-countdown-popup-text">
            <span>{momentText(moment).title}</span>
            {moment.kind === 'phase' && <span className="stage-countdown-popup-sub">{momentText(moment).detail}</span>}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
