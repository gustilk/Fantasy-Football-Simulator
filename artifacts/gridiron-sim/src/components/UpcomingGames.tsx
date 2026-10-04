import { useState } from 'react';
import { useGetNflSchedule, getGetNflScheduleQueryKey, type NflScheduledGame } from '@workspace/api-client-react';
import { RotateCw } from 'lucide-react';
import { gamesForWeek, type WeeklyProgress } from '@/lib/weekly-simulations';

export default function UpcomingGames({ season, enabled, busy, teams, selectedMatchup, onSelect, onRunWeek, progress }: {
  season: number; enabled: boolean; busy: boolean; teams: string[];
  selectedMatchup: { away: string; home: string; week: number } | null;
  onSelect: (game: NflScheduledGame, fetchedAt: string) => void;
  onRunWeek: (week: number, games: NflScheduledGame[], fetchedAt: string) => void;
  progress: WeeklyProgress | null;
}) {
  const schedule = useGetNflSchedule(season, { scope: 'all' }, {
    query: { queryKey: getGetNflScheduleQueryKey(season, { scope: 'all' }), enabled, staleTime: 60_000, refetchInterval: 300_000, retry: false },
  });
  const [week, setWeek] = useState('');
  const games = schedule.data?.games ?? [];
  const weeks = [...new Set(games.map(game => game.week))].sort((a, b) => a - b);
  const selectedWeek = weeks.includes(Number(week)) ? Number(week)
    : selectedMatchup && weeks.includes(selectedMatchup.week) ? selectedMatchup.week
    : games.find(game => Date.parse(game.date) > Date.now())?.week ?? weeks.at(-1);
  const visible = selectedWeek === undefined ? [] : gamesForWeek(games, selectedWeek);
  const selected = visible.find(game => selectedMatchup?.away === game.awayTeam &&
    selectedMatchup?.home === game.homeTeam && selectedMatchup?.week === game.week);
  const missing = selected ? [selected.awayTeam, selected.homeTeam].filter(team => !teams.includes(team)) : [];
  const weekLabel = (value: number) => value <= 18 ? `Week ${value}` : ['Wild Card', 'Divisional', 'Conference Championships', 'Super Bowl'][value - 19];
  return <section className="upcoming-games" aria-labelledby="upcoming-title" data-testid="upcoming-games">
    <div className="schedule-heading">
      <h3 className="section-mini-title" id="upcoming-title">NFL schedule · {season}</h3>
      <button className="text-button" disabled={schedule.isFetching || busy} onClick={() => void schedule.refetch()} aria-label="Refresh upcoming schedule"><RotateCw size={13} /> Refresh</button>
    </div>
    {schedule.isLoading && <p className="stats-help" role="status">Loading the NFL schedule…</p>}
    {schedule.isError && <p className="history-warning" role="alert">Could not load the schedule. {schedule.error.message} Use Refresh to retry, or choose teams manually below.</p>}
    {schedule.data && !schedule.isError && <>
      {games.length ? <>
        <label className="schedule-filter" htmlFor="schedule-week">Browse week
          <select id="schedule-week" value={selectedWeek} disabled={busy} onChange={event => setWeek(event.target.value)}>
            {weeks.map(value => <option key={value} value={value}>{weekLabel(value)}</option>)}
          </select>
        </label>
        <button className="btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy || !visible.length || schedule.isFetching}
          data-testid="button-run-week" onClick={() => {
            if (selectedWeek !== undefined) onRunWeek(selectedWeek, visible, schedule.data!.fetchedAt);
          }}>
          {progress && busy ? <><RotateCw size={15} className="spin-icon" /> {progress.completed} / {progress.total} games</>
            : <>Run all {visible.length} games · {selectedWeek === undefined ? '' : weekLabel(selectedWeek)}</>}
        </button>
        <p className="sim-caption">Includes every announced matchup, Thursday through Monday, even games already played. Uses saved history before this week, neutral weather and no odds adjustment.</p>
        {progress && busy && <div role="status" aria-live="polite">
          <progress value={progress.completed} max={progress.total} style={{ width: '100%' }} aria-label="Weekly simulation progress" />
          <p className="sim-caption">{progress.matchup || 'Preparing weekly simulations…'}</p>
        </div>}
        <label className="schedule-filter" htmlFor="schedule-matchup">Game
          <select id="schedule-matchup" value={selected?.id ?? ''} disabled={busy} onChange={event => {
            const game = visible.find(game => game.id === event.target.value);
            if (game) onSelect(game, schedule.data!.fetchedAt);
          }}>
            <option value="">Choose a game</option>
            {visible.map(game => <option key={game.id} value={game.id} data-testid={`schedule-game-${game.id}`}>
              {game.awayTeam.split(' ').at(-1)} at {game.homeTeam.split(' ').at(-1)}
            </option>)}
          </select>
        </label>
        {selected && <p className="sim-caption">{selected.timeConfirmed
          ? new Date(selected.date).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' })
          : 'Kickoff time TBD'}</p>}
        {missing.length > 0 && <p className="history-warning" role="status">Save roster and history in Team Library for: {missing.join(', ')}.</p>}
      </> : <p className="stats-help" role="status">No announced matchups are available for this season.</p>}
    </>}
  </section>;
}