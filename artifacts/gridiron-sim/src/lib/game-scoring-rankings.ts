import type { NflScheduledGame } from '@workspace/api-client-react';
import { simulateEnsemble } from './ensemble';
import { gamesForWeek, runWeeklySimulations } from './weekly-simulations';

export interface GameScoringProjection {
  gameId: string;
  awayMean: number;
  homeMean: number;
  totalMean: number;
  totalP10: number;
  totalP90: number;
  warnings: string[];
}
export interface GameScoringRankings {
  projections: GameScoringProjection[];
  failures: { gameId: string; matchup: string; reason: string }[];
}
export function orderGamesByProjection(games: NflScheduledGame[], projections: GameScoringProjection[]) {
  const totals = new Map(projections.map(projection => [projection.gameId, projection.totalMean]));
  return [...games].sort((a, b) => {
    const x = totals.get(a.id), y = totals.get(b.id);
    if (x === undefined && y !== undefined) return 1;
    if (x !== undefined && y === undefined) return -1;
    return (x !== undefined && y !== undefined ? y - x : 0)
      || Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id);
  });
}
/** Stable sampling for comparisons, without depending on scores or a desired winner. */
function rankingSeed(season: number, week: number, gameId: string) {
  let seed = 2166136261;
  for (const char of `${season}:${week}:${gameId}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return seed || 1;
}
/** Reuse the real preparation/model pipeline; previews have no storage callback.
 * Only Run selected game persists a forecast. Missing inputs never become a zero score. */
export async function rankGamesByScoring(options: Omit<Parameters<typeof runWeeklySimulations>[0], 'save' | 'simulate'> & {
  shouldStop?: () => boolean;
}): Promise<GameScoringRankings> {
  const checkStopped = () => { if (options.shouldStop?.()) throw new Error('Ranking stopped. No forecasts were saved.'); };
  checkStopped();
  const report = await runWeeklySimulations({
    ...options,
    save: () => {},
    yieldUI: async () => { checkStopped(); await options.yieldUI(); checkStopped(); },
    simulate: input => simulateEnsemble({
      ...input, seed: rankingSeed(options.season, options.week, input.market?.gameId ?? ''),
    }, 200),
  });
  checkStopped();
  const projections: GameScoringProjection[] = report.saved.map(entry => {
    const scoring = entry.result.ensemble?.scoring;
    const setup = entry.setup;
    if (!scoring || !setup?.market?.gameId) throw new Error('The model did not return an expected scoring total for this game.');
    return { gameId: setup.market.gameId, ...scoring,
      warnings: [...new Set([...(setup.away.footballEvidence?.warnings ?? []),
        ...(setup.home.footballEvidence?.warnings ?? [])])] };
  });
  const order = orderGamesByProjection(gamesForWeek(options.games, options.week), projections);
  return { projections: order.flatMap(game => projections.filter(p => p.gameId === game.id)), failures: report.failures };
}
