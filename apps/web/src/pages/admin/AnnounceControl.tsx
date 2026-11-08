import { activeAnnouncement, ANNOUNCEMENT_MAX, ANNOUNCEMENT_MS, type HostCommand, type HostView } from '@slides/shared';
import { Megaphone, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useServerNow } from '../../lib/serverNow.ts';

type Cmd = (cmd: HostCommand) => Promise<void>;

/**
 * Rundruf: eigene Nachricht als Hinweisfenster auf alle Handys (nicht auf den Beamer).
 * Ein neuer Rundruf ersetzt den alten; nach 30 Minuten erscheint er auch bei neu
 * Beitretenden nicht mehr.
 */
export function AnnounceControl({ view, command, offset, disabled }: { view: HostView; command: Cmd; offset: number; disabled: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useServerNow(offset, !!view.state.announcement, 30_000);
  const active = activeAnnouncement(view.state.announcement, now);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await command({ action: 'announce', text: text.trim() });
      setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-s announce">
      {active && (
        <div className="announce-active">
          <Megaphone aria-hidden />
          <div className="grow">
            <div className="announce-text">{active.text}</div>
            <div className="small muted">
              gesendet {ago(now - active.at)} · verschwindet in {Math.max(1, Math.ceil((ANNOUNCEMENT_MS - (now - active.at)) / 60_000))}{' '}
              Min. von selbst
            </div>
          </div>
          <button className="btn btn-small" disabled={disabled} onClick={() => void command({ action: 'announce', text: null })}>
            <X /> Zurückziehen
          </button>
        </div>
      )}
      <form className="stack-s" onSubmit={send}>
        <textarea
          className="textarea"
          rows={2}
          value={text}
          maxLength={ANNOUNCEMENT_MAX}
          placeholder="Nachricht an alle Handys, z. B. „Bitte in 5 Minuten zurück in Raum 2“"
          aria-label="Nachricht für den Rundruf"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          disabled={disabled}
        />
        <div className="row-between">
          <span className="small faint tabular">
            {text.length}/{ANNOUNCEMENT_MAX}
          </span>
          <button className="btn btn-small btn-ink" disabled={disabled || busy || !text.trim()}>
            <Megaphone /> {active ? 'Neuen Rundruf senden' : 'Rundruf senden'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ago(ms: number): string {
  const min = Math.floor(ms / 60_000);
  return min < 1 ? 'gerade eben' : `vor ${min} Min.`;
}
