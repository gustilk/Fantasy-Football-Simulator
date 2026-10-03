import { Fragment, useState } from 'react';
import { Download, RotateCw, Trash2, Play } from 'lucide-react';
import type { NflScheduledGame } from '@workspace/api-client-react';
import { useDraftKingsBoard, type DraftKingsBoardController } from '@/hooks/use-draftkings-board';
import { DK_POSITIONS, groupDKPlayers, type DKHistoryPlayer } from '@/lib/draftkings-board';
import './draftkings.css';

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
      <td>{p.observedGames}{p.unknownGames ? ` (+${p.unknownGames} unknown)` : ''}</td>
      <td className="fantasy-points">{fmt(p.recordedTotal)}{p.partial ? '*' : ''}</td>
      <td>{fmt(p.recordedAverage)}</td>
    </tr>
    {open && <tr><td colSpan={4}><div className="dk-weeks">{p.weeks.map(w => {
      const v = drafts[w.week] ?? '';
      return <div className="dk-week" key={w.week}>
        <strong>Wk {w.week}</strong>
        <span>{w.points === null ? 'unknown' : `${w.points.toFixed(2)}${w.partial ? '*' : ''}`}</span>
        <span className="dk-muted">{w.source === 'user-entered-official' ? 'official (you)' : w.source === 'recorded-stats' ? 'recorded stats' : 'no box score'}</span>
        <div className="row"><input type="number" step="0.01" aria-label={`Official points week ${w.week}`} value={v} onChange={e => setDrafts({ ...drafts, [w.week]: e.target.value })} />
          <button disabled={v.trim() === '' || !Number.isFinite(Number(v))} onClick={() => { if (c.saveOfficial({ team: p.team, playerId: p.playerId, week: w.week, points: Number(v) })) setDrafts({ ...drafts, [w.week]: '' }); }}>Save</button>
          {w.source === 'user-entered-official' && <button onClick={() => c.removeOfficial(p.team, p.playerId, w.week)}>Restore</button>}</div>
      </div>;
    })}</div></td></tr>}
  </Fragment>;
}

export default function DraftKingsBoard({ season }: { season: number }) {
  const c = useDraftKingsBoard(season);
  const [confirm, setConfirm] = useState(false);
  const [more, setMore] = useState(false);
  const loading = c.schedule.isLoading || c.historyQuery.isLoading;
  const loadError = c.schedule.isError || c.historyQuery.isError;
  const slate = c.activeSlate;
  const grouped = groupDKPlayers(c.projections);
  const hist = groupDKPlayers(c.actualHistory.filter(p => p.weeks.length > 0).sort((a, b) =>
    a.recordedTotal === null ? (b.recordedTotal === null ? a.name.localeCompare(b.name) : 1)
      : b.recordedTotal === null ? -1 : b.recordedTotal - a.recordedTotal || a.name.localeCompare(b.name)));
  return <section className="dk" aria-label="DraftKings fantasy board">
    <div className="page-heading" style={{ marginBottom: 0 }}>
      <div><div className="eyebrow">DRAFTKINGS / PLAYER BOARD / SEASON {season}</div><h1>Sunday player board.</h1><p>Every Sunday player ranked by DK fantasy points, not game winners.</p></div>
    </div>
    <div className="dk-note"><strong>Read this first.</strong> Saved data lives in this browser and device only; export it to keep a copy. “All Sunday games” means Sunday in Central Time, morning to evening, not a DraftKings contest slate. Batch runs assume neutral weather: 68 F, 5 mph wind, no precipitation. Each game runs 200 simulations and shows the mean with a 10th–90th range; runs are never added together. Projections are estimates, no winnings are guaranteed, and this is not a salary or lineup optimizer. Actual stats, not projections, power the model.</div>
    {c.storageError && <div className="dk-err" role="alert">{c.storageError} <button className="btn-secondary" onClick={c.reloadArchive}>Retry</button></div>}
    {c.error && <div className="dk-err" role="alert" data-testid="dk-error">{c.error}</div>}
    {c.notice && <div className="dk-note" role="status">{c.notice}</div>}
    {loading && <div className="dk-skel" role="status" aria-label="Loading" />}
    {loadError && <div className="dk-err" role="alert">Could not load the schedule or Team Library. <button className="btn-secondary" onClick={c.refresh} data-testid="dk-retry">Retry</button></div>}
    {!loading && !loadError && <div className="panel dk-panel">
      <div className="dk-slates"><h3>RUN A SUNDAY</h3><button className="btn-secondary" disabled={c.busy} onClick={c.refresh}><RotateCw size={14} /> Refresh schedule and history</button></div>
      {c.sundays.length === 0 ? <p className="dk-muted">No upcoming Sundays in the {season} schedule.</p> : <>
        <div className="dk-row" style={{ margin: '12px 0' }}>
          <div className="field"><label htmlFor="dk-sunday">Sunday (Central)</label>
            <select id="dk-sunday" disabled={c.busy} value={c.sunday} onChange={e => c.setSunday(e.target.value)} data-testid="select-dk-sunday">{c.sundays.map(s => <option key={s}>{s}</option>)}</select></div>
          <button className="btn-primary" disabled={c.busy || !c.games.length} onClick={() => { void c.runSlate(); }} data-testid="button-dk-run">
            {c.busy ? <><RotateCw size={15} className="spin-icon" /> Simulating</> : <><Play size={15} /> Run and save {c.games.length} games</>}</button>
        </div>
        {c.busy && <div role="status"><span className="dk-muted">{c.progress.completed} of {c.progress.total} {c.progress.matchup}</span>
          <div className="dk-bar"><i style={{ width: `${c.progress.total ? c.progress.completed / c.progress.total * 100 : 0}%` }} /></div></div>}
        {c.games.length === 0 ? <p className="dk-muted">No upcoming games remain on this Sunday.</p> :
          <details key={slate?.id ?? 'initial-games'} open={!slate || c.busy}><summary>Review {c.games.length} matchups and optional odds</summary>{c.games.map(g => <MarketRow key={g.id} c={c} game={g} />)}</details>}
      </>}
    </div>}
    <div className="panel dk-panel">
      <div className="dk-slates"><h3>SAVED SLATES</h3>
        <button className="btn-secondary" onClick={c.exportArchive} data-testid="button-dk-export"><Download size={14} /> Export all</button></div>
      {c.slates.length === 0 ? <p className="dk-muted">No saved slates for {season} yet. Run a Sunday above and it will appear here.</p> : <>
        <div className="dk-row" style={{ marginTop: 10 }}>
          <div className="field"><label htmlFor="dk-slate">Open slate</label>
            <select id="dk-slate" value={slate?.id ?? ''} onChange={e => { setConfirm(false); c.selectSlate(e.target.value); }} data-testid="select-dk-slate">
              {c.slates.map(s => <option key={s.id} value={s.id}>{s.sunday} · saved {new Date(s.createdAt).toLocaleString()}</option>)}</select></div>
          {slate && !confirm && <button className="btn-secondary" onClick={() => setConfirm(true)} data-testid="button-dk-delete"><Trash2 size={14} /> Delete</button>}
          {slate && confirm && <div className="dk-confirm">Delete this saved slate permanently?
            <button className="btn-secondary" onClick={() => { c.deleteSlate(slate.id); setConfirm(false); }} data-testid="button-dk-delete-confirm">Delete</button>
            <button className="btn-secondary" onClick={() => setConfirm(false)}>Cancel</button></div>}
        </div>
        {slate && <>
          <p className="dk-muted">{slate.forecasts.length} game(s) covered{slate.failures.length ? `, ${slate.failures.length} failed: partial slate coverage` : ', no failures'}.</p>
          {slate.failures.map(f => <div className="history-warning" key={f.gameId} style={{ margin: '6px 0' }}>{f.matchup}: {f.reason}</div>)}
          {slate.forecasts.some(f => f.warnings.length > 0) && <details><summary>Review history, availability and market cautions</summary>{slate.forecasts.filter(f => f.warnings.length).map(f => <div className="history-warning" key={f.gameId} style={{ margin: '6px 0' }}>{f.awayTeam} at {f.homeTeam}: {[...new Set(f.warnings)].join(' ')}</div>)}</details>}
        </>}
      </>}
    </div>
    {slate && <div>
      <h2 style={{ margin: '4px 0 10px' }}>PROJECTIONS · highest mean first</h2>
      <div className="dk-grid">{grouped.map(g => <div key={g.position}><h3>{g.position}<span className="dk-muted">{g.players.length}</span></h3>
        <div className="player-table-wrap"><table className="player-table"><thead><tr><th>Player</th><th>Mean</th><th>10th–90th</th><th>Actual</th><th>Diff</th></tr></thead><tbody>
          {g.players.map(r => <tr key={`${r.team}-${r.playerId}`} data-testid={`dk-proj-${r.playerId}`}>
            <td><span className="player-name">{r.name}</span><span className="player-pos">{r.team} · wk {r.week}</span></td>
            <td className="dk-mean">{r.mean.toFixed(2)}</td><td>{r.p10.toFixed(2)}–{r.p90.toFixed(2)}</td>
            <td>{r.actual ? `${fmt(r.actual.points)}${r.actual.partial ? '*' : ''}` : 'not recorded'}</td>
            <td>{r.difference === null ? (r.actual?.partial ? 'partial' : '–') : `${r.difference > 0 ? '+' : ''}${r.difference.toFixed(2)}`}</td></tr>)}
          {g.players.length === 0 && <tr><td colSpan={5}>No players.</td></tr>}</tbody></table></div></div>)}</div>
    </div>}
    <div>
      <h2 style={{ margin: '4px 0 10px' }}>ACTUAL RECORDED POINTS · {season}</h2>
      <div className="dk-note" data-testid="dk-partial-note">* marks a <strong>partial recorded-stat subtotal</strong>, not a guaranteed full official total. Totals cover only the games recorded in Team Library (often just three); unknown games are not counted as zero. Enter official postgame DK points for a week to compare; negatives and zero are allowed. These entries are for comparison only and do not change stat lines or the simulator.</div>
      <div className="dk-grid" style={{ marginTop: 12 }}>{DK_POSITIONS.map(pos => {
        const all = hist.find(h => h.position === pos)!.players; const list = more ? all : all.slice(0, 15);
        return <div key={pos}><h3>{pos}<span className="dk-muted">{all.length}</span></h3>
          <div className="player-table-wrap"><table className="player-table"><thead><tr><th>Player (tap for weeks)</th><th>Games</th><th>Total</th><th>Avg</th></tr></thead><tbody>
            {list.map(p => <HistoryRow key={`${p.team}-${p.playerId}`} c={c} p={p} />)}
            {all.length === 0 && <tr><td colSpan={4}>No recorded games yet.</td></tr>}</tbody></table></div></div>;
      })}</div>
      <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setMore(!more)}>{more ? 'Show top 15' : 'Show all players'}</button>
    </div>
  </section>;
}
