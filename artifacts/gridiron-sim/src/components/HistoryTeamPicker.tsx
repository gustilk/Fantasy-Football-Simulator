import type { TeamSeasonRecord } from '@workspace/api-client-react';
import { setupFromHistory } from '@/lib/season-model';
import type { TeamSetup } from '@/lib/simulator';

export default function HistoryTeamPicker({ name, teams, week, venue, onChange, onLibrary, snapshot }: {
  name: string; teams: TeamSeasonRecord[]; week: number; venue: 'away' | 'home';
  onChange: (name: string) => void; onLibrary: () => void; snapshot?: TeamSetup;
}) {
  const team = teams.find(team => team.team === name);
  const setup = snapshot ?? (team ? setupFromHistory(team, week, venue) : undefined);
  return <div className="team-block history-team">
    <h3 className="section-mini-title">{venue.toUpperCase()} TEAM</h3>
    <label htmlFor={`history-${venue}`} className="input-help">Saved team</label>
    <select id={`history-${venue}`} value={name} onChange={event => onChange(event.target.value)} disabled={!!snapshot} data-testid={`history-${venue}`}>
      {snapshot ? <option value={name}>{name}</option> : <>
        {!team && <option value={name}>{name} — not yet saved</option>}
        {teams.map(team => <option key={team.team} value={team.team}>{team.team}</option>)}
      </>}
    </select>
    {!setup ? <p className="stats-help">Save this team’s roster and weekly games in Team Library first. <button className="text-button" onClick={onLibrary}>Open Team Library</button></p> : <>
      <p className="stats-help"><strong>Record: {setup.record?.wins ?? 0}–{setup.record?.losses ?? 0}–{setup.record?.ties ?? 0}</strong> · {setup.historyGames ?? 0} recorded games before this matchup.</p>
      {(setup.historyGames ?? 0) < 3 && <p className="history-warning">Limited history: fewer than 3 games. Missing statistics use baseline assumptions; enter more weeks to inform projections.</p>}
      <details className="recent-stats">
        <summary>Loaded offense · {setup.roster?.length ?? 0} skill players</summary>
        <p className="stats-help">All active QB/RB/WR/TE players are included. The QB with the most entered passing attempts starts; backup QBs have no automatic playing time.</p>
        {setup.roster?.map(player => <div className="history-player" key={player.id}>
          <strong>{player.position} · {player.name}</strong>
          <span>{Object.entries(player.recentStats ?? {}).map(([key, value]) => `${key}: ${Number(value).toFixed(1)}`).join(' · ') || 'No earlier statistics recorded'}</span>
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