import type { SlideResults, PublicSlide, WordCount } from '@slides/shared';
import { Check, Star } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { AnimatedNumber, EASE, useBump } from '../lib/liveMotion.tsx';
import './results.css';

/*
 * Ergebnisdarstellungen. Einreihige Balken in einer Farbe (--chart), Wert an der
 * Balkenspitze, Text immer in Tintenfarben. Richtige Quizantworten tragen
 * zusätzlich Haken und Beschriftung – nie nur Farbe. Größen in em, damit dieselbe
 * Komponente im Steuerpult klein und auf dem Beamer groß funktioniert.
 */

const percent = (value: number, total: number) => (total === 0 ? 0 : Math.round((value / total) * 100));

interface BarItem {
  key: string | number;
  label: string;
  value: number;
  display: string;
  correct?: boolean;
  dim?: boolean;
  /** Zusätzliche Marken hinter dem Text (z. B. Verteilung der Kennzeichnungen) */
  extra?: ReactNode;
}

export function BarList({ items, max, inline = false }: { items: BarItem[]; max: number; inline?: boolean }) {
  return (
    <ul className={`bars ${inline ? 'bars-inline' : ''}`} role="list">
      {items.map((item) => (
        <BarRow key={item.key} item={item} max={max} />
      ))}
    </ul>
  );
}

/**
 * Eine Zeile: Balken wächst weich, eine neue Stimme lässt ihn kurz aufleuchten, und
 * ändert sich die Reihenfolge (Ranking), gleitet die Zeile an ihren neuen Platz.
 */
function BarRow({ item, max }: { item: BarItem; max: number }) {
  const width = max === 0 ? 0 : (item.value / max) * 100;
  const bump = useBump(item.value);
  // Auch außerhalb der Bühne (Steuerpult, Handy) ohne Bewegung, wenn das System es wünscht
  const reduce = useReducedMotion();
  return (
    <motion.li
      layout="position"
      transition={{ layout: reduce ? { duration: 0 } : { duration: 0.45, ease: EASE } }}
      className={`bar-row ${item.correct ? 'is-correct' : ''} ${item.dim ? 'is-dim' : ''} ${bump}`}
      title={`${item.label}: ${item.display}`}
      style={{ ['--bar' as string]: `${Math.max(width, item.value > 0 ? 1.5 : 0)}%` }}
    >
      <div className="bar-label">
        {item.correct !== undefined && (
          <span className={`bar-mark ${item.correct ? 'ok' : ''}`} aria-hidden>
            {item.correct ? <Check /> : null}
          </span>
        )}
        <span className="bar-text">{item.label}</span>
        {item.extra}
        {item.correct && <span className="visually-hidden">(richtig)</span>}
      </div>
      <div className="bar-track">
        <div className="bar-area">
          <div className="bar-fill" />
        </div>
        <span className="bar-value tabular">{item.display}</span>
      </div>
    </motion.li>
  );
}

function ChoiceResults({ options, counts, voters }: { options: string[]; counts: number[]; voters: number }) {
  const max = Math.max(1, ...counts);
  return (
    <BarList
      max={max}
      items={options.map((label, i) => ({
        key: i,
        label,
        value: counts[i] ?? 0,
        display: `${counts[i] ?? 0} · ${percent(counts[i] ?? 0, voters)} %`,
      }))}
    />
  );
}

function ScaleResults({
  results,
  max,
  minLabel,
  maxLabel,
}: {
  results: Extract<SlideResults, { type: 'scale' }>;
  max: number;
  minLabel: string;
  maxLabel: string;
}) {
  const top = Math.max(1, ...results.distribution);
  return (
    <div className="scale-results">
      <div className="hero-figure">
        {results.average === null ? (
          <span className="hero-value tabular">–</span>
        ) : (
          <AnimatedNumber className="hero-value tabular" value={results.average} decimals={1} />
        )}
        <span className="hero-label">Durchschnitt von {max}</span>
      </div>
      <div className="columns" style={{ gridTemplateColumns: `repeat(${max}, 1fr)` }}>
        {results.distribution.map((n, i) => (
          <ScaleColumn key={i} n={n} top={top} label={i + 1} />
        ))}
      </div>
      <div className="row-between scale-ends">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function ScaleColumn({ n, top, label }: { n: number; top: number; label: number }) {
  const bump = useBump(n);
  return (
    <div className={`column ${bump}`} title={`${label}: ${n} Stimmen`}>
      <span className="column-value tabular">{n > 0 ? n : ''}</span>
      <div className="column-track">
        <div className="column-fill" style={{ height: `${(n / top) * 100}%` }} />
      </div>
      <span className="column-label tabular">{label}</span>
    </div>
  );
}

export function WordCloud({ words, limit = 60, highlight = false }: { words: WordCount[]; limit?: number; highlight?: boolean }) {
  if (words.length === 0) return null;
  const shown = words.slice(0, limit);
  const max = shown[0]!.count;
  const min = shown[shown.length - 1]!.count;
  // Hervorheben nur, wenn es echte Spitzenreiter gibt – nicht bei lauter Gleichstand.
  const leaders = max > min ? shown.filter((w) => w.count === max).length : 0;
  // Mischen nach festem Muster: große Wörter in die Mitte, kleine nach außen.
  const arranged: (WordCount & { rank: number })[] = [];
  shown.forEach((w, rank) => (rank % 2 === 0 ? arranged.push({ ...w, rank }) : arranged.unshift({ ...w, rank })));
  return (
    <div className="wordcloud">
      <AnimatePresence initial={false}>
        {arranged.map((w) => {
          const t = max === min ? 1 : (w.count - min) / (max - min);
          return <CloudWord key={w.key} word={w.word} count={w.count} t={t} top={highlight && w.rank < leaders} />;
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * Wort der Wolke: Die Schriftgröße wird animiert (nicht skaliert), damit die Nachbarn
 * mitfließen – ein neues Wort wächst aus dem Nichts, statt die Wolke umzuwerfen.
 */
function CloudWord({ word, count, t, top }: { word: string; count: number; t: number; top: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      className={`cloud-word ${top ? 'is-top' : ''}`}
      initial={{ fontSize: '0.3em', opacity: 0 }}
      animate={{ fontSize: `${0.9 + t * 2.6}em`, opacity: 0.6 + t * 0.4 }}
      exit={{ fontSize: '0.3em', opacity: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }}
      title={`${word}: ${count}×`}
    >
      {word}
    </motion.span>
  );
}

export function FeedbackResults({ results }: { results: Extract<SlideResults, { type: 'feedback' }> }) {
  const max = Math.max(1, ...results.distribution);
  return (
    <div className="feedback-results">
      <div className="hero-figure">
        {results.average === null ? (
          <span className="hero-value tabular">–</span>
        ) : (
          <AnimatedNumber className="hero-value tabular" value={results.average} decimals={1} />
        )}
        <Stars value={results.average ?? 0} />
        <span className="hero-label">
          {results.voters} {results.voters === 1 ? 'Bewertung' : 'Bewertungen'}
        </span>
      </div>
      <BarList
        max={max}
        inline
        items={[5, 4, 3, 2, 1].map((stars) => ({
          key: stars,
          label: `${stars} ★`,
          value: results.distribution[stars - 1] ?? 0,
          display: String(results.distribution[stars - 1] ?? 0),
        }))}
      />
    </div>
  );
}

export function Stars({ value, size = '1em' }: { value: number; size?: string }) {
  return (
    <span
      className="stars"
      aria-label={`${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} von 5 Sternen`}
      style={{ fontSize: size }}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={value >= i - 0.25 ? 'on' : value >= i - 0.75 ? 'half' : ''} />
      ))}
    </span>
  );
}

/** Ergebnis einer Folie. `slide` liefert Optionstexte; bei Quizfragen mit Lösung. */
export function SlideResultsView({
  slide,
  results,
  showComments = true,
  maxComments = Infinity,
}: {
  slide: PublicSlide;
  results: SlideResults;
  showComments?: boolean;
  /** Auf der Bühne nur die neuesten Kommentare, damit nichts überläuft */
  maxComments?: number;
}) {
  switch (results.type) {
    case 'choice':
      if (slide.type !== 'choice') return null;
      return <ChoiceResults options={slide.config.options} counts={results.counts} voters={results.voters} />;
    case 'scale':
      if (slide.type !== 'scale') return null;
      return <ScaleResults results={results} max={slide.config.max} minLabel={slide.config.minLabel} maxLabel={slide.config.maxLabel} />;
    case 'wordcloud':
      return <WordCloud words={results.words} highlight />;
    case 'ranking': {
      if (slide.type !== 'ranking') return null;
      return (
        <BarList
          max={100}
          items={results.items.map((item, place) => ({
            key: item.index,
            label: `${place + 1}. ${slide.config.options[item.index] ?? ''}`,
            value: item.score,
            display:
              item.averagePosition === null ? '–' : `Ø Platz ${item.averagePosition.toLocaleString('de-DE', { maximumFractionDigits: 1 })}`,
          }))}
        />
      );
    }
    case 'quiz': {
      if (slide.type !== 'quiz') return null;
      const correct = slide.config.correct;
      const max = Math.max(1, ...results.counts);
      return (
        <BarList
          max={max}
          items={slide.config.options.map((label, i) => ({
            key: i,
            label,
            value: results.counts[i] ?? 0,
            display: `${results.counts[i] ?? 0}`,
            correct: correct ? correct.includes(i) : undefined,
            dim: correct ? !correct.includes(i) : false,
          }))}
        />
      );
    }
    case 'feedback':
      return (
        <div className="stack">
          <FeedbackResults results={results} />
          {showComments && results.comments.length > 0 && slide.type === 'feedback' && slide.config.commentLabel && (
            <span className="label">{slide.config.commentLabel}</span>
          )}
          {showComments && results.comments.length > 0 && (
            <ul className="comment-list">
              {results.comments.slice(-maxComments).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      );
    case 'sentence':
      return <WordCloud words={results.words} highlight />;
  }
}
