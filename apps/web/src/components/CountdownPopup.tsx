import type { Countdown } from '@slides/shared';
import { Timer } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useCountdownMoments, type CountdownMoment } from '../lib/countdownSound.ts';

/**
 * Countdown-Hinweis auf der Bühne: fährt eine Minute vor Ende und bei Ablauf
 * von unten ein (der Ton dazu kommt aus useCountdownSounds).
 */
export function CountdownPopup({ countdown, offset }: { countdown: Countdown | null; offset: number }) {
  const [moment, setMoment] = useState<CountdownMoment | null>(null);
  useCountdownMoments(countdown, offset, setMoment);
  useEffect(() => {
    if (!moment) return;
    const t = window.setTimeout(() => setMoment(null), moment === 'warning' ? 7000 : 15000);
    return () => window.clearTimeout(t);
  }, [moment]);
  useEffect(() => {
    if (!countdown) setMoment(null);
  }, [countdown]);

  return (
    <AnimatePresence>
      {moment && (
        <motion.div
          key={moment}
          className={`stage-countdown-popup ${moment === 'end' ? 'is-end' : ''}`}
          role="alert"
          initial={{ y: '140%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '140%', opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Timer aria-hidden />
          <span>{moment === 'warning' ? 'Noch 1 Minute' : 'Die Zeit ist um'}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
