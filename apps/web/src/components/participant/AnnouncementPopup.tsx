import type { Announcement } from '@slides/shared';
import { Megaphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { vibrate, VIBRATE } from '../../lib/vibrate.ts';

const dismissKey = 'takepart:announcement-dismissed';

function readDismissed(): number | null {
  try {
    const v = sessionStorage.getItem(dismissKey);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/**
 * Rundruf der Moderation als Hinweisfenster auf dem Handy. Bleibt stehen, bis die
 * Person ihn bestätigt (gilt für diesen Rundruf, auch nach dem Neuladen).
 */
export function AnnouncementPopup({ announcement }: { announcement: Announcement | null | undefined }) {
  const [dismissed, setDismissed] = useState<number | null>(readDismissed);
  const buzzed = useRef<number | null>(null);
  const open = !!announcement && dismissed !== announcement.at;
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || buzzed.current === announcement.at) return;
    buzzed.current = announcement.at;
    vibrate(VIBRATE.announcement);
    button.current?.focus();
  }, [open, announcement?.at]);

  if (!open) return null;
  const close = () => {
    setDismissed(announcement.at);
    try {
      sessionStorage.setItem(dismissKey, String(announcement.at));
    } catch {
      /* privater Modus: dann nur bis zum Neuladen */
    }
  };
  return (
    <div className="sheet-backdrop announcement-backdrop">
      <div
        className="sheet card card-pad stack anim-pop announcement"
        role="alertdialog"
        aria-labelledby="announcement-title"
        aria-describedby="announcement-text"
      >
        <div className="announcement-head">
          <Megaphone aria-hidden />
          <h2 id="announcement-title">Nachricht der Moderation</h2>
        </div>
        <p id="announcement-text" className="announcement-text">
          {announcement.text}
        </p>
        <button ref={button} className="btn btn-primary btn-large" onClick={close}>
          Verstanden
        </button>
      </div>
    </div>
  );
}
