import { useEffect, useState } from 'react';

/** Aktuelle Serverzeit (lokale Uhr + Versatz), regelmäßig aktualisiert, solange `active` gilt. */
export function useServerNow(offset: number, active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now + offset;
}
