import {
  BOARD_MODE_HINTS,
  BOARD_MODE_LABELS,
  BOARD_MODES,
  BOARD_RIGHTS,
  BOARD_RIGHTS_LABELS,
  RATING_SOURCES,
  RATING_SOURCE_LABELS,
  type RatingSource,
  type BoardMode,
  type Slide,
  type SlideConfigs,
} from '@slides/shared';
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

/** Aufgabenbeschreibung für Folien mit Beteiligung – klein unter der Frage auf Beamer und Handys */
function TaskField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>
        Aufgabenbeschreibung <span className="faint">(optional)</span>
      </span>
      <textarea
        className="textarea"
        rows={3}
        value={value}
        maxLength={600}
        placeholder="Was genau sollen die Teilnehmenden tun? Erscheint klein unter der Frage – auf dem Beamer und auf den Handys."
        onChange={(e) => onChange(e.target.value)}
      />
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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

function FeedbackForm({ value, onChange, boards = [] }: FormProps<'feedback'> & { boards?: string[] }) {
  return (
    <>
      <Text label="Frage" value={value.question} max={300} onChange={(question) => onChange({ ...value, question })} autoFocus />
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
      <Toggle label="Kommentar erlauben" checked={value.withComment} onChange={(withComment) => onChange({ ...value, withComment })} />
      {value.withComment && (
        <Text
          label="Frage zum Kommentar"
          value={value.commentLabel}
          max={120}
          placeholder="z. B. Was nimmst du mit?"
          onChange={(commentLabel) => onChange({ ...value, commentLabel })}
        />
      )}
      <label className="field">
        <span>Rückblick auf Kartenwand</span>
        <input
          className="input"
          list="feedback-recall-boards"
          value={value.recall}
          maxLength={60}
          placeholder="leer = kein Rückblick"
          onChange={(e) => onChange({ ...value, recall: e.target.value })}
        />
        <datalist id="feedback-recall-boards">
          {[...new Set(boards)].map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <p className="small faint">
        Jede Person sieht über dem Formular ihre eigenen Karten dieser Wand, z. B. die Erwartungen vom Anfang. Beamer und Steuerpult zeigen
        nichts davon.
      </p>
    </>
  );
}

function PauseForm({ value, onChange }: FormProps<'pause'>) {
  return (
    <>
      <Text label="Überschrift" value={value.title} max={200} onChange={(title) => onChange({ ...value, title })} autoFocus />
      <label className="field">
        <span>Dauer</span>
        <select className="select" value={value.minutes} onChange={(e) => onChange({ ...value, minutes: Number(e.target.value) })}>
          {[...new Set([5, 10, 15, 20, 30, 45, 60, value.minutes])]
            .sort((a, b) => a - b)
            .map((m) => (
              <option key={m} value={m}>
                {m} Minuten
              </option>
            ))}
        </select>
      </label>
      <Toggle
        label="Energie-Frage auf den Handys"
        hint="„Wie ist deine Energie?“ (1–5) – das Ergebnis siehst du im Steuerpult."
        checked={value.question}
        onChange={(question) => onChange({ ...value, question })}
      />
      <p className="small faint">
        Beim Erreichen der Folie startet die Pause automatisch: Countdown, „Weiter um … Uhr“ und „Ich bin wieder da“ auf den Handys.
        Weiterblättern beendet sie; im Steuerpult lässt sie sich verlängern.
      </p>
    </>
  );
}

function TeamsForm({ value, onChange }: FormProps<'teams'>) {
  return (
    <>
      <Text label="Überschrift" value={value.title} max={200} onChange={(title) => onChange({ ...value, title })} autoFocus />
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
      <p className="small faint">
        Alle geben auf dem Handy ihren Namen ein. Im Steuerpult wählst du Anzahl oder Größe der Gruppen; jede Person sieht dann ihre Gruppe.
      </p>
      <OptionList
        label="Kennzeichnung zum Mischen (optional, z. B. Rollen oder Abteilungen)"
        options={value.tags}
        min={0}
        max={8}
        placeholder="Kennzeichnung"
        onChange={(tags) => onChange({ ...value, tags })}
      />
      {value.tags.length > 0 && (
        <Text label="Frage dazu" value={value.tagLabel} max={60} onChange={(tagLabel) => onChange({ ...value, tagLabel })} />
      )}
    </>
  );
}

function QaForm({ value, onChange }: FormProps<'qa'>) {
  return (
    <>
      <Text label="Überschrift" value={value.title} max={200} onChange={(title) => onChange({ ...value, title })} autoFocus />
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
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

function ImageForm({ value, onChange }: FormProps<'image'>) {
  return (
    <>
      <Text label="Titel (für Folienlisten)" value={value.title} max={200} onChange={(title) => onChange({ ...value, title })} />
      <p className="small faint">
        Importierte Folie, {value.width} × {value.height} px. Inhalt ändern: Folie in PowerPoint anpassen und neu importieren.
      </p>
      {value.builds && value.builds.regions.length > 0 && (
        <label className="switch small">
          <input
            type="checkbox"
            checked={value.builds.enabled}
            onChange={(e) => onChange({ ...value, builds: { ...value.builds!, enabled: e.target.checked } })}
          />
          <span>
            Animationen abspielen
            <span className="faint" style={{ display: 'block' }}>
              {value.builds.regions.length} Elemente, {value.builds.steps === 0 ? 'ohne Klick' : `${value.builds.steps} Klicks`}. Bleibt
              beim Aufdecken eine falsche Fläche stehen (überlappende Elemente), hier abschalten.
            </span>
          </span>
        </label>
      )}
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
      <TaskField value={value.task} onChange={(task) => onChange({ ...value, task })} />
      <p className="small faint">
        Alle tippen das Wort, das am wahrscheinlichsten als Nächstes kommt. Du blendest die Antworten ein und hängst das häufigste an –
        Runde für Runde.
      </p>
    </>
  );
}

/* ───────────── Kartenwand ───────────── */

const LANE_PRESETS: { label: string; lanes: SlideConfigs['board']['lanes']; xLabel: string; yLabel: string }[] = [
  { label: 'Spalten', lanes: [{ title: '', cells: ['Spalte 1', 'Spalte 2', 'Spalte 3'] }], xLabel: '', yLabel: '' },
  {
    label: 'Prozess mit zwei Bahnen',
    lanes: [
      { title: 'Neukunden', cells: ['Marketing', 'Lead', 'Opportunity', 'Angebot', 'Unterschrift'] },
      {
        title: 'Bestandskunden',
        cells: ['Zielkunden identifizieren', 'Potenzial bewerten', 'Ansprache vorbereiten', 'Qualifizieren', 'Übergabe'],
      },
    ],
    xLabel: '',
    yLabel: '',
  },
  {
    label: 'Matrix Nutzen × Aufwand',
    lanes: [
      { title: 'hoch', cells: ['Quick Wins', 'Strategisch'] },
      { title: 'gering', cells: ['Mitnehmen', 'Zurückstellen'] },
    ],
    xLabel: 'Aufwand: gering → hoch',
    yLabel: 'Nutzen',
  },
];

const SCALE_PRESETS = [
  { label: 'S bis XL', levels: ['S', 'M', 'L', 'XL'] },
  { label: '1 bis 5', levels: ['1', '2', '3', '4', '5'] },
  { label: 'gering / mittel / hoch', levels: ['gering', 'mittel', 'hoch'] },
];

function TargetsField({ value, onChange, table = true }: FormProps<'board'> & { table?: boolean }) {
  const fromTable = table && value.targets === 'table';
  return (
    <div className="form-2col">
      <label className="field">
        <span>Bezieht sich auf</span>
        <select
          className="select"
          value={value.targets}
          onChange={(e) => onChange({ ...value, targets: e.target.value as typeof value.targets })}
        >
          <option value="auto">Gruppen, sonst Karten</option>
          <option value="groups">Gruppen (Cluster)</option>
          <option value="cards">Einzelne Karten</option>
          {table && <option value="table">Zeilen der Ergebnistabelle davor</option>}
        </select>
      </label>
      {fromTable ? (
        <p className="small faint">
          Es zählen die Zeilen der letzten Ergebnistabelle dieser Wand vor dieser Folie – z. B. die bestätigten Top 3, in ihrer Reihenfolge.
        </p>
      ) : (
        <label className="field">
          <span>Auswahl</span>
          <select className="select" value={value.top} onChange={(e) => onChange({ ...value, top: Number(e.target.value) })}>
            <option value={0}>Alle Einträge</option>
            {[3, 5, 7, 10].map((n) => (
              <option key={n} value={n}>
                Top {n} nach Punkten
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function RightsField({ value, onChange }: FormProps<'board'>) {
  return (
    <>
      <label className="field">
        <span>Teilnehmende dürfen</span>
        <select
          className="select"
          value={value.rights}
          onChange={(e) => onChange({ ...value, rights: e.target.value as typeof value.rights })}
        >
          {BOARD_RIGHTS.map((r) => (
            <option key={r} value={r}>
              {BOARD_RIGHTS_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <p className="small faint">
        „Alle bearbeiten gemeinsam“ erlaubt allen, jede Karte zu verschieben und zu ändern sowie Gruppen anzulegen und umzubenennen. Im
        Steuerpult jederzeit umschaltbar.
      </p>
      <Toggle
        label="Noch nicht eingeordnete Karten auf dem Beamer zeigen"
        hint="Aus: Karten erscheinen erst an der Wand, wenn sie eingeordnet sind – wie beim reihum Aufhängen."
        checked={value.showUnsorted}
        onChange={(showUnsorted) => onChange({ ...value, showUnsorted })}
      />
    </>
  );
}

function BoardForm({ value, onChange, boards = [] }: FormProps<'board'> & { boards?: string[] }) {
  const set = (patch: Partial<SlideConfigs['board']>) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="form-2col">
        <label className="field">
          <span>Kartenwand</span>
          <input className="input" list="board-names" value={value.board} maxLength={60} onChange={(e) => set({ board: e.target.value })} />
          <datalist id="board-names">
            {boards.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Schritt</span>
          <select className="select" value={value.mode} onChange={(e) => set({ mode: e.target.value as BoardMode })}>
            {BOARD_MODES.map((m) => (
              <option key={m} value={m}>
                {BOARD_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="small faint">
        {BOARD_MODE_HINTS[value.mode]}. Folien mit demselben Wand-Namen arbeiten mit denselben Karten und Gruppen.
      </p>
      <Text label="Aufgabe oder Frage" value={value.prompt} max={300} onChange={(prompt) => set({ prompt })} autoFocus />
      <TaskField value={value.task} onChange={(task) => set({ task })} />

      {value.mode === 'collect' && (
        <>
          <label className="field">
            <span>Karten pro Person</span>
            <select className="select" value={value.maxCards} onChange={(e) => set({ maxCards: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>
                  höchstens {n}
                </option>
              ))}
            </select>
          </label>
          <OptionList
            label="Kennzeichnung je Karte (optional, z. B. Rollen)"
            options={value.tags}
            min={0}
            max={5}
            placeholder="Kennzeichnung"
            onChange={(tags) => set({ tags })}
          />
          <Toggle
            label="Jederzeit offen (Parkplatz)"
            hint="Teilnehmende können von jeder Folie aus Karten hinzufügen – z. B. Lösungsideen, die später drankommen."
            checked={value.anytime}
            onChange={(anytime) => set({ anytime })}
          />
          <Toggle
            label="Namen abfragen"
            hint="Vor der ersten Karte fragt das Handy nach dem Namen – nötig für eine Runde reihum (Reihenfolge im Steuerpult unter „Moderation“)."
            checked={value.askName}
            onChange={(askName) => set({ askName })}
          />
          <Toggle
            label="Karten auf dem Beamer erst nach dem Aufdecken zeigen"
            hint="Beim Betreten der Folie sind die Ergebnisse verborgen – du deckst sie im Steuerpult auf, wenn alle fertig sind."
            checked={value.startHidden}
            onChange={(startHidden) => set({ startHidden })}
          />
          <Toggle
            label="Jede Gruppe sammelt für sich"
            hint="Braucht eine „Gruppen bilden“-Folie davor. Alle sehen die Karten ihrer Gruppe und melden sich fertig; Beamer und Steuerpult zeigen die Karten nach Gruppen."
            checked={value.perTeam}
            onChange={(perTeam) => set({ perTeam })}
          />
        </>
      )}

      {value.mode === 'cluster' && (
        <>
          <div className="field">
            <span>Darstellung</span>
            <div className="segmented" style={{ justifySelf: 'start' }}>
              <button type="button" aria-pressed={value.layout === 'wall'} onClick={() => set({ layout: 'wall' })}>
                Wand
              </button>
              <button type="button" aria-pressed={value.layout === 'mindmap'} onClick={() => set({ layout: 'mindmap' })}>
                Mindmap
              </button>
            </div>
          </div>
          <RightsField value={value} onChange={onChange} />
        </>
      )}

      {value.mode === 'place' && (
        <>
          <div className="field">
            <span>Vorlage</span>
            <div className="row">
              {LANE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="btn btn-small"
                  onClick={() => set({ lanes: p.lanes, xLabel: p.xLabel, yLabel: p.yLabel })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {value.lanes.map((lane, l) => (
            <div key={l} className="lane-edit stack-s">
              <div className="row">
                <input
                  className="input grow"
                  value={lane.title}
                  maxLength={60}
                  placeholder={value.lanes.length > 1 ? `Bahn ${l + 1} (Zeile)` : 'Zeilenbeschriftung (optional)'}
                  onChange={(e) => set({ lanes: value.lanes.map((x, i) => (i === l ? { ...x, title: e.target.value } : x)) })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Bahn entfernen"
                  disabled={value.lanes.length <= 1}
                  onClick={() => set({ lanes: value.lanes.filter((_, i) => i !== l) })}
                >
                  <X />
                </button>
              </div>
              <OptionList
                label="Felder"
                options={lane.cells}
                min={1}
                max={8}
                placeholder="Feld"
                onChange={(cells) => set({ lanes: value.lanes.map((x, i) => (i === l ? { ...x, cells } : x)) })}
              />
            </div>
          ))}
          {value.lanes.length < 4 && (
            <button
              type="button"
              className="btn btn-small btn-ghost"
              style={{ justifySelf: 'start' }}
              onClick={() => set({ lanes: [...value.lanes, { title: '', cells: ['Feld 1', 'Feld 2'] }] })}
            >
              <Plus /> Bahn hinzufügen
            </button>
          )}
          <div className="form-2col">
            <Text label="Achse senkrecht (optional)" value={value.yLabel} max={60} onChange={(yLabel) => set({ yLabel })} />
            <Text label="Achse waagerecht (optional)" value={value.xLabel} max={60} onChange={(xLabel) => set({ xLabel })} />
          </div>
          <TargetsField value={value} onChange={onChange} />
          <RightsField value={value} onChange={onChange} />
        </>
      )}

      {value.mode === 'dots' && (
        <>
          <TargetsField value={value} onChange={onChange} />
          <label className="field">
            <span>Punkte pro Person</span>
            <select className="select" value={value.dots} onChange={(e) => set({ dots: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Toggle label="Mehrere Punkte auf denselben Eintrag erlaubt" checked={value.stack} onChange={(stack) => set({ stack })} />
        </>
      )}

      {value.mode === 'rate' && (
        <>
          <TargetsField value={value} onChange={onChange} />
          {value.scales.map((scale, i) => (
            <div key={i} className="lane-edit stack-s">
              <div className="row">
                <input
                  className="input grow"
                  value={scale.label}
                  maxLength={40}
                  placeholder="Kriterium, z. B. Nutzen"
                  onChange={(e) => set({ scales: value.scales.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Kriterium entfernen"
                  disabled={value.scales.length <= 1}
                  onClick={() => set({ scales: value.scales.filter((_, j) => j !== i) })}
                >
                  <X />
                </button>
              </div>
              <label className="field">
                <span>Wer schätzt?</span>
                <select
                  className="select"
                  value={scale.source}
                  onChange={(e) =>
                    set({ scales: value.scales.map((x, j) => (j === i ? { ...x, source: e.target.value as RatingSource } : x)) })
                  }
                >
                  {RATING_SOURCES.map((src) => (
                    <option key={src} value={src}>
                      {RATING_SOURCE_LABELS[src]}
                    </option>
                  ))}
                </select>
              </label>
              {scale.source === 'tags' && (
                <p className="small faint">
                  Die Stufen sollten den Kennzeichnungen der Sammel-Folie entsprechen (erste Kennzeichnung = erste Stufe, z. B. S bis XL).
                  Bei Gruppen zählt der Durchschnitt ihrer Karten.
                </p>
              )}
              {scale.source === 'host' && <p className="small faint">Die Moderation trägt die Stufe je Eintrag im Steuerpult ein.</p>}
              <div className="row">
                {SCALE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="btn btn-small btn-ghost"
                    onClick={() => set({ scales: value.scales.map((x, j) => (j === i ? { ...x, levels: p.levels } : x)) })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <OptionList
                label="Stufen (von gering nach hoch)"
                options={scale.levels}
                min={2}
                max={7}
                placeholder="Stufe"
                onChange={(levels) => set({ scales: value.scales.map((x, j) => (j === i ? { ...x, levels } : x)) })}
              />
            </div>
          ))}
          {value.scales.length < 2 && (
            <button
              type="button"
              className="btn btn-small btn-ghost"
              style={{ justifySelf: 'start' }}
              onClick={() => set({ scales: [...value.scales, { label: 'Aufwand', levels: ['S', 'M', 'L', 'XL'], source: 'votes' }] })}
            >
              <Plus /> Zweites Kriterium (ergibt eine Matrix)
            </button>
          )}
          {value.scales.length === 2 && (
            <div className="field">
              <span>Felder der Matrix – erstes Kriterium senkrecht, zweites waagerecht</span>
              <div className="form-2col">
                {['oben links', 'oben rechts', 'unten links', 'unten rechts'].map((pos, i) => (
                  <input
                    key={i}
                    className="input"
                    value={value.quadrants[i] ?? ''}
                    maxLength={40}
                    placeholder={pos}
                    aria-label={pos}
                    onChange={(e) => set({ quadrants: value.quadrants.map((q, j) => (j === i ? e.target.value : q)) })}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {value.mode === 'choose' && (
        <>
          <TargetsField value={value} onChange={onChange} />
          <OptionList
            label="Kategorien"
            options={value.choices}
            min={2}
            max={8}
            placeholder="Kategorie"
            onChange={(choices) => set({ choices })}
          />
          <Toggle
            label="Mehrere Kategorien je Eintrag erlaubt"
            hint="Aus: Jede Person wählt je Eintrag genau eine Kategorie."
            checked={value.multi}
            onChange={(multi) => set({ multi })}
          />
          <p className="small faint">Teilnehmende stimmen ab; im Steuerpult kannst du die Kategorie je Eintrag zusätzlich festlegen.</p>
        </>
      )}

      {value.mode === 'table' && (
        <>
          <OptionList
            label="Spalten"
            options={value.columns}
            min={1}
            max={5}
            placeholder="Spalte"
            onChange={(columns) => set({ columns })}
          />
          <TargetsField value={value} onChange={onChange} table={false} />
          <p className="small faint">
            Zeilen übernimmst du live im Steuerpult – zum Beispiel die Top 3 nach Punkten – und füllst sie gemeinsam aus.
          </p>
        </>
      )}
    </>
  );
}

export function SlideForm({
  slide,
  value,
  onChange,
  boards,
}: {
  slide: Slide;
  value: Slide['config'];
  onChange: (v: Slide['config']) => void;
  /** Namen der Kartenwände dieser Präsentation – zur Auswahl */
  boards?: string[];
}) {
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
      return <FeedbackForm value={v} onChange={onChange} boards={boards} />;
    case 'qa':
      return <QaForm value={v} onChange={onChange} />;
    case 'sentence':
      return <SentenceForm value={v} onChange={onChange} />;
    case 'image':
      return <ImageForm value={v} onChange={onChange} />;
    case 'board':
      return <BoardForm value={v} onChange={onChange} boards={boards} />;
    case 'teams':
      return <TeamsForm value={v} onChange={onChange} />;
    case 'pause':
      return <PauseForm value={v} onChange={onChange} />;
  }
}
