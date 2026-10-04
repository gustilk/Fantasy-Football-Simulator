import { useState } from 'react';
import './prior-season-baseline.css';
import type { TeamSeasonRecord } from '@workspace/api-client-react';
import { baseline2025, priorTeam, priorPlayer, PRIOR_GAMES } from '@/lib/prior-season-baseline';

type Table = { heading: string; columns: string[]; rows: (number | string | null)[][] };
const labels: Record<string, string> = {
  index: 'Season overview / team offense', passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving',
  scrimmage: 'Scrimmage', defense: 'Player defense', kicking: 'Kicking', punting: 'Punting',
  returns: 'Kick & punt returns', scoring: 'Scoring', fantasy: 'Fantasy rankings',
  'redzone-passing': 'Red-zone passing', 'redzone-rushing': 'Red-zone rushing', 'redzone-receiving': 'Red-zone receiving',
  'fantasy-points-against-QB': 'Defense vs QB', 'fantasy-points-against-RB': 'Defense vs RB',
  'fantasy-points-against-WR': 'Defense vs WR', 'fantasy-points-against-TE': 'Defense vs TE', opp: 'Team defense',
};
export default function PriorSeasonBaselinePanel({ season, teams }: { season: number; teams: TeamSeasonRecord[] }) {
  const [selected, setSelected] = useState('');
  const [category, setCategory] = useState('passing');
  const [reference, setReference] = useState<Record<string, Table[]> | null>(null);
  const [referenceError, setReferenceError] = useState('');
  const [page, setPage] = useState(0);
  const [tableIndex, setTableIndex] = useState(0);
  const enabled = season === baseline2025.season + 1;
  const team = teams.find(team => team.team === selected) ?? teams[0];
  const historical = team && priorTeam(season, team.team);
  const players = team?.players.filter(player => player.active && (player.side === 'defense' || ['QB', 'RB', 'WR', 'TE'].includes(player.position))) ?? [];
  const coverage = players.map(player => ({ player, prior: priorPlayer(season, team!.team, player) }));
  const table = reference?.[category]?.[tableIndex];
  const loadReference = async () => {
    if (reference) return;
    setReferenceError('');
    try { const module = await import('../data/baseline-2025-reference.json'); setReference(module.default as Record<string, Table[]>); }
    catch { setReferenceError('Imported tables could not be loaded. Reopen this section to retry.'); }
  };
  return <section className="panel psb" data-testid="baseline-2025-panel">
    <h3 className="section-mini-title psb-title">2025 statistical baseline · {enabled ? 'Active for 2026' : `Not applied to ${season}`}</h3>
    <p className="stats-help">{baseline2025.sources.length} sources imported · {baseline2025.players.length.toLocaleString()} player identities · 32 teams.
      {' '}2025 regular-season stats stay separate from your saved {season} games. Current rosters and availability remain authoritative.</p>
    <p className="stats-help">Up to {PRIOR_GAMES} prior-game equivalents per known field: 2025 weight = p ÷ (p + known 2026 observations).
      With p = 3, that is 50% after 3 observations and 27% after 8. Missing fields stay unknown. This is an uncalibrated starting policy, not a proven accuracy improvement.
      Saved forecasts keep their original inputs; this affects new runs from Team Library.</p>
    <details className="sim-disclosure">
      <summary>Check player coverage and defensive references</summary>
      {!teams.length ? <p className="stats-help">Save current-season rosters in Team Library to check coverage.</p> : <>
        <label className="field psb-field">Current team<select value={team?.team ?? ''} onChange={event => setSelected(event.target.value)} data-testid="baseline-team">
          {teams.map(team => <option key={team.team}>{team.team}</option>)}
        </select></label>
        <p className="stats-help">{coverage.filter(row => row.prior.record).length} / {players.length} active modeled players have a same-team, compatible-position baseline.
          New teams, new QB1 roles and ambiguous names do not receive guessed 2025 workload.</p>
        <div className="psb-scroll" tabIndex={0} role="region" aria-label="Player coverage table"><table className="stats-table"><thead><tr><th>Current player</th><th>Position</th><th>2025 match</th></tr></thead>
          <tbody>{coverage.map(({ player, prior }) => <tr key={player.id}><td>{player.name}</td><td>{player.position}</td>
            <td>{!enabled ? 'Not applied this season' : prior.record ? `${prior.matched!.name} · ${prior.record.games} games`
              : prior.roleChanged ? 'QB role changed — excluded' : prior.teamChanged ? 'Different 2025 team — excluded' : 'Missing or ambiguous — no prior'}</td></tr>)}</tbody></table></div>
        {historical && <p className="stats-help">2025 DK points allowed per game (reference only):{' '}
          {Object.entries(historical.defenseVsPosition).map(([position, stats]) => `${position} ${stats.perGame.toFixed(2)}`).join(' · ')}.
          These are not added as extra scoring multipliers.</p>}
      </>}
    </details>
    <details className="sim-disclosure">
      <summary>All 19 imported sources</summary>
      <p className="stats-help">Passing, rushing, receiving, player defense and team statistics supply baseline fields.
        Scrimmage, scoring, fantasy, red-zone, kicking, punting, returns and defense-vs-position data are retained for reference.
        Overlapping totals are not added twice; fantasy points are not fed back as performance stats.</p>
      <ul className="psb-sources">{baseline2025.sources.map(source => <li key={source.name}><a href={source.url} target="_blank" rel="noreferrer">{labels[source.name]}</a>
        {' '}· {source.rows.toLocaleString()} rows · {source.use === 'model' ? 'Baseline inputs' : 'Reference only'}</li>)}</ul>
      <p className="stats-help">Retrieved {new Date(baseline2025.retrievedAt).toLocaleDateString()} from Pro Football Reference. Source checksums identify this imported snapshot; they do not establish historical pregame eligibility.</p>
    </details>
    <details className="sim-disclosure" onToggle={event => { if (event.currentTarget.open) void loadReference(); }}>
      <summary>Browse imported 2025 tables</summary>
      <label className="field psb-field">Statistics category<select value={category} onChange={event => { setCategory(event.target.value); setTableIndex(0); setPage(0); }} data-testid="baseline-category">
        {baseline2025.sources.map(source => <option key={source.name} value={source.name}>{labels[source.name]}</option>)}</select></label>
      {reference?.[category] && reference[category].length > 1 && <label className="field psb-field">Table<select value={tableIndex} onChange={event => { setTableIndex(Number(event.target.value)); setPage(0); }}>
        {reference[category].map((table, index) => <option key={index} value={index}>{table.heading}{category === 'fantasy' ? ` · part ${index + 1}` : ''}</option>)}</select></label>}
      {referenceError ? <p role="alert">{referenceError}</p> : !reference ? <p role="status">Loading imported tables…</p> : table && <>
        <p>{table.heading} · {table.rows.length.toLocaleString()} rows</p>
        <div className="psb-scroll" tabIndex={0} role="region" aria-label="Imported statistics table"><table className="stats-table" data-testid="baseline-reference-table">
          <thead><tr>{table.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
          <tbody>{table.rows.slice(page * 25, (page + 1) * 25).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value ?? '—'}</td>)}</tr>)}</tbody></table></div>
        <div className="psb-pager">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} / {Math.max(1, Math.ceil(table.rows.length / 25))}</span>
          <button className="btn-secondary" disabled={(page + 1) * 25 >= table.rows.length} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </>}
    </details>
  </section>;
}