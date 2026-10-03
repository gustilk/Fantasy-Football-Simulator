import type { NflScheduledGame, TeamSeasonRecord } from '@workspace/api-client-react';
import type { SimulationInput, SimulationResult } from './simulator';
import { getDraftKingsDetails } from './draftkings';
import { savedEliteTier, type EliteTier } from './elite-players';

export const DK_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
export type DKPosition = typeof DK_POSITIONS[number];
export const DK_TIMEZONE = 'America/Chicago';
const round = (value: number) => Math.round(value * 100) / 100;
const supported = (position: string): position is DKPosition => DK_POSITIONS.includes(position as DKPosition);
export const dkPlayerKey = (team: string, playerId: string) => JSON.stringify([team, playerId]);
const scoringFields = [
  'passYards', 'passTD', 'interceptions', 'rushYards', 'rushTD', 'receptions', 'receivingYards',
  'receivingTD', 'fumblesLost', 'kickReturnTD', 'puntReturnTD', 'fieldGoalReturnTD',
  'twoPointConversions', 'offensiveFumbleRecoveryTD',
];

export interface DKProjection {
  playerId: string;
  name: string;
  team: string;
  position: DKPosition;
  elite1x?: boolean;
  eliteTier?: EliteTier;
  mean: number;
  p10: number;
  p90: number;
}
export interface DKGameForecast {
  gameId: string;
  generatedAt?: string;
  week: number;
  kickoff: string;
  awayTeam: string;
  homeTeam: string;
  seed: number;
  runs: number;
  players: DKProjection[];
  input: SimulationInput;
  market?: NonNullable<SimulationResult['ensemble']>['market'];
  warnings: string[];
}
export interface DKSlate {
  id: string;
  season: number;
  sunday: string;
  createdAt: string;
  savedAt?: string;
  timezone: typeof DK_TIMEZONE;
  forecasts: DKGameForecast[];
  failures: { gameId: string; matchup: string; reason: string }[];
}
export interface DKOfficialScore {
  season: number;
  team: string;
  playerId: string;
  week: number;
  points: number;
  enteredAt: string;
}
export interface DKMarketDraft {
  enabled: boolean;
  homeSpread: string;
  total: string;
  recordedAt: string;
  manual: boolean;
}
export interface DKWeekPoints {
  week: number;
  points: number | null;
  partial: boolean;
  source: 'recorded-stats' | 'user-entered-official' | 'unknown';
}
export interface DKHistoryPlayer {
  playerId: string;
  name: string;
  team: string;
  position: DKPosition;
  weeks: DKWeekPoints[];
  recordedTotal: number | null;
  recordedAverage: number | null;
  observedGames: number;
  unknownGames: number;
  partial: boolean;
}
export interface DKBoardRow extends DKProjection {
  gameId: string;
  week: number;
  actual: DKWeekPoints | null;
  difference: number | null;
  history: DKHistoryPlayer | null;
}

export function centralDay(timestamp: string) {
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid game date.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DK_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function isSunday(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
}
export function sundayGames(games: NflScheduledGame[], sunday: string, now = Date.now()) {
  if (!isSunday(sunday)) throw new Error('Choose a Sunday date.');
  return games.filter(game => Date.parse(game.date) > now && centralDay(game.date) === sunday);
}
export function availableSundays(games: NflScheduledGame[]) {
  return [...new Set(games.map(game => centralDay(game.date)).filter(isSunday))].sort();
}

/** Game numbers are source NFL weeks, not a team's count of games played. */
export function availableSundayOptions(games: NflScheduledGame[]) {
  const byDay = new Map<string, Map<string, { week: number; playoff: boolean }>>();
  for (const game of games) {
    const day = centralDay(game.date);
    if (!isSunday(day)) continue;
    const weeks = byDay.get(day) ?? new Map();
    const playoff = game.seasonType === 'postseason';
    weeks.set(`${playoff}:${game.week}`, { week: game.week, playoff });
    byDay.set(day, weeks);
  }
  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, weeks]) => ({
    value,
    label: `${dateFormat.format(new Date(`${value}T12:00:00Z`))} · ${[...weeks.values()]
      .sort((a, b) => a.week - b.week)
      .map(week => `${week.playoff ? 'Playoff game' : 'Game'} #${week.week}`).join(' / ')}`,
  }));
}

export function gameForecast(game: NflScheduledGame, input: SimulationInput, result: SimulationResult): DKGameForecast {
  const ensemble = result.ensemble;
  if (!ensemble || ensemble.fantasy.length !== result.players.length) throw new Error('Complete ensemble projections are required.');
  const players = result.players.filter(player => supported(player.position)).map(player => {
    const index = result.players.indexOf(player);
    const summary = ensemble.fantasy[index]!;
    if (![summary.mean, summary.p10, summary.p90].every(Number.isFinite)) throw new Error('Non-finite DraftKings projection.');
    const roster = player.team === input.away.name ? input.away.roster : player.team === input.home.name ? input.home.roster : undefined;
    const matches = roster?.filter(candidate => player.id
      ? candidate.id === player.id
      : candidate.name === player.name && candidate.position === player.position) ?? [];
    if (matches.length !== 1) throw new Error(`Cannot uniquely identify ${player.name} in the saved roster.`);
    return {
      playerId: matches[0]!.id, name: player.name, team: player.team, position: player.position as DKPosition,
      elite1x: player.elite1x === true,
      eliteTier: savedEliteTier(player),
      mean: summary.mean, p10: summary.p10, p90: summary.p90,
    };
  });
  return {
    gameId: game.id, week: game.week, kickoff: game.date, awayTeam: game.awayTeam, homeTeam: game.homeTeam,
    seed: result.seed, runs: ensemble.runs, players, input: structuredClone(input), market: ensemble.market,
    warnings: [...(input.away.modelEvidence?.warnings ?? []), ...(input.home.modelEvidence?.warnings ?? []), ...(ensemble.market?.warnings ?? [])],
  };
}

/** Includes inactive historical players. Missing box scores never become zero. */
export function dkHistory(teams: TeamSeasonRecord[], season: number, official: DKOfficialScore[] = []): DKHistoryPlayer[] {
  return teams.filter(team => team.season === season).flatMap(team => {
    const games = team.weeks.filter(game => game.status === 'played').sort((a, b) => a.week - b.week);
    return team.players.filter(player => player.side === 'offense' && supported(player.position)).map(player => {
      const weeks: DKWeekPoints[] = games.map(game => {
        const entered = official.find(score => score.season === season && score.team === team.team &&
          score.playerId === player.id && score.week === game.week);
        if (entered) return { week: game.week, points: entered.points, partial: false, source: 'user-entered-official' };
        const stats = game.playerStats[player.id];
        if (!stats || !scoringFields.some(field => Number.isFinite(stats[field]))) {
          return { week: game.week, points: null, partial: false, source: 'unknown' };
        }
        const details = getDraftKingsDetails(player, stats);
        return { week: game.week, points: details.points, partial: details.partial, source: 'recorded-stats' };
      });
      const observed = weeks.filter(week => week.points !== null);
      const total = observed.length ? round(observed.reduce((sum, week) => sum + week.points!, 0)) : null;
      return {
        playerId: player.id, name: player.name, team: team.team, position: player.position as DKPosition, weeks,
        recordedTotal: total, recordedAverage: total === null ? null : round(total / observed.length),
        observedGames: observed.length, unknownGames: weeks.length - observed.length,
        partial: observed.some(week => week.partial),
      };
    });
  });
}

export function slateBoard(slate: DKSlate, history: DKHistoryPlayer[]): DKBoardRow[] {
  const histories = new Map(history.map(player => [dkPlayerKey(player.team, player.playerId), player]));
  const seen = new Set<string>();
  return slate.forecasts.flatMap(game => game.players.map(player => {
    const key = dkPlayerKey(player.team, player.playerId);
    if (seen.has(key)) throw new Error('A player appears twice in this slate. Duplicate games cannot be added together.');
    seen.add(key);
    const past = histories.get(key) ?? null;
    const actual = past?.weeks.find(week => week.week === game.week) ?? null;
    return {
      ...player, gameId: game.gameId, week: game.week, history: past, actual,
      difference: actual?.points !== null && actual?.points !== undefined && !actual.partial ? round(actual.points - player.mean) : null,
    };
  })).sort((a, b) => b.mean - a.mean || a.name.localeCompare(b.name));
}
export function groupDKPlayers<T extends { position: string }>(rows: T[]) {
  return DK_POSITIONS.map(position => ({ position, players: rows.filter(row => row.position === position) }));
}

export function validateOfficialScore(score: DKOfficialScore, teams: TeamSeasonRecord[]) {
  if (!Number.isFinite(score.points) || score.points < -100 || score.points > 200) throw new Error('Enter actual DK points between -100 and 200.');
  const team = teams.find(team => team.season === score.season && team.team === score.team);
  const player = team?.players.find(player => player.id === score.playerId && player.side === 'offense' && supported(player.position));
  if (!player || !team?.weeks.some(game => game.week === score.week && game.status === 'played')) {
    throw new Error('Record an actual completed game in Team Library before entering its official DK points.');
  }
  if (!Number.isFinite(Date.parse(score.enteredAt))) throw new Error('Invalid score entry time.');
}