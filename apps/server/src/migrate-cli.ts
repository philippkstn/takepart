import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { migrate } from './migrate.ts';

const config = loadConfig();
const db = createPool(config);
try {
  await migrate(db);
} catch (err) {
  console.error('Migration fehlgeschlagen:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
}
