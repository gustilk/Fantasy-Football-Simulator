import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, Play, Square, Trash2, RotateCw } from 'lucide-react';
import { useManualLineups } from '@/hooks/use-manual-lineups';
import { TEAM_CODES, lineupSlots } from '@/lib/lineups';
import { MANUAL_LINEUP_COUNT } from '@/lib/manual-lineups';
import { EMPTY_MANUAL_PLAYER_FILTERS, filterManualPlayers, manualPlayerPage, type ManualPlayerFilters } from '@/lib/manual-player-browser';
import { manualRosterReadiness } from '@/lib/manual-lineup-readiness';
import './manual-lineups.css';

const CAP = 50000;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const POS = ['QB', 'RB', 'WR', 'TE', 'DST'];

export default function ManualLineupsSection({ season }: { season: number }) {
  const c = useManualLineups(season);
  const [filters, setFilters] = useState<ManualPlayerFilters>({ ...EMPTY_MANUAL_PLAYER_FILTERS });
  const [requestedPage, setRequestedPage] = useState(1);
  const file = useRef<HTMLInputElement>(null);
  const playerList = useRef<HTMLUListElement>(null);
  const busy = c.importing || c.loading;

  const teams = useMemo(() => [...new Set(c.players.map(p => p.team))].sort((a, b) =>
    (TEAM_CODES[a] ?? a).localeCompare(TEAM_CODES[b] ?? b)), [c.players]);
  const games = useMemo(() => [...new Set(c.players.map(p => p.gameInfo).filter(Boolean))].sort(), [c.players]);
  const rows = useMemo(() => filterManualPlayers(c.players, c.picks, filters), [c.players, c.picks, filters]);
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
        <p>Select any number of candidates, enter your fantasy-point estimates, and generate the top {MANUAL_LINEUP_COUNT} DraftKings Classic lineups from your entire selected pool.</p></div>
    </div>

    <div className="panel ml-panel">
      <h2>1. Contest salaries</h2>
      {busy && <p className="ml-muted" role="status">Loading salaries…</p>}
      {c.record
        ? <p className="ml-muted"><strong>{c.record.filename}</strong> · imported {new Date(c.record.importedAt).toLocaleString()} · {c.players.length} players</p>
        : !busy && <div className="ml-note" role="status">No Classic salaries yet. Import Featured Classic or upload a DraftKings Classic CSV.</div>}
      <p className="ml-muted">These salaries are shared with Lineups; replacing them changes both. Save your picks to sync selections and point estimates across devices for this exact contest. Other contests never inherit these points.</p>
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
      <h2>2. Choose players &amp; enter points</h2>
      {c.record && <><p className="ml-muted" role="status" data-testid="manual-sync-status">{c.pickSync.status}</p>
        <div className="ml-actions">
          <button className="btn-primary" data-testid="manual-save" disabled={busy || !c.pickSync.ready || !c.pickSync.dirty || c.pickSync.saving || c.pickSync.conflict} onClick={c.pickSync.save}>Save picks</button>
          <button className="btn-secondary" data-testid="manual-refresh" disabled={c.pickSync.saving} onClick={c.pickSync.refresh}><RotateCw size={14} /> Refresh picks</button>
          {(c.pickSync.dirty || c.warning) && <button className="btn-secondary" data-testid="manual-export-draft" onClick={c.pickSync.exportDraft}>Export browser draft</button>}
          {c.pickSync.conflict && <button className="btn-secondary" data-testid="manual-use-shared" onClick={c.pickSync.useShared}>Use latest shared picks</button>}
        </div></>}
      <p className="ml-muted">Points are your own assumptions, not guaranteed results. They never change actual stats or simulator forecasts. Zero is allowed. Salaries are read only.</p>
      <div className="ml-note">Start with a <strong>team or game</strong>, then choose a position to find players quickly. Salaries do not confirm who will start; backups remain available for replacements.</div>
      <div className="ml-filters">
        <div className="field"><label htmlFor="ml-q">Search player or team</label>
          <input id="ml-q" type="search" data-testid="manual-search" value={filters.query} onChange={e => changeFilters({ query: e.target.value })} placeholder="Name, team name, or abbreviation" /></div>
        <div className="field"><label htmlFor="ml-pos">Position</label>
          <select id="ml-pos" data-testid="manual-position" value={filters.position} onChange={e => changeFilters({ position: e.target.value })}>
            <option value="">All</option>{POS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
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
      <p className="ml-muted">Filters only change what is shown. All your selected players and point estimates are kept and used by Generate.</p>
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
              <input type="text" inputMode="decimal" aria-label={`Your projected points for ${p.name}`} placeholder="Pts"
                data-testid={`manual-points-${p.id}`} maxLength={100} value={pick?.points ?? ''} disabled={busy || !c.pickSync.ready || (!!p.unavailable && !sel)}
                onChange={e => c.updatePick(p.id, { points: e.target.value })} />
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
      <p className="ml-note"><strong>Select as many candidates as you want.</strong> Generate compares legal combinations from <strong>all {c.selectedCount} selected candidates</strong> and returns the top {MANUAL_LINEUP_COUNT} distinct lineups, ranked by the total of your entered points. Selected players are options—not mandatory locks.</p>
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
          : <button className="btn-primary" data-testid="manual-generate" disabled={busy || !c.pickSync.ready || c.pickSync.dirty || !!c.storageError || !c.selectedCount} onClick={c.generate}><Play size={15} /> Generate top {MANUAL_LINEUP_COUNT} lineups</button>}
        {!!c.lineups.length && <button className="btn-secondary" onClick={c.exportResults}><Download size={14} /> Export {c.lineups.length} {c.lineups.length === 1 ? 'lineup' : 'lineups'} CSV</button>}
      </div>
      {c.running && <p className="ml-muted" role="status"><RotateCw size={12} className="spin-icon" /> Searching all legal lineups…</p>}
    </div>

    {!!c.lineups.length && <p className="ml-muted" role="status">Showing {c.lineups.length} distinct {c.lineups.length === 1 ? 'lineup' : 'lineups'}, highest projected points first. Each lineup uses only your selected candidates and stays under $50,000. Lineups may share players.</p>}
    {c.lineups.map((lineup, index) => <article key={lineup.players.map(p => p.id).sort().join(',')} className="panel ml-panel ml-result" data-testid={index === 0 ? 'manual-result' : `manual-result-${index + 1}`}>
      <h2>Lineup #{index + 1}{index === 0 ? ' — Highest projected points' : ''}</h2>
      <div className="ml-stats">
        <div><span>Your projected points</span><strong className="ml-total">{lineup.points.toFixed(2)}</strong></div>
        <div><span>Salary used</span><strong>{money(lineup.salary)}</strong></div>
        <div><span>Remaining</span><strong>{money(CAP - lineup.salary)}</strong></div>
      </div>
      <div className="tw"><table><thead><tr><th>Slot</th><th>Player</th><th>Your pts</th><th>Salary</th></tr></thead><tbody>
        {lineupSlots(lineup).map(({ slot, player }) => <tr key={`${slot}-${player.id}`}>
          <td className="ml-slot">{slot}</td><td>{player.name}<br /><small className="ml-muted">{player.position} {player.team}</small></td>
          <td>{player.mean.toFixed(2)}</td><td>{money(player.salary)}</td></tr>)}
      </tbody></table></div>
      <p className="ml-muted">Totals use your own assumptions, not guaranteed results.</p>
    </article>)}
  </section>;
}
