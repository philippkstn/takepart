import type { CountdownMoment } from '../lib/countdownSound.ts';
import { formatMinutes } from './Countdown.tsx';

/** Texte für die Countdown-Hinweise auf Beamer und Handy */
export function momentText(moment: CountdownMoment): { title: string; detail: string } {
  const phase = moment.phase;
  switch (moment.kind) {
    case 'phase':
      return {
        title: `Jetzt: ${moment.phase.label}`,
        detail: `Phase ${moment.phase.index + 1} von ${moment.phase.count} · ${formatMinutes(moment.phase.seconds)}`,
      };
    case 'warning':
      return phase?.next
        ? { title: 'Noch 1 Minute', detail: `Danach: ${phase.next.label}` }
        : { title: 'Noch 1 Minute', detail: 'Langsam zum Ende kommen.' };
    case 'end':
      return { title: 'Die Zeit ist um', detail: phase ? 'Alle Phasen sind vorbei.' : 'Bitte zum Abschluss kommen.' };
  }
}
