import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(3000),
  /** Uberspace-Web-Backends erreichen den Prozess nur über 0.0.0.0 */
  HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.url().default('http://localhost:5180'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string(),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string(),
  /** Einmal-Token für den ersten Passkey. Fehlt er, erzeugt der Server beim ersten Start selbst einen und schreibt ihn ins Log. */
  SETUP_TOKEN: z.string().optional(),
  /** Rechtliche Links in der Fußzeile (leer = nicht anzeigen) */
  IMPRINT_URL: z.url().optional(),
  PRIVACY_URL: z.url().optional(),
  /** Quellcode-Link (AGPL § 13). Wer TakePart verändert betreibt, verlinkt hier den eigenen Code. */
  SOURCE_URL: z.url().default('https://github.com/philippkstn/takepart'),
  /** Gebaute Web-App; in der Entwicklung liefert Vite sie aus */
  STATIC_DIR: z.string().optional(),
  RELEASE: z.string().default('dev'),
  /**
   * Anzahl vertrauenswürdiger Proxys vor der App. Uberspace allein: 1.
   * Mit Cloudflare davor: 2 (Client → Cloudflare → Uberspace → App).
   * Bestimmt, welche IP aus X-Forwarded-For gilt – zu hoch erlaubt gefälschte IPs.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

export type Config = z.infer<typeof schema> & { rpId: string; secureCookies: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Leere Werte (z. B. `PRIVACY_URL=` in Docker Compose) gelten als nicht gesetzt.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Konfiguration unvollständig oder ungültig: ${fields}`);
  }
  const origin = new URL(parsed.data.APP_ORIGIN);
  return { ...parsed.data, rpId: origin.hostname, secureCookies: origin.protocol === 'https:' };
}
