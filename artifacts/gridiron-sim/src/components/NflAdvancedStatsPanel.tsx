import { useEffect, useMemo, useState } from 'react';
import { useGetNflAdvancedStats, getGetNflAdvancedStatsQueryKey, type TeamSeasonRecord, type NflAdvancedPlayer } from '@workspace/api-client-react';
import './nfl-advanced-stats.css';

type Props = { season: number; team: string; record: TeamSeasonRecord | undefined };
const n = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`);
const when = (v: string | null | undefined) => { if (!v) return 'Unavailable'; const d = new Date(v); return Number.isNaN(d.getTime()) ? 'Unavailable' : d.toLocaleString(); };
const clampWeek = (w: number) => Math.min(19, Math.max(1, Math.round(w)));

function defaultWeek(record: TeamSeasonRecord | undefined) {
  const last = Math.max(0, ...(record?.weeks ?? []).filter(w => w.status === 'played').map(w => w.week));
  return clampWeek(last ? last + 1 : 19);
}
function overrideWeek() {
  const v = Number(new URLSearchParams(window.location.search).get('beforeWeek'));
  return Number.isFinite(v) && v >= 1 ? clampWeek(v) : null;
}

export default function NflAdvancedStatsPanel({ season, team, record }: Props) {
  const fallback = defaultWeek(record);
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('section') === 'advanced');
  const [picked, setPicked] = useState<{ key: string; week: number } | null>(null);
  const scope = `${season}:${team}`;
  const initial = overrideWeek();
  const week = picked && picked.key === scope ? picked.week : (initial ?? fallback);
  useEffect(() => { setPicked(null); }, [scope]);
  const q = useGetNflAdvancedStats(season, team, week, { query: { queryKey: getGetNflAdvancedStatsQueryKey(season, team, week), enabled: open && !!team, staleTime: 300_000, retry: false } });
  const report = q.data && q.data.season === season && q.data.team === team && q.data.beforeWeek === week ? q.data : undefined;
  const ids = useMemo(() => new Set((record?.players ?? []).map(p => p.id)), [record]);
  const rows = useMemo(() => [...(report?.players ?? [])].sort((a, b) => (b.offenseSnaps ?? -1) - (a.offenseSnaps ?? -1)), [report]);
  const err = q.error as { data?: { error?: string }; message?: string } | null;
  const bad = report && (report.status !== 'available' || report.sources.some(s => s.status !== 'available'));
  const matched = (p: NflAdvancedPlayer) => !!p.playerId && ids.has(p.playerId);
  const matchedCount = rows.filter(matched).length;
  const totalAir = rows.reduce((s, p) => s + p.airYardTargets, 0);
  const totalTargets = rows.reduce((s, p) => s + (p.targets ?? 0), 0);
  const d = report?.defense;

  return (
    <details className="nas" open={open} onToggle={e => setOpen(e.currentTarget.open)} data-testid="panel-nfl-advanced">
      <summary>Advanced NFL stats <span>observed past games only</span></summary>
      <p className="tl-hint">These are stats from games already played, from public nflverse data. They are not projected shares and are not applied as automatic fantasy-point boosts. Your saved roster and eligibility are unchanged.</p>
      <div className="nas-controls">
        <label>Games before week
          <select value={week} onChange={e => setPicked({ key: scope, week: Number(e.target.value) })} data-testid="select-advanced-week">
            {Array.from({ length: 19 }, (_, i) => <option key={i + 1} value={i + 1}>Week {i + 1}</option>)}
          </select>
        </label>
        <button className="btn-secondary" onClick={() => void q.refetch()} disabled={!open || q.isFetching} data-testid="button-advanced-refresh">{q.isFetching ? 'Loading…' : 'Refresh'}</button>
      </div>
      {open && q.isLoading && <div className="tl-skel" aria-busy="true"><i /><i /></div>}
      {open && q.isError && <div className="tl-banner err" role="alert">{err?.data?.error || err?.message || 'Advanced stats could not be loaded.'}<button className="btn-secondary" onClick={() => void q.refetch()} data-testid="button-advanced-retry">Retry</button></div>}
      {open && q.data && !report && <div className="tl-banner err" role="alert">The response does not match the selected season, team and cutoff. <button className="btn-secondary" onClick={() => void q.refetch()}>Retry</button></div>}
      {report && <>
        <div className="nas-meta" data-testid="text-advanced-meta">
          <b>{report.season} season · {report.team}</b>
          <span>Games before week {report.beforeWeek}</span>
          <span>{report.games} completed {report.games === 1 ? 'game' : 'games'} used</span>
          <span>Last verified completed week: {report.dataThroughWeek ?? 'Unavailable'}</span>
          <span>Report checked {when(report.fetchedAt)}</span>
        </div>
        {bad && <div className="tl-banner warn" role="status">{report.status === 'unavailable' ? 'Completed games could not be verified from play-by-play. Other source files may still be available.' : 'Partial data: some sources failed or are incomplete. Missing values show —, not zero.'}<button className="btn-secondary" onClick={() => void q.refetch()}>Retry</button></div>}
        {report.warnings.map((w, i) => <div className="tl-banner warn" role="status" key={i}>{w}</div>)}
        <ul className="nas-sources">{report.sources.map(s => <li key={s.kind} className={s.status}>
          <a href={s.url} target="_blank" rel="noreferrer">{s.kind}</a> · {s.status === 'available' ? 'Available' : 'Unavailable'} · fetched {when(s.fetchedAt)} · updated {when(s.updatedAt)}{s.error ? ` · ${s.error}` : ''}</li>)}</ul>
        {report.games === 0 ? <div className="tl-empty"><strong>0 completed games before week {report.beforeWeek}</strong><span>Nothing to show for {report.season} yet. No numbers are estimated.</span></div> : <>
          <h3 className="tl-sub">Team context</h3>
          <div className="nas-grid" data-testid="grid-advanced-defense">
            <div><small>Pass EPA allowed / play</small><b>{n(d?.passEpaAllowed, 3)}</b><em>{d?.passEpaPlays ?? 0} plays</em></div>
            <div><small>Rush EPA allowed / play</small><b>{n(d?.rushEpaAllowed, 3)}</b><em>{d?.rushEpaPlays ?? 0} plays</em></div>
            <div><small>Offense plays per game</small><b>{n(d?.offensePlaysPerGame)}</b><em>{report.games} completed games · rush/pass plays, not tempo</em></div>
            <div><small>Sack-or-QB-hit rate (limited proxy)</small><b>{pct(d?.sackHitRate)}</b><em>{d?.sackHitPlays ?? 0} plays · true pressure rate: {d?.pressureRate == null ? 'Unavailable' : pct(d.pressureRate)}</em></div>
          </div>
          <p className="tl-hint">EPA allowed measures the opponent's change in expected points per play. Lower means a stronger defense; negative is valid. Sack-or-QB-hit rate only counts sacks and recorded hits, so it is not full pressure.</p>
          <h3 className="tl-sub">Players ({rows.length})</h3>
          <p className="tl-hint">Snap shares average recorded snap rows. Target/carry shares use confirmed participation games; no-play plays, kneels, spikes and two-point tries are excluded. Air-yard data covers {totalAir} of {totalTargets} targets, so air-yard totals may be partial. {matchedCount} of {rows.length} rows match your saved roster; {report.unmatchedPlayers} lack a verified ESPN identity. Source players are shown, not added to your roster.</p>
          <div className="nas-scroll" tabIndex={0} role="region" aria-label="Advanced player stats">
            <table className="stats-table nas-table" data-testid="table-advanced-players">
              <thead><tr><th>Player</th><th>ID match</th><th>Pos</th><th>Games</th><th>Snaps</th><th>Snap %</th><th>Targets</th><th>Tgt %</th><th>Carries</th><th>Carry %</th><th>Air yds</th><th>Air yds / tgt</th><th>Air tgts</th></tr></thead>
              <tbody>{rows.map(p => <tr key={p.sourcePlayerId} className={matched(p) ? '' : 'src'}>
                <td>{p.name}</td>
                <td>{matched(p) ? 'Saved roster' : p.playerId ? 'Not on saved roster' : 'Missing ID'}</td>
                <td>{p.position === 'unknown' ? '—' : p.position}</td>
                <td title={`${p.snapGames} games with snap counts; ${p.opportunityGames} with confirmed offensive participation`}>{p.games}</td><td>{n(p.offenseSnaps, 0)}</td><td>{pct(p.snapShare)}</td>
                <td>{n(p.targets, 0)}</td><td>{pct(p.targetShare)}</td>
                <td>{n(p.carries, 0)}</td><td>{pct(p.carryShare)}</td>
                <td>{n(p.airYards, 0)}</td><td>{n(p.airYardsPerTarget)}</td><td>{p.airYardTargets}</td></tr>)}</tbody>
            </table>
          </div>
        </>}
      </>}
    </details>
  );
}
