import type { TeamSeasonRecord } from '@workspace/api-client-react';
import { setupFromHistory } from '@/lib/season-model';
import type { TeamSetup } from '@/lib/simulator';
import { getDivision } from '@/lib/nfl-divisions';
import { availabilityLabels } from '@/lib/availability';

export default function HistoryTeamPicker({ name, teams, week, venue, opponent, onChange, onLibrary, snapshot }: {
  name: string; teams: TeamSeasonRecord[]; week: number; venue: 'away' | 'home';
  opponent: string;
  onChange: (name: string) => void; onLibrary: () => void; snapshot?: TeamSetup;
}) {
  const team = teams.find(team => team.team === name);
  const setup = snapshot ?? (team ? setupFromHistory(team, week, venue, opponent) : undefined);
  return <div className={`team-block history-team team-${venue}`}>
    <h3 className="section-mini-title">{venue.toUpperCase()} TEAM</h3>
    <label htmlFor={`history-${venue}`} className="input-help">Saved team</label>
    <select id={`history-${venue}`} value={name} onChange={event => onChange(event.target.value)} disabled={!!snapshot} data-testid={`history-${venue}`}>
      {snapshot ? <option value={name}>{name}</option> : <>
        {!team && <option value={name}>{name} — not yet saved</option>}
        {teams.map(team => <option key={team.team} value={team.team}>{team.team}</option>)}
      </>}
    </select>
    <p className="stats-help" data-testid={`division-${venue}`}>Current division: <strong>{getDivision(name) ?? 'Unknown'}</strong></p>
    {!setup ? <p className="stats-help">Save this team’s roster and weekly games in Team Library first. <button className="text-button" onClick={onLibrary}>Open Team Library</button></p> : <>
      <p className="stats-help"><strong>Record: {setup.record?.wins ?? 0}–{setup.record?.losses ?? 0}–{setup.record?.ties ?? 0}</strong> · {setup.historyGames ?? 0} recorded games before this matchup.</p>
      {setup.modelEvidence && <>
        <p className="stats-help" data-testid={`strength-${venue}`}>History-derived strength: <strong>Pass {setup.passRating} · Rush {setup.rushRating} · Defense {setup.defenseRating}</strong>. Passing: {setup.modelEvidence.strength.passGames} usable games; rushing: {setup.modelEvidence.strength.rushGames}; defense: {setup.modelEvidence.strength.passDefenseGames} passing / {setup.modelEvidence.strength.rushDefenseGames} rushing. Sparse data shrinks ratings toward 55. These are heuristic estimates, not opponent-adjusted or validated accuracy gains.</p>
        <details className="recent-stats"><summary>Data quality · {setup.modelEvidence.warnings.length} caution(s)</summary>
          {setup.modelEvidence.warnings.length ? setup.modelEvidence.warnings.map(warning => <p key={warning} className="history-warning">{warning}</p>) : <p className="stats-help">No missing-history or availability-freshness warnings. This does not certify prediction accuracy or game-day participation.</p>}
        </details>
      </>}
      {setup.availabilityChecks && <details className="recent-stats">
        <summary>Week {week} availability · {setup.availabilityChecks.filter(p => !p.included).length} excluded</summary>
        <p className="stats-help">Roster reports are not confirmed game-day participation. Weekly overrides take precedence and are retained in saved inputs.</p>
        {setup.availabilityChecks.map(player => <div className="history-player" key={player.id}><strong>{player.name} · {availabilityLabels[player.status]} · {player.included ? 'included' : 'excluded'}</strong><span>{player.basis} · {player.checkedAt ? `checked ${new Date(player.checkedAt).toLocaleString()}` : 'no availability timestamp'}</span></div>)}
      </details>}
      {setup.depthChartSource && <p className="stats-help">Current depth chart fetched {new Date(setup.depthChartSource.fetchedAt).toLocaleString()}. <a href={setup.depthChartSource.url} target="_blank" rel="noreferrer">ESPN source</a>. This is not a historical pregame availability record.</p>}
      <p className="stats-help" data-testid={`head-to-head-${venue}`}>{setup.headToHead?.opponent === opponent && setup.headToHead.usableGames > 0
        ? `${setup.headToHead.games} earlier head-to-head game(s) against ${opponent}; ${setup.headToHead.usableGames} with usable stats. Up to ${Math.round(setup.headToHead.maxWeight * 100)}% weight per known field, with bounded changes.`
        : `No usable earlier head-to-head stats against ${opponent}. No opponent-specific history adjustment.`}</p>
      {(setup.historyGames ?? 0) < 3 && <p className="history-warning">Limited history: fewer than 3 games. Missing statistics use baseline assumptions; enter more weeks to inform projections.</p>}
      <details className="recent-stats">
        <summary>Loaded offense · {setup.roster?.length ?? 0} skill players</summary>
        <p className="stats-help">Available QB/RB/WR/TE players retain their depth roles. QB1 starts when available; deeper backups receive smaller workload priors. Missing injury games do not become zero-stat performances. Shares are of reported targets/carries in games with that player’s observed statistic, not verified complete team opportunities. They guide workload but remain bounded by depth roles. No snap, route or goal-line data is invented.</p>
        {setup.roster?.map(player => <div className="history-player" key={player.id}>
          <strong>{player.position}{player.depthRank ?? ''} · {player.name} · {player.depthRankBasis === 'ESPN' ? 'ESPN chart' : player.depthRankBasis === 'saved' ? 'Saved role' : 'Usage estimate'}</strong>
          <span>{Object.entries(player.recentStats ?? {}).map(([key, value]) => `${key}: ${Number(value).toFixed(1)}`).join(' · ') || 'No earlier statistics recorded'}</span>
          {player.usage && <span>{player.usage.targetShare !== undefined ? `Reported target share ${(player.usage.targetShare * 100).toFixed(1)}% (${player.usage.targetGames} games)` : 'Target share unknown'} · {player.usage.carryShare !== undefined ? `Reported carry share ${(player.usage.carryShare * 100).toFixed(1)}% (${player.usage.carryGames} games)` : 'Carry share unknown'}</span>}
        </div>)}
      </details>
      <details className="recent-stats">
        <summary>Loaded defense {team ? `· ${team.players.filter(player => player.side === 'defense').length} players saved` : ''}</summary>
        <p className="stats-help">Explicit team totals take precedence. Otherwise, defensive-player INTs, forced fumbles, sacks, and passes defended are summed without double counting. Other stored defensive stats remain available in the library.</p>
        <div className="history-player"><span>{Object.entries(setup.defenseRecent ?? {}).map(([key, value]) => `${key}: ${Number(value).toFixed(1)}`).join(' · ') || 'No earlier defensive totals recorded'}</span></div>
      </details>
      <button className="text-button" onClick={onLibrary}>Manage roster and weekly stats</button>
    </>}
  </div>;
}