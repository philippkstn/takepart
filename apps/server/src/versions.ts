import { createHash } from 'node:crypto';
import { parseConfig, stableJson, type SlideSchedule, type SlideType } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accessOf, requireAccess } from './access.ts';
import { deleteOrphanAssets } from './assets.ts';
import { exec, isDuplicateKey, json, one, query, transaction, type Conn, type Db } from './db.ts';
import { touchOf, touchPresentation, type EditHub, type Touch } from './editing.ts';
import type { LiveHub } from './live.ts';
import { SCHEDULE_COLUMNS, scheduleFromRow, scheduleValues, type ScheduleRow } from './schedule.ts';

/**
 * Versionen einer Präsentation: Schnappschüsse aller Folien (Konfiguration,
 * Sprechernotizen, Ablaufplan, Google-Kennung) und der Einstellungen.
 *
 * Entstehen automatisch nach AUTO_AFTER_MINUTES ohne weitere Änderung, vor
 * Import, Bildertausch, Google-Abgleich, Durchführung und Wiederherstellung –
 * und auf Knopfdruck mit Namen. Gleicher Inhalt wie die letzte Version ergibt
 * keine neue (Prüfsumme).
 *
 * Wiederherstellen geschieht an Ort und Stelle: Folien behalten ihre IDs und
 * damit die Ergebnisse früherer Durchführungen; gelöschte Folien kommen mit
 * ihrer alten ID zurück. Folien, die es in der Version nicht gab, werden
 * gelöscht – haben sie Ergebnisse, nur nach ausdrücklicher Bestätigung.
 * Folienbilder, die eine Version braucht, stehen in `version_assets` und
 * überleben das Aufräumen.
 */

const AUTO_AFTER_MINUTES = 10;
/** Unbenannte Versionen je Präsentation; benannte bleiben immer */
const KEEP_UNNAMED = 50;

export const VERSION_REASONS = ['auto', 'named', 'import', 'images', 'google', 'run', 'restore'] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

interface VersionSlide {
  id: number;
  type: SlideType;
  config: Record<string, unknown>;
  notes: string;
  schedule: SlideSchedule;
  sourceKey: string | null;
}

interface VersionData {
  v: 1;
  presentation: { title: string; brandId: number | null; shareSlides: boolean; targetMinutes: number | null };
  slides: VersionSlide[];
}

async function currentData(conn: Conn, presentationId: number): Promise<VersionData | null> {
  const pres = await one<{ title: string; brand_id: number | null; share_slides: number; target_minutes: number | null }>(
    conn,
    'SELECT title, brand_id, share_slides, target_minutes FROM presentations WHERE id = ?',
    [presentationId],
  );
  if (!pres) return null;
  const rows = await query<ScheduleRow & { id: number; type: SlideType; config: string; notes: string | null; source_key: string | null }>(
    conn,
    `SELECT id, type, config, notes, source_key, ${SCHEDULE_COLUMNS} FROM slides WHERE presentation_id = ? ORDER BY position, id`,
    [presentationId],
  );
  return {
    v: 1,
    presentation: {
      title: pres.title,
      brandId: pres.brand_id,
      shareSlides: !!pres.share_slides,
      targetMinutes: pres.target_minutes,
    },
    slides: rows.map((r) => ({
      id: r.id,
      type: r.type,
      config: json<Record<string, unknown>>(r.config),
      notes: r.notes ?? '',
      schedule: scheduleFromRow(r),
      sourceKey: r.source_key,
    })),
  };
}

const hashOf = (data: VersionData) => createHash('sha256').update(stableJson(data)).digest('hex');

const assetsOf = (data: VersionData) => [
  ...new Set(data.slides.flatMap((s) => (s.type === 'image' && typeof s.config.asset === 'string' ? [s.config.asset] : []))),
];

/**
 * Aktuellen Stand als Version sichern. Ist er gleich der letzten Version,
 * entsteht keine neue (mit Namen bekommt die letzte Version den Namen).
 * Liefert die ID der Version.
 */
export async function snapshotVersion(
  db: Db,
  presentationId: number,
  reason: VersionReason,
  who: Pick<Touch, 'userId' | 'username'>,
  label: string | null = null,
): Promise<number | null> {
  return transaction(db, async (conn) => {
    // Sperrt die Präsentation, damit zwei gleichzeitige Schnappschüsse nicht doppelt entstehen
    const locked = await one<{ id: number }>(conn, 'SELECT id FROM presentations WHERE id = ? FOR UPDATE', [presentationId]);
    if (!locked) return null;
    const data = await currentData(conn, presentationId);
    if (!data) return null;
    const hash = hashOf(data);
    const last = await one<{ id: number; hash: string; label: string | null; created_at: Date }>(
      conn,
      'SELECT id, hash, label, created_at FROM presentation_versions WHERE presentation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [presentationId],
    );
    if (last && last.hash === hash) {
      if (label && !last.label) await exec(conn, 'UPDATE presentation_versions SET label = ? WHERE id = ?', [label, last.id]);
      if (!label || !last.label) return last.id;
    }
    // Wer seit der letzten Version bearbeitet hat
    const editors = (
      await query<{ username: string }>(
        conn,
        `SELECT u.username FROM presentation_edits e JOIN users u ON u.id = e.user_id
          WHERE e.presentation_id = ? AND e.edited_at > ? ORDER BY e.edited_at DESC`,
        [presentationId, last?.created_at ?? new Date(0)],
      )
    ).map((r) => r.username);
    const result = await exec(
      conn,
      `INSERT INTO presentation_versions (presentation_id, created_by, reason, label, editors, hash, slide_count, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        presentationId,
        who.userId,
        label ? 'named' : reason,
        label,
        editors.length ? JSON.stringify(editors.slice(0, 20)) : null,
        hash,
        data.slides.length,
        JSON.stringify(data),
      ],
    );
    const assets = assetsOf(data);
    if (assets.length > 0) {
      await exec(conn, 'INSERT INTO version_assets (version_id, public_id) VALUES ?', [assets.map((a) => [result.insertId, a])]);
    }
    // Ältere unbenannte Versionen abräumen (ihre Bilder gibt `version_assets` per Kaskade frei)
    await exec(
      conn,
      `DELETE FROM presentation_versions
        WHERE presentation_id = ? AND label IS NULL
          AND id NOT IN (SELECT id FROM (
            SELECT id FROM presentation_versions WHERE presentation_id = ? AND label IS NULL ORDER BY created_at DESC, id DESC LIMIT ?
          ) AS keep)`,
      [presentationId, presentationId, KEEP_UNNAMED],
    );
    return result.insertId;
  });
}

/**
 * Automatische Versionen: Präsentationen, die seit AUTO_AFTER_MINUTES niemand
 * mehr geändert hat und deren letzte Änderung nach der letzten Version liegt.
 * Läuft minütlich; der Zustand steht vollständig in der Datenbank.
 */
export async function autoVersions(db: Db): Promise<number> {
  const due = await query<{ id: number }>(
    db,
    `SELECT p.id FROM presentations p
      WHERE p.edited_at IS NOT NULL
        AND p.edited_at < UTC_TIMESTAMP(3) - INTERVAL ${AUTO_AFTER_MINUTES} MINUTE
        AND p.edited_at > COALESCE((SELECT MAX(v.created_at) FROM presentation_versions v WHERE v.presentation_id = p.id), '1970-01-01')
      ORDER BY p.edited_at
      LIMIT 20`,
  );
  for (const p of due) {
    await snapshotVersion(db, p.id, 'auto', { userId: null, username: null });
    // Inhalt gleich der letzten Version (z. B. Änderung zurückgenommen): nichts mehr offen –
    // sonst käme die Präsentation jede Minute wieder dran. `updated_at` bleibt (Sortierung der Liste).
    await exec(
      db,
      `UPDATE presentations p SET p.edited_at = NULL, p.updated_at = p.updated_at
        WHERE p.id = ? AND p.edited_at > COALESCE((SELECT MAX(v.created_at) FROM presentation_versions v WHERE v.presentation_id = p.id), '1970-01-01')`,
      [p.id],
    );
  }
  return due.length;
}

function headline(config: Record<string, unknown>): string {
  for (const key of ['title', 'question', 'prompt', 'text']) {
    const v = config[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return '';
}

/** Anzahl gespeicherter Ergebnisse je Folie (Antworten, Beiträge, Wand-Platzierungen, Protokollnotizen) */
async function resultCounts(conn: Conn, slideIds: number[]): Promise<Map<number, number>> {
  if (slideIds.length === 0) return new Map();
  const rows = await query<{ slide_id: number; n: number }>(
    conn,
    `SELECT slide_id, SUM(n) AS n FROM (
        SELECT slide_id, COUNT(*) AS n FROM responses WHERE slide_id IN (?) GROUP BY slide_id
        UNION ALL SELECT slide_id, COUNT(*) FROM posts WHERE slide_id IN (?) GROUP BY slide_id
        UNION ALL SELECT slide_id, COUNT(*) FROM board_places WHERE slide_id IN (?) GROUP BY slide_id
        UNION ALL SELECT slide_id, COUNT(*) FROM run_notes WHERE slide_id IN (?) GROUP BY slide_id
      ) AS t GROUP BY slide_id`,
    [slideIds, slideIds, slideIds, slideIds],
  );
  return new Map(rows.map((r) => [r.slide_id, Number(r.n)]));
}

interface RestorePlan {
  /** Bleibende Folien, die sich ändern */
  changed: number;
  /** Folien, die zurückkommen */
  restored: number;
  /** Folien, die wegfallen – mit Anzahl ihrer Ergebnisse */
  removed: { id: number; type: SlideType; title: string; results: number }[];
}

async function restorePlan(conn: Conn, presentationId: number, version: VersionData): Promise<RestorePlan> {
  const now = await currentData(conn, presentationId);
  const current = new Map((now?.slides ?? []).map((s) => [s.id, s]));
  const kept = new Set(version.slides.map((s) => s.id));
  const removedSlides = [...current.values()].filter((s) => !kept.has(s.id));
  const counts = await resultCounts(
    conn,
    removedSlides.map((s) => s.id),
  );
  return {
    changed: version.slides.filter((s) => {
      const c = current.get(s.id);
      return c && stableJson({ ...c, id: 0 }) !== stableJson({ ...s, id: 0 });
    }).length,
    restored: version.slides.filter((s) => !current.has(s.id)).length,
    removed: removedSlides.map((s) => ({ id: s.id, type: s.type, title: headline(s.config), results: counts.get(s.id) ?? 0 })),
  };
}

export function versionRoutes(app: FastifyInstance, db: Db, live: LiveHub, edits: EditHub) {
  const view = requireAccess(db, 'presentation', 'view');
  const edit = requireAccess(db, 'presentation', 'edit');
  const params = z.object({ id: z.coerce.number().int(), vid: z.coerce.number().int() });
  const labelInput = z.string().trim().min(1).max(120);

  const loadVersion = async (conn: Conn, presentationId: number, versionId: number) => {
    const row = await one<{ data: string }>(conn, 'SELECT data FROM presentation_versions WHERE id = ? AND presentation_id = ?', [
      versionId,
      presentationId,
    ]);
    return row ? json<VersionData>(row.data) : null;
  };

  app.get('/api/presentations/:id/versions', view, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const rows = await query<{
      id: number;
      created_at: Date;
      reason: VersionReason;
      label: string | null;
      editors: string | null;
      slide_count: number;
      created_by: string | null;
    }>(
      db,
      `SELECT v.id, v.created_at, v.reason, v.label, v.editors, v.slide_count, u.username AS created_by
         FROM presentation_versions v LEFT JOIN users u ON u.id = v.created_by
        WHERE v.presentation_id = ? ORDER BY v.created_at DESC, v.id DESC`,
      [id],
    );
    const pending = await one<{ pending: number }>(
      db,
      `SELECT (p.edited_at IS NOT NULL AND p.edited_at > COALESCE(
                 (SELECT MAX(v.created_at) FROM presentation_versions v WHERE v.presentation_id = p.id), '1970-01-01')) AS pending
         FROM presentations p WHERE p.id = ?`,
      [id],
    );
    return {
      // Gibt es Änderungen seit der letzten Version?
      unsaved: !!Number(pending?.pending ?? 0),
      versions: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        reason: r.reason,
        label: r.label,
        editors: r.editors ? json<string[]>(r.editors) : [],
        createdBy: r.created_by,
        slideCount: Number(r.slide_count),
      })),
    };
  });

  /** Inhalt einer Version samt Vorschau, was das Wiederherstellen ändert */
  app.get('/api/presentations/:id/versions/:vid', view, async (request, reply) => {
    const { id, vid } = params.parse(request.params);
    const data = await loadVersion(db, id, vid);
    if (!data) return reply.code(404).send({ error: 'Version nicht gefunden' });
    return {
      title: data.presentation.title,
      slides: data.slides.map((s) => ({
        id: s.id,
        type: s.type,
        title: headline(s.config),
        asset: s.type === 'image' && typeof s.config.asset === 'string' ? s.config.asset : null,
      })),
      plan: await restorePlan(db, id, data),
    };
  });

  /** Version mit Namen speichern („Stand vor dem Workshop“) */
  app.post('/api/presentations/:id/versions', edit, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    const { label } = z.object({ label: labelInput }).parse(request.body);
    const versionId = await snapshotVersion(db, id, 'named', touchOf(request), label);
    edits.changed(id, { by: touchOf(request).client, who: touchOf(request).username, versions: true, slides: [] });
    return { id: versionId };
  });

  app.patch('/api/presentations/:id/versions/:vid', edit, async (request, reply) => {
    const { id, vid } = params.parse(request.params);
    const { label } = z.object({ label: labelInput.nullable() }).parse(request.body);
    const result = await exec(db, 'UPDATE presentation_versions SET label = ? WHERE id = ? AND presentation_id = ?', [label, vid, id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Version nicht gefunden' });
    edits.changed(id, { by: touchOf(request).client, who: touchOf(request).username, versions: true, slides: [] });
    return { ok: true };
  });

  app.post('/api/presentations/:id/versions/:vid/restore', edit, async (request, reply) => {
    const { id, vid } = params.parse(request.params);
    const { dropResults } = z.object({ dropResults: z.boolean().default(false) }).parse(request.body ?? {});
    const open = await one<{ id: number }>(db, 'SELECT id FROM runs WHERE presentation_id = ? AND ended_at IS NULL LIMIT 1', [id]);
    if (open) {
      return reply.code(409).send({ error: 'Während einer Durchführung oder eines Probelaufs lässt sich keine Version wiederherstellen' });
    }
    const data = await loadVersion(db, id, vid);
    if (!data) return reply.code(404).send({ error: 'Version nicht gefunden' });
    const plan = await restorePlan(db, id, data);
    if (!dropResults && plan.removed.some((s) => s.results > 0)) {
      return reply.code(409).send({ error: 'Beim Wiederherstellen gingen Ergebnisse verloren', plan });
    }
    // Den Stand davor sichern – so lässt sich auch das Wiederherstellen zurücknehmen
    await snapshotVersion(db, id, 'restore', touchOf(request));

    const ownerId = accessOf(request).ownerId;
    await transaction(db, async (conn) => {
      await exec(conn, 'SELECT id FROM presentations WHERE id = ? FOR UPDATE', [id]);
      const existing = new Set(
        (await query<{ id: number }>(conn, 'SELECT id FROM slides WHERE presentation_id = ? FOR UPDATE', [id])).map((r) => r.id),
      );
      const keep = new Set(data.slides.map((s) => s.id));
      const drop = [...existing].filter((sid) => !keep.has(sid));
      if (drop.length > 0) await exec(conn, 'DELETE FROM slides WHERE id IN (?)', [drop]);
      for (const [position, s] of data.slides.entries()) {
        // Gegen das aktuelle Schema prüfen (ältere Versionen); Unlesbares überspringen
        let config: unknown;
        try {
          config = parseConfig(s.type, s.config);
        } catch {
          continue;
        }
        const values = [JSON.stringify(config), s.notes || null, s.sourceKey, ...scheduleValues(s.schedule)];
        if (existing.has(s.id)) {
          await exec(
            conn,
            `UPDATE slides SET position = ?, config = ?, notes = ?, source_key = ?, planned_minutes = ?, phases = ?, auto_countdown = ?,
                    source_hash = NULL, rev = rev + 1 WHERE id = ? AND presentation_id = ?`,
            [position, ...values, s.id, id],
          );
          continue;
        }
        const insert = (withId: boolean) =>
          exec(
            conn,
            `INSERT INTO slides (${withId ? 'id, ' : ''}presentation_id, position, type, config, notes, source_key, ${SCHEDULE_COLUMNS})
             VALUES (${withId ? '?, ' : ''}?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [...(withId ? [s.id] : []), id, position, s.type, ...values],
          );
        // Gelöschte Folien kommen mit ihrer alten ID zurück (die vergibt die Datenbank nie neu)
        try {
          await insert(true);
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
          await insert(false);
        }
      }
      const p = data.presentation;
      // Branding nur, wenn es dem Eigentümer noch gehört
      const brand = p.brandId
        ? await one<{ id: number }>(conn, 'SELECT id FROM brands WHERE id = ? AND user_id = ?', [p.brandId, ownerId])
        : null;
      await exec(conn, 'UPDATE presentations SET title = ?, brand_id = ?, share_slides = ?, target_minutes = ? WHERE id = ?', [
        p.title,
        brand?.id ?? null,
        p.shareSlides ? 1 : 0,
        p.targetMinutes,
        id,
      ]);
    });
    await deleteOrphanAssets(db, id);
    await touchPresentation(db, live, edits, id, touchOf(request), { structure: true, versions: true });
    return { ok: true, plan };
  });
}
