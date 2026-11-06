import { assetUrl, hiresUrl } from '@slides/shared';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

/**
 * Folienbilder in doppelter Auflösung zeigen? Nur der Beamer setzt das (über
 * `useHiresDecision`); Steuerpult, Editor und Handys bleiben beim leichten Bild.
 */
export const HiresSlides = createContext(false);

/** URL des Folienbilds je nach gewählter Qualität */
export function useSlideSrc(asset: string): string;
export function useSlideSrc(asset: string | null | undefined): string | null;
export function useSlideSrc(asset: string | null | undefined): string | null {
  const hires = useContext(HiresSlides);
  return asset ? (hires ? hiresUrl(asset) : assetUrl(asset)) : null;
}

interface NetworkInfo {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

/** Ab so vielen Bildpunkten Breite (CSS-Pixel × Pixeldichte) lohnt das Bild in doppelter Auflösung */
const HIRES_MIN_PIXELS = 2400;
/** Mindestens so viel Mbit/s laut Browser (Chrome/Edge melden das; Safari/Firefox nicht) */
const HIRES_MIN_MBPS = 5;

/** Entscheidung nach Bildschirm und Verbindung – rein im Browser, ändert sich mit der Verbindung. */
export function wantsHires(width: number, ratio: number, net: NetworkInfo | undefined): boolean {
  if (width * ratio < HIRES_MIN_PIXELS) return false;
  if (!net) return true; // Ohne Angaben (Safari, Firefox): großer Bildschirm genügt
  if (net.saveData) return false;
  if (net.effectiveType && net.effectiveType !== '4g') return false;
  return net.downlink === undefined || net.downlink >= HIRES_MIN_MBPS;
}

/**
 * Beamer: hochauflösende Folien je nach Bildschirm und Verbindung. Wechselt die
 * Verbindung (z. B. WLAN wird langsam), gelten ab der nächsten Folie die leichten Bilder.
 */
export function useHiresDecision(): boolean {
  const decide = () =>
    wantsHires(
      window.screen.width,
      window.devicePixelRatio || 1,
      (navigator as Navigator & { connection?: NetworkInfo }).connection,
    );
  const [hires, setHires] = useState(decide);
  useEffect(() => {
    const net = (navigator as Navigator & { connection?: NetworkInfo }).connection;
    const update = () => setHires(decide());
    net?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      net?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return hires;
}

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
  const url = useSlideSrc(slide?.config.asset);
  const [readyUrl, setReadyUrl] = useState<string | null>(() => (url && isReady(url) ? url : null));
  const [shown, setShown] = useState<T | null>(() => (url && readyUrl === url ? slide : null));
  // Seit wann die gezeigte Folie veraltet ist: Beim schnellen Durchblättern zählt die
  // Wartezeit ab dem ersten Wechsel, nicht je Folie neu – sonst bliebe die alte Folie
  // stehen, solange man schneller als alle 1,5 s klickt.
  const staleSince = useRef<number | null>(null);

  useEffect(() => {
    if (!url) return;
    if (readyUrl === url) {
      staleSince.current = null;
      return;
    }
    staleSince.current ??= Date.now();
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
    const timer = setTimeout(show, Math.max(0, MAX_WAIT_MS - (Date.now() - staleSince.current)));
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
  const hires = useContext(HiresSlides);
  // Der Server liefert die Adressen der normalen Bilder (`/api/assets/<id>`)
  const key = urls.map((u) => (hires && /^\/api\/assets\/[^/]+$/.test(u) ? `${u}/hires` : u)).join('|');
  useEffect(() => {
    for (const url of key ? key.split('|') : []) new Image().src = url;
  }, [key]);
}
