import { callbackHeadline, type Callback, type MyTeamView } from '@slides/shared';
import { Check, Megaphone, Users, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { useActiveCallback } from '../board/Breakout.tsx';
import { useToast } from '../ui.tsx';
import '../board/breakout.css';

const dismissKey = 'takepart:callback-dismissed';

function readDismissed(): number | null {
  try {
    const v = sessionStorage.getItem(dismissKey);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/**
 * Sammelruf „zurück ins Plenum“ auf dem Handy – im Inhalt oben, damit Kopfzeile
 * mit Countdown frei bleibt. Lässt sich lokal schließen (gilt für diesen Ruf).
 */
export function CallbackNotice({ callback, offset }: { callback: Callback | null | undefined; offset: number }) {
  const active = useActiveCallback(callback, offset);
  const [dismissed, setDismissed] = useState<number | null>(readDismissed);
  if (!active || dismissed === active.at) return null;
  const close = () => {
    setDismissed(active.at);
    try {
      sessionStorage.setItem(dismissKey, String(active.at));
    } catch {
      /* privater Modus: dann nur bis zum Neuladen */
    }
  };
  return (
    <div className="callback-notice anim-pop" role="alert">
      <Megaphone aria-hidden />
      <div className="grow">
        <strong>{callbackHeadline(active)}</strong>
        {active.text && <div className="small">{active.text}</div>}
      </div>
      <button className="icon-btn" aria-label="Hinweis schließen" onClick={close}>
        <X />
      </button>
    </div>
  );
}

/** Eigene Arbeitsgruppe beim gruppenweisen Sammeln mit „Unsere Gruppe ist fertig“ */
export function TeamBar({ team, slideId, token }: { team: MyTeamView; slideId: number; token: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api('/api/p/team-done', { body: { slideId, done: !team.done }, participant: token });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="team-bar anim-rise">
      <div className="team-bar-text">
        <strong>
          <Users size={16} aria-hidden style={{ verticalAlign: '-2px' }} /> Ihr sammelt als {team.name}
        </strong>
        <span className="small muted">
          {team.members.length > 0 ? `mit ${team.members.join(', ')}` : 'Alle in der Gruppe sehen eure Karten.'}
        </span>
        {team.done && (
          <span className="small">
            <Check size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> {team.name} ist als fertig gemeldet
          </span>
        )}
      </div>
      <button className={`btn btn-small ${team.done ? '' : 'btn-primary'}`} disabled={busy} onClick={toggle} aria-pressed={team.done}>
        {team.done ? 'Doch noch nicht fertig' : 'Unsere Gruppe ist fertig'}
      </button>
    </div>
  );
}
