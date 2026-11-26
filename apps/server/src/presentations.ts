import {
  batchSlides,
  buildsConfig,
  CREATABLE_SLIDE_TYPES,
  defaultConfig,
  parseConfig,
  scheduleInput,
  STARTER_SLIDES,
  type SlideSchedule,
  type SlideType,
} from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { copyAssets, deleteOrphanAssets } from './assets.ts';
import { accessOf, ownsBrand, requireAccess, type Role } from './access.ts';
import { accountOf, requireHost } from './auth.ts';
import { BRAND_COLUMNS, brandView, type BrandRow } from './brands.ts';
import { exec, json, one, query, transaction, type Conn, type Db } from './db.ts';
import { sameValue, mergeConfig } from '@slides/shared';
import { DEMO_TITLE, insertDemoSlides } from './demo.ts';
import type { LiveHub } from './live.ts';
import { touchOf, touchPresentation, type EditHub } from './editing.ts';
import { snapshotVersion } from './versions.ts';
import { sourceInfo } from './google.ts';
import { loadSlides } from './snapshot.ts';
import { loadSchedule, SCHEDULE_COLUMNS, scheduleFromRow, scheduleValues, type ScheduleRow } from './schedule.ts';

const idParam = z.object({ id: z.coerce.number().int() });

/** Vorlage für eine neue Präsentation: Begrüßung mit Code, die beiden Satz-Spiele, Q&A, Feedback. */
export async function insertSlide(
  conn: Conn,
  presentationId: number,
  position: number,
  type: SlideType,
  config: unknown,
  notes: string | null = null,
  schedule?: SlideSchedule,
) {
  const parsed = parseConfig(type, config);
  return exec(
    conn,
    `INSERT INTO slides (presentation_id, position, type, config, notes, ${SCHEDULE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [presentationId, position, type, JSON.stringify(parsed), notes || null, ...scheduleValues(schedule)],
  );
}

/** Folien neu durchnummerieren (Reihenfolge = übergebene IDs). */
export async function renumber(conn: Conn, ids: number[]) {
  for (const [i, sid] of ids.entries()) await exec(conn, 'UPDATE slides SET position = ? WHERE id = ?', [i, sid]);
}

const notesInput = z.string().max(20000);

/** Was der Editor von einer Folie bearbeitet (Antwort auf PATCH, auch im Konflikt) */
interface SlideState {
  config: Record<string, unknown>;
  notes: string;
  schedule: SlideSchedule;
  rev: number;
}

export function presentationRoutes(app: FastifyInstance, db: Db, live: LiveHub, edits: EditHub) {
  const host = { preHandler: requireHost(db) };
  const viewPresentation = requireAccess(db, 'presentation', 'view');
  const ownPresentation = requireAccess(db, 'presentation', 'edit');
  const ownSlide = requireAccess(db, 'slide', 'edit');

  /** Laufende Durchführungen und offene Editoren über Folienänderungen informieren. */
  const touch = (request: import('fastify').FastifyRequest, presentationId: number, change: Parameters<typeof touchPresentation>[5] = {}) =>
    touchPresentation(db, live, edits, presentationId, touchOf(request), change);

  app.get('/api/presentations', host, async (request) => {
    const rows = await query<{
      id: number;
      title: string;
      brand_name: string | null;
      updated_at: Date;
      slides: number;
      runs: number;
      live_run: number | null;
      live_code: string | null;
      rehearsal_run: number | null;
      owner_id: number;
      owner_name: string;
      role: Exclude<Role, 'owner'> | null;
      shared_with: number;
    }>(
      db,
      `SELECT p.id, p.title, p.updated_at, (SELECT b.name FROM brands b WHERE b.id = p.brand_id) AS brand_name,
              (SELECT COUNT(*) FROM slides s WHERE s.presentation_id = p.id) AS slides,
              (SELECT COUNT(*) FROM runs r WHERE r.presentation_id = p.id AND r.rehearsal = 0) AS runs,
              (SELECT r.id FROM runs r WHERE r.presentation_id = p.id AND r.ended_at IS NULL AND r.rehearsal = 0 LIMIT 1) AS live_run,
              (SELECT r.code FROM runs r WHERE r.presentation_id = p.id AND r.ended_at IS NULL AND r.rehearsal = 0 LIMIT 1) AS live_code,
              (SELECT r.id FROM runs r WHERE r.presentation_id = p.id AND r.ended_at IS NULL AND r.rehearsal = 1 LIMIT 1) AS rehearsal_run,
              p.user_id AS owner_id, u.username AS owner_name, sh.role,
              (SELECT COUNT(*) FROM presentation_shares s2 WHERE s2.presentation_id = p.id) AS shared_with
         FROM presentations p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN presentation_shares sh ON sh.presentation_id = p.id AND sh.user_id = ?
        WHERE p.user_id = ? OR sh.user_id IS NOT NULL
        ORDER BY p.updated_at DESC`,
      [accountOf(request).id, accountOf(request).id],
    );
    const me = accountOf(request).id;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      brandName: r.brand_name,
      updatedAt: r.updated_at,
      slides: Number(r.slides),
      runs: Number(r.runs),
      liveRun: r.live_run ? { id: r.live_run, code: r.live_code } : null,
      rehearsalRun: r.rehearsal_run ? { id: r.rehearsal_run } : null,
      role: (r.owner_id === me ? 'owner' : r.role) as Role,
      ownerName: r.owner_id === me ? null : r.owner_name,
      // Für den Eigentümer: mit wie vielen Konten geteilt
      sharedWith: r.owner_id === me ? Number(r.shared_with) : 0,
    }));
  });

  app.post('/api/presentations', host, async (request) => {
    const body = z.object({ title: z.string().trim().min(1).max(200), template: z.boolean().default(true) }).parse(request.body);
    const id = await transaction(db, async (conn) => {
      const result = await exec(conn, 'INSERT INTO presentations (user_id, title) VALUES (?, ?)', [accountOf(request).id, body.title]);
      if (body.template) {
        for (const [i, s] of STARTER_SLIDES.entries()) await insertSlide(conn, result.insertId, i, s.type, s.config, s.notes);
      }
      return result.insertId;
    });
    return { id };
  });

  /** Neue Präsentation mit dem Demo-Foliensatz (alle Funktionen). */
  app.post('/api/presentations/demo', host, async (request) => {
    const id = await transaction(db, async (conn) => {
      const result = await exec(conn, 'INSERT INTO presentations (user_id, title) VALUES (?, ?)', [accountOf(request).id, DEMO_TITLE]);
      await insertDemoSlides(conn, result.insertId);
      return result.insertId;
    });
    return { id };
  });

  /** Demo-Folien in eine leere Präsentation laden. */
  app.post('/api/presentations/:id/demo-slides', ownPresentation, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const pres = await one<{ id: number }>(db, 'SELECT id FROM presentations WHERE id = ?', [id]);
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    const added = await transaction(db, async (conn) => {
      const count = await one<{ n: number }>(conn, 'SELECT COUNT(*) AS n FROM slides WHERE presentation_id = ? FOR UPDATE', [id]);
      if (Number(count?.n ?? 0) > 0) return false;
      await insertDemoSlides(conn, id);
      return true;
    });
    if (!added) return reply.code(409).send({ error: 'Die Präsentation hat schon Folien' });
    await touch(request, id, { structure: true });
    return { ok: true };
  });

  app.get('/api/presentations/:id', viewPresentation, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const pres = await one<BrandRow & { id: number; title: string; updated_at: Date; share_slides: number; target_minutes: number | null }>(
      db,
      `SELECT p.id, p.title, p.updated_at, p.share_slides, p.target_minutes, ${BRAND_COLUMNS}
         FROM presentations p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = ?`,
      [id],
    );
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    const liveRun = await one<{ id: number; code: string }>(
      db,
      'SELECT id, code FROM runs WHERE presentation_id = ? AND ended_at IS NULL AND rehearsal = 0 LIMIT 1',
      [id],
    );
    const rehearsalRun = await one<{ id: number; code: string }>(
      db,
      'SELECT id, code FROM runs WHERE presentation_id = ? AND ended_at IS NULL AND rehearsal = 1 LIMIT 1',
      [id],
    );
    return {
      id: pres.id,
      title: pres.title,
      brandId: pres.brand_id,
      brand: brandView(pres),
      shareSlides: !!pres.share_slides,
      targetMinutes: pres.target_minutes,
      updatedAt: pres.updated_at,
      slides: await loadSlides(db, id),
      // Sprechernotizen nur hier (Host) – nie in Beamer- oder Teilnehmer-Ansichten
      notes: Object.fromEntries(
        (
          await query<{ id: number; notes: string }>(db, 'SELECT id, notes FROM slides WHERE presentation_id = ? AND notes IS NOT NULL', [
            id,
          ])
        ).map((r) => [r.id, r.notes]),
      ),
      // Ablaufplan (Soll-Dauer, Phasen, Auto-Start) – ebenfalls nur für den Host
      schedule: Object.fromEntries(await loadSchedule(db, id)),
      // Änderungszähler je Folie – zeigt dem Editor, welche Folien sich beim Neuladen geändert haben
      revs: Object.fromEntries(
        (await query<{ id: number; rev: number }>(db, 'SELECT id, rev FROM slides WHERE presentation_id = ?', [id])).map((r) => [
          r.id,
          Number(r.rev),
        ]),
      ),
      // Google-Kennung und Prüfsumme je Bildfolie (Abgleich mit Google Slides)
      sources: Object.fromEntries(
        (
          await query<{ id: number; source_key: string | null; source_hash: string | null }>(
            db,
            'SELECT id, source_key, source_hash FROM slides WHERE presentation_id = ? AND (source_key IS NOT NULL OR source_hash IS NOT NULL)',
            [id],
          )
        ).map((r) => [r.id, { key: r.source_key, hash: r.source_hash }]),
      ),
      role: accessOf(request).role,
      ownerName:
        accessOf(request).role === 'owner'
          ? null
          : ((await one<{ username: string }>(db, 'SELECT username FROM users WHERE id = ?', [accessOf(request).ownerId]))?.username ??
            null),
      source: await sourceInfo(db, id),
      liveRun: liveRun ?? null,
      rehearsalRun: rehearsalRun ?? null,
    };
  });

  app.patch('/api/presentations/:id', ownPresentation, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        brandId: z.number().int().nullable().optional(),
        shareSlides: z.boolean().optional(),
        targetMinutes: z.number().int().min(1).max(600).nullable().optional(),
      })
      .parse(request.body);
    // Brandings gehören dem Konto des Eigentümers – nur er wählt sie aus
    if (body.brandId !== undefined && accessOf(request).role !== 'owner') {
      return reply.code(403).send({ error: 'Das Branding legt fest, wem die Präsentation gehört' });
    }
    if (body.brandId && !(await ownsBrand(db, body.brandId, accountOf(request).id))) {
      return reply.code(404).send({ error: 'Branding nicht gefunden' });
    }
    if (body.shareSlides !== undefined)
      await exec(db, 'UPDATE presentations SET share_slides = ? WHERE id = ?', [body.shareSlides ? 1 : 0, id]);
    if (body.targetMinutes !== undefined)
      await exec(db, 'UPDATE presentations SET target_minutes = ? WHERE id = ?', [body.targetMinutes, id]);
    if (body.title !== undefined) await exec(db, 'UPDATE presentations SET title = ? WHERE id = ?', [body.title, id]);
    if (body.brandId !== undefined) await exec(db, 'UPDATE presentations SET brand_id = ? WHERE id = ?', [body.brandId, id]);
    await touch(request, id, { slides: [] });
    return { ok: true };
  });

  app.delete('/api/presentations/:id', requireAccess(db, 'presentation', 'owner'), async (request) => {
    const { id } = idParam.parse(request.params);
    const runs = await query<{ id: number }>(db, 'SELECT id FROM runs WHERE presentation_id = ?', [id]);
    for (const r of runs) live.end(r.id);
    await exec(db, 'DELETE FROM presentations WHERE id = ?', [id]);
    edits.revoke(id);
    return { ok: true };
  });

  // Auch mit Leserecht: die Kopie gehört dem eigenen Konto
  app.post('/api/presentations/:id/duplicate', viewPresentation, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const pres = await one<{ title: string; brand_id: number | null; share_slides: number; target_minutes: number | null }>(
      db,
      'SELECT title, brand_id, share_slides, target_minutes FROM presentations WHERE id = ?',
      [id],
    );
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    const slides = await loadSlides(db, id);
    const notes = new Map(
      (await query<{ id: number; notes: string | null }>(db, 'SELECT id, notes FROM slides WHERE presentation_id = ?', [id])).map((r) => [
        r.id,
        r.notes,
      ]),
    );
    const schedule = await loadSchedule(db, id);
    const newId = await transaction(db, async (conn) => {
      const result = await exec(
        conn,
        'INSERT INTO presentations (user_id, title, brand_id, share_slides, target_minutes) VALUES (?, ?, ?, ?, ?)',
        [
          accountOf(request).id,
          `${pres.title} (Kopie)`.slice(0, 200),
          // Fremde Brandings bleiben im Konto ihres Eigentümers
          accessOf(request).role === 'owner' ? pres.brand_id : null,
          pres.share_slides,
          pres.target_minutes,
        ],
      );
      // Eigene Kopien der Bilder: die Kennungen sind zugleich Zugriffsrechte und sollen nicht geteilt werden.
      const assetMap = await copyAssets(
        conn,
        id,
        result.insertId,
        slides.flatMap((s) => (s.type === 'image' ? [s.config.asset] : [])),
      );
      for (const [i, s] of slides.entries()) {
        const config = s.type === 'image' ? { ...s.config, asset: assetMap.get(s.config.asset) ?? s.config.asset } : s.config;
        await insertSlide(conn, result.insertId, i, s.type, config, notes.get(s.id) ?? null, schedule.get(s.id));
      }
      return result.insertId;
    });
    return { id: newId };
  });

  app.post('/api/presentations/:id/slides', ownPresentation, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ type: z.enum(CREATABLE_SLIDE_TYPES), afterId: z.number().int().nullable().default(null), config: z.unknown().optional() })
      .parse(request.body);
    const pres = await one<{ id: number }>(db, 'SELECT id FROM presentations WHERE id = ?', [id]);
    if (!pres) return reply.code(404).send({ error: 'Präsentation nicht gefunden' });

    const slideId = await transaction(db, async (conn) => {
      const slides = await query<{ id: number }>(conn, 'SELECT id FROM slides WHERE presentation_id = ? ORDER BY position, id FOR UPDATE', [
        id,
      ]);
      const ids = slides.map((s) => s.id);
      const at = body.afterId === null ? ids.length : ids.indexOf(body.afterId) + 1 || ids.length;
      const result = await insertSlide(conn, id, at, body.type, body.config ?? defaultConfig(body.type));
      ids.splice(at, 0, result.insertId);
      for (const [i, sid] of ids.entries()) await exec(conn, 'UPDATE slides SET position = ? WHERE id = ?', [i, sid]);
      return result.insertId;
    });
    await touch(request, id, { structure: true });
    return { id: slideId };
  });

  /**
   * Mehrere Folien auf einmal hinter `afterId` einfügen (Übungsbausteine, eigene
   * Bausteine) – alle oder keine. Importierte Bild-Folien sind hier nicht erlaubt.
   */
  app.post('/api/presentations/:id/slides/batch', { ...ownPresentation, bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ afterId: z.number().int().nullable().default(null), slides: batchSlides }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    let parsed: { type: SlideType; config: unknown; notes: string; schedule?: SlideSchedule }[];
    try {
      parsed = body.data.slides.map((s) => ({
        type: s.type,
        config: parseConfig(s.type, s.config ?? {}),
        notes: s.notes,
        schedule: s.schedule,
      }));
    } catch (err) {
      const message = err instanceof ZodError ? err.issues[0]?.message : err instanceof Error ? err.message : null;
      return reply.code(400).send({ error: message || 'Ungültige Folie' });
    }
    const created = await transaction(db, async (conn) => {
      const ids = (
        await query<{ id: number }>(conn, 'SELECT id FROM slides WHERE presentation_id = ? ORDER BY position, id FOR UPDATE', [id])
      ).map((s) => s.id);
      let at = body.data.afterId === null ? ids.length : ids.indexOf(body.data.afterId) + 1 || ids.length;
      const newIds: number[] = [];
      for (const s of parsed) {
        const result = await insertSlide(conn, id, 0, s.type, s.config, s.notes, s.schedule);
        ids.splice(at++, 0, result.insertId);
        newIds.push(result.insertId);
      }
      await renumber(conn, ids);
      return newIds;
    });
    await touch(request, id, { structure: true });
    return { ids: created };
  });

  /**
   * Folie ändern. Für paralleles Bearbeiten schickt der Editor zu jedem Feld den
   * Stand mit, auf dem seine Änderung beruht (`baseConfig`, `baseNotes`,
   * `baseSchedule`). Hat inzwischen jemand anderes gespeichert, werden Änderungen
   * an verschiedenen Feldern zusammengeführt; widersprechen sie sich, antwortet
   * die Route mit 409 und dem aktuellen Stand – nichts wird still überschrieben.
   * Ohne Basis (ältere Aufrufer) gilt wie bisher „letzte Änderung gewinnt“.
   */
  app.patch('/api/slides/:id', ownSlide, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const parsedBody = z
      .object({
        config: z.unknown().optional(),
        baseConfig: z.record(z.string(), z.unknown()).optional(),
        notes: notesInput.optional(),
        baseNotes: notesInput.optional(),
        baseSchedule: z
          .object({ plannedMinutes: z.number().nullable(), phases: z.array(z.unknown()), autoCountdown: z.boolean() })
          .optional(),
      })
      .and(scheduleInput)
      .safeParse(request.body);
    if (!parsedBody.success) return reply.code(400).send({ error: parsedBody.error.issues[0]?.message || 'Ungültige Eingabe' });
    const body = parsedBody.data;

    type Outcome =
      | { kind: 'missing' }
      | { kind: 'invalid'; message: string }
      | { kind: 'conflict'; fields: string[]; current: SlideState }
      | { kind: 'ok'; state: SlideState; merged: boolean };

    const outcome = await transaction(db, async (conn): Promise<Outcome> => {
      const row = await one<ScheduleRow & { presentation_id: number; type: SlideType; config: string; notes: string | null; rev: number }>(
        conn,
        `SELECT presentation_id, type, config, notes, rev, ${SCHEDULE_COLUMNS} FROM slides WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!row) return { kind: 'missing' };
      const current: SlideState = {
        config: json<Record<string, unknown>>(row.config),
        notes: row.notes ?? '',
        schedule: scheduleFromRow(row),
        rev: Number(row.rev),
      };
      const conflicts: string[] = [];
      let merged = false;

      let config = current.config;
      if (body.config !== undefined) {
        let mine: Record<string, unknown>;
        try {
          mine = parseConfig(row.type, body.config) as Record<string, unknown>;
        } catch (err) {
          const message = err instanceof ZodError ? err.issues[0]?.message : err instanceof Error ? err.message : null;
          return { kind: 'invalid', message: message || 'Ungültige Eingabe' };
        }
        config = mine;
        if (body.baseConfig && !sameValue(body.baseConfig, current.config) && !sameValue(mine, current.config)) {
          const m = mergeConfig(body.baseConfig, mine, current.config);
          if (m.conflicts.length > 0) conflicts.push(...m.conflicts.map((k) => `config.${k}`));
          else {
            try {
              config = parseConfig(row.type, m.merged) as Record<string, unknown>;
              merged = true;
            } catch {
              conflicts.push('config');
            }
          }
        }
        // Das Bild einer importierten Folie lässt sich nicht gegen ein fremdes tauschen.
        if (row.type === 'image' && config.asset !== current.config.asset) {
          return { kind: 'invalid', message: 'Das Folienbild kann nicht geändert werden' };
        }
      }

      const notes = body.notes ?? current.notes;
      if (body.notes !== undefined && body.baseNotes !== undefined && body.baseNotes !== current.notes && body.notes !== current.notes) {
        conflicts.push('notes');
      }

      const schedule = {
        plannedMinutes: body.plannedMinutes !== undefined ? body.plannedMinutes : current.schedule.plannedMinutes,
        phases: body.phases ?? current.schedule.phases,
        autoCountdown: body.autoCountdown ?? current.schedule.autoCountdown,
      };
      if (body.baseSchedule) {
        for (const key of ['plannedMinutes', 'phases', 'autoCountdown'] as const) {
          if (body[key] === undefined) continue;
          if (!sameValue(body.baseSchedule[key], current.schedule[key]) && !sameValue(schedule[key], current.schedule[key])) {
            conflicts.push(key);
          }
        }
      }

      if (conflicts.length > 0) return { kind: 'conflict', fields: conflicts, current };

      const changed = !sameValue(config, current.config) || notes !== current.notes || !sameValue(schedule, current.schedule);
      if (!changed) return { kind: 'ok', state: current, merged };
      await exec(
        conn,
        `UPDATE slides SET config = ?, notes = ?, planned_minutes = ?, phases = ?, auto_countdown = ?, rev = rev + 1 WHERE id = ?`,
        [JSON.stringify(config), notes || null, ...scheduleValues(schedule), id],
      );
      return { kind: 'ok', state: { config, notes, schedule, rev: current.rev + 1 }, merged };
    });

    if (outcome.kind === 'missing') return reply.code(404).send({ error: 'Folie nicht gefunden' });
    if (outcome.kind === 'invalid') return reply.code(400).send({ error: outcome.message });
    if (outcome.kind === 'conflict') {
      return reply.code(409).send({
        error: 'Diese Folie wurde gerade von jemand anderem geändert',
        fields: outcome.fields,
        current: outcome.current,
      });
    }
    await touch(request, accessOf(request).presentationId, { slides: [id] });
    const { state } = outcome;
    return {
      ...state,
      merged: outcome.merged,
      // Für ältere Aufrufer wie bisher
      plannedMinutes: state.schedule.plannedMinutes,
      phases: state.schedule.phases,
      autoCountdown: state.schedule.autoCountdown,
    };
  });

  app.delete('/api/slides/:id', ownSlide, async (request) => {
    const { id } = idParam.parse(request.params);
    const slide = await one<{ presentation_id: number }>(db, 'SELECT presentation_id FROM slides WHERE id = ?', [id]);
    if (!slide) return { ok: true };
    await exec(db, 'DELETE FROM slides WHERE id = ?', [id]);
    await deleteOrphanAssets(db, slide.presentation_id);
    await touch(request, slide.presentation_id, { structure: true });
    return { ok: true };
  });

  app.post('/api/slides/:id/duplicate', ownSlide, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const slide = await one<ScheduleRow & { presentation_id: number; type: SlideType; config: string; notes: string | null }>(
      db,
      `SELECT presentation_id, type, config, notes, ${SCHEDULE_COLUMNS} FROM slides WHERE id = ?`,
      [id],
    );
    if (!slide) return reply.code(404).send({ error: 'Folie nicht gefunden' });
    const newId = await transaction(db, async (conn) => {
      const ids = (
        await query<{ id: number }>(conn, 'SELECT id FROM slides WHERE presentation_id = ? ORDER BY position, id FOR UPDATE', [
          slide.presentation_id,
        ])
      ).map((s) => s.id);
      const result = await insertSlide(conn, slide.presentation_id, 0, slide.type, json(slide.config), slide.notes, scheduleFromRow(slide));
      ids.splice(ids.indexOf(id) + 1, 0, result.insertId);
      for (const [i, sid] of ids.entries()) await exec(conn, 'UPDATE slides SET position = ? WHERE id = ?', [i, sid]);
      return result.insertId;
    });
    await touch(request, slide.presentation_id, { structure: true });
    return { id: newId };
  });

  /**
   * Importierte Folien (PDF-Seiten als zuvor hochgeladene Bilder) als Folgen von
   * Bild-Folien einfügen – hinter `afterId` oder am Ende.
   */
  // Eigenes Limit: 100+ Folien mit Sprechernotizen sprengen die üblichen 64 KB.
  app.post('/api/presentations/:id/slides/import', { ...ownPresentation, bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        afterId: z.number().int().nullable().default(null),
        items: z
          .array(
            z.object({
              asset: z.string(),
              width: z.number().int(),
              height: z.number().int(),
              title: z.string().max(200).default(''),
              notes: notesInput.default(''),
              builds: buildsConfig.optional(),
            }),
          )
          .min(1)
          .max(300),
      })
      .parse(request.body);
    const assets = new Set(
      (await query<{ public_id: string }>(db, 'SELECT public_id FROM assets WHERE presentation_id = ?', [id])).map((r) => r.public_id),
    );
    if (body.items.some((it) => !assets.has(it.asset))) return reply.code(400).send({ error: 'Unbekanntes Folienbild' });
    // Vorher eine Version, damit sich ein Import zurücknehmen lässt
    await snapshotVersion(db, id, 'import', touchOf(request));

    const created = await transaction(db, async (conn) => {
      const ids = (
        await query<{ id: number }>(conn, 'SELECT id FROM slides WHERE presentation_id = ? ORDER BY position, id FOR UPDATE', [id])
      ).map((s) => s.id);
      let at = body.afterId === null ? ids.length : ids.indexOf(body.afterId) + 1 || ids.length;
      const newIds: number[] = [];
      for (const it of body.items) {
        const result = await insertSlide(
          conn,
          id,
          0,
          'image',
          { asset: it.asset, width: it.width, height: it.height, title: it.title.trim().slice(0, 200), builds: it.builds },
          it.notes,
        );
        ids.splice(at++, 0, result.insertId);
        newIds.push(result.insertId);
      }
      await renumber(conn, ids);
      return newIds;
    });
    await touch(request, id, { structure: true });
    return { ids: created };
  });

  /**
   * „Folienbilder aktualisieren“: neue Bilder (aus einem erneuten PDF-Export) für
   * bestehende Bildfolien – an Ort und Stelle. Folien-IDs, Reihenfolge, Animationen,
   * Notizen und alle Ergebnisse bleiben; nur Bild, Maße und Titel wechseln.
   * Die alten Bilder räumt `deleteOrphanAssets` später ab.
   */
  app.post('/api/presentations/:id/slides/replace-images', { ...ownPresentation, bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        items: z
          .array(
            z.object({
              slideId: z.number().int(),
              asset: z.string(),
              width: z.number().int().min(1).max(10000),
              height: z.number().int().min(1).max(10000),
              title: z.string().max(200).optional(),
            }),
          )
          .min(1)
          .max(300),
      })
      .parse(request.body);
    const assets = new Set(
      (await query<{ public_id: string }>(db, 'SELECT public_id FROM assets WHERE presentation_id = ?', [id])).map((r) => r.public_id),
    );
    if (body.items.some((it) => !assets.has(it.asset))) return reply.code(400).send({ error: 'Unbekanntes Folienbild' });
    await snapshotVersion(db, id, 'images', touchOf(request));
    const result = await transaction(db, async (conn) => {
      const slides = new Map(
        (
          await query<{ id: number; config: string }>(
            conn,
            "SELECT id, config FROM slides WHERE presentation_id = ? AND type = 'image' FOR UPDATE",
            [id],
          )
        ).map((s) => [s.id, json<Record<string, unknown>>(s.config)]),
      );
      if (body.items.some((it) => !slides.has(it.slideId))) return null;
      for (const it of body.items) {
        const current = slides.get(it.slideId)!;
        const config = parseConfig('image', {
          ...current,
          asset: it.asset,
          width: it.width,
          height: it.height,
          title: it.title?.trim() ? it.title.trim().slice(0, 200) : current.title,
        });
        await exec(conn, 'UPDATE slides SET config = ?, source_hash = NULL, rev = rev + 1 WHERE id = ?', [
          JSON.stringify(config),
          it.slideId,
        ]);
      }
      return body.items.length;
    });
    if (result === null) return reply.code(400).send({ error: 'Unbekannte Bildfolie' });
    await touch(request, id, { slides: body.items.map((it) => it.slideId) });
    return { updated: result };
  });

  app.put('/api/presentations/:id/order', ownPresentation, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ ids: z.array(z.number().int()) }).parse(request.body);
    const existing = (await query<{ id: number }>(db, 'SELECT id FROM slides WHERE presentation_id = ?', [id])).map((s) => s.id);
    if (existing.length !== body.ids.length || !body.ids.every((sid) => existing.includes(sid))) {
      // Meist hat jemand anderes gerade Folien hinzugefügt oder gelöscht – der Editor lädt neu und versucht es erneut
      return reply.code(409).send({ error: 'Die Folienliste hat sich gerade geändert' });
    }
    await transaction(db, async (conn) => {
      for (const [i, sid] of body.ids.entries()) await exec(conn, 'UPDATE slides SET position = ? WHERE id = ?', [i, sid]);
    });
    await touch(request, id, { structure: true });
    return { ok: true };
  });
}
