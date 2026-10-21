import { leadingChoices, tagCountText, type BoardConfig, type BoardResults, type BoardSummary, type SlideResults } from '@slides/shared';
import { cardsByGroup, itemsByCell, labelOf, ratingText } from '../../lib/board.ts';

/**
 * Protokoll einer Kartenwand fürs Archiv: Gruppen mit ihren Karten, Felder,
 * Punkte, Einschätzungen und die Ergebnistabelle – wie ein Fotoprotokoll, nur lesbar.
 */
export function BoardProtocol({ config, summary, results }: { config: BoardConfig; summary: BoardSummary; results: SlideResults | null }) {
  const { view, cards } = summary;
  const board = results?.type === 'board' ? (results as BoardResults) : null;
  const label = (key: string) => labelOf(key, cards, view);
  // Auf späteren Folien der Wand gelten die Kennzeichnungen der Sammel-Folie
  const tag = (column: number | null) => (column !== null ? (config.tags[column] ?? view.tags[column]) : undefined);
  const dist = (key: string) => tagCountText(view.tags, view.tagCounts[key]);

  switch (config.mode) {
    case 'collect':
      return null; // Karten stehen als Beiträge darunter
    case 'cluster': {
      const byGroup = cardsByGroup(cards);
      const unsorted = byGroup.get(null) ?? [];
      return (
        <div className="protocol-groups">
          {view.groups.map((g) => (
            <section key={g.id} className="protocol-group">
              <h3>
                {g.name} <span className="faint tabular">· {g.cards} Karten</span>
                {dist(`g${g.id}`) && <span className="faint tabular"> · {dist(`g${g.id}`)}</span>}
              </h3>
              <ul>
                {(byGroup.get(g.id) ?? []).map((c) => (
                  <li key={c.id}>
                    {c.text} {tag(c.column) && <span className="pill">{tag(c.column)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {unsorted.length > 0 && (
            <section className="protocol-group is-unsorted">
              <h3>Nicht eingeordnet</h3>
              <ul>
                {unsorted.map((c) => (
                  <li key={c.id}>{c.text}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      );
    }
    case 'place': {
      const { cells, unplaced } = itemsByCell(view);
      return (
        <div className="protocol-groups">
          {config.lanes.flatMap((lane, l) =>
            lane.cells.map((cell, c) => {
              const items = cells.get(`${l}:${c}`) ?? [];
              return (
                <section key={`${l}:${c}`} className="protocol-group">
                  <h3>
                    {lane.title ? `${lane.title} · ` : ''}
                    {cell} <span className="faint tabular">· {items.length}</span>
                  </h3>
                  <ul>
                    {items.map((k) => (
                      <li key={k}>{label(k)}</li>
                    ))}
                  </ul>
                </section>
              );
            }),
          )}
          {unplaced.length > 0 && (
            <section className="protocol-group is-unsorted">
              <h3>Nicht eingeordnet</h3>
              <ul>
                {unplaced.map((k) => (
                  <li key={k}>{label(k)}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      );
    }
    case 'dots':
    case 'rate': {
      const score = (key: string) =>
        config.mode === 'dots' ? (board?.dots[key] ?? 0) : (board?.ratings[key]?.average.reduce<number>((a, b) => a + (b ?? 0), 0) ?? -1);
      const keys = [...view.targets].sort((a, b) => score(b) - score(a));
      return (
        <table className="protocol-table">
          <thead>
            <tr>
              <th>Eintrag</th>
              <th>{config.mode === 'dots' ? 'Punkte' : 'Einschätzung'}</th>
              {config.mode === 'rate' && <th>Stimmen</th>}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td>
                  {label(k)}
                  {dist(k) && <span className="faint tabular"> · {dist(k)}</span>}
                  {view.tied.includes(k) && <span className="faint"> · gleichauf</span>}
                </td>
                <td className="tabular">{config.mode === 'dots' ? (board?.dots[k] ?? 0) : ratingText(config, board?.ratings[k])}</td>
                {config.mode === 'rate' && <td className="tabular">{board?.ratings[k]?.n.join(' / ') ?? 0}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'choose':
      return <ChooseProtocol config={config} view={view} results={board} label={label} />;
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
                <td>{label(r.key)}</td>
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

/** Einordnen im Protokoll: Stimmen je Kategorie, meistgewählte fett, Festlegungen benannt */
export function ChooseProtocol({
  config,
  view,
  results,
  label,
}: {
  config: Pick<BoardConfig, 'choices'>;
  view: BoardSummary['view'];
  results: BoardResults | null;
  label: (key: string) => string;
}) {
  return (
    <table className="protocol-table">
      <thead>
        <tr>
          <th>Eintrag</th>
          {config.choices.map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {view.targets.map((k) => {
          const counts = results?.picks[k];
          const lead = leadingChoices(counts, view.chosen[k]);
          const dist = tagCountText(view.tags, view.tagCounts[k]);
          return (
            <tr key={k}>
              <td>
                {label(k)}
                {dist && <span className="faint tabular"> · {dist}</span>}
              </td>
              {config.choices.map((_, i) => (
                <td key={i} className="tabular">
                  {lead.indices.includes(i) ? <strong>{counts?.[i] ?? 0}</strong> : (counts?.[i] ?? 0)}
                  {lead.fixed && lead.indices.includes(i) && ' · festgelegt'}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
