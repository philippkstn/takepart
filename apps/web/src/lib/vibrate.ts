/** Vibrationsmuster der Hinweise auf dem Handy (ms: an, aus, an …) */
export const VIBRATE = {
  /** Zeit abgelaufen (Countdown, Pause) */
  end: [300, 150, 300],
  /** Nächste Phase */
  phase: [200, 100, 200],
  /** Rundruf der Moderation */
  announcement: [150, 80, 150, 80, 150],
} as const;

/**
 * Handy vibrieren lassen. Geht nur in sichtbaren Tabs und erst nach einer ersten
 * Berührung der Seite (Browser-Regel); iPhones unterstützen die Vibration im Browser nicht.
 */
export function vibrate(pattern: readonly number[]) {
  try {
    navigator.vibrate?.([...pattern]);
  } catch {
    // nicht überall erlaubt
  }
}
