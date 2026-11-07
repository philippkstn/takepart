import { api } from './api.ts';

/**
 * Beitritt per Code – gemeinsam für Startseite und Teilnahme-Seite. Das Token liegt
 * je Code im localStorage; wer schon beigetreten ist, bekommt mit demselben Token
 * keinen zweiten Teilnehmer-Eintrag. So kann die Startseite den Code vorab prüfen
 * (Fehler direkt unter dem Feld), und die Teilnahme-Seite tritt danach nur noch
 * mit dem gespeicherten Token bei.
 */
const storageKey = (code: string) => `slides:participant:${code}`;

export function readToken(code: string): string | undefined {
  try {
    return localStorage.getItem(storageKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(code: string, token: string) {
  try {
    localStorage.setItem(storageKey(code), token);
  } catch {
    /* privater Modus: Token gilt dann nur für diesen Tab */
  }
}

/** Beitreten (oder bestätigen) und das Token merken; wirft `ApiError` mit der Meldung des Servers. */
export async function joinRun(code: string): Promise<string> {
  const res = await api<{ token: string }>('/api/join', { body: { code, token: readToken(code) } });
  writeToken(code, res.token);
  return res.token;
}
