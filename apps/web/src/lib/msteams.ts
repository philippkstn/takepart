/**
 * Microsoft Teams (Meeting-App): das SDK wird nur auf den Teams-Seiten geladen,
 * damit Teilnehmer- und Admin-Seiten nicht größer werden.
 */
export type TeamsSdk = typeof import('@microsoft/teams-js');

/** Ohne Teams-Host antwortet `app.initialize` nie – nach dieser Zeit gilt die Seite als außerhalb von Teams */
const INIT_TIMEOUT_MS = 5000;

let pending: Promise<TeamsSdk | null> | null = null;

/** SDK laden und mit Teams verbinden; `null` außerhalb von Teams */
export function connectTeams(): Promise<TeamsSdk | null> {
  pending ??= (async () => {
    if (window.parent === window) return null; // nicht eingebettet: sicher nicht Teams
    try {
      const sdk = await import('@microsoft/teams-js');
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), INIT_TIMEOUT_MS));
      await Promise.race([sdk.app.initialize(), timeout]);
      return sdk;
    } catch {
      return null;
    }
  })();
  return pending;
}

/** Anzeige-Token aus einem eingefügten Anzeige-Link (`…/d/<token>`) oder dem Token selbst */
export function displayTokenFrom(input: string, origin: string): string | null {
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{16,64}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.origin !== origin) return null;
    const match = /^\/d\/([A-Za-z0-9_-]{16,64})\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Adresse des Teams-Tabs: Seitenleiste und Bühne laden dieselbe Seite, sie unterscheidet am Kontext */
export const teamsTabUrl = (origin: string, token: string) => `${origin}/teams/tab/${token}`;
