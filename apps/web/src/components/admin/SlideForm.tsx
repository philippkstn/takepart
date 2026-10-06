import type { Slide, SlideConfigs } from '@slides/shared';
import { Check, GripVertical, Plus, X } from 'lucide-react';
import type { ReactNode } from 'react';

/*
 * Formulare für die Folienkonfiguration. Kontrolliert: `value` kommt vom Editor,
 * `onChange` liefert die komplette neue Konfiguration (gespeichert wird gebündelt).
 */

type FormProps<T extends Slide['type']> = { value: SlideConfigs[T]; onChange: (v: SlideConfigs[T]) => void };

function Text({
  label,
  value,
  onChange,
  max,
  placeholder,
  multiline,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea className="textarea" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          className="input"
          value={value}
          maxLength={max}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
        />
      )}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && (
          <span className="small faint" style={{ display: 'block' }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

function OptionList({
  label,
  options,
  onChange,
  min,
  max,
  marker,
  placeholder = 'Option',
}: {
  label: string;
  options: string[];
  onChange: (v: string[], removed?: number) => void;
  min: number;
  max: number;
  marker?: (i: number) => ReactNode;
  placeholder?: string;
}) {
  const move = (i: number, d: number) => {
    const next = [...options];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item!);
    onChange(next);
  };
  return (
    <div className="field">
      <span>{label}</span>
      <ul className="option-edit">
        {options.map((o, i) => (
          <li key={i}>
            {marker ? marker(i) : <GripVertical size={16} className="faint" aria-hidden />}
            <input
              className="input"
              value={o}
              maxLength={120}
              placeholder={`${placeholder} ${i + 1}`}
              onChange={(e) => onChange(options.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowUp' && i > 0) move(i, -1);
                if (e.altKey && e.key === 'ArrowDown' && i < options.length - 1) move(i, 1);
              }}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Option entfernen"
              disabled={options.length <= min}
              onClick={() =>
                onChange(
                  options.filter((_, j) => j !== i),
                  i,
                )
              }
            >
              <X />
            </button>
          </li>
        ))}
      </ul>
      {options.length < max && (
        <button
          type="button"
          className="btn btn-small btn-ghost"
          style={{ justifySelf: 'start' }}
          onClick={() => onChange([...options, ''])}
        >
          <Plus /> {placeholder} hinzufügen
        </button>
      )}
    </div>
  );
}

function ContentForm({ value, onChange }: FormProps<'content'>) {
  return (
    <>
      <Text label="Titel" value={value.title} max={200} onChange={(title) => onChange({ ...value, title })} autoFocus />
      <Text label="Text" value={value.body} max={2000} multiline onChange={(body) => onChange({ ...value, body })} />
      <Toggle
        label="Beitritts-Code und QR-Code zeigen"
        checked={value.showJoin}
        onChange={(showJoin) => onChange({ ...value, showJoin })}
      />
    </>
  );
}

function ChoiceForm({ value, onChange }: FormProps<'choice'>) {
  return (
    <>
      <Text label="Frage" value={value.question} max={300} onChange={(question) => onChange({ ...value, question })} autoFocus />
      <OptionList
        label="Antwortmöglichkeiten"
        options={value.options}
        min={2}
        max={10}
        onChange={(options) => onChange({ ...value, options })}
      />
      <Toggle label="Mehrfachauswahl erlauben" checked={value.multiple} onChange={(multiple) => onChange({ ...value, multiple })} />
    </>
  );
}

function OpenForm({ value, onChange }: FormProps<'open'>) {
  return (
    <>
      <Text label="Frage" value={value.question} max={300} onChange={(question) => onChange({ ...value, question })} autoFocus />
      <label className="field">
        <span>Höchstlänge pro Antwort</span>
        <select className="select" value={value.maxLength} onChange={(e) => onChange({ ...value, maxLength: Number(e.target.value) })}>
          {[100, 200, 280, 500].map((n) => (
            <option key={n} value={n}>
              {n} Zeichen
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function ScaleForm({ value, onChange }: FormProps<'scale'>) {
  return (
    <>
      <Text
        label="Aussage oder Frage"
        value={value.question}
        max={300}
        onChange={(question) => onChange({ ...value, question })}
        autoFocus
      />
      <div className="field">
        <span>Skala</span>
        <div className="segmented" style={{ justifySelf: 'start' }}>
          {([5, 7, 10] as const).map((n) => (
            <button type="button" key={n} aria-pressed={value.max === n} onClick={() => onChange({ ...value, max: n })}>
              1–{n}
            </button>
          ))}
        </div>
      </div>
      <div className="form-2col">
        <Text label="Beschriftung 1" value={value.minLabel} max={40} onChange={(minLabel) => onChange({ ...value, minLabel })} />
        <Text
          label={`Beschriftung ${value.max}`}
          value={value.maxLabel}
          max={40}
          onChange={(maxLabel) => onChange({ ...value, maxLabel })}
        />
      </div>
    </>
  );
}

function WordcloudForm({ value, onChange }: FormProps<'wordcloud'>) {
  return (
    <>
      <Text label="Frage" value={value.question} max={300} onChange={(question) => onChange({ ...value, question })} autoFocus />
      <div className="field">
        <span>Begriffe pro Person</span>
        <div className="segmented" style={{ justifySelf: 'start' }}>
          {[1, 2, 3].map((n) => (
            <button type="button" key={n} aria-pressed={value.maxWords === n} onClick={() => onChange({ ...value, maxWords: n })}>
              {n}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function RankingForm({ value, onChange }: FormProps<'ranking'>) {
  return (
    <>
      <Text label="Frage" value={value.question} max={300} onChange={(question) => onChange({ ...value, question })} autoFocus />
      <OptionList label="Optionen (2–8)" options={value.options} min={2} max={8} onChange={(options) => onChange({ ...value, options })} />
    </>
  );
}

function QuizForm({ value, onChange }: FormProps<'quiz'>) {
  const toggleCorrect = (i: number) => {
    const correct = value.correct.includes(i) ? value.correct.filter((x) => x !== i) : [...value.correct, i].sort((a, b) => a - b);
    if (correct.length > 0) onChange({ ...value, correct });
  };
  return (
    <>
      <Text label="Frage" value={value.question} max={300} onChange={(question) => onChange({ ...value, question })} autoFocus />
      <OptionList
        label="Antworten – Haken setzt die richtige(n)"
        options={value.options}
        min={2}
        max={6}
        placeholder="Antwort"
        onChange={(options, removed) => {
          let correct = value.correct;
          if (removed !== undefined) correct = correct.filter((c) => c !== removed).map((c) => (c > removed ? c - 1 : c));
          onChange({ ...value, options, correct: correct.length ? correct : [0] });
        }}
        marker={(i) => (
          <button
            type="button"
            className={`correct-toggle ${value.correct.includes(i) ? 'on' : ''}`}
            aria-pressed={value.correct.includes(i)}
            aria-label={value.correct.includes(i) ? 'Richtige Antwort' : 'Als richtig markieren'}
            onClick={() => toggleCorrect(i)}
          >
            <Check size={14} />
          </button>
        )}
      />
      <label className="field">
        <span>Zeitlimit</span>
        <select className="select" value={value.timeLimit} onChange={(e) => onChange({ ...value, timeLimit: Number(e.target.value) })}>
          {[10, 15, 20, 30, 45, 60, 90, 120].map((n) => (
            <option key={n} value={n}>
              {n} Sekunden
            </option>
          ))}
        </select>
      </label>
      <p className="small faint">
        Richtig: 500 Punkte plus bis zu 500 für Schnelligkeit. Für die Rangliste geben Teilnehmende einen Namen an.
      </p>
    </>
  );
}

function BrainstormForm({ value, onChange }: FormProps<'brainstorm'>) {
  return (
    <>
      <Text label="Frage oder Thema" value={value.question} max={300} onChange={(question) => onChange({ ...value, question })} autoFocus />
      <Toggle
        label="Publikum darf Ideen hochvoten"
        checked={value.allowVotes}
        onChange={(allowVotes) => onChange({ ...value, allowVotes })}
      />
    </>
  );
}

function PinboardForm({ value, onChange }: FormProps<'pinboard'>) {
  return (
    <>
      <Text label="Titel" value={value.title} max={200} onChange={(title) => onChange({ ...value, title })} autoFocus />
      <OptionList
        label="Spalten (1–5)"
        options={value.columns}
        min={1}
        max={5}
        placeholder="Spalte"
        onChange={(columns) => onChange({ ...value, columns })}
      />
    </>
  );
}

function FeedbackForm({ value, onChange }: FormProps<'feedback'>) {
  return (
    <>
      <Text label="Frage" value={value.question} max={300} onChange={(question) => onChange({ ...value, question })} autoFocus />
      <Toggle label="Kommentar erlauben" checked={value.withComment} onChange={(withComment) => onChange({ ...value, withComment })} />
    </>
  );
}

function QaForm({ value, onChange }: FormProps<'qa'>) {
  return (
    <>
      <Text label="Überschrift" value={value.title} max={200} onChange={(title) => onChange({ ...value, title })} autoFocus />
      <Toggle
        label="Fragen erst nach Freigabe zeigen"
        hint="Neue Fragen siehst zuerst nur du im Steuerpult."
        checked={value.moderated}
        onChange={(moderated) => onChange({ ...value, moderated })}
      />
      <p className="small faint">Teilnehmende geben für Fragen ihren Namen an.</p>
    </>
  );
}

function SentenceForm({ value, onChange }: FormProps<'sentence'>) {
  return (
    <>
      <Text
        label="Satzanfang"
        value={value.start}
        max={300}
        multiline
        placeholder="Ein Admin öffnet die Tür des Serverraums und sieht, dass"
        onChange={(start) => onChange({ ...value, start })}
        autoFocus
      />
      <p className="small faint">
        Alle tippen das Wort, das am wahrscheinlichsten als Nächstes kommt. Du blendest die Antworten ein und hängst das häufigste an –
        Runde für Runde.
      </p>
    </>
  );
}

export function SlideForm({ slide, value, onChange }: { slide: Slide; value: Slide['config']; onChange: (v: Slide['config']) => void }) {
  // Der Folientyp bestimmt die Form der Konfiguration; der Editor hält beides zusammen.
  const v = value as never;
  switch (slide.type) {
    case 'content':
      return <ContentForm value={v} onChange={onChange} />;
    case 'choice':
      return <ChoiceForm value={v} onChange={onChange} />;
    case 'open':
      return <OpenForm value={v} onChange={onChange} />;
    case 'scale':
      return <ScaleForm value={v} onChange={onChange} />;
    case 'wordcloud':
      return <WordcloudForm value={v} onChange={onChange} />;
    case 'ranking':
      return <RankingForm value={v} onChange={onChange} />;
    case 'quiz':
      return <QuizForm value={v} onChange={onChange} />;
    case 'brainstorm':
      return <BrainstormForm value={v} onChange={onChange} />;
    case 'pinboard':
      return <PinboardForm value={v} onChange={onChange} />;
    case 'feedback':
      return <FeedbackForm value={v} onChange={onChange} />;
    case 'qa':
      return <QaForm value={v} onChange={onChange} />;
    case 'sentence':
      return <SentenceForm value={v} onChange={onChange} />;
  }
}
