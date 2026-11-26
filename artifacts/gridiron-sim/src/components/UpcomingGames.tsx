import { useEffect, useRef, useState } from 'react';
import { useGetNflSchedule, getGetNflScheduleQueryKey, type NflScheduledGame, type NflDepthChart, type TeamSeasonRecord } from '@workspace/api-client-react';
import { RotateCw } from 'lucide-react';
import { gamesForWeek, type WeeklyProgress } from '@/lib/weekly-simulations';
import { orderGamesByProjection, rankGamesByScoring, type GameScoringRankings } from '@/lib/game-scoring-rankings';
import type { WeatherSetup } from '@/lib/simulator';
import { readStandings, findStandings } from '@/lib/standings';

export default function UpcomingGames({ season, enabled, busy, teams, onRunGame, progress, historyReady, loadDepth }: {
  season: number; enabled: boolean; busy: boolean; teams: TeamSeasonRecord[];
  historyReady: boolean; loadDepth: (season: number, team: string) => Promise<NflDepthChart>;
  onRunGame: (week: number, game: NflScheduledGame, fetchedAt: string, weather?: WeatherSetup) => void;
  progress: WeeklyProgress | null;
}) {
  const schedule = useGetNflSchedule(season, { scope: 'all' }, {
    query: { queryKey: getGetNflScheduleQueryKey(season, { scope: 'all' }), enabled, staleTime: 60_000, refetchInterval: 300_000, retry: false },
  });
  const [week, setWeek] = useState('');
  const [gameId, setGameId] = useState('');
  const [useWeather, setUseWeather] = useState(false);
  const [tempF, setTempF] = useState('40');
  const [windMph, setWindMph] = useState('20');
  const [precip, setPrecip] = useState<WeatherSetup['precipitation']>('moderate');
  const [ranking, setRanking] = useState<GameScoringRankings | null>(null);
  const [rankingBusy, setRankingBusy] = useState(false);
  const [rankingProgress, setRankingProgress] = useState<WeeklyProgress | null>(null);
  const [rankingError, setRankingError] = useState('');
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const games = schedule.data?.games ?? [];
  const weeks = [...new Set(games.map(game => game.week))].sort((a, b) => a - b);
  const selectedWeek = weeks.includes(Number(week)) ? Number(week)
    : games.find(game => Date.parse(game.date) > Date.now())?.week ?? weeks.at(-1);
  const scope = JSON.stringify([season, selectedWeek, schedule.data?.fetchedAt, teams.map(team => [team.team, team.version])]);
  useEffect(() => { request.current++; setRanking(null); setRankingBusy(false); setRankingProgress(null); setRankingError(''); }, [scope]);
  const rankingScope = useRef(scope); rankingScope.current = scope;
  const visible = orderGamesByProjection(selectedWeek === undefined ? [] : gamesForWeek(games, selectedWeek), ranking?.projections ?? []);
  const selectedGame = visible.find(game => game.id === gameId) ??
    visible.find(game => Date.parse(game.date) > Date.now()) ?? visible[0];
  const missing = selectedGame ? [selectedGame.awayTeam, selectedGame.homeTeam].filter(name => !teams.some(team => team.team === name)) : [];
  const selectedProjection = ranking?.projections.find(p => p.gameId === selectedGame?.id);
  const rankGames = async () => {
    if (busy || rankingBusy || !historyReady || selectedWeek === undefined || !schedule.data) return;
    const id = ++request.current, startedScope = scope;
    const stopped = () => request.current !== id || rankingScope.current !== startedScope;
    setRankingBusy(true); setRankingError(''); setRankingProgress(null);
    try {
      const result = await rankGamesByScoring({
        season, week: selectedWeek, games: visible, teams, fetchedAt: schedule.data.fetchedAt, loadDepth,
        standings: findStandings(readStandings(localStorage), season, selectedWeek),
        onProgress: value => { if (!stopped()) setRankingProgress(value); },
        yieldUI: () => new Promise(resolve => setTimeout(resolve, 0)), shouldStop: stopped,
      });
      if (!stopped()) {
        setRanking(result);
        if (!gameId) {
          const ordered = orderGamesByProjection(visible, result.projections);
          const available = ordered.filter(game => result.projections.some(p => p.gameId === game.id));
          setGameId((available.find(game => Date.parse(game.date) > Date.now()) ?? available[0])?.id ?? '');
        }
      }
    } catch (error) {
      if (!stopped()) setRankingError(error instanceof Error ? error.message : 'Games could not be ranked. Saved forecasts are unchanged.');
    } finally { if (!stopped()) setRankingBusy(false); }
  };
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
        <button className="btn-secondary" style={{ width: '100%' }} onClick={() => void rankGames()}
          disabled={busy || rankingBusy || !historyReady || schedule.isFetching} data-testid="button-rank-games">
          {rankingBusy ? 'Calculating projected points…' : ranking ? 'Refresh scoring rankings' : 'Find high-scoring games'}
        </button>
        <p className="sim-caption">Compare mean combined points from 200 model simulations per game, using saved pre-week history and available football evidence. Neutral weather, no odds adjustment. Rankings are estimates, not guaranteed scores; no forecasts are saved.</p>
        {!historyReady && <p className="history-warning">Load Team Library successfully before ranking games.</p>}
        {rankingBusy && <div role="status" aria-live="polite">
          <progress value={rankingProgress?.completed ?? 0} max={rankingProgress?.total ?? visible.length} style={{ width: '100%' }} />
          <p className="sim-caption">{rankingProgress?.completed ?? 0}/{rankingProgress?.total ?? visible.length} games checked · {rankingProgress?.matchup ?? 'Preparing rankings…'}</p>
          <button className="text-button" onClick={() => { request.current++; setRankingBusy(false); setRankingError('Ranking stopped. No forecasts were saved.'); }}>Stop ranking</button>
        </div>}
        {rankingError && <p className="history-warning" role="alert">{rankingError}</p>}
        {ranking && <p className="sim-caption" role="status" data-testid="ranking-result">{ranking.projections.length}/{visible.length} games ranked · highest projected total first</p>}
        <label className="schedule-filter" htmlFor="schedule-game">Select game{ranking ? ' · highest projected total first' : ''}
          <select id="schedule-game" value={selectedGame?.id ?? ''} disabled={busy} onChange={event => setGameId(event.target.value)}>
            {visible.map(game => {
              const projection = ranking?.projections.find(p => p.gameId === game.id);
              return <option key={game.id} value={game.id}>{projection ? `${projection.totalMean.toFixed(1)} pts · ` : ranking ? 'Unranked · ' : ''}{game.awayTeam} at {game.homeTeam} · {new Date(game.date).toLocaleString()}{!game.timeConfirmed ? ' · time unconfirmed' : ''}</option>;
            })}
          </select>
        </label>
        {ranking && <div className="schedule-games scoring-rankings" aria-label="Games ranked by projected total points">
          {visible.map(game => {
            const projection = ranking.projections.find(p => p.gameId === game.id);
            return <button key={game.id} className={`scoring-game ${selectedGame?.id === game.id ? 'selected' : ''}`}
              aria-pressed={selectedGame?.id === game.id} disabled={busy} onClick={() => setGameId(game.id)} data-testid={`ranked-game-${game.id}`}>
              <span>{game.awayTeam} at {game.homeTeam}</span>
              <strong>{projection ? `${projection.totalMean.toFixed(1)} projected points` : 'Projection unavailable'}</strong>
              <small>{new Date(game.date).toLocaleString()}{!game.timeConfirmed ? ' · time unconfirmed' : Date.parse(game.date) <= Date.now() ? ' · already started' : ''}</small>
            </button>;
          })}
        </div>}
        {selectedProjection && <div className="sim-caption" data-testid="selected-scoring-projection">
          <strong>Expected combined score: {selectedProjection.totalMean.toFixed(1)} points</strong>
          <p>{selectedGame?.awayTeam}: {selectedProjection.awayMean.toFixed(1)} · {selectedGame?.homeTeam}: {selectedProjection.homeMean.toFixed(1)}<br />Central 80% of simulated totals: {selectedProjection.totalP10}–{selectedProjection.totalP90} points.</p>
          {!!selectedProjection.warnings.length && <details><summary>Evidence limitations</summary><ul>{selectedProjection.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
        </div>}
        {!!ranking?.failures.length && <details className="history-warning"><summary>{ranking.failures.length} game(s) could not be ranked</summary><ul>{ranking.failures.map(f => <li key={f.gameId}>{f.matchup}: {f.reason}</li>)}</ul></details>}
        <label className="sim-caption" style={{ display: 'block', marginBottom: 6 }}>
          <input type="checkbox" checked={useWeather} data-testid="weather-toggle" onChange={e => setUseWeather(e.target.checked)} /> Use game-day weather for this run (otherwise neutral)</label>
        {useWeather && <div className="sim-caption" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <label>Temp °F <input type="number" value={tempF} data-testid="weather-temp" style={{ width: 64 }} onChange={e => setTempF(e.target.value)} /></label>
          <label>Wind mph <input type="number" value={windMph} data-testid="weather-wind" style={{ width: 64 }} onChange={e => setWindMph(e.target.value)} /></label>
          <label>Precipitation <select value={precip} data-testid="weather-precip" onChange={e => setPrecip(e.target.value as WeatherSetup['precipitation'])}>
            <option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
        </div>}
        <button className="btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy || rankingBusy || !selectedGame || schedule.isFetching}
          data-testid="button-run-game" onClick={() => {
            if (selectedWeek !== undefined && selectedGame) onRunGame(selectedWeek, selectedGame, schedule.data!.fetchedAt, useWeather ? { temperatureF: Number(tempF), windMph: Number(windMph), precipitation: precip } : undefined);
          }}>
          {progress && busy ? <><RotateCw size={15} className="spin-icon" /> Simulating selected game…</>
            : <>Run selected game</>}
        </button>
        <p className="sim-caption">Runs only the selected matchup using saved history before this week, neutral weather unless you turn on game-day weather above, and no odds adjustment. Past or unconfirmed games can be simulated, but are not eligible for pregame Captain lineups.</p>
        {progress && busy && <div role="status" aria-live="polite">
          <progress value={progress.completed} max={progress.total} style={{ width: '100%' }} aria-label="Selected game simulation progress" />
          <p className="sim-caption">{progress.matchup || 'Preparing selected game…'}</p>
        </div>}
        {missing.length > 0 && <p className="history-warning" role="status">Save roster and history in Team Library for: {missing.join(', ')}.</p>}
      </> : <p className="stats-help" role="status">No announced matchups are available for this season.</p>}
    </>}
  </section>;
}