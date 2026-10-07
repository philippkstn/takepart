import { useCallback, useState } from 'react';

/**
 * Kleine Ansichts-Einstellung, die sich der Browser merkt (z. B. Breite der
 * Seitenleiste). Speicher kann fehlen oder gesperrt sein – dann gilt der Standard.
 */
export function usePref<T>(key: string, fallback: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`takepart:${key}`);
      if (raw === null) return fallback;
      const parsed: unknown = JSON.parse(raw);
      return valid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`takepart:${key}`, JSON.stringify(v));
      } catch {
        // nur Komfort – ohne Speicher gilt die Einstellung bis zum Neuladen
      }
    },
    [key],
  );
  return [value, set];
}

export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
