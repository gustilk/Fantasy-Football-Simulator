import type { SimulationResult } from './simulator';

/** Associate each ensemble mean with its original player before sorting. */
export function gameProjections(result: SimulationResult) {
  const ensemble = result.ensemble;
  if (!ensemble || ensemble.fantasy.length !== result.players.length ||
      !result.players.every(player => typeof player.draftKings === 'number') ||
      !ensemble.fantasy.every(estimate => Number.isFinite(estimate.mean))) return null;
  return result.players.map((player, index) => ({
    id: player.id ?? `${player.team}-${player.name}-${index}`,
    name: player.name,
    team: player.team,
    position: player.position,
    mean: ensemble.fantasy[index].mean,
  })).filter(player => ['QB', 'RB', 'WR', 'TE'].includes(player.position))
    .sort((a, b) => b.mean - a.mean);
}