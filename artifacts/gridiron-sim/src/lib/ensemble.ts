import { simulateGame, type SimulationInput, type SimulationResult } from "./simulator";

export function simulateEnsemble(input: SimulationInput, runs = 200): SimulationResult {
  if (!Number.isInteger(runs) || runs < 1 || runs > 500) throw new Error("Use between 1 and 500 simulations.");
  const first = simulateGame(input);
  const values = first.players.map(player => [player.halfPpr]);
  let awayWins = Number(first.awayScore > first.homeScore);
  let homeWins = Number(first.homeScore > first.awayScore);
  let ties = Number(first.awayScore === first.homeScore);
  for (let i = 1; i < runs; i++) {
    const result = simulateGame({ ...input, seed: (first.seed + Math.imul(i, 2654435761)) >>> 0 });
    result.players.forEach((player, index) => values[index]!.push(player.halfPpr));
    awayWins += Number(result.awayScore > result.homeScore);
    homeWins += Number(result.homeScore > result.awayScore);
    ties += Number(result.awayScore === result.homeScore);
  }
  const rounded = (value: number) => Math.round(value * 10) / 10;
  first.ensemble = {
    runs,
    awayWinPct: rounded(awayWins / runs * 100),
    homeWinPct: rounded(homeWins / runs * 100),
    tiePct: rounded(ties / runs * 100),
    fantasy: values.map(points => {
      points.sort((a, b) => a - b);
      return {
        mean: rounded(points.reduce((sum, value) => sum + value, 0) / runs),
        p10: points[Math.floor((runs - 1) * 0.1)]!,
        p90: points[Math.floor((runs - 1) * 0.9)]!,
      };
    }),
  };
  return first;
}