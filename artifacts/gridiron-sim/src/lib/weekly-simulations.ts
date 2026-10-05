import type { NflDepthChart, NflScheduledGame, TeamSeasonRecord } from '@workspace/api-client-react';
import { withDepthChart } from './depth-chart';
import { setupFromHistory } from './season-model';
import { simulateEnsemble } from './ensemble';
import type { SimulationInput } from './simulator';
import type { SavedSimulation } from './saved-simulations';
import { applyStandings, validateStandings, type StandingsSnapshot } from './standings';

export interface WeeklyProgress { completed: number; total: number; matchup: string }
export interface WeeklyRun {
  season: number; week: number; total: number;
  saved: SavedSimulation[];
  failures: { gameId: string; matchup: string; reason: string }[];
}

export function gamesForWeek(games: NflScheduledGame[], week: number): NflScheduledGame[] {
  return [...new Map(games.filter(game => game.week === week).map(game => [game.id, game])).values()]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id));
}

export async function runWeeklySimulations(options: {
  season: number; week: number; games: NflScheduledGame[];
  teams: TeamSeasonRecord[]; fetchedAt: string;
  loadDepth: (season: number, team: string) => Promise<NflDepthChart>;
  save: (entry: SavedSimulation) => void;
  onProgress: (progress: WeeklyProgress) => void;
  yieldUI: () => Promise<void>;
  simulate?: typeof simulateEnsemble;
  standings?: StandingsSnapshot;
}): Promise<WeeklyRun> {
  const { season, week } = options;
  const games = structuredClone(gamesForWeek(options.games, week));
  const teams = structuredClone(options.teams);
  const standings = options.standings ? structuredClone(options.standings) : undefined;
  if (standings) validateStandings(standings);
  const report: WeeklyRun = { season, week, total: games.length, saved: [], failures: [] };
  if (!games.length) throw new Error(`No announced games are available for week ${week}.`);
  const weeklyRunId = crypto.randomUUID();
  const loadTeam = async (name: string) => {
    const team = teams.find(team => team.team === name && team.season === season);
    if (!team) throw new Error(`${name} is missing from the ${season} Team Library. Save its roster and history first.`);
    if (team.weeks.some(game => game.week === week && game.status === 'bye')) {
      throw new Error(`${name} has a saved bye in week ${week}. Check its history.`);
    }
    try { return withDepthChart(team, await options.loadDepth(season, name)); }
    catch (cause) {
      const ranked = ['QB', 'RB', 'WR', 'TE'].every(position =>
        team.players.some(player => player.active && player.side === 'offense' &&
          player.position === position && player.depthRank !== undefined));
      if (!ranked) throw new Error(`${name}: live depth chart unavailable and saved QB/RB/WR/TE ranks are incomplete. Set the ranks in Team Library.`);
      return team;
    }
  };
  for (const [index, game] of games.entries()) {
    const matchup = `${game.awayTeam} at ${game.homeTeam}`;
    options.onProgress({ completed: index, total: games.length, matchup });
    await options.yieldUI();
    try {
      const [away, home] = await Promise.all([loadTeam(game.awayTeam), loadTeam(game.homeTeam)]);
      const input: SimulationInput = {
        showdownModel: 'showdown-v1',
        away: applyStandings(setupFromHistory(away, week, 'away', home.team), standings, season, week),
        home: applyStandings(setupFromHistory(home, week, 'home', away.team), standings, season, week),
        weather: { temperatureF: 68, windMph: 5, precipitation: 'none' },
        importance: game.seasonType === 'postseason' ? 'playoff' : 'regular',
        market: {
          enabled: false, source: game.odds ? 'ESPN' : 'manual', ...game.odds,
          season, week, gameId: game.id, awayTeam: game.awayTeam, homeTeam: game.homeTeam,
          kickoff: game.timeConfirmed ? game.date : undefined,
          recordedAt: game.odds ? options.fetchedAt : undefined,
        },
        seed: Math.floor(Math.random() * 2_000_000_000) + 1,
      };
      const generatedAt = new Date().toISOString();
      const result = (options.simulate ?? simulateEnsemble)(input, 200);
      if (!game.timeConfirmed || Date.parse(game.date) <= Date.now()) {
        result.overview.push('Historical/unconfirmed-kickoff simulation: not an eligible pregame forecast. Current roster/depth-chart data may differ from game-day roles.');
      }
      result.overview.push('Weekly batch uses neutral weather (68°F, 5 mph wind, no precipitation) and no market-odds adjustment.');
      const { seed: _seed, ...setup } = input;
      const entry: SavedSimulation = {
        id: `${season}-${week}-${game.id}-${crypto.randomUUID()}`,
        weeklyRunId, generatedAt,
        savedAt: new Date().toISOString(), awayName: game.awayTeam, homeName: game.homeTeam,
        result, setup,
      };
      options.save(entry);
      report.saved.push(entry);
    } catch (cause) {
      report.failures.push({ gameId: game.id, matchup,
        reason: cause instanceof Error ? cause.message : 'This game could not be simulated.' });
    }
    options.onProgress({ completed: index + 1, total: games.length, matchup });
    await options.yieldUI();
  }
  return report;
}