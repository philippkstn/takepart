import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool, one } from './db.ts';

const config = loadConfig();
// Im Release liegt die Web-App neben dem gebündelten Server: release/web, release/server/server.mjs
const releaseDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = config.STATIC_DIR ?? (config.NODE_ENV === 'production' ? join(releaseDir, 'web') : undefined);
// deploy.sh legt die Git-Revision ins Release; /api/health zeigt sie an.
const revisionFile = join(releaseDir, 'REVISION');
if (config.RELEASE === 'dev' && existsSync(revisionFile)) config.RELEASE = readFileSync(revisionFile, 'utf8').trim().slice(0, 12);
const db = createPool(config);

// Erster Start ohne SETUP_TOKEN: selbst einen erzeugen, solange es noch keinen Passkey gibt.
let setupToken = config.SETUP_TOKEN;
let generatedToken = false;
if (!setupToken) {
  const row = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM credentials').catch(() => undefined);
  if (row && Number(row.n) === 0) {
    setupToken = randomBytes(12).toString('base64url');
    generatedToken = true;
  }
}

const { app } = await buildApp({ ...config, SETUP_TOKEN: setupToken, STATIC_DIR: staticDir }, db);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} – fahre herunter`);
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });

if (generatedToken) {
  const lines = [
    'TakePart – erster Start / first start',
    `Setup-Token: ${setupToken}`,
    `Erster Passkey / first passkey: ${config.APP_ORIGIN}/login`,
    'Gilt bis zum ersten Passkey / valid until the first passkey exists.',
  ];
  const width = Math.max(...lines.map((l) => l.length));
  const bar = '─'.repeat(width + 2);
  console.log(['', `┌${bar}┐`, ...lines.map((l) => `│ ${l.padEnd(width)} │`), `└${bar}┘`, ''].join('\n'));
}
