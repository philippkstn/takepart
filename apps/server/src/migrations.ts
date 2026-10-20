/**
 * Datenbank-Migrationen (MariaDB 10.11, wie auf dem Uberspace).
 *
 * Als TypeScript-Modul statt als .sql-Dateien, damit sie im gebündelten
 * migrate.mjs enthalten sind. Einträge nie ändern oder umsortieren – nur neue
 * anhängen. Ausgeführt von deploy.sh vor dem Umschalten (`node migrate.mjs`).
 */
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { exec, one, type Conn } from './db.ts';
import { insertDemoBrands } from './demo.ts';

export interface Migration {
  name: string;
  statements?: string[];
  /** Für Daten-Migrationen, die mehr als SQL-Anweisungen brauchen */
  run?: (conn: Conn) => Promise<void>;
}

export const migrations: Migration[] = [
  {
    name: '001_init',
    statements: [
      `CREATE TABLE credentials (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        public_key VARBINARY(1024) NOT NULL,
        counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
        transports VARCHAR(255) NULL,
        label VARCHAR(100) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        last_used_at DATETIME(3) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE host_sessions (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        expires_at DATETIME(3) NOT NULL,
        INDEX idx_host_sessions_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE presentations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE slides (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        presentation_id INT UNSIGNED NOT NULL,
        position INT NOT NULL,
        type VARCHAR(20) NOT NULL,
        config JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX idx_slides_presentation (presentation_id, position),
        CONSTRAINT fk_slides_presentation FOREIGN KEY (presentation_id) REFERENCES presentations (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE runs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        presentation_id INT UNSIGNED NOT NULL,
        code CHAR(6) NULL,
        display_token CHAR(32) NOT NULL,
        state JSON NOT NULL,
        started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        ended_at DATETIME(3) NULL,
        UNIQUE KEY uq_runs_code (code),
        UNIQUE KEY uq_runs_display_token (display_token),
        INDEX idx_runs_presentation (presentation_id),
        CONSTRAINT fk_runs_presentation FOREIGN KEY (presentation_id) REFERENCES presentations (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE participants (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        run_id INT UNSIGNED NOT NULL,
        token CHAR(32) NOT NULL,
        name VARCHAR(60) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_participants_token (token),
        INDEX idx_participants_run (run_id),
        CONSTRAINT fk_participants_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // Eine Antwort pro Person, Folie und Runde (Runde nur beim Satz-Spiel > 1)
      `CREATE TABLE responses (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        run_id INT UNSIGNED NOT NULL,
        slide_id INT UNSIGNED NOT NULL,
        participant_id INT UNSIGNED NOT NULL,
        round INT NOT NULL DEFAULT 1,
        payload JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_responses_once (run_id, slide_id, participant_id, round),
        INDEX idx_responses_slide (run_id, slide_id, round),
        CONSTRAINT fk_responses_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE,
        CONSTRAINT fk_responses_slide FOREIGN KEY (slide_id) REFERENCES slides (id) ON DELETE CASCADE,
        CONSTRAINT fk_responses_participant FOREIGN KEY (participant_id) REFERENCES participants (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // Beiträge als Karten: offene Antworten, Brainstorming, Pinnwand, Q&A
      `CREATE TABLE posts (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        run_id INT UNSIGNED NOT NULL,
        slide_id INT UNSIGNED NOT NULL,
        participant_id INT UNSIGNED NOT NULL,
        author_name VARCHAR(60) NULL,
        text VARCHAR(500) NOT NULL,
        column_index TINYINT UNSIGNED NULL,
        status ENUM('pending', 'visible', 'hidden', 'answered') NOT NULL DEFAULT 'visible',
        votes INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_posts_slide (run_id, slide_id),
        CONSTRAINT fk_posts_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE,
        CONSTRAINT fk_posts_slide FOREIGN KEY (slide_id) REFERENCES slides (id) ON DELETE CASCADE,
        CONSTRAINT fk_posts_participant FOREIGN KEY (participant_id) REFERENCES participants (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE post_votes (
        post_id INT UNSIGNED NOT NULL,
        participant_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (post_id, participant_id),
        CONSTRAINT fk_post_votes_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
        CONSTRAINT fk_post_votes_participant FOREIGN KEY (participant_id) REFERENCES participants (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ],
  },
  {
    name: '002_brands',
    statements: [
      // Optionales Branding pro Präsentation: Name, Farben, Logo (als Datei in der DB)
      `CREATE TABLE brands (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        accent CHAR(7) NOT NULL,
        chart CHAR(7) NOT NULL,
        logo MEDIUMBLOB NULL,
        logo_type VARCHAR(40) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `ALTER TABLE presentations
        ADD COLUMN brand_id INT UNSIGNED NULL AFTER title,
        ADD CONSTRAINT fk_presentations_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL`,
    ],
  },
  {
    // Demo-Brandings für den ersten Start (fiktive Namen, verschiedene Farbschemata)
    name: '003_demo_brands',
    run: insertDemoBrands,
  },
  {
    // Slides-Engine: importierte Folienbilder, Sprechernotizen, Präsentations-Einstellungen, Freigabe-Link
    name: '004_slides_engine',
    statements: [
      `CREATE TABLE assets (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        presentation_id INT UNSIGNED NOT NULL,
        public_id CHAR(32) NOT NULL,
        mime VARCHAR(40) NOT NULL,
        width INT UNSIGNED NOT NULL,
        height INT UNSIGNED NOT NULL,
        data MEDIUMBLOB NOT NULL,
        thumb MEDIUMBLOB NULL,
        thumb_mime VARCHAR(40) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_assets_public_id (public_id),
        INDEX idx_assets_presentation (presentation_id),
        CONSTRAINT fk_assets_presentation FOREIGN KEY (presentation_id) REFERENCES presentations (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `ALTER TABLE slides ADD COLUMN notes TEXT NULL AFTER config`,
      `ALTER TABLE presentations
        ADD COLUMN share_slides TINYINT(1) NOT NULL DEFAULT 1 AFTER brand_id,
        ADD COLUMN target_minutes SMALLINT UNSIGNED NULL AFTER share_slides`,
      `ALTER TABLE runs ADD COLUMN handout_token CHAR(32) NULL AFTER display_token, ADD UNIQUE KEY uq_runs_handout_token (handout_token)`,
    ],
  },
  {
    // Kartenwand: Gruppen (Cluster) je Wand, Platzierungen und Tabellenzeilen je Folie.
    // Karten sind Beiträge (posts); von der Moderation ergänzte Karten haben keine Person.
    name: '005_board',
    statements: [
      `CREATE TABLE board_groups (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        run_id INT UNSIGNED NOT NULL,
        board VARCHAR(60) NOT NULL,
        name VARCHAR(120) NOT NULL,
        position INT NOT NULL DEFAULT 0,
        participant_id INT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_board_groups_run (run_id, board),
        CONSTRAINT fk_board_groups_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE,
        CONSTRAINT fk_board_groups_participant FOREIGN KEY (participant_id) REFERENCES participants (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `ALTER TABLE posts
        MODIFY participant_id INT UNSIGNED NULL,
        ADD COLUMN group_id INT UNSIGNED NULL AFTER column_index,
        ADD CONSTRAINT fk_posts_group FOREIGN KEY (group_id) REFERENCES board_groups (id) ON DELETE SET NULL`,
      // target: 'c<postId>' oder 'g<groupId>'; lane/cell beim Zuordnen, position/fields in der Ergebnistabelle
      `CREATE TABLE board_places (
        run_id INT UNSIGNED NOT NULL,
        slide_id INT UNSIGNED NOT NULL,
        target VARCHAR(12) NOT NULL,
        lane TINYINT UNSIGNED NULL,
        cell TINYINT UNSIGNED NULL,
        position INT NOT NULL DEFAULT 0,
        fields TEXT NULL,
        PRIMARY KEY (run_id, slide_id, target),
        CONSTRAINT fk_board_places_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE,
        CONSTRAINT fk_board_places_slide FOREIGN KEY (slide_id) REFERENCES slides (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ],
  },
  {
    // Mehrere Konten: jedes mit eigenen Passkeys, optionalem Passwort, eigenen Präsentationen und Brandings.
    // Bestehende Daten gehören danach dem Konto „admin“; alle Sitzungen enden (neu anmelden).
    name: '006_accounts',
    run: async (conn) => {
      await exec(
        conn,
        `CREATE TABLE users (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) NOT NULL,
          password_hash VARCHAR(255) NULL,
          webauthn_handle VARCHAR(64) NOT NULL,
          is_admin TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          last_login_at DATETIME(3) NULL,
          UNIQUE KEY uq_users_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
      for (const table of ['credentials', 'presentations', 'brands']) {
        await exec(conn, `ALTER TABLE ${table} ADD COLUMN user_id INT UNSIGNED NULL`);
      }
      const used = await one<{ n: number }>(conn, 'SELECT (SELECT COUNT(*) FROM credentials) + (SELECT COUNT(*) FROM presentations) AS n');
      if (Number(used?.n) > 0) {
        // Bisherige Passkeys wurden mit der Kennung „slides-host“ angelegt – beibehalten.
        await exec(conn, "INSERT INTO users (id, username, webauthn_handle, is_admin) VALUES (1, 'admin', ?, 1)", [
          Buffer.from('slides-host').toString('base64url'),
        ]);
        for (const table of ['credentials', 'presentations', 'brands']) await exec(conn, `UPDATE ${table} SET user_id = 1`);
      } else {
        // Frische Installation: die Demo-Brandings bekommt jedes neue Konto selbst.
        await exec(conn, 'DELETE FROM brands');
      }
      for (const table of ['credentials', 'presentations', 'brands']) {
        await exec(
          conn,
          `ALTER TABLE ${table} MODIFY user_id INT UNSIGNED NOT NULL,
            ADD CONSTRAINT fk_${table}_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE`,
        );
      }
      await exec(conn, 'DELETE FROM host_sessions');
      await exec(
        conn,
        `ALTER TABLE host_sessions ADD COLUMN user_id INT UNSIGNED NOT NULL AFTER token_hash,
          ADD CONSTRAINT fk_host_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE`,
      );
    },
  },
  {
    // Zeitstempel mit CURRENT_TIMESTAMP-Vorgabe wurden in der Zeitzone des Datenbankservers
    // gespeichert, aber als UTC gelesen. Seit jede Verbindung UTC nutzt, einmalig umrechnen.
    // Auf Servern mit UTC (z. B. Docker) ist der Versatz 0 und es passiert nichts.
    name: '007_utc_timestamps',
    run: async (db) => {
      const conn = await (db as Pool).getConnection();
      let offset = 0;
      try {
        await conn.query('SET time_zone = @@global.time_zone');
        const [rows] = await conn.query<RowDataPacket[]>('SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS off');
        offset = Number(rows[0]?.off ?? 0);
      } finally {
        await conn.query("SET time_zone = '+00:00'");
        conn.release();
      }
      if (offset === 0) return;
      const columns: Record<string, string[]> = {
        credentials: ['created_at'],
        host_sessions: ['created_at'],
        users: ['created_at'],
        presentations: ['created_at', 'updated_at'],
        slides: ['created_at', 'updated_at'],
        brands: ['created_at', 'updated_at'],
        assets: ['created_at'],
        runs: ['started_at'],
        participants: ['created_at'],
        responses: ['created_at', 'updated_at'],
        posts: ['created_at'],
        board_groups: ['created_at'],
      };
      for (const [table, cols] of Object.entries(columns)) {
        // updated_at ausdrücklich mit setzen, sonst stempelt ON UPDATE die Zeile neu
        await exec(
          db,
          `UPDATE ${table} SET ${cols.map((c) => `${c} = ${c} - INTERVAL ? MINUTE`).join(', ')}`,
          cols.map(() => offset),
        );
      }
    },
  },
  {
    // Breakout: Arbeitsgruppe (Index der Einteilung aus „Gruppen bilden“), in der eine Karte
    // gesammelt wurde. Fest beim Anlegen gespeichert – spätere Umbesetzungen ändern die Herkunft nicht.
    name: '008_breakout',
    statements: ['ALTER TABLE posts ADD COLUMN team SMALLINT UNSIGNED NULL AFTER group_id'],
  },
  {
    // Probeläufe (nicht im Archiv), simulierte Teilnehmende und eigene Übungsbausteine je Konto
    name: '009_prep',
    statements: [
      'ALTER TABLE runs ADD COLUMN rehearsal TINYINT(1) NOT NULL DEFAULT 0',
      'ALTER TABLE participants ADD COLUMN fake TINYINT(1) NOT NULL DEFAULT 0',
      `CREATE TABLE blocks (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        slides MEDIUMTEXT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_blocks_user (user_id),
        CONSTRAINT fk_blocks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ],
  },
];
