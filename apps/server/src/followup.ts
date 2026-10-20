import { parseBoardKey, parseConfig, type BoardSummary, type SlideConfigs, type SlideType } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOwner } from './access.ts';
import { accountOf } from './auth.ts';
import { exec, one, transaction, type Db } from './db.ts';
import { runResults } from './runs.ts';

/**
 * Folgetermin-Vorlage: aus einer Durchführung eine neue Präsentation mit
 * Startfolien – Titel, Rückblick, je Top-Thema der Ergebnistabelle eine Textfolie
 * mit den Tabellenfeldern und eine Skala „Wie weit sind wir …?“, am Ende Q&A.
 */

/** Mehr Themen ergäben einen unhandlichen Foliensatz */
export const MAX_FOLLOWUP_TOPICS = 10;

export interface FollowupTopic {
  label: string;
  /** Tabellenfelder, z. B. Verantwortlich, Nächster Schritt, Termin */
  fields: { column: string; value: string }[];
}

export interface FollowupInput {
  title: string;
  /** Datum der Durchführung, bereits formatiert */
  date: string;
  participants: number;
  topics: FollowupTopic[];
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Startfolien des Folgetermins (rein, ohne Datenbank) */
export function followupSlides(input: FollowupInput): { type: SlideType; config: Record<string, unknown> }[] {
  const topics = dedupeTopics(input.topics).slice(0, MAX_FOLLOWUP_TOPICS);
  const review = [
    `Termin: ${input.date}`,
    `Teilnehmende: ${input.participants}`,
    ...(topics.length > 0 ? ['', 'Vereinbarte Themen:', ...topics.map((t) => `– ${t.label}`)] : []),
  ].join('\n');

  return [
    {
      type: 'content',
      config: {
        title: cut(`Follow-up: ${input.title}`, 200),
        body: cut(`Wir knüpfen an den Termin vom ${input.date} an.`, 2000),
        showJoin: true,
      },
    },
    { type: 'content', config: { title: 'Rückblick', body: cut(review, 2000), showJoin: false } },
    ...topics.flatMap((t) => [
      {
        type: 'content' as const,
        config: {
          title: cut(t.label, 200),
          body: cut(
            t.fields.length > 0 ? t.fields.map((f) => `${f.column}: ${f.value.trim() || '–'}`).join('\n') : 'Was ist seitdem passiert?',
            2000,
          ),
          showJoin: false,
        },
      },
      {
        type: 'scale' as const,
        config: {
          question: cut(`Wie weit sind wir bei „${t.label}“?`, 300),
          max: 5,
          minLabel: 'noch nicht begonnen',
          maxLabel: 'erledigt',
        },
      },
    ]),
    { type: 'qa', config: { title: 'Offene Fragen', moderated: true } },
  ];
}

/** Gleiche Themen aus mehreren Tabellen nur einmal; leere Überschriften fallen weg */
function dedupeTopics(topics: FollowupTopic[]): FollowupTopic[] {
  const seen = new Set<string>();
  return topics.flatMap((t) => {
    const label = t.label.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) return [];
    seen.add(key);
    return [{ ...t, label }];
  });
}

/** Zeilen einer Ergebnistabelle (Modus `table`) mit aufgelösten Überschriften */
export function tableTopics(config: SlideConfigs['board'], board: BoardSummary): FollowupTopic[] {
  return board.view.rows.map((row) => {
    const parsed = parseBoardKey(row.key);
    const label =
      parsed?.kind === 'group'
        ? (board.view.groups.find((g) => g.id === parsed.id)?.name ?? '')
        : parsed
          ? (board.cards.find((c) => c.id === parsed.id)?.text ?? '')
          : '';
    return { label, fields: config.columns.map((column, i) => ({ column, value: row.fields[i] ?? '' })) };
  });
}

function formatDate(date: Date, timeZone: string): string {
  try {
    return date.toLocaleDateString('de-DE', { dateStyle: 'long', timeZone });
  } catch {
    return date.toLocaleDateString('de-DE', { dateStyle: 'long', timeZone: 'Europe/Berlin' });
  }
}

export function followupRoutes(app: FastifyInstance, db: Db) {
  app.post('/api/runs/:id/followup', requireOwner(db, 'run'), async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(request.params);
    // Zeitzone des Browsers, damit das Datum stimmt (der Server läuft oft in UTC)
    const body = z.object({ timeZone: z.string().max(60).default('Europe/Berlin') }).parse(request.body ?? {});
    const data = await runResults(db, id);
    if (!data) return reply.code(404).send({ error: 'Durchführung nicht gefunden' });
    const pres = await one<{ brand_id: number | null; target_minutes: number | null }>(
      db,
      'SELECT brand_id, target_minutes FROM presentations WHERE id = ?',
      [data.presentationId],
    );
    const topics = data.slides.flatMap((s) => {
      const config = s.config as SlideConfigs['board'];
      return s.type === 'board' && s.board && config.mode === 'table' ? tableTopics(config, s.board) : [];
    });
    const slides = followupSlides({
      title: data.title,
      date: formatDate(data.startedAt, body.timeZone),
      participants: data.participants,
      topics,
    });
    const newId = await transaction(db, async (conn) => {
      const result = await exec(conn, 'INSERT INTO presentations (user_id, title, brand_id, target_minutes) VALUES (?, ?, ?, ?)', [
        accountOf(request).id,
        cut(`Follow-up: ${data.title}`, 200),
        pres?.brand_id ?? null,
        pres?.target_minutes ?? null,
      ]);
      for (const [position, s] of slides.entries()) {
        await exec(conn, 'INSERT INTO slides (presentation_id, position, type, config) VALUES (?, ?, ?, ?)', [
          result.insertId,
          position,
          s.type,
          JSON.stringify(parseConfig(s.type, s.config)),
        ]);
      }
      return result.insertId;
    });
    return { id: newId };
  });
}
