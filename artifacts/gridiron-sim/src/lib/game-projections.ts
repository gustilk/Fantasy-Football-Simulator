import type { SimulationResult } from './simulator';

/** Associate each ensemble mean with its original player before sorting. */
export function gameProjections(result: SimulationResult) {
  const ensemble = result.ensemble;
  if (!ensemble || ensemble.fantasy.length !== result.players.length ||
      !result.players.every(player => typeof player.draftKings === 'number') ||
      !ensemble.fantasy.every(estimate => Number.isFinite(estimate.mean))) return null;
  const offense = result.players.map((player, index) => ({
    id: player.id ?? `${player.team}-${player.name}-${index}`,
    name: player.name,
    team: player.team,
    position: player.position,
    elite1x: player.elite1x === true,
    mean: ensemble.fantasy[index].mean,
  })).filter(player => ['QB', 'RB', 'WR', 'TE'].includes(player.position));
  const kickers = (ensemble.kickerFantasy ?? []).map(k => ({ id: `K-${k.team}`, name: k.name, team: k.team, position: 'K', elite1x: false, mean: k.mean }));
  const defenses = (ensemble.defenseFantasy ?? []).map(d => ({ id: `DST-${d.team}`, name: `${d.team} DST`, team: d.team, position: 'DST', elite1x: false, mean: d.mean }));
  return [...offense, ...kickers, ...defenses].sort((a, b) => b.mean - a.mean);
}