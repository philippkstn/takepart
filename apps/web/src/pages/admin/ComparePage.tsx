import { groupSimilar } from '@slides/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { FullScreenSpinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import './protocol.css';
import './compare.css';

interface CompareRun {
  id: number;
  startedAt: string;
  endedAt: string | null;
  participants: number;
  boards: { name: string; groups: { name: string; cards: number }[]; loose: string[] }[];
  tables: { headline: string; board: string; columns: string[]; rows: { label: string; fields: string[] }[] }[];
}

interface CompareData {
  id: number;
  title: string;
  boards: string[];
  runs: CompareRun[];
}

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { dateStyle: 'medium' });

/**
 * Workshop-Reihe: beendete Durchführungen einer Präsentation nebeneinander –
 * Teilnehmende, Gruppen je Kartenwand, mehrfach vorkommende Themen (ähnliche
 * Texte, `groupSimilar`) und die Ergebnistabellen. Druckbar wie das Protokoll.
 */
export default function ComparePage() {
  const id = Number(useParams().id);
  const data = useQuery({ queryKey: ['compare', id], queryFn: () => api<CompareData>(`/api/presentations/${id}/compare`) });
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const runs = useMemo(() => (data.data?.runs ?? []).filter((r) => !excluded.has(r.id)), [data.data, excluded]);
  const dates = useMemo(() => new Map((data.data?.runs ?? []).map((r) => [r.id, dateLabel(r.startedAt)])), [data.data]);
  const clusters = useMemo(
    () =>
      groupSimilar(
        runs.flatMap((r) => r.boards.flatMap((b) => [...b.groups.map((g) => g.name), ...b.loose]).map((text) => ({ text, source: r.id }))),
      ),
    [runs],
  );

  if (data.isLoading) return <FullScreenSpinner />;
  if (!data.data) return <main className="page">Nicht gefunden.</main>;
  const all = data.data.runs;
  const toggle = (runId: number) => {
    const next = new Set(excluded);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    setExcluded(next);
  };
  const columns = { gridTemplateColumns: `repeat(${Math.max(1, runs.length)}, minmax(200px, 1fr))` };

  return (
    <div className="protocol compare">
      <div className="protocol-toolbar no-print">
        <Link to={`/admin/p/${id}`} className="btn btn-ghost">
          <ArrowLeft /> Zur Präsentation
        </Link>
        <span className="grow" />
        <button className="btn btn-primary" onClick={() => window.print()} disabled={runs.length === 0}>
          <Printer /> Als PDF speichern
        </button>
      </div>

      <section className="protocol-cover compare-cover">
        <span className="protocol-kicker">Durchführungen vergleichen</span>
        <h1>{data.data.title}</h1>
        {all.length === 0 ? (
          <p className="muted">Noch keine beendete Durchführung.</p>
        ) : (
          <fieldset className="compare-select no-print">
            <legend className="label">Einbeziehen</legend>
            {all.map((r) => (
              <label key={r.id} className="row small">
                <input type="checkbox" checked={!excluded.has(r.id)} onChange={() => toggle(r.id)} />
                {new Date(r.startedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
                <span className="faint">· {r.participants} Teilnehmende</span>
              </label>
            ))}
          </fieldset>
        )}
        {runs.length > 0 && (
          <div className="compare-scroll">
            <table className="protocol-table">
              <thead>
                <tr>
                  <th>Durchführung</th>
                  {runs.map((r) => (
                    <th key={r.id}>{dates.get(r.id)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Teilnehmende</td>
                  {runs.map((r) => (
                    <td key={r.id} className="tabular">
                      {r.participants}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Dauer</td>
                  {runs.map((r) => (
                    <td key={r.id} className="tabular">
                      {r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)} Min.` : '–'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {runs.length > 0 && (
        <section className="protocol-page">
          <header>
            <span className="protocol-kicker">Über alle Durchführungen</span>
            <h2>Themen, die mehrfach vorkommen</h2>
          </header>
          {clusters.length === 0 ? (
            <p className="faint small">
              {runs.length < 2
                ? 'Für den Vergleich mindestens zwei Durchführungen auswählen.'
                : 'Keine ähnlichen Gruppen oder Karten gefunden.'}
            </p>
          ) : (
            <ul className="compare-topics">
              {clusters.map((c, i) => (
                <li key={i} className="protocol-note">
                  <strong>{c.label}</strong>
                  <span className="protocol-note-meta">
                    in {c.sources.length} von {runs.length} Durchführungen · {c.sources.map((s) => dates.get(s)).join(', ')}
                  </span>
                  <span className="compare-variants">
                    {[...new Set(c.items.map((it) => it.text.trim()))].filter((t) => t !== c.label).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="small faint no-print">
            Ähnlich heißt: nach Kleinschreibung, Umlauten und ohne Füllwörter teilen die Texte mindestens die Hälfte ihrer Wörter.
          </p>
        </section>
      )}

      {runs.length > 0 &&
        data.data.boards.map((name) => (
          <section key={name} className="protocol-page">
            <header>
              <span className="protocol-kicker">Kartenwand</span>
              <h2>{name}</h2>
            </header>
            <div className="compare-scroll">
              <div className="protocol-columns" style={columns}>
                {runs.map((r) => {
                  const board = r.boards.find((b) => b.name === name);
                  return (
                    <div key={r.id} className="protocol-column">
                      <h3>{dates.get(r.id)}</h3>
                      {!board || (board.groups.length === 0 && board.loose.length === 0) ? (
                        <p className="faint small">Keine Karten.</p>
                      ) : (
                        <ul className="protocol-notes">
                          {board.groups.map((g, i) => (
                            <li key={`g${i}`} className="protocol-note">
                              <span>{g.name}</span>
                              <span className="protocol-note-meta">{g.cards === 1 ? '1 Karte' : `${g.cards} Karten`}</span>
                            </li>
                          ))}
                          {board.groups.length === 0 ? (
                            board.loose.map((t, i) => (
                              <li key={`c${i}`} className="protocol-note">
                                <span>{t}</span>
                              </li>
                            ))
                          ) : board.loose.length > 0 ? (
                            <li className="protocol-note is-muted">
                              <span className="protocol-note-meta">{board.loose.length} nicht eingeordnete Karten</span>
                            </li>
                          ) : null}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}

      {runs.some((r) => r.tables.length > 0) && (
        <section className="protocol-page">
          <header>
            <span className="protocol-kicker">Ergebnistabellen</span>
            <h2>Top-Themen je Durchführung</h2>
          </header>
          {runs.map((r) =>
            r.tables.map((t, ti) => (
              <div key={`${r.id}-${ti}`} className="stack-s compare-table">
                <h3>
                  {dates.get(r.id)} · {t.headline || t.board}
                </h3>
                <div className="compare-scroll">
                  <table className="protocol-table">
                    <thead>
                      <tr>
                        <th>Nr.</th>
                        <th>Thema</th>
                        {t.columns.map((c, i) => (
                          <th key={i}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((row, i) => (
                        <tr key={i}>
                          <td className="tabular">{i + 1}</td>
                          <td>
                            <strong>{row.label}</strong>
                          </td>
                          {row.fields.map((f, j) => (
                            <td key={j}>{f || '–'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )),
          )}
        </section>
      )}
    </div>
  );
}
