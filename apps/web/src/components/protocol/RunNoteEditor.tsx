import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import './protocol-extra.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Protokollnotiz der Moderation zu einer Folie – speichert selbst (kurz nach dem
 * Tippen und beim Verlassen des Feldes). Getrennt von den Sprechernotizen.
 */
export function RunNoteEditor({
  runId,
  slideId,
  initial,
  rows = 3,
  label = 'Notizen der Moderation',
}: {
  runId: number;
  slideId: number;
  initial: string;
  rows?: number;
  label?: string;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(initial);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const saved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(text);
  latest.current = text;

  const save = async () => {
    clearTimeout(timer.current);
    const value = latest.current;
    if (value === saved.current) return;
    setState('saving');
    try {
      await api(`/api/runs/${runId}/notes/${slideId}`, { method: 'PUT', body: { text: value } });
      saved.current = value;
      setState(latest.current === value ? 'saved' : 'idle');
      void queryClient.invalidateQueries({ queryKey: ['run-results', runId] });
      queryClient.setQueryData<Record<string, string>>(['run-notes', runId], (old) => {
        const next = { ...old };
        if (value.trim()) next[slideId] = value;
        else delete next[slideId];
        return next;
      });
    } catch (err) {
      setError(errorMessage(err));
      setState('error');
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Beim Wechsel der Folie bzw. Verlassen der Seite nichts verlieren
  useEffect(() => () => void saveRef.current(), []);

  const change = (value: string) => {
    setText(value);
    setState('idle');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), 900);
  };

  const id = `run-note-${runId}-${slideId}`;
  return (
    <div className="run-note no-print">
      <div className="row-between">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <span className={`small ${state === 'error' ? 'run-note-error' : 'faint'}`} aria-live="polite">
          {state === 'saving' ? 'Speichert …' : state === 'saved' ? 'Gespeichert' : state === 'error' ? error : ''}
        </span>
      </div>
      <textarea
        id={id}
        className="textarea"
        rows={rows}
        value={text}
        maxLength={10000}
        placeholder="Entscheidungen, Absprachen, offene Punkte – erscheint im Fotoprotokoll"
        onChange={(e) => change(e.target.value)}
        onBlur={() => void save()}
      />
    </div>
  );
}

/** Steuerpult: Protokollnotiz zur aktuellen Folie */
export function LiveRunNote({ runId, slideId }: { runId: number; slideId: number }) {
  const notes = useQuery({
    queryKey: ['run-notes', runId],
    queryFn: () => api<Record<string, string>>(`/api/runs/${runId}/notes`),
    staleTime: Infinity,
  });
  if (!notes.data) return null;
  return (
    <RunNoteEditor key={slideId} runId={runId} slideId={slideId} initial={notes.data[slideId] ?? ''} label="Protokoll zu dieser Folie" />
  );
}
