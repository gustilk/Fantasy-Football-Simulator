import { Fragment, useState } from 'react';
import { Download, RotateCw, Trash2, Play } from 'lucide-react';
import type { NflScheduledGame } from '@workspace/api-client-react';
import { useDraftKingsBoard, type DraftKingsBoardController } from '@/hooks/use-draftkings-board';
import { DK_POSITIONS, groupDKPlayers, type DKHistoryPlayer, type DKPosition } from '@/lib/draftkings-board';
import './draftkings.css';
import DraftKingsAccuracy from './DraftKingsAccuracy';
import EliteBadge from './EliteBadge';

const fmt = (n: number | null | undefined) => n === null || n === undefined ? 'unknown' : n.toFixed(2);
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' });

function MarketRow({ c, game }: { c: DraftKingsBoardController; game: NflScheduledGame }) {
  const m = c.getMarket(game);
  const id = game.id;
  return <div className="dk-game" data-testid={`dk-game-${id}`}>
    <div className="dk-game-head"><strong>{game.awayTeam} at {game.homeTeam}</strong><span>{game.timeConfirmed ? when(game.date) : 'Kickoff unconfirmed'} · Week {game.week}</span></div>
    <div className="dk-mkt">
      <label className="chk"><input type="checkbox" disabled={c.busy} checked={m.enabled} onChange={e => c.updateMarket(game, { enabled: e.target.checked })} data-testid={`dk-weight-${id}`} /> Weight with market</label>
      <div className="field"><label htmlFor={`sp-${id}`}>Home spread</label><input id={`sp-${id}`} disabled={c.busy} type="number" step="0.5" value={m.homeSpread} placeholder="optional" onChange={e => c.updateMarket(game, { homeSpread: e.target.value })} /></div>
      <div className="field"><label htmlFor={`to-${id}`}>Total</label><input id={`to-${id}`} disabled={c.busy} type="number" step="0.5" value={m.total} placeholder="optional" onChange={e => c.updateMarket(game, { total: e.target.value })} /></div>
      <button className="btn-secondary" disabled={c.busy} onClick={() => c.usePublicMarket(game)} data-testid={`dk-public-${id}`}>Use ESPN line</button>
    </div>
    <span className="dk-muted">{m.manual ? 'Manual line.' : game.odds ? `ESPN ${game.odds.provider}.` : 'No public line.'} Weighting is optional; no line is required when off. {m.homeSpread || m.total ? `Recorded ${when(m.recordedAt)}.` : ''}</span>
  </div>;
}

function HistoryRow({ c, p }: { c: DraftKingsBoardController; p: DKHistoryPlayer }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  return <Fragment>
    <tr data-testid={`dk-history-${p.team}-${p.playerId}`}>
      <td><button className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>{p.name}</button><span className="player-pos">{p.team}</span></td>
      <td className="fantasy-points">{fmt(p.recordedTotal)}{p.partial ? '*' : ''}</td>
      <td>{fmt(p.recordedAverage)}</td>
      <td>{p.observedGames}{p.unknownGames ? ` (+${p.unknownGames} unknown)` : ''}</td>
    </tr>
    {open && <tr><td colSpan={4}><div className="dk-weeks">{p.weeks.map(w => {
      const v = drafts[w.week] ?? '';
      return <div className="dk-week" key={w.week}>
        <strong>Wk {w.week}</strong>
        <span>{w.points === null ? 'unknown' : `${w.points.toFixed(2)}${w.partial ? '*' : ''}`}</span>
        <span className="dk-muted">{w.source === 'user-entered-official' ? 'official (you)' : w.source === 'recorded-stats' ? 'recorded stats' : 'no box score'}</span>
        <div className="row"><input type="number" step="0.01" aria-label={`Official points week ${w.week}`} value={v} onChange={e => setDrafts({ ...drafts, [w.week]: e.target.value })} />
          <button disabled={v.trim() === '' || !Number.isFinite(Number(v))} onClick={async () => { if (await c.saveOfficial({ team: p.team, playerId: p.playerId, week: w.week, points: Number(v) })) setDrafts({ ...drafts, [w.week]: '' }); }}>Save</button>
          {w.source === 'user-entered-official' && <button onClick={() => c.removeOfficial(p.team, p.playerId, w.week)}>Restore</button>}</div>
      </div>;
    })}</div></td></tr>}
  </Fragment>;
}

export default function DraftKingsBoard({ season }: { season: number }) {
  const c = useDraftKingsBoard(season);
  const [confirm, setConfirm] = useState(false);
  const [pos, setPos] = useState<DKPosition>('QB');
  const [view, setView] = useState<'projected' | 'actual'>('projected');
  const [all, setAll] = useState(false);
  const [detail, setDetail] = useState(false);
  const loading = c.schedule.isLoading || c.historyQuery.isLoading || c.archiveLoading;
  const loadError = c.schedule.isError || c.historyQuery.isError;
  const slate = c.activeSlate;
  const grouped = groupDKPlayers(c.projections);
  const hist = groupDKPlayers(c.actualHistory.filter(p => p.weeks.length > 0).sort((a, b) =>
    a.recordedTotal === null ? (b.recordedTotal === null ? a.name.localeCompare(b.name) : 1)
      : b.recordedTotal === null ? -1 : b.recordedTotal - a.recordedTotal || a.name.localeCompare(b.name)));
  const LIMIT = view === 'projected' ? 20 : 10;
  const projAll = grouped.find(g => g.position === pos)?.players ?? [];
  const histAll = hist.find(h => h.position === pos)?.players ?? [];
  const projList = all ? projAll : projAll.slice(0, LIMIT);
  const histList = all ? histAll : histAll.slice(0, LIMIT);
  const total = view === 'projected' ? projAll.length : histAll.length;
  return <section className="dk" aria-label="DraftKings fantasy board">
    <div className="dk-head">
      <h1>DraftKings points</h1>
      <p>Players ranked by projected fantasy points, {season}.</p>
    </div>
    <p className="dk-short" data-testid="dk-storage-note">Saved in this browser only. <span>* means a partial estimate.</span> Sunday daytime games only; Sunday night excluded. Neutral weather assumed.
      {' '}<button className="text-button" onClick={() => setDetail(!detail)} aria-expanded={detail}>{detail ? 'Hide details' : 'Details'}</button></p>
    {detail && <div className="dk-note"><strong>How to read this.</strong> Saved data lives in this browser and device only; export it to keep a copy. This batch includes Sunday kickoffs before 6 PM Central and excludes Sunday night. Your contest salary CSV remains the authority for Classic eligibility; daytime games can still belong to different contests. Night forecasts in older saves are hidden from this board but retained in archive exports. Batch runs assume neutral weather: 68 F, 5 mph wind, no precipitation. Each game runs 200 simulations and shows the mean with a 10th–90th range; runs are never added together. Projections are estimates, no winnings are guaranteed, and this is not a salary or lineup optimizer. Actual stats, not projections, power the model.</div>}
    {c.storageError && <div className="dk-err" role="alert">{c.storageError} <button className="btn-secondary" onClick={c.reloadArchive}>Retry</button></div>}
    {c.error && <div className="dk-err" role="alert" data-testid="dk-error">{c.error}</div>}
    {c.unsavedSlate && <div className="dk-note" role="alert" data-testid="dk-unsaved">
      Latest results are shown but are not saved. They will be lost if you reload or close this page. Retry saving or export a backup first.
      <div className="dk-row"><button className="btn-primary" disabled={c.busy} onClick={() => { void c.retrySave(); }} data-testid="button-dk-retry-save">Retry save</button>
        <button className="btn-secondary" onClick={c.exportArchive}>Export all, including unsaved results</button></div>
    </div>}
    {c.notice && <div className="dk-note" role="status">{c.notice}</div>}
    {loading && <div className="dk-skel" role="status" aria-label="Loading" />}
    {loadError && <div className="dk-err" role="alert">Could not load the schedule or Team Library. <button className="btn-secondary" onClick={c.refresh} data-testid="dk-retry">Retry</button></div>}
    {!loading && !loadError && <div className="panel dk-panel">
      {c.sundays.length === 0 ? <p className="dk-muted">No upcoming Sundays in the {season} schedule.</p> : <>
        <div className="dk-row">
          <div className="field dk-date-field"><label htmlFor="dk-sunday">Sunday daytime · NFL week (Central)</label>
            <select id="dk-sunday" disabled={c.busy} value={c.sunday} onChange={e => c.setSunday(e.target.value)} data-testid="select-dk-sunday">{c.sundayOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          <button className="btn-primary" disabled={c.busy || !!c.unsavedSlate || !c.games.length} onClick={() => { void c.runSlate(); }} data-testid="button-dk-run">
            {c.busy ? <><RotateCw size={15} className="spin-icon" /> Simulating</> : <><Play size={15} /> Run and save {c.games.length} games</>}</button>
        </div>
        {c.busy && <div role="status"><span className="dk-muted">{c.progress.completed} of {c.progress.total} {c.progress.matchup}</span>
          <div className="dk-bar"><i style={{ width: `${c.progress.total ? c.progress.completed / c.progress.total * 100 : 0}%` }} /></div></div>}
        {c.games.length === 0 ? <p className="dk-muted">No upcoming games remain on this Sunday.</p> :
          <details key={slate?.id ?? 'initial-games'} open={c.busy}><summary>Matchup odds ({c.games.length} games, optional)</summary>
            <div className="dk-row"><button className="btn-secondary" disabled={c.busy} onClick={c.refresh}><RotateCw size={14} /> Refresh schedule and history</button></div>
            {c.games.map(g => <MarketRow key={g.id} c={c} game={g} />)}</details>}
      </>}
    </div>}
    {slate && slate.failures.length > 0 && <div className="dk-err" role="alert" data-testid="dk-failures"><div>
      {slate.forecasts.length} game(s) covered, {slate.failures.length} failed: partial slate coverage.
      {slate.failures.map(f => <div key={f.gameId}>{f.matchup}: {f.reason}</div>)}</div></div>}
    <DraftKingsAccuracy report={c.accuracy} season={season} loading={c.historyQuery.isLoading} failed={c.historyQuery.isError || !!c.storageError} refresh={c.storageError ? c.reloadArchive : c.refresh} />
    <div className="dk-controls">
      <div className="dk-seg" role="tablist" aria-label="Position">{DK_POSITIONS.map(p => <button key={p} role="tab" aria-selected={pos === p} className={pos === p ? 'on' : ''} onClick={() => { setPos(p); setAll(false); }} data-testid={`dk-pos-${p}`}>{p}</button>)}</div>
      <div className="dk-seg" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view === 'projected'} className={view === 'projected' ? 'on' : ''} onClick={() => { setView('projected'); setAll(false); }} data-testid="dk-view-projected">Projected</button>
        <button role="tab" aria-selected={view === 'actual'} className={view === 'actual' ? 'on' : ''} onClick={() => { setView('actual'); setAll(false); }} data-testid="dk-view-actual">Actual</button></div>
    </div>
    {view === 'projected' ? (!slate ? <p className="dk-muted">Run a Sunday to see projections.</p> :
      <div className="dk-list">
        <p className="dk-muted">Saved Sunday {slate.sunday} · {slate.forecasts.length} games</p>
        <details className="dk-gap"><summary>Football stats used &amp; missing data</summary>
          <p className="dk-muted">New forecasts combine season history, last-four-game trends and a separate prior-season baseline. Verified PBP adds passing/rushing efficiency and matchups, play volume, workload shares, red-zone/goal-line roles, snap support, air-yard upside, sacks and hits. Fantasy totals and overlapping scoring summaries are comparisons, not additional point boosts.</p>
          {slate.forecasts.flatMap(g => [g.input.away, g.input.home]).map((team, i) =>
            <div key={`${team.name}-${i}`} className="dk-gap"><strong>{team.name}</strong>
              {team.footballEvidence ? <>
                <p className="dk-muted">{team.footballEvidence.sources.map(s => `${s.season}: ${s.games} verified game(s), weeks ${s.weeks.join(', ')} (${s.status})`).join(' · ') || 'No verified play-by-play available.'} · {team.footballEvidence.matchedPlayers} eligible players matched.</p>
                {team.footballEvidence.warnings.map((w, j) => <p className="dk-muted" key={j}>{w}</p>)}
              </> : <p className="dk-muted">Legacy saved forecast: original inputs preserved. Run a new forecast to use the expanded football evidence model.</p>}
            </div>)}
        </details>
        <div className="player-table-wrap"><table className="player-table"><thead><tr><th>#  Player</th><th>DK points</th>{detail && <><th>10th–90th</th><th>Actual</th><th>Diff</th></>}</tr></thead><tbody>
          {projList.map((r, i) => <tr key={`${r.team}-${r.playerId}`} data-testid={`dk-proj-${r.playerId}`}>
            <td><span className="dk-rank">{i + 1}</span><span className="player-name">{r.name}</span><EliteBadge player={r} /><span className="player-pos">{r.opponent ? `vs ${r.opponent}` : 'Opponent unavailable'}</span></td>
            <td className="dk-mean">{r.mean.toFixed(2)}</td>
            {detail && <><td>{r.p10.toFixed(2)}–{r.p90.toFixed(2)}</td>
              <td>{r.actual ? `${fmt(r.actual.points)}${r.actual.partial ? '*' : ''}` : 'not recorded'}</td>
              <td>{r.difference === null ? (r.actual?.partial ? 'partial' : '–') : `${r.difference > 0 ? '+' : ''}${r.difference.toFixed(2)}`}</td></>}</tr>)}
          {projAll.length === 0 && <tr><td colSpan={detail ? 5 : 2}>No players.</td></tr>}</tbody></table></div>
        <p className="dk-muted">Highest mean first; no minimum points. Ranges and actual comparisons appear under Details above.</p>
      </div>) :
      <div className="dk-list">
        <p className="dk-short" data-testid="dk-partial-note">* partial estimate: recorded games only, unknown games are not counted as zero.
          {detail && <> Totals cover only the games recorded in Team Library (often just three). Enter official postgame DK points for a week (tap a player) to compare; negatives and zero are allowed. These entries are for comparison only and do not change stat lines or the simulator.</>}</p>
        <div className="player-table-wrap"><table className="player-table"><thead><tr><th>Player (tap for weeks)</th><th>Total</th><th>Avg</th><th>Games</th></tr></thead><tbody>
          {histList.map(p => <HistoryRow key={`${p.team}-${p.playerId}`} c={c} p={p} />)}
          {histAll.length === 0 && <tr><td colSpan={4}>No recorded games yet.</td></tr>}</tbody></table></div>
      </div>}
    {total > LIMIT && <button className="btn-secondary dk-more" onClick={() => setAll(!all)}>{all ? `Show top ${LIMIT}` : `Show all ${total} players`}</button>}
    <details className="dk-archive"><summary>Saved slates and export</summary>
      <div className="dk-slates"><button className="btn-secondary" onClick={c.exportArchive} data-testid="button-dk-export"><Download size={14} /> Export all</button></div>
      {c.slates.length === 0 ? <p className="dk-muted">No saved slates for {season} yet. Run a Sunday above and it will appear here.</p> : <>
        <div className="dk-row" style={{ marginTop: 10 }}>
          <div className="field"><label htmlFor="dk-slate">Open slate</label>
            <select id="dk-slate" value={slate?.id ?? ''} onChange={e => { setConfirm(false); c.selectSlate(e.target.value); }} data-testid="select-dk-slate">
              {c.slates.map(s => <option key={s.id} value={s.id}>{s.sunday} · {s.id === c.unsavedSlate?.id ? 'UNSAVED' : 'saved'} {new Date(s.createdAt).toLocaleString()}</option>)}</select></div>
          {slate && !confirm && <button className="btn-secondary" onClick={() => setConfirm(true)} data-testid="button-dk-delete"><Trash2 size={14} /> Delete</button>}
          {slate && confirm && <div className="dk-confirm">{slate.id === c.unsavedSlate?.id ? 'Discard these unsaved results? Export first to keep a copy.' : 'Delete this saved slate permanently?'}
            <button className="btn-secondary" onClick={() => { c.deleteSlate(slate.id); setConfirm(false); }} data-testid="button-dk-delete-confirm">Delete</button>
            <button className="btn-secondary" onClick={() => setConfirm(false)}>Cancel</button></div>}
        </div>
        {slate && slate.forecasts.some(f => f.warnings.length > 0) && <details><summary>History, availability and market cautions</summary>{slate.forecasts.filter(f => f.warnings.length).map(f => <div className="history-warning" key={f.gameId} style={{ margin: '6px 0' }}>{f.awayTeam} at {f.homeTeam}: {[...new Set(f.warnings)].join(' ')}</div>)}</details>}
      </>}
    </details>
  </section>;
}
