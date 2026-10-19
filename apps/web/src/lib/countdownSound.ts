import type { Countdown } from '@slides/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * Töne zum Countdown – nur auf dem Beamer: ein kurzer Hinweis eine Minute vor
 * Ende, ein Gong bei Ablauf. Per Web Audio erzeugt (keine Dateien, kein CDN).
 * Browser geben Ton erst nach einer Interaktion frei; bis dahin ist `locked` wahr.
 */

const WARNING_MS = 60_000;

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Ein Ton mit weichem Einsatz und abklingendem Ausklang */
function tone(ac: AudioContext, freq: number, start: number, duration: number, volume: number) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Eine Minute vor Ende: zwei kurze, helle Töne */
export function playWarning() {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + 0.05;
  tone(ac, 880, t, 0.45, 0.25);
  tone(ac, 1175, t + 0.28, 0.6, 0.22);
}

/** Zeit abgelaufen: Gong aus drei Teiltönen, zweimal */
export function playEnd() {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + 0.05;
  for (const offset of [0, 0.9]) {
    tone(ac, 523.25, t + offset, 2.2, 0.3);
    tone(ac, 659.25, t + offset, 1.8, 0.18);
    tone(ac, 1046.5, t + offset, 1.2, 0.1);
  }
}

/**
 * Plant die Töne für den laufenden Countdown. Schon vergangene Zeitpunkte
 * (z. B. nach einem Neuladen) werden nicht nachgeholt.
 */
export function useCountdownSounds(countdown: Countdown | null, offset: number): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(() => audio()?.state !== 'running');
  const played = useRef(new Set<string>());

  const unlock = () => {
    const ac = audio();
    if (!ac) return;
    void ac.resume().then(() => setLocked(ac.state !== 'running'));
  };

  // Jede Interaktion mit dem Beamer-Fenster (Klick, Taste, Vollbild) gibt den Ton frei.
  useEffect(() => {
    const ac = audio();
    if (!ac) return;
    const onState = () => setLocked(ac.state !== 'running');
    ac.addEventListener('statechange', onState);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      ac.removeEventListener('statechange', onState);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const endsAt = countdown?.endsAt ?? null;
  const seconds = countdown?.seconds ?? 0;
  useEffect(() => {
    if (endsAt === null) return;
    const now = Date.now() + offset;
    const timers: number[] = [];
    const schedule = (key: string, at: number, play: () => void) => {
      if (at <= now || played.current.has(key)) return;
      timers.push(
        window.setTimeout(() => {
          played.current.add(key);
          play();
        }, at - now),
      );
    };
    // Hinweis nur, wenn der Countdown länger als eine Minute läuft
    if (seconds * 1000 > WARNING_MS) schedule(`${endsAt}:warn`, endsAt - WARNING_MS, playWarning);
    schedule(`${endsAt}:end`, endsAt, playEnd);
    return () => timers.forEach((t) => window.clearTimeout(t));
    // offset schwankt minimal mit jeder Ansicht – neu planen nur bei neuem Countdown
  }, [endsAt, seconds]);

  return { locked, unlock };
}
