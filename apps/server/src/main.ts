import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const config = loadConfig();
// Im Release liegt die Web-App neben dem gebündelten Server: release/web, release/server/server.mjs
const releaseDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = config.STATIC_DIR ?? (config.NODE_ENV === 'production' ? join(releaseDir, 'web') : undefined);
// deploy.sh legt die Git-Revision ins Release; /api/health zeigt sie an.
const revisionFile = join(releaseDir, 'REVISION');
if (config.RELEASE === 'dev' && existsSync(revisionFile)) config.RELEASE = readFileSync(revisionFile, 'utf8').trim().slice(0, 12);
const db = createPool(config);
const { app } = await buildApp({ ...config, STATIC_DIR: staticDir }, db);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} – fahre herunter`);
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
