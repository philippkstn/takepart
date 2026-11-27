import type { CreatableSlideType } from './blocks.ts';
import {
  BOARD_MODE_HINTS,
  BOARD_MODE_LABELS,
  BOARD_MODES,
  CREATABLE_SLIDE_TYPES,
  SLIDE_TYPE_HINTS,
  SLIDE_TYPE_LABELS,
  type BoardMode,
} from './slides.ts';

/**
 * Folientypen nach Ziel statt nach Technik: Der Einfügen-Dialog im Editor zeigt
 * zuerst diese Ziele, danach die passenden Folientypen (ein Typ darf unter
 * mehreren Zielen stehen) und Bausteine (`BUILTIN_BLOCKS`, über ihre `id`).
 * Kartenwand-Schritte stehen als eigene Einträge mit ihrem `mode`.
 */

export type GoalItem = { type: Exclude<CreatableSlideType, 'board'> } | { type: 'board'; mode: BoardMode };

export interface SlideGoal {
  id: string;
  label: string;
  description: string;
  items: GoalItem[];
  /** Kennungen passender Bausteine aus `BUILTIN_BLOCKS` */
  blocks: string[];
}

const t = (type: Exclude<CreatableSlideType, 'board'>): GoalItem => ({ type });
const b = (mode: BoardMode): GoalItem => ({ type: 'board', mode });

export const SLIDE_GOALS: SlideGoal[] = [
  {
    id: 'arrive',
    label: 'Ankommen & Stimmung',
    description: 'Beitritt zeigen, Stimmung und Vorwissen abfragen, das Eis brechen',
    items: [t('content'), t('wordcloud'), t('scale'), t('choice'), t('sentence')],
    blocks: ['checkin', 'expectations'],
  },
  {
    id: 'collect',
    label: 'Ideen & Beiträge sammeln',
    description: 'Alle schreiben mit: Ideen, Begriffe, Freitext, Notizen in Spalten',
    items: [t('brainstorm'), t('pinboard'), t('open'), t('wordcloud'), b('collect')],
    blocks: ['retro', 'expectations'],
  },
  {
    id: 'quiz',
    label: 'Wissen prüfen',
    description: 'Quizfragen mit Punkten und Rangliste oder eine schnelle Verständnisfrage',
    items: [t('quiz'), t('choice'), t('ranking'), t('open')],
    blocks: [],
  },
  {
    id: 'decide',
    label: 'Abstimmen & entscheiden',
    description: 'Meinungen einholen, Optionen gewichten, Prioritäten setzen',
    items: [t('choice'), t('ranking'), t('scale'), b('dots'), b('rate'), b('choose')],
    blocks: ['obstacles', 'retro'],
  },
  {
    id: 'questions',
    label: 'Fragen & Feedback',
    description: 'Fragen aus dem Publikum sammeln und beantworten, Rückmeldung einholen',
    items: [t('qa'), t('feedback'), t('open'), t('scale')],
    blocks: ['closing', 'feedback'],
  },
  {
    id: 'workshop',
    label: 'Gruppenarbeit & Workshop',
    description: 'Gruppen bilden, Karten sammeln, clustern, punkten und Ergebnisse festhalten',
    items: [t('teams'), b('collect'), b('cluster'), b('place'), b('dots'), b('rate'), b('choose'), b('table'), t('pause')],
    blocks: ['groupwork', 'obstacles', 'obstacles-v3', 'expectations', 'retro'],
  },
  {
    id: 'show',
    label: 'Inhalt zeigen',
    description: 'Text, Beitritts-Code oder eine Pause – ohne Beteiligung',
    items: [t('content'), t('pause')],
    blocks: ['closing'],
  },
];

/** Eindeutiger Schlüssel eines Eintrags: Typ bzw. `board:<mode>` */
export const goalItemKey = (item: GoalItem): string => (item.type === 'board' ? `board:${item.mode}` : item.type);

export const goalItemLabel = (item: GoalItem): string =>
  item.type === 'board' ? BOARD_MODE_LABELS[item.mode] : SLIDE_TYPE_LABELS[item.type];

export const goalItemHint = (item: GoalItem): string => (item.type === 'board' ? BOARD_MODE_HINTS[item.mode] : SLIDE_TYPE_HINTS[item.type]);

/** Vollständige Liste für „Alle Folientypen“ – in der bisherigen Reihenfolge, Kartenwand-Schritte am Ende */
export const ALL_GOAL_ITEMS: GoalItem[] = [
  ...CREATABLE_SLIDE_TYPES.flatMap((type) => (type === 'board' ? [] : [t(type)])),
  ...BOARD_MODES.map(b),
];

/** Kleinschreibung, Umlaute wie „ue“, damit „pruefen“ auch „prüfen“ findet */
const normalize = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

const haystacks = new Map(
  ALL_GOAL_ITEMS.map((item) => {
    const key = goalItemKey(item);
    const goals = SLIDE_GOALS.filter((g) => g.items.some((i) => goalItemKey(i) === key));
    const words = [
      goalItemLabel(item),
      goalItemHint(item),
      item.type === 'board' ? SLIDE_TYPE_LABELS.board : '',
      ...goals.map((g) => g.label),
    ];
    return [key, normalize(words.join(' '))];
  }),
);

/** Suche über alle Folientypen: jedes Wort der Eingabe muss in Name, Beschreibung oder Ziel vorkommen */
export function searchGoalItems(query: string): GoalItem[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return ALL_GOAL_ITEMS.filter((item) => {
    const hay = haystacks.get(goalItemKey(item)) ?? '';
    return words.every((w) => hay.includes(w));
  });
}
