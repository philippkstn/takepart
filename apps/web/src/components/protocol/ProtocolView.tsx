import {
  type BoardConfig,
  type BoardResults,
  type BoardSummary,
  type BrandView,
  type PostView,
  type PublicSlide,
  type SlideResults,
  type SlideType,
  teamLabel,
} from '@slides/shared';
import { useEffect, type ReactNode } from 'react';
import { BarList, SlideResultsView } from '../Results.tsx';
import { BrandMark } from '../ui.tsx';
import { cardsByGroup, itemsByCell, labelOf, ratingText } from '../../lib/board.ts';
import { cardsByTeam } from '../board/Breakout.tsx';
import { brandStyle } from '../../lib/brand.ts';
import '../../pages/admin/protocol.css';
import './protocol-extra.css';

/** Gruppe einer Einteilung; `size` statt Namen, wenn das geteilte Protokoll ohne Namen ist */
export interface ProtocolTeam {
  name: string;
  members: string[];
  size?: number;
}

export interface ProtocolSlide {
  id: number;
  type: SlideType;
  typeLabel: string;
  headline: string;
  config: PublicSlide['config'];
  /** Protokollnotiz der Moderation */
  note: string | null;
  results: SlideResults | null;
  responses: number;
  posts: { id: number; authorName: string | null; text: string; column: number | null; status: string; votes: number }[];
  sentence: string | null;
  board: BoardSummary | null;
  teams: ProtocolTeam[] | null;
}

export interface ProtocolData {
  title: string;
  startedAt: string;
  endedAt: string | null;
  participants: number;
  brand: BrandView | null;
  slides: ProtocolSlide[];
}

/** Folien ohne Mitmach-Inhalt gehören nicht ins Protokoll – außer mit Notiz der Moderation */
export function hasContent(s: ProtocolSlide): boolean {
  if (s.note) return true;
  if (s.type === 'content' || s.type === 'image') return false;
  if (s.type === 'teams') return (s.teams?.length ?? 0) > 0;
  if (s.board) {
    const { view, cards } = s.board;
    switch ((s.config as BoardConfig).mode) {
      case 'collect':
        return cards.length > 0;
      case 'cluster':
        return view.groups.length > 0;
      case 'place':
        return Object.keys(view.places).length > 0;
      case 'dots':
      case 'rate':
        return (s.results?.voters ?? 0) > 0;
      case 'table':
        return view.rows.length > 0;
    }
  }
  return s.responses > 0;
}

/**
 * Fotoprotokoll einer Durchführung: alle Karten, Gruppen, Zuordnungen, Punkte,
 * Ergebnisse, Notizen der Moderation und die Gruppeneinteilung – aufbereitet für
 * den Druck. Gemeinsam für die Admin-Seite und den geteilten Link (`/p/:token`).
 * `noteEditor` ersetzt im Admin die Anzeige der Notiz durch ein Eingabefeld
 * (gedruckt wird immer der Text).
 */
export function ProtocolView({
  run,
  toolbar,
  noteEditor,
}: {
  run: ProtocolData;
  toolbar?: ReactNode;
  noteEditor?: (slide: ProtocolSlide) => ReactNode;
}) {
  // Der Dokumenttitel wird zum Dateinamen der PDF
  useEffect(() => {
    const previous = document.title;
    document.title = `Fotoprotokoll – ${run.title} – ${new Date(run.startedAt).toLocaleDateString('de-DE')}`;
    return () => {
      document.title = previous;
    };
  }, [run.title, run.startedAt]);

  const slides = run.slides.filter(hasContent);
  const started = new Date(run.startedAt);
  const minutes = run.endedAt ? Math.round((new Date(run.endedAt).getTime() - started.getTime()) / 60000) : null;

  return (
    <div className="protocol" style={brandStyle(run.brand)}>
      {toolbar}

      <section className="protocol-cover">
        <div className="protocol-brand">
          {run.brand?.logoUrl ? <img src={run.brand.logoUrl} alt={run.brand.name} /> : <BrandMark size={40} />}
        </div>
        <span className="protocol-kicker">Fotoprotokoll</span>
        <h1>{run.title}</h1>
        <dl className="protocol-facts">
          <div>
            <dt>Datum</dt>
            <dd>{started.toLocaleDateString('de-DE', { dateStyle: 'full' })}</dd>
          </div>
          <div>
            <dt>Uhrzeit</dt>
            <dd>
              {started.toLocaleTimeString('de-DE', { timeStyle: 'short' })}
              {run.endedAt && ` – ${new Date(run.endedAt).toLocaleTimeString('de-DE', { timeStyle: 'short' })}`}
              {minutes !== null && ` (${minutes} Min.)`}
            </dd>
          </div>
          <div>
            <dt>Teilnehmende</dt>
            <dd>{run.participants}</dd>
          </div>
          <div>
            <dt>Übungen</dt>
            <dd>{slides.length}</dd>
          </div>
        </dl>
        {slides.length > 0 && (
          <ol className="protocol-toc">
            {slides.map((s) => (
              <li key={s.id}>
                <span>{s.headline || s.typeLabel}</span>
                <span className="faint">{s.typeLabel}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {slides.map((s, i) => (
        <section key={s.id} className="protocol-page">
          <header className="protocol-page-head">
            <span className="protocol-kicker">
              {i + 1} · {s.typeLabel}
              {s.board && ` · ${(s.config as BoardConfig).board}`}
            </span>
            <h2>{s.headline || s.typeLabel}</h2>
          </header>
          <SlideBody slide={s} index={i} />
          {s.note && (
            <div className={`protocol-minutes${noteEditor ? ' print-only' : ''}`}>
              <h3>Notizen der Moderation</h3>
              <p>{s.note}</p>
            </div>
          )}
          {noteEditor?.(s)}
        </section>
      ))}
    </div>
  );
}

function SlideBody({ slide: s, index }: { slide: ProtocolSlide; index: number }) {
  if (s.teams) return <Teams teams={s.teams} />;
  if (s.board) return <Board config={s.config as BoardConfig} summary={s.board} results={s.results} />;
  if (s.sentence) return <p className="protocol-sentence">{s.sentence}</p>;
  const results =
    s.results && s.results.voters > 0 ? (
      <SlideResultsView slide={{ id: s.id, type: s.type, position: index, config: s.config } as PublicSlide} results={s.results} />
    ) : null;
  const visible = s.posts.filter((p) => p.status !== 'hidden' && p.status !== 'pending');
  if (visible.length === 0) return results;
  if (s.type === 'pinboard' && 'columns' in s.config) {
    const columns = s.config.columns;
    return (
      <div className="protocol-columns" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((c, i) => (
          <div key={i} className="protocol-column">
            <h3>{c}</h3>
            <Notes items={visible.filter((p) => (p.column ?? 0) === i).map((p) => ({ id: p.id, text: p.text, votes: p.votes }))} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      {results}
      <Notes
        items={visible.map((p) => ({
          id: p.id,
          text: p.text,
          meta: p.authorName ?? undefined,
          votes: p.votes,
          done: p.status === 'answered',
        }))}
      />
    </>
  );
}

/** Karten wie an der Wand: Kärtchen in einem Raster */
function Notes({ items }: { items: { id: number | string; text: string; meta?: string; votes?: number; done?: boolean }[] }) {
  if (items.length === 0) return <p className="faint small">Keine Karten.</p>;
  return (
    <ul className="protocol-notes">
      {items.map((it) => (
        <li key={it.id} className="protocol-note">
          <span>{it.text}</span>
          {(it.meta || (it.votes ?? 0) > 0 || it.done) && (
            <span className="protocol-note-meta">
              {[it.meta, (it.votes ?? 0) > 0 ? `${it.votes} Stimmen` : '', it.done ? 'beantwortet' : ''].filter(Boolean).join(' · ')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Teams({ teams }: { teams: ProtocolTeam[] }) {
  return (
    <div className="protocol-columns is-auto">
      {teams.map((t) => (
        <div key={t.name} className="protocol-column">
          <h3>
            {t.name} <span className="faint tabular">{t.size ?? t.members.length}</span>
          </h3>
          {t.size !== undefined ? (
            <p className="small faint">Namen nicht geteilt</p>
          ) : (
            <ul className="protocol-names">
              {t.members.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Board({ config, summary, results }: { config: BoardConfig; summary: BoardSummary; results: SlideResults | null }) {
  const { view, cards } = summary;
  const board = results?.type === 'board' ? (results as BoardResults) : null;
  const label = (key: string) => labelOf(key, cards, view);
  const tag = (c: PostView) => (c.column !== null ? config.tags[c.column] : undefined);
  const note = (c: PostView) => ({ id: c.id, text: c.text, meta: tag(c) });

  switch (config.mode) {
    case 'collect': {
      const visible = cards.filter((c) => c.status === 'visible');
      // Gruppenweise gesammelt: Karten nach Arbeitsgruppe
      if (config.perTeam && visible.some((c) => c.team !== null && c.team !== undefined)) {
        const byTeam = cardsByTeam(visible);
        const teams = [...byTeam.keys()].filter((k): k is number => k !== null).sort((a, b) => a - b);
        const loose = byTeam.get(null) ?? [];
        return (
          <div className="protocol-columns is-auto">
            {teams.map((t) => (
              <div key={t} className="protocol-column">
                <h3>
                  {teamLabel(t)} <span className="faint tabular">{byTeam.get(t)!.length}</span>
                </h3>
                <Notes items={byTeam.get(t)!.map(note)} />
              </div>
            ))}
            {loose.length > 0 && (
              <div className="protocol-column is-muted">
                <h3>Ohne Gruppe</h3>
                <Notes items={loose.map(note)} />
              </div>
            )}
          </div>
        );
      }
      return <Notes items={visible.map(note)} />;
    }
    case 'cluster': {
      const byGroup = cardsByGroup(cards);
      const unsorted = byGroup.get(null) ?? [];
      return (
        <div className="protocol-columns is-auto">
          {view.groups.map((g) => (
            <div key={g.id} className="protocol-column">
              <h3>
                {g.name} <span className="faint tabular">{g.cards}</span>
              </h3>
              <Notes items={(byGroup.get(g.id) ?? []).map(note)} />
            </div>
          ))}
          {unsorted.length > 0 && (
            <div className="protocol-column is-muted">
              <h3>Nicht eingeordnet</h3>
              <Notes items={unsorted.map(note)} />
            </div>
          )}
        </div>
      );
    }
    case 'place': {
      const { cells, unplaced } = itemsByCell(view);
      const matrix = config.lanes.length === 2 && config.lanes.every((l) => l.cells.length === 2);
      return (
        <div className="stack">
          {config.lanes.map((lane, l) => (
            <div key={l} className="stack-s">
              {lane.title && <h3 className="protocol-lane">{lane.title}</h3>}
              <div className="protocol-columns" style={{ gridTemplateColumns: `repeat(${lane.cells.length}, minmax(0, 1fr))` }}>
                {lane.cells.map((cell, c) => {
                  const items = cells.get(`${l}:${c}`) ?? [];
                  return (
                    <div key={c} className="protocol-column">
                      <h3>
                        {cell} <span className="faint tabular">{items.length}</span>
                      </h3>
                      <Notes items={items.map((k) => ({ id: k, text: label(k) }))} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {matrix && (config.xLabel || config.yLabel) && (
            <p className="small faint">
              {config.yLabel} · {config.xLabel}
            </p>
          )}
          {unplaced.length > 0 && (
            <div className="protocol-column is-muted">
              <h3>Nicht eingeordnet</h3>
              <Notes items={unplaced.map((k) => ({ id: k, text: label(k) }))} />
            </div>
          )}
        </div>
      );
    }
    case 'dots': {
      const items = view.targets.map((k, i) => ({ k, i, n: board?.dots[k] ?? 0 })).sort((a, b) => b.n - a.n || a.i - b.i);
      return (
        <div className="protocol-bars">
          <BarList
            max={Math.max(1, ...items.map((e) => e.n))}
            items={items.map((e) => ({ key: e.k, label: label(e.k), value: e.n, display: `${e.n} ${e.n === 1 ? 'Punkt' : 'Punkte'}` }))}
          />
        </div>
      );
    }
    case 'rate': {
      const sum = (k: string) => board?.ratings[k]?.average.reduce<number>((a, b) => a + (b ?? 0), 0) ?? -1;
      const keys = [...view.targets].sort((a, b) => sum(b) - sum(a));
      return (
        <table className="protocol-table">
          <thead>
            <tr>
              <th>Eintrag</th>
              <th>Einschätzung</th>
              <th>Stimmen</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td>{label(k)}</td>
                <td className="tabular">{ratingText(config, board?.ratings[k])}</td>
                <td className="tabular">{board?.ratings[k]?.n.join(' / ') ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'table':
      return (
        <table className="protocol-table">
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Thema</th>
              {config.columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r, i) => (
              <tr key={r.key}>
                <td className="tabular">{i + 1}</td>
                <td>
                  <strong>{label(r.key)}</strong>
                </td>
                {r.fields.map((f, j) => (
                  <td key={j}>{f || '–'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
