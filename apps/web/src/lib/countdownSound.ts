import { currentPhase, type Countdown, type PhaseInfo } from '@slides/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * Töne zum Countdown auf dem Beamer: ein kurzer Hinweis eine Minute vor
 * Ende, ein Gongschlag beim Phasenwechsel, ein Gong bei Ablauf. Bei Phasen auch
 * auf den Geräten der Teilnehmenden, sobald sie Ton freigegeben haben. Per Web Audio erzeugt (keine Dateien, kein CDN).
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

export type CountdownMoment =
  | { kind: 'warning'; phase: PhaseInfo | null }
  | { kind: 'end'; phase: PhaseInfo | null }
  /** Neue Phase hat begonnen */
  | { kind: 'phase'; phase: PhaseInfo };

/** Ein Gongschlag beim Wechsel in die nächste Phase */
export function playPhase() {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + 0.05;
  tone(ac, 659.25, t, 1.6, 0.28);
  tone(ac, 987.77, t, 1.2, 0.14);
}

/** Ton freigeben (Browser erlauben Ton erst nach einer Interaktion) */
export function unlockAudio(): Promise<boolean> {
  const ac = audio();
  if (!ac) return Promise.resolve(false);
  return ac.resume().then(
    () => ac.state === 'running',
    () => false,
  );
}

interface Observed {
  key: string;
  index: number;
  warn: boolean;
  done: boolean;
}

/**
 * Meldet die Momente des laufenden Countdowns: eine Minute vor Ende einer Phase
 * bzw. des Countdowns (nur wenn sie länger als eine Minute dauert), den Beginn
 * jeder weiteren Phase und den Ablauf. Abgeleitet aus Serverzeit bei jedem Takt:
 * Nach einem verdeckten Tab erscheint beim Zurückkehren sofort der aktuelle
 * Wechsel. Was beim ersten Anblick eines Countdowns (Neuladen, gerade
 * gestartet) schon vorbei ist, wird nicht nachgeholt.
 */
export function useCountdownMoments(countdown: Countdown | null, offset: number, onMoment: (moment: CountdownMoment) => void) {
  const latest = useRef(onMoment);
  latest.current = onMoment;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const observed = useRef<Observed | null>(null);
  const cdRef = useRef(countdown);
  cdRef.current = countdown;
  const key = countdown ? `${countdown.endsAt}:${countdown.seconds}:${countdown.phases?.length ?? 0}` : null;

  useEffect(() => {
    observed.current = null;
    if (key === null) return;
    const check = () => {
      const cd = cdRef.current;
      if (!cd) return;
      const now = Date.now() + offsetRef.current;
      const phase = currentPhase(cd, now);
      const phaseEnds = phase ? phase.endsAt : cd.endsAt;
      const phaseSeconds = phase ? phase.seconds : cd.seconds;
      const left = phaseEnds - now;
      const next: Observed = {
        key,
        index: phase?.index ?? 0,
        done: now >= cd.endsAt,
        warn: now < cd.endsAt && phaseSeconds * 1000 > WARNING_MS && left <= WARNING_MS,
      };
      const prev = observed.current;
      observed.current = next;
      if (!prev || prev.key !== key) return;
      if (!prev.done && next.done) latest.current({ kind: 'end', phase });
      else if (phase && next.index > prev.index) latest.current({ kind: 'phase', phase });
      else if (!prev.warn && next.warn && next.index === prev.index && left > WARNING_MS - 15_000)
        latest.current({ kind: 'warning', phase });
    };
    check();
    const id = window.setInterval(check, 250);
    // Beim Zurückkehren in den Tab sofort prüfen, nicht erst beim nächsten (gedrosselten) Takt
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [key]);
}

/** Töne zum Countdown auf dem Beamer. Solange der Browser Ton sperrt, ist `locked` wahr. */
export function useCountdownSounds(countdown: Countdown | null, offset: number): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(() => audio()?.state !== 'running');

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

  useCountdownMoments(countdown, offset, (moment) =>
    moment.kind === 'warning' ? playWarning() : moment.kind === 'phase' ? playPhase() : playEnd(),
  );
  return { locked, unlock };
}
