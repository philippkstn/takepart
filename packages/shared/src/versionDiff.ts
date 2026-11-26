import type { SlideSchedule } from './schedule.ts';
import type { SlideType } from './slides.ts';
import { sameValue } from './editing.ts';
import { lcs } from './sync.ts';

/**
 * Versionen einer Präsentation (Schnappschuss, wie ihn der Server speichert) und
 * der Vergleich zweier Versionen für die Zeitleiste im Versionen-Dialog.
 */

export interface VersionSlide {
  id: number;
  type: SlideType;
  config: Record<string, unknown>;
  notes: string;
  schedule: SlideSchedule;
  sourceKey: string | null;
}

export interface VersionSnapshot {
  v: 1;
  presentation: { title: string; brandId: number | null; shareSlides: boolean; targetMinutes: number | null };
  slides: VersionSlide[];
}

export type SlideChangeKind = 'added' | 'removed' | 'changed' | 'moved';

export interface SlideChange {
  id: number;
  type: SlideType;
  title: string;
  kind: SlideChangeKind;
  /** Geänderte Felder: Schlüssel der Konfiguration, `notes`, `schedule`, `position` */
  fields: string[];
}

export interface VersionDiff {
  /** Erste Version – es gibt nichts zum Vergleichen */
  initial: boolean;
  /** Geänderte Einstellungen der Präsentation (`title`, `brandId`, …) */
  meta: string[];
  slides: SlideChange[];
}

/** Überschrift einer Folie aus ihrer Konfiguration (für Listen) */
export function versionSlideTitle(config: Record<string, unknown>): string {
  for (const key of ['title', 'question', 'prompt', 'text']) {
    const v = config[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return '';
}

/** Welche Felder unterscheiden sich (ohne Position) */
function changedFields(a: VersionSlide, b: VersionSlide): string[] {
  const keys = [...new Set([...Object.keys(a.config), ...Object.keys(b.config)])].filter((k) => !sameValue(a.config[k], b.config[k]));
  if (a.notes !== b.notes) keys.push('notes');
  if (!sameValue(a.schedule, b.schedule)) keys.push('schedule');
  return keys;
}

/** Was hat sich von `prev` zu `next` geändert? */
export function diffVersions(prev: VersionSnapshot | null, next: VersionSnapshot): VersionDiff {
  if (!prev) return { initial: true, meta: [], slides: [] };
  const meta = (Object.keys(next.presentation) as (keyof VersionSnapshot['presentation'])[]).filter(
    (k) => !sameValue(prev.presentation[k], next.presentation[k]),
  );
  const before = new Map(prev.slides.map((s) => [s.id, s]));
  const after = new Set(next.slides.map((s) => s.id));

  // Verschoben: gemeinsame Folien außerhalb der längsten gleich geordneten Folge
  const commonPrev = prev.slides.filter((s) => after.has(s.id)).map((s) => s.id);
  const commonNext = next.slides.filter((s) => before.has(s.id)).map((s) => s.id);
  const stay = new Set(lcs(commonPrev, commonNext, (x, y) => x === y).map(([i]) => commonPrev[i]!));

  const slides: SlideChange[] = [];
  for (const s of next.slides) {
    const old = before.get(s.id);
    const entry = { id: s.id, type: s.type, title: versionSlideTitle(s.config) };
    if (!old) {
      slides.push({ ...entry, kind: 'added', fields: [] });
      continue;
    }
    const fields = changedFields(old, s);
    const moved = !stay.has(s.id);
    if (fields.length > 0) slides.push({ ...entry, kind: 'changed', fields: moved ? [...fields, 'position'] : fields });
    else if (moved) slides.push({ ...entry, kind: 'moved', fields: ['position'] });
  }
  for (const s of prev.slides) {
    if (!after.has(s.id)) slides.push({ id: s.id, type: s.type, title: versionSlideTitle(s.config), kind: 'removed', fields: [] });
  }
  return { initial: false, meta, slides };
}

/** Bezeichnungen der häufigsten Felder; alles andere heißt „Einstellungen“ */
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  title: 'Titel',
  body: 'Text',
  question: 'Frage',
  prompt: 'Frage',
  text: 'Text',
  task: 'Aufgabe',
  options: 'Antworten',
  choices: 'Auswahl',
  correct: 'Lösung',
  asset: 'Folienbild',
  width: 'Folienbild',
  height: 'Folienbild',
  builds: 'Animationen',
  columns: 'Bereiche',
  lanes: 'Bahnen',
  scales: 'Kriterien',
  board: 'Wand',
  mode: 'Art',
  notes: 'Notizen',
  schedule: 'Ablaufplan',
  position: 'Reihenfolge',
  startHidden: 'Aufdecken',
  showJoin: 'Beitritt',
  brandId: 'Branding',
  shareSlides: 'Folien auf Handys',
  targetMinutes: 'Dauer',
};

/** Feldnamen für die Anzeige, ohne Doppelte: „Titel, Antworten, Einstellungen“ */
export function changeFieldLabels(fields: string[]): string[] {
  return [...new Set(fields.map((f) => CHANGE_FIELD_LABELS[f] ?? 'Einstellungen'))];
}
