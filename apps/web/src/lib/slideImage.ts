import { assetUrl } from '@slides/shared';
import { useEffect, useState } from 'react';

/** Länger wartet ein Folienwechsel nicht auf das Bild – danach lädt es sichtbar nach. */
const MAX_WAIT_MS = 1500;

/** Liegt das Bild schon dekodiert im Speicher-Cache des Browsers? */
function isReady(url: string): boolean {
  const img = new Image();
  img.src = url;
  return img.complete && img.naturalWidth > 0;
}

/**
 * Importierte Folie erst zeigen, wenn ihr Bild dekodiert ist; bis dahin bleibt die
 * vorige stehen. Sonst wäre beim Wechsel kurz der leere (schwarze) Rahmen zu sehen,
 * und die Abdeckungen der Animationen lägen schon darauf, bevor das Bild da ist.
 * Liefert `null`, solange noch gar keine Folie fertig ist.
 */
export function useDecodedSlide<T extends { id: number; config: { asset: string } }>(slide: T | null): T | null {
  const url = slide?.config.asset ? assetUrl(slide.config.asset) : null;
  const [readyUrl, setReadyUrl] = useState<string | null>(() => (url && isReady(url) ? url : null));
  const [shown, setShown] = useState<T | null>(() => (url && readyUrl === url ? slide : null));

  useEffect(() => {
    if (!url) return;
    if (readyUrl === url) return;
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      setReadyUrl(url);
    };
    const img = new Image();
    img.src = url;
    // decode() schlägt z. B. bei abgebrochenen Ladevorgängen fehl – dann trotzdem wechseln
    img.decode().then(show, show);
    const timer = setTimeout(show, MAX_WAIT_MS);
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [url, readyUrl]);

  // Aktuelle Folie (mit neuestem Stand, z. B. geänderten Animationen), sobald ihr Bild bereit ist
  const current = slide && url && readyUrl === url ? slide : null;
  useEffect(() => {
    if (current) setShown(current);
  }, [current]);
  return current ?? shown;
}

/** Bilder der nächsten Folie schon laden, damit der Wechsel nicht flackert. */
export function usePreload(urls: string[]) {
  const key = urls.join('|');
  useEffect(() => {
    for (const url of key ? key.split('|') : []) new Image().src = url;
  }, [key]);
}
