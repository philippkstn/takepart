import type { ParticipantView } from '@slides/shared';
import { CircleCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NameForm } from './Activities.tsx';

/*
 * Beitritt sichtbar machen: Viele waren nach dem QR-Code unsicher, ob sie „drin“ sind.
 * - Braucht die Präsentation irgendwo einen Namen (Quiz, Fragen, Gruppen, Reihum),
 *   fragt das Handy direkt beim Beitritt danach (nur „Wie heißt du?“) statt mitten im Vortrag.
 * - Danach (bzw. ohne Namensabfrage sofort) einmal je Tab „Du bist dabei“.
 * - Die Kopfzeile zeigt dauerhaft, als wer man dabei ist (`ParticipantWho`).
 */

/** Erster Bildschirm nach dem Beitritt, solange der Name fehlt, die Präsentation ihn aber braucht */
export function WelcomeName({ view, token }: { view: ParticipantView; token: string }) {
  return (
    <div className="card card-pad stack anim-rise welcome">
      <div className="welcome-joined">
        <CircleCheck aria-hidden />
        <div>
          <strong>Du bist dabei</strong>
          <span className="muted small">„{view.run.title}“</span>
        </div>
      </div>
      <NameForm token={token} />
    </div>
  );
}

const seenKey = (code: string) => `takepart:joined:${code}`;

/** Einmal je Tab: kurze Begrüßung oben, damit klar ist, dass der Beitritt geklappt hat */
export function JoinedNotice({ code, name, ready }: { code: string; name: string | null; ready: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(seenKey(code)) === '1';
      sessionStorage.setItem(seenKey(code), '1');
    } catch {
      /* ohne Speicher: einmal je Seitenaufruf */
    }
    if (seen) return;
    setShow(true);
    const timer = window.setTimeout(() => setShow(false), 7000);
    return () => clearTimeout(timer);
  }, [code, ready]);
  if (!show) return null;
  return (
    <div className="joined-notice anim-rise" role="status">
      <CircleCheck aria-hidden />
      <span className="grow">{name ? `Hey ${name}, schön, dass du da bist!` : 'Hey, schön, dass du da bist!'}</span>
      <button className="icon-btn" aria-label="Hinweis schließen" onClick={() => setShow(false)}>
        <X />
      </button>
    </div>
  );
}

/** Dauerhaft in der Kopfzeile: als wer man dabei ist und ob die Verbindung steht */
export function ParticipantWho({ name, connected }: { name: string | null; connected: boolean }) {
  return (
    <span className={`p-who ${connected ? 'is-on' : ''}`}>
      <span className="p-who-dot" aria-hidden />
      {connected ? (name ? `Dabei als ${name}` : 'Du bist dabei') : 'Verbinde …'}
    </span>
  );
}
