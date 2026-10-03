import { useState } from 'react';
import { useGetNflSchedule, getGetNflScheduleQueryKey, type NflScheduledGame } from '@workspace/api-client-react';
import { RotateCw } from 'lucide-react';

export default function UpcomingGames({ season, enabled, busy, teams, selectedMatchup, onSelect }: {
  season: number; enabled: boolean; busy: boolean; teams: string[];
  selectedMatchup: { away: string; home: string; week: number } | null;
  onSelect: (game: NflScheduledGame) => void;
}) {
  const schedule = useGetNflSchedule(season, {
    query: { queryKey: getGetNflScheduleQueryKey(season), enabled, staleTime: 60_000, refetchInterval: 300_000, retry: false },
  });
  const [week, setWeek] = useState('all');
  const games = schedule.data?.games ?? [];
  const weeks = [...new Set(games.map(game => game.week))].sort((a, b) => a - b);
  const selectedWeek = week !== 'all' && weeks.includes(Number(week)) ? week : 'all';
  const visible = games.filter(game => selectedWeek === 'all' || game.week === Number(selectedWeek));
  const weekLabel = (value: number) => value <= 18 ? `Week ${value}` : ['Wild Card', 'Divisional', 'Conference Championships', 'Super Bowl'][value - 19];
  return <section className="upcoming-games" aria-labelledby="upcoming-title" data-testid="upcoming-games">
    <div className="schedule-heading">
      <h3 className="section-mini-title" id="upcoming-title">UPCOMING NFL GAMES · {season}</h3>
      <button className="text-button" disabled={schedule.isFetching || busy} onClick={() => void schedule.refetch()} aria-label="Refresh upcoming schedule"><RotateCw size={13} /> Refresh</button>
    </div>
    <p className="stats-help">Select a game to fill both teams and the week automatically, using Saved Team Library. All announced regular-season and playoff matchups are included. Kickoff times use your local time zone.</p>
    {schedule.isLoading && <p className="stats-help" role="status">Loading the NFL schedule…</p>}
    {schedule.isError && <p className="history-warning" role="alert">Could not load the schedule. {schedule.error.message} Use Refresh to retry, or choose teams manually below.</p>}
    {schedule.data && !schedule.isError && <>
      <p className="stats-help">ESPN schedule checked {new Date(schedule.data.fetchedAt).toLocaleString()}. Public source updates are cached for up to 5 minutes. <a href={schedule.data.sourceUrl} target="_blank" rel="noreferrer">Source</a></p>
      {schedule.data.unannouncedGames > 0 && <p className="stats-help">{schedule.data.unannouncedGames} future game(s) have undecided teams and will appear once the matchup is announced.</p>}
      {games.length ? <>
        <label className="schedule-filter" htmlFor="schedule-week">Show games
          <select id="schedule-week" value={selectedWeek} onChange={event => setWeek(event.target.value)}>
            <option value="all">All upcoming weeks ({games.length} games)</option>
            {weeks.map(value => <option key={value} value={value}>{weekLabel(value)}</option>)}
          </select>
        </label>
        <div className="schedule-games">
          {visible.map(game => {
            const missing = [game.awayTeam, game.homeTeam].filter(team => !teams.includes(team));
            const selected = selectedMatchup?.away === game.awayTeam && selectedMatchup?.home === game.homeTeam && selectedMatchup?.week === game.week;
            return <button className={`scheduled-game${selected ? ' selected' : ''}`} aria-pressed={selected} key={game.id} disabled={busy} onClick={() => onSelect(game)} data-testid={`schedule-game-${game.id}`}>
              <strong>{game.awayTeam} <span>at</span> {game.homeTeam}</strong>
              <span>{weekLabel(game.week)} · {game.timeConfirmed
                ? new Date(game.date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
                : 'Date / kickoff TBD'}</span>
              {missing.length > 0 && <small>Needs saved roster/history: {missing.join(', ')}</small>}
              {selected && <small>Selected matchup</small>}
            </button>;
          })}
        </div>
      </> : <p className="stats-help" role="status">No upcoming announced matchups are available for this season.</p>}
    </>}
  </section>;
}