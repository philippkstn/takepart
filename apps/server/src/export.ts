import {
  parseBoardKey,
  SLIDE_TYPE_LABELS,
  slideHeadline,
  type QuizAnswer,
  type ResponsePayloads,
  type RunState,
  type Slide,
} from '@slides/shared';
import { json, one, query, type Db } from './db.ts';
import { loadSlides } from './snapshot.ts';

/**
 * CSV-Export einer Durchführung: eine Zeile pro Antwort bzw. Beitrag.
 * Semikolon und BOM, damit Excel mit deutschen Einstellungen die Datei direkt öffnet.
 * Teilnehmende erscheinen als laufende Nummer, nicht mit ihrem internen Token.
 */
export async function exportCsv(db: Db, runId: number): Promise<string | null> {
  const run = await one<{ presentation_id: number; state: string }>(db, 'SELECT presentation_id, state FROM runs WHERE id = ?', [runId]);
  if (!run) return null;
  const slides = await loadSlides(db, run.presentation_id);
  const bySlide = new Map(slides.map((s, i) => [s.id, { slide: s, index: i + 1 }]));

  const participants = await query<{ id: number; name: string | null }>(
    db,
    'SELECT id, name FROM participants WHERE run_id = ? ORDER BY id',
    [runId],
  );
  const number = new Map(participants.map((p, i) => [p.id, i + 1]));
  const names = new Map(participants.map((p) => [p.id, p.name ?? '']));

  const rows: string[][] = [['Folie', 'Typ', 'Frage', 'Teilnehmer', 'Name', 'Runde', 'Antwort', 'Details', 'Zeitpunkt']];

  const responses = await query<{ slide_id: number; participant_id: number; round: number; payload: string; created_at: Date }>(
    db,
    'SELECT slide_id, participant_id, round, payload, created_at FROM responses WHERE run_id = ? ORDER BY slide_id, round, id',
    [runId],
  );
  const posts = await query<{
    id: number;
    slide_id: number;
    participant_id: number | null;
    author_name: string | null;
    text: string;
    column_index: number | null;
    status: string;
    votes: number;
    group_id: number | null;
    created_at: Date;
  }>(db, 'SELECT * FROM posts WHERE run_id = ? ORDER BY slide_id, id', [runId]);

  // Kartenwand: Gruppen und Kartentexte, um Punkte und Bewertungen lesbar zu machen
  const groups = await query<{ id: number; name: string }>(db, 'SELECT id, name FROM board_groups WHERE run_id = ?', [runId]);
  const groupNames = new Map(groups.map((g) => [g.id, g.name]));
  const cardTexts = new Map(posts.map((p) => [p.id, p.text]));
  const label = (key: string) => {
    const parsed = parseBoardKey(key);
    if (!parsed) return key;
    const text = parsed.kind === 'group' ? groupNames.get(parsed.id) : cardTexts.get(parsed.id);
    return text ?? key;
  };

  const base = (slideId: number, participantId: number | null) => {
    const s = bySlide.get(slideId)!;
    return [
      String(s.index),
      SLIDE_TYPE_LABELS[s.slide.type],
      slideHeadline(s.slide),
      participantId === null ? '' : String(number.get(participantId) ?? ''),
      participantId === null ? 'Moderation' : (names.get(participantId) ?? ''),
    ];
  };

  for (const r of responses) {
    const s = bySlide.get(r.slide_id);
    if (!s) continue;
    const [answer, details] = describe(s.slide, json(r.payload), label);
    rows.push([...base(r.slide_id, r.participant_id), String(r.round), answer, details, r.created_at.toISOString()]);
  }
  // Gruppen bilden: je Person eine Zeile mit ihrer Gruppe
  const teams = json<RunState>(run.state).teams ?? {};
  for (const [slideId, assigned] of Object.entries(teams)) {
    if (!bySlide.has(Number(slideId))) continue;
    assigned.forEach((ids, i) => {
      for (const id of ids) rows.push([...base(Number(slideId), id), '', `Gruppe ${i + 1}`, 'Gruppeneinteilung', '']);
    });
  }
  for (const p of posts) {
    const s = bySlide.get(p.slide_id);
    if (!s) continue;
    const details = [
      s.slide.type === 'pinboard' && p.column_index !== null
        ? `Spalte: ${s.slide.config.columns[p.column_index] ?? p.column_index + 1}`
        : '',
      s.slide.type === 'board' && p.column_index !== null
        ? `Kennzeichnung: ${s.slide.config.tags[p.column_index] ?? p.column_index + 1}`
        : '',
      p.group_id !== null ? `Gruppe: ${groupNames.get(p.group_id) ?? p.group_id}` : '',
      p.votes > 0 ? `${p.votes} Stimmen` : '',
      p.status === 'visible' ? '' : `Status: ${p.status}`,
    ]
      .filter(Boolean)
      .join(', ');
    const row = base(p.slide_id, p.participant_id);
    if (p.author_name) row[4] = p.author_name;
    rows.push([...row, '', p.text, details, p.created_at.toISOString()]);
  }
  // Protokollnotizen der Moderation
  const notes = await query<{ slide_id: number; text: string; updated_at: Date }>(
    db,
    'SELECT slide_id, text, updated_at FROM run_notes WHERE run_id = ?',
    [runId],
  );
  for (const n of notes) {
    if (!bySlide.has(n.slide_id)) continue;
    rows.push([...base(n.slide_id, null), '', n.text, 'Notiz der Moderation', n.updated_at.toISOString()]);
  }

  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

function describe(slide: Slide, payload: unknown, label: (key: string) => string): [string, string] {
  switch (slide.type) {
    case 'choice': {
      const p = payload as ResponsePayloads['choice'];
      return [p.choices.map((i) => slide.config.options[i] ?? `#${i + 1}`).join(' | '), ''];
    }
    case 'scale':
      return [String((payload as ResponsePayloads['scale']).value), `von ${slide.config.max}`];
    case 'wordcloud':
      return [(payload as ResponsePayloads['wordcloud']).words.join(' | '), ''];
    case 'ranking':
      return [(payload as ResponsePayloads['ranking']).order.map((i) => slide.config.options[i] ?? `#${i + 1}`).join(' > '), ''];
    case 'quiz': {
      const p = payload as QuizAnswer;
      return [
        slide.config.options[p.choice] ?? `#${p.choice + 1}`,
        `${p.correct ? 'richtig' : 'falsch'}, ${p.points} Punkte, ${(p.ms / 1000).toFixed(1)} s`,
      ];
    }
    case 'feedback': {
      const p = payload as ResponsePayloads['feedback'];
      return [`${p.rating} Sterne`, p.comment];
    }
    case 'sentence':
      return [(payload as ResponsePayloads['sentence']).word, ''];
    case 'board': {
      const p = payload as ResponsePayloads['board'];
      if (p.dots)
        return [
          Object.entries(p.dots)
            .map(([k, n]) => `${label(k)}: ${n}`)
            .join(' | '),
          'Punkte',
        ];
      const scales = slide.config.scales;
      return [
        Object.entries(p.ratings ?? {})
          .map(
            ([k, values]) =>
              `${label(k)}: ${values.map((v, i) => `${scales[i]?.label ?? i + 1} ${v === null ? '–' : (scales[i]?.levels[v] ?? v)}`).join(', ')}`,
          )
          .join(' | '),
        'Bewertung',
      ];
    }
    case 'teams': {
      const tag = (payload as ResponsePayloads['teams']).tag;
      return [tag === null ? '–' : (slide.config.tags[tag] ?? `#${tag + 1}`), slide.config.tagLabel || 'Kennzeichnung'];
    }
    default:
      return [JSON.stringify(payload), ''];
  }
}

/** CSV-Zelle quoten; führende =,+,-,@ entschärfen, damit Excel nichts als Formel ausführt. */
function cell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) || v !== value ? `"${v.replace(/"/g, '""')}"` : v;
}
