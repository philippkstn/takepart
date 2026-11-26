import { useEffect, useRef } from 'react';

/** Dialog mit Escape schließen; `null` = gerade nicht schließbar (z. B. während eines Abgleichs) */
export function useEscape(onClose: (() => void) | null) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current) {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
