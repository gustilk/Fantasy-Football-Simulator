import { useState } from 'react';
import { useGetNflSchedule, getGetNflScheduleQueryKey, type NflScheduledGame } from '@workspace/api-client-react';
import { RotateCw } from 'lucide-react';
import { gamesForWeek, type WeeklyProgress } from '@/lib/weekly-simulations';

export default function UpcomingGames({ season, enabled, busy, teams, onRunGame, progress }: {
  season: number; enabled: boolean; busy: boolean; teams: string[];
  onRunGame: (week: number, game: NflScheduledGame, fetchedAt: string) => void;
  progress: WeeklyProgress | null;
}) {
  const schedule = useGetNflSchedule(season, { scope: 'all' }, {
    query: { queryKey: getGetNflScheduleQueryKey(season, { scope: 'all' }), enabled, staleTime: 60_000, refetchInterval: 300_000, retry: false },
  });
  const [week, setWeek] = useState('');
  const [gameId, setGameId] = useState('');
  const games = schedule.data?.games ?? [];
  const weeks = [...new Set(games.map(game => game.week))].sort((a, b) => a - b);
  const selectedWeek = weeks.includes(Number(week)) ? Number(week)
    : games.find(game => Date.parse(game.date) > Date.now())?.week ?? weeks.at(-1);
  const visible = selectedWeek === undefined ? [] : gamesForWeek(games, selectedWeek);
  const selectedGame = visible.find(game => game.id === gameId) ??
    visible.find(game => Date.parse(game.date) > Date.now()) ?? visible[0];
  const missing = selectedGame ? [selectedGame.awayTeam, selectedGame.homeTeam].filter(team => !teams.includes(team)) : [];
  const weekLabel = (value: number) => value <= 18 ? `Week ${value}` : ['Wild Card', 'Divisional', 'Conference Championships', 'Super Bowl'][value - 19];
  return <section className="upcoming-games" aria-labelledby="upcoming-title" data-testid="upcoming-games">
    <div className="schedule-heading">
      <h3 className="section-mini-title" id="upcoming-title">NFL schedule · {season}</h3>
      <button className="text-button" disabled={schedule.isFetching || busy} onClick={() => void schedule.refetch()} aria-label="Refresh upcoming schedule"><RotateCw size={13} /> Refresh</button>
    </div>
    {schedule.isLoading && <p className="stats-help" role="status">Loading the NFL schedule…</p>}
    {schedule.isError && <p className="history-warning" role="alert">Could not load the schedule. {schedule.error.message} Use Refresh to retry.</p>}
    {schedule.data && !schedule.isError && <>
      {games.length ? <>
        <label className="schedule-filter" htmlFor="schedule-week">Browse week
          <select id="schedule-week" value={selectedWeek} disabled={busy} onChange={event => { setWeek(event.target.value); setGameId(''); }}>
            {weeks.map(value => <option key={value} value={value}>{weekLabel(value)}</option>)}
          </select>
        </label>
        <label className="schedule-filter" htmlFor="schedule-game">Select game
          <select id="schedule-game" value={selectedGame?.id ?? ''} disabled={busy} onChange={event => setGameId(event.target.value)}>
            {visible.map(game => <option key={game.id} value={game.id}>{game.awayTeam} at {game.homeTeam} · {new Date(game.date).toLocaleString()}{!game.timeConfirmed ? ' · time unconfirmed' : ''}</option>)}
          </select>
        </label>
        <button className="btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy || !selectedGame || schedule.isFetching}
          data-testid="button-run-game" onClick={() => {
            if (selectedWeek !== undefined && selectedGame) onRunGame(selectedWeek, selectedGame, schedule.data!.fetchedAt);
          }}>
          {progress && busy ? <><RotateCw size={15} className="spin-icon" /> Simulating selected game…</>
            : <>Run selected game</>}
        </button>
        <p className="sim-caption">Runs only the selected matchup using saved history before this week, neutral weather and no odds adjustment. Past or unconfirmed games can be simulated, but are not eligible for pregame Captain lineups.</p>
        {progress && busy && <div role="status" aria-live="polite">
          <progress value={progress.completed} max={progress.total} style={{ width: '100%' }} aria-label="Selected game simulation progress" />
          <p className="sim-caption">{progress.matchup || 'Preparing selected game…'}</p>
        </div>}
        {missing.length > 0 && <p className="history-warning" role="status">Save roster and history in Team Library for: {missing.join(', ')}.</p>}
      </> : <p className="stats-help" role="status">No announced matchups are available for this season.</p>}
    </>}
  </section>;
}