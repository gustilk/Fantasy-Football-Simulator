import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, Play, Square, Trash2, RotateCw } from 'lucide-react';
import { useManualLineups } from '@/hooks/use-manual-lineups';
import { TEAM_CODES, lineupSlots } from '@/lib/lineups';
import { MANUAL_LINEUP_COUNT } from '@/lib/manual-lineups';
import { EMPTY_MANUAL_PLAYER_FILTERS, filterManualPlayers, manualPlayerPage, type ManualPlayerFilters } from '@/lib/manual-player-browser';
import { manualRosterReadiness } from '@/lib/manual-lineup-readiness';
import type { SimulatorLineupSource } from '@/lib/simulator-lineups';
import './manual-lineups.css';

const CAP = 50000;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const POS = ['QB', 'RB', 'WR', 'TE', 'DST'];
const POSITION_TABS = [{ value: '', label: 'All' }, ...POS.map(position => ({ value: position, label: position }))];

export default function ManualLineupsSection({ season, forecastSource }: { season: number; forecastSource?: SimulatorLineupSource }) {
  const c = useManualLineups(season, forecastSource);
  const [exposure, setExposure] = useState(60);
  const [availabilityText, setAvailabilityText] = useState('');
  const [limitText, setLimitText] = useState('');
  const [gameLimitText, setGameLimitText] = useState('');
  const [filters, setFilters] = useState<ManualPlayerFilters>({ ...EMPTY_MANUAL_PLAYER_FILTERS });
  const [requestedPage, setRequestedPage] = useState(1);
  const file = useRef<HTMLInputElement>(null);
  const playerList = useRef<HTMLUListElement>(null);
  const busy = c.importing || c.loading;

  const teams = useMemo(() => [...new Set(c.players.map(p => p.team))].sort((a, b) =>
    (TEAM_CODES[a] ?? a).localeCompare(TEAM_CODES[b] ?? b)), [c.players]);
  const games = useMemo(() => [...new Set(c.players.map(p => p.gameInfo).filter(Boolean))].sort(), [c.players]);
  const rows = useMemo(() => filterManualPlayers(c.players, c.picks, filters), [c.players, c.picks, filters]);
  const positionCounts = useMemo(() => {
    const matching = filterManualPlayers(c.players, c.picks, { ...filters, position: '' });
    return Object.fromEntries(POSITION_TABS.map(({ value }) => [
      value, value ? matching.filter(player => player.position === value).length : matching.length,
    ]));
  }, [c.players, c.picks, filters]);
  const page = manualPlayerPage(rows, requestedPage);
  useEffect(() => { if (playerList.current) playerList.current.scrollTop = 0; }, [page.page, filters, c.record?.csv]);
  const changeFilters = (patch: Partial<ManualPlayerFilters>) => {
    setFilters(current => ({ ...current, ...patch })); setRequestedPage(1);
  };
  const resetFilters = () => { setFilters({ ...EMPTY_MANUAL_PLAYER_FILTERS }); setRequestedPage(1); };
  const filtered = Object.values(filters).some(Boolean);
  const readiness = useMemo(() => manualRosterReadiness(c.players, c.picks), [c.players, c.picks]);

  return <section className="ml" aria-label="My Picks">
    <div className="page-heading" style={{ marginBottom: 0 }}>
      <div><h1>My Picks</h1>
        <p>Select players and generate up to {MANUAL_LINEUP_COUNT} distinct DraftKings Classic lineups using salaries only. No fantasy-point entries are needed.</p></div>
    </div>

    <div className="panel ml-panel">
      <h2>1. Contest salaries</h2>
      {busy && <p className="ml-muted" role="status">Loading salaries…</p>}
      {c.record
        ? <p className="ml-muted"><strong>{c.record.filename}</strong> · imported {new Date(c.record.importedAt).toLocaleString()} · {c.players.length} players</p>
        : !busy && <div className="ml-note" role="status">No Classic salaries yet. Import Featured Classic or upload a DraftKings Classic CSV.</div>}
      <p className="ml-muted">These salaries are shared with Lineups; replacing them changes both. Save your selections to sync them across devices for this exact contest.</p>
      {c.warning && <div className="ml-note" role="status">{c.warning}</div>}
      {c.notice && <div className="ml-note" role="status">{c.notice}</div>}
      <div className="ml-actions">
        <input ref={file} type="file" accept=".csv,text/csv" hidden data-testid="manual-upload"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void c.importCsv(f); }} />
        <button className="btn-primary" data-testid="manual-import-featured" disabled={busy} onClick={() => void c.importFeatured()}><Download size={14} /> Import Featured Classic</button>
        <button className="btn-secondary" disabled={busy} onClick={() => file.current?.click()}>{c.importing ? <><RotateCw size={14} className="spin-icon" /> Importing…</> : <><Upload size={14} /> Upload Classic CSV</>}</button>
      </div>
    </div>

    {c.storageError && <div className="ml-err" role="alert">{c.storageError}
      <button className="btn-secondary" data-testid="manual-save-retry" disabled={c.pickSync.saving || c.pickSync.conflict || !c.pickSync.dirty} onClick={c.retrySave}>Retry save</button></div>}

    <div className="panel ml-panel">
      <h2>2. Choose players</h2>
      {c.record && <><p className="ml-muted" role="status" data-testid="manual-sync-status">{c.pickSync.status}</p>
        <div className="ml-actions">
          <button className="btn-primary" data-testid="manual-save" disabled={busy || !c.pickSync.ready || !c.pickSync.dirty || c.pickSync.saving || c.pickSync.conflict} onClick={c.pickSync.save}>Save picks</button>
          <button className="btn-secondary" data-testid="manual-refresh" disabled={c.pickSync.saving} onClick={c.pickSync.refresh}><RotateCw size={14} /> Refresh picks</button>
          {(c.pickSync.dirty || c.warning) && <button className="btn-secondary" data-testid="manual-export-draft" onClick={c.pickSync.exportDraft}>Export browser draft</button>}
          {c.pickSync.conflict && <button className="btn-secondary" data-testid="manual-use-shared" onClick={c.pickSync.useShared}>Use latest shared picks</button>}
        </div></>}
      <div className="ml-note">Start with a <strong>team or game</strong>, then choose a position to find players quickly. Salaries do not confirm who will start; backups remain available for replacements.</div>
      <div className="ml-filters">
        <div className="field"><label htmlFor="ml-q">Search player or team</label>
          <input id="ml-q" type="search" data-testid="manual-search" value={filters.query} onChange={e => changeFilters({ query: e.target.value })} placeholder="Name, team name, or abbreviation" /></div>
      </div>
      <div className="ml-filters ml-scope-filters">
        <div className="field"><label htmlFor="ml-team">Team</label>
          <select id="ml-team" data-testid="manual-team" value={filters.team} onChange={e => changeFilters({ team: e.target.value })}>
            <option value="">All teams</option>{teams.map(team => <option key={team} value={team}>{TEAM_CODES[team] ?? team} ({team})</option>)}
          </select></div>
        <div className="field"><label htmlFor="ml-game">Game</label>
          <select id="ml-game" data-testid="manual-game" value={filters.game} onChange={e => changeFilters({ game: e.target.value })}>
            <option value="">All games</option>{games.map(game => <option key={game} value={game}>{game.replace('@', ' at ')}</option>)}
          </select></div>
      </div>
      <div className="ml-actions">
        <label className="ml-check"><input type="checkbox" data-testid="manual-selected-only" checked={filters.selectedOnly}
          onChange={e => changeFilters({ selectedOnly: e.target.checked })} /> Show selected only ({c.selectedCount})</label>
        <button className="btn-secondary" data-testid="manual-review-picks" disabled={!c.selectedCount}
          onClick={() => { setFilters({ ...EMPTY_MANUAL_PLAYER_FILTERS, selectedOnly: true }); setRequestedPage(1); }}>Review all my picks ({c.selectedCount})</button>
        <button className="btn-secondary" data-testid="manual-reset-filters" disabled={!filtered} onClick={resetFilters}>Reset filters</button>
      </div>
      <p className="ml-muted">Filters only change what is shown. Generate uses all selected players, including those on other pages.</p>
      <div className="ml-position-tabs" role="group" aria-label="Filter players by position">
        {POSITION_TABS.map(({ value, label }) => {
          const count = positionCounts[value] ?? 0;
          return <button key={value || 'all'} type="button" className="btn-secondary ml-position-tab"
            data-testid={`manual-position-${value || 'all'}`} aria-pressed={filters.position === value}
            aria-label={`${label === 'All' ? 'All positions' : label}: ${count} matching players`}
            onClick={() => changeFilters({ position: value })}>
            <span>{label}</span><span className="ml-position-count">{count}</span>
          </button>;
        })}
      </div>
      <p className="ml-muted" role="status" data-testid="manual-player-count">
        {rows.length ? `Showing ${page.start}–${page.end} of ${rows.length} matching players` : 'No matching players'} · {c.players.length} in the contest · highest salaries first
      </p>
      {busy && !c.players.length
        ? <div className="ml-list" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="ml-row"><span /><span className="ml-muted">Loading…</span><span /></div>)}</div>
        : rows.length === 0
          ? <p className="ml-note" role="status">{c.players.length ? 'No players match these filters.' : 'Import salaries to see players.'}</p>
          : <ul className="ml-list" ref={playerList}>{page.rows.map(p => {
            const pick = c.picks[p.id];
            const sel = !!pick?.selected;
            const blocked = !!p.unavailable && !sel;
            return <li key={p.id} className={`ml-row${sel ? ' on' : ''}${p.unavailable ? ' off' : ''}`}>
              <input type="checkbox" aria-label={`Select ${p.name}`} data-testid={`manual-pick-${p.id}`} checked={sel} disabled={busy || blocked || !c.pickSync.ready}
                onChange={e => c.updatePick(p.id, { selected: e.target.checked })} />
              <div className="ml-who"><strong>{p.name}</strong>
                <span>{p.position} · {p.team} · {money(p.salary)}</span>
                <span className="ml-game-info">{p.gameInfo.replace('@', ' at ')}</span>
                {p.unavailable && <em>{p.unavailable}</em>}</div>
            </li>;
          })}</ul>}
      {page.pages > 1 && <nav className="ml-pagination" aria-label="Player list pages">
        <button className="btn-secondary" data-testid="manual-previous-page" disabled={page.page === 1}
          onClick={() => setRequestedPage(page.page - 1)}>Previous</button>
        <span className="ml-muted">Page {page.page} of {page.pages}</span>
        <button className="btn-secondary" data-testid="manual-next-page" disabled={page.page === page.pages}
          onClick={() => setRequestedPage(page.page + 1)}>Next</button>
      </nav>}
      <div className="ml-actions"><button className="btn-secondary" disabled={busy || !c.pickSync.ready || (!c.selectedCount && !Object.keys(c.picks).length)} onClick={c.clearPicks}><Trash2 size={14} /> Clear selections</button></div>
    </div>

    <div className="panel ml-panel">
      <h2>3. Generate</h2>
      <p className="ml-note"><strong>Select as many candidates as you want.</strong> Generate up to {MANUAL_LINEUP_COUNT} distinct random legal lineups from <strong>all {c.selectedCount} selected candidates</strong>. Salary is used only for Classic roster rules and the $50,000 cap; lineups are not ranked by fantasy points. Selected players are options—not mandatory locks.</p>
      <p className="ml-muted">The final 9-player Classic lineup—not your selection list—must fit {money(CAP)} and contain QB, 2 RB, 3 WR, TE, FLEX, DST across at least 2 games.</p>
      <div className="ml-stats"><div><span>Candidates in your pool</span><strong>{c.selectedCount}</strong></div><div><span>Final lineup budget</span><strong>{money(CAP)}</strong></div></div>
      <div className="ml-roster-check" data-testid="manual-roster-check" aria-label="Selected position counts">
        {readiness.positions.map(p => <span key={p.position} className={p.count < p.required ? 'missing' : ''}>
          {p.position === 'DST' ? 'DST (defense)' : p.position}: {p.count} candidates · lineup uses {p.required}{['RB', 'WR', 'TE'].includes(p.position) ? ' + possible FLEX' : ''}
        </span>)}
        <span className={readiness.flexMissing ? 'missing' : ''}>RB/WR/TE: {readiness.flexCount} candidates · lineup chooses 7 including FLEX</span>
      </div>
      {!!c.selectedCount && readiness.issues.length > 0 && <div className="ml-note" data-testid="manual-roster-needs">
        <strong>Your candidate pool is missing options for these slots:</strong><ul>{readiness.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
        <div className="ml-actions">{readiness.positions.filter(p => p.count < p.required).map(p =>
          <button key={p.position} className="btn-secondary" onClick={() => {
            setFilters({ ...EMPTY_MANUAL_PLAYER_FILTERS, position: p.position }); setRequestedPage(1);
            playerList.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }}>Find {p.position === 'DST' ? 'team defenses (DST)' : p.position}</button>)}
        </div>
      </div>}
      <p className="ml-muted">You do not need to deselect extra players or reduce your pool to 9. The $50,000 cap applies only to the chosen lineup, not the salary total of all your candidates. Filters and pages do not restrict the optimizer.</p>
      {c.error && <div className="ml-err" role="alert" data-testid="manual-error">{c.error}
        {c.salaryError && <button className="btn-secondary" onClick={c.refreshSalaries}>Retry salary sync</button>}</div>}
      <div className="ml-actions">
        {c.running
          ? <button className="btn-secondary" data-testid="manual-stop" onClick={c.stop}><Square size={14} /> Stop</button>
          : <button className="btn-primary" data-testid="manual-generate" disabled={busy || !c.pickSync.ready || c.pickSync.dirty || !!c.storageError || !c.selectedCount} onClick={c.generate}><Play size={15} /> Generate {MANUAL_LINEUP_COUNT} lineups</button>}
        {!!c.lineups.length && <button className="btn-secondary" onClick={c.exportResults}><Download size={14} /> Export {c.lineups.length} {c.lineups.length === 1 ? 'lineup' : 'lineups'} CSV</button>}
      </div>
      {c.running && <p className="ml-muted" role="status"><RotateCw size={12} className="spin-icon" /> Generating random legal lineups…</p>}
    </div>


    <div className="panel ml-panel">
      <h2>4. Generate from projections</h2>
      <p className="ml-note"><strong>Uses your saved game projections.</strong> Builds up to {MANUAL_LINEUP_COUNT} distinct legal lineups from your selected players, favouring combinations that score high together in the simulated games (stacks come from the simulations, not a fixed rule). Selected players are options, not locks. The random option above is unchanged.</p>
      <p className="ml-muted">Every selected player needs a saved pregame projection. Thursday and Monday games come from <strong>Game Simulator</strong> runs; Sunday games from the <strong>DraftKings</strong> tab. Players without one are skipped and listed below. Lineups are estimates, not guaranteed winnings.</p>
      <div className="ml-filters"><div className="field"><label htmlFor="ml-exposure">Max share of lineups for any one player: {exposure}%</label>
        <input id="ml-exposure" type="range" min={20} max={100} step={5} value={exposure} data-testid="manual-exposure" onChange={e => setExposure(Number(e.target.value))} /></div></div>
      <div className="field"><label htmlFor="ml-availability">Uncertain players (optional): one per line, name, chance to play %, workload %</label>
        <textarea id="ml-availability" rows={3} placeholder={'Kenneth Walker, 50, 70\nDalton Kincaid, 75'} value={availabilityText} data-testid="manual-availability" onChange={e => setAvailabilityText(e.target.value)} />
        <span className="ml-muted">Example: 50, 70 means he plays in half the simulated games and, when he plays, gets 70% of his normal points. Leave blank for normal. Update after the Wednesday practice report.</span></div>
      <div className="field"><label htmlFor="ml-limits">Per-player limits (optional): one per line, name, max % of lineups</label>
        <textarea id="ml-limits" rows={2} placeholder={'Emmett Johnson, 20\nJames Cook, 20'} value={limitText} data-testid="manual-limits" onChange={e => setLimitText(e.target.value)} />
        <span className="ml-muted">A hard cap for that player. Players you leave out use the slider above.</span></div>
      <div className="field"><label htmlFor="ml-game-limits">Per-game limits (optional): one per line, team code, max % of lineups</label>
        <textarea id="ml-game-limits" rows={2} placeholder={'KC, 33'} value={gameLimitText} data-testid="manual-game-limits" onChange={e => setGameLimitText(e.target.value)} />
        <span className="ml-muted">Caps how many lineups hold ANY player from that team's game. KC, 33 means the Chiefs–Bills game appears in at most 33% of lineups.</span></div>
      {c.projError && <div className="ml-err" role="alert" data-testid="manual-projection-error">{c.projError}</div>}
      <div className="ml-actions">
        {c.projRunning
          ? <button className="btn-secondary" data-testid="manual-projection-stop" onClick={c.stopProjection}><Square size={14} /> Stop</button>
          : <button className="btn-primary" data-testid="manual-generate-projection" disabled={busy || !c.pickSync.ready || c.pickSync.dirty || !!c.storageError || !c.selectedCount || c.running}
              onClick={() => c.generateFromProjections({ maxExposure: exposure / 100, availabilityText, limitText, gameLimitText })}><Play size={15} /> Generate {MANUAL_LINEUP_COUNT} from projections</button>}
        {c.projected && <button className="btn-secondary" data-testid="manual-projection-export" onClick={c.exportProjected}><Download size={14} /> Export {c.projected.portfolio.lineups.length} projection lineups CSV</button>}
      </div>
      {c.projRunning && <p className="ml-muted" role="status"><RotateCw size={12} className="spin-icon" /> Simulating and building lineups…</p>}
      {c.projected && <div data-testid="manual-projection-summary">
        <p className="ml-muted" role="status">Built {c.projected.portfolio.lineups.length} of {c.projected.portfolio.requested} lineups from {c.projected.portfolio.candidates} candidates and {c.projected.portfolio.scenarios} simulated outcomes. Ranked by upside (90th percentile) on a separate set of simulated outcomes.</p>
        {c.projected.portfolio.notes.map(note => <div key={note} className="ml-note">{note}</div>)}
        {c.projected.skipped.length > 0 && <details className="ml-note"><summary>{c.projected.skipped.length} selected players were skipped (no usable projection)</summary>
          <ul>{c.projected.skipped.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
        <details className="ml-note"><summary>Player exposure</summary>
          <ul>{c.projected.portfolio.exposure.slice(0, 40).map(row => <li key={row.id}>{row.name} ({row.position} {row.team}): {row.lineups} lineups · {Math.round(row.share * 100)}%</li>)}</ul></details>
      </div>}
    </div>

    {c.projected && c.projected.portfolio.lineups.map((lineup, index) => <details key={`p-${lineup.players.map(p => p.id).sort().join(',')}`} className="panel ml-panel ml-result" data-testid={`manual-projection-result-${index + 1}`} open={index === 0}>
      <summary>Projection lineup #{index + 1} · {money(lineup.salary)} used · avg {lineup.points.toFixed(1)} pts · 90th pct {lineup.tournament?.p90.toFixed(1)}{lineup.tournament?.stackNames.length ? ` · stack ${lineup.tournament.stackNames.join(', ')}` : ''}</summary>
      <div className="tw"><table><thead><tr><th>Slot</th><th>Player</th><th>Salary</th><th>Avg proj</th></tr></thead><tbody>
        {lineupSlots(lineup).map(({ slot, player }) => <tr key={`${slot}-${player.id}`}>
          <td className="ml-slot">{slot}</td><td>{player.name}<br /><small className="ml-muted">{player.position} {player.team}</small></td>
          <td>{money(player.salary)}</td><td>{player.mean.toFixed(1)}</td></tr>)}
      </tbody></table></div>
    </details>)}

    {!!c.lineups.length && <p className="ml-muted" role="status">Generated {c.lineups.length} distinct random legal lineups from your selected players. Salary only enforces the $50,000 cap; these lineups have no fantasy-point ranking.</p>}
    {c.lineups.map((lineup, index) => <details key={lineup.players.map(p => p.id).sort().join(',')} className="panel ml-panel ml-result" data-testid={index === 0 ? 'manual-result' : `manual-result-${index + 1}`} open={index === 0}>
      <summary>Lineup #{index + 1} · {money(lineup.salary)} used · {money(CAP - lineup.salary)} remaining</summary>
      <div className="tw"><table><thead><tr><th>Slot</th><th>Player</th><th>Salary</th></tr></thead><tbody>
        {lineupSlots(lineup).map(({ slot, player }) => <tr key={`${slot}-${player.id}`}>
          <td className="ml-slot">{slot}</td><td>{player.name}<br /><small className="ml-muted">{player.position} {player.team}</small></td>
          <td>{money(player.salary)}</td></tr>)}
      </tbody></table></div>
    </details>)}
  </section>;
}
