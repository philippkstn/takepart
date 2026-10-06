import type { SlideType } from '@slides/shared';
import {
  Cloud,
  Lightbulb,
  ListChecks,
  ListOrdered,
  MessageCircleQuestion,
  MessageSquareText,
  SlidersHorizontal,
  Star,
  StickyNote,
  TextCursorInput,
  Trophy,
  Type,
  type LucideIcon,
} from 'lucide-react';

export const SLIDE_ICONS: Record<SlideType, LucideIcon> = {
  content: Type,
  choice: ListChecks,
  open: MessageSquareText,
  scale: SlidersHorizontal,
  wordcloud: Cloud,
  ranking: ListOrdered,
  quiz: Trophy,
  brainstorm: Lightbulb,
  pinboard: StickyNote,
  feedback: Star,
  qa: MessageCircleQuestion,
  sentence: TextCursorInput,
};

export function SlideIcon({ type, size = 18 }: { type: SlideType; size?: number }) {
  const Icon = SLIDE_ICONS[type];
  return <Icon size={size} aria-hidden />;
}
