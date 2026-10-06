import { simulateGame, type SimulationInput, type SimulationResult } from "./simulator";
import { validateMarketOdds, marketOutcomeWeights, weightedFantasySummary } from "./market-odds";
import { calculateDefenseDraftKings } from "./draftkings-defense";

export function simulateEnsemble(input: SimulationInput, runs = 200): SimulationResult {
  if (!Number.isInteger(runs) || runs < 1 || runs > 500) throw new Error("Use between 1 and 500 simulations.");
  const market = validateMarketOdds(input.market, input.away.name, input.home.name);
  if (market && runs < 20) throw new Error("Market blending needs at least 20 simulated games.");
  const first = simulateGame(input);
  const scores = [{ away: first.awayScore, home: first.homeScore }];
  const values = first.players.map(player => [player.draftKings]);
  const defenseValues = first.defenses!.map(defense => [calculateDefenseDraftKings(defense)]);
  const kickerValues = first.kickers?.map(kicker => [kicker.draftKings]);
  let awayWins = Number(first.awayScore > first.homeScore);
  let homeWins = Number(first.homeScore > first.awayScore);
  let ties = Number(first.awayScore === first.homeScore);
  for (let i = 1; i < runs; i++) {
    const result = simulateGame({ ...input, seed: (first.seed + Math.imul(i, 2654435761)) >>> 0 });
    scores.push({ away: result.awayScore, home: result.homeScore });
    result.players.forEach((player, index) => values[index]!.push(player.draftKings));
    result.defenses!.forEach((defense, index) => defenseValues[index]!.push(calculateDefenseDraftKings(defense)));
    result.kickers?.forEach((kicker, index) => kickerValues![index]!.push(kicker.draftKings));
    awayWins += Number(result.awayScore > result.homeScore);
    homeWins += Number(result.homeScore > result.awayScore);
    ties += Number(result.awayScore === result.homeScore);
  }
  const rounded = (value: number) => Math.round(value * 100) / 100;
  if (market) {
    const { weights, evidence } = marketOutcomeWeights(scores, market);
    const probability = (test: (score: typeof scores[number]) => boolean) =>
      rounded(scores.reduce((sum, score, index) => sum + (test(score) ? weights[index] : 0), 0) * 100);
    first.ensemble = {
      runs, market: evidence,
      awayWinPct: probability(score => score.away > score.home),
      homeWinPct: probability(score => score.home > score.away),
      tiePct: probability(score => score.away === score.home),
      fantasy: values.map(points => weightedFantasySummary(points, weights)),
      defenseFantasy: defenseValues.map((points, index) => ({ team: first.defenses![index]!.team, ...weightedFantasySummary(points, weights) })),
      ...(kickerValues ? { kickerFantasy: kickerValues.map((points, i) => ({ name: first.kickers![i]!.name, team: first.kickers![i]!.team, ...weightedFantasySummary(points, weights) })) } : {}),
    };
    first.overview.push(`Optional market weighting: home spread ${evidence.homeSpread > 0 ? '+' : ''}${evidence.homeSpread}, total ${evidence.total}. Market-implied scores: away ${evidence.implied.away}, home ${evidence.implied.home}. Ensemble summaries mix 65% original outcomes with 35% market-compatible outcomes; the displayed game is an unweighted example. This heuristic has not been accuracy-validated.`);
    evidence.warnings.forEach(warning => first.overview.push(`Market caution: ${warning}`));
    return first;
  }
  first.ensemble = {
    runs,
    scoring: (() => {
      const totals = scores.map(score => score.away + score.home).sort((a, b) => a - b);
      return {
        awayMean: rounded(scores.reduce((sum, score) => sum + score.away, 0) / runs),
        homeMean: rounded(scores.reduce((sum, score) => sum + score.home, 0) / runs),
        totalMean: rounded(totals.reduce((sum, score) => sum + score, 0) / runs),
        totalP10: totals[Math.floor((runs - 1) * 0.1)]!,
        totalP90: totals[Math.floor((runs - 1) * 0.9)]!,
      };
    })(),
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
    defenseFantasy: defenseValues.map((points, index) => ({ team: first.defenses![index]!.team, ...weightedFantasySummary(points, points.map(() => 1 / runs)) })),
    ...(kickerValues ? { kickerFantasy: kickerValues.map((points, i) => ({ name: first.kickers![i]!.name, team: first.kickers![i]!.team, ...weightedFantasySummary(points, points.map(() => 1 / runs)) })) } : {}),
  };
  return first;
}