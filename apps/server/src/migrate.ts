import type { Pool } from 'mysql2/promise';
import { exec, query } from './db.ts';
import { migrations } from './migrations.ts';

/**
 * Führt ausstehende Migrationen aus. MariaDB kann DDL nicht in Transaktionen
 * zurückrollen, deshalb wird jede Migration erst nach Erfolg aller Anweisungen
 * als erledigt eingetragen; eine halb gelaufene Migration fällt beim nächsten
 * Versuch an "Tabelle existiert bereits" auf und muss von Hand geprüft werden.
 */
export async function migrate(db: Pool, log: (msg: string) => void = console.log): Promise<number> {
  await exec(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(100) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  const done = new Set((await query<{ name: string }>(db, 'SELECT name FROM schema_migrations')).map((r) => r.name));
  let applied = 0;
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    log(`Migration ${m.name}`);
    for (const statement of m.statements) await exec(db, statement);
    await exec(db, 'INSERT INTO schema_migrations (name) VALUES (?)', [m.name]);
    applied++;
  }
  log(applied === 0 ? 'Datenbank ist aktuell' : `${applied} Migration(en) ausgeführt`);
  return applied;
}
