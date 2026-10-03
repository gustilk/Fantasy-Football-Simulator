export interface Forecast {
  total: number;
  margin: number; // home minus away
  probabilities: [number, number, number]; // away win, home win, tie
}

export interface ScoredForecast {
  prediction: Forecast;
  actual: { away: number; home: number };
}

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function losses(row: ScoredForecast) {
  const actual = row.actual;
  const total = row.prediction.total - actual.home - actual.away;
  const margin = row.prediction.margin - (actual.home - actual.away);
  const result = actual.away > actual.home ? 0 : actual.home > actual.away ? 1 : 2;
  return {
    totalAbsolute: Math.abs(total), totalSquared: total ** 2,
    marginAbsolute: Math.abs(margin), marginSquared: margin ** 2,
    homeBrier: (row.prediction.probabilities[1] - Number(result === 1)) ** 2,
    multiclassBrier: row.prediction.probabilities.reduce((sum, p, i) => sum + (p - Number(result === i)) ** 2, 0),
  };
}

export function summarizeForecasts(rows: ScoredForecast[]) {
  if (!rows.length) return null;
  const errors = rows.map(losses);
  return {
    games: rows.length,
    totalMAE: mean(errors.map(row => row.totalAbsolute)),
    totalRMSE: Math.sqrt(mean(errors.map(row => row.totalSquared))!),
    marginMAE: mean(errors.map(row => row.marginAbsolute)),
    marginRMSE: Math.sqrt(mean(errors.map(row => row.marginSquared))!),
    homeWinBrier: mean(errors.map(row => row.homeBrier)),
    multiclassBrier: mean(errors.map(row => row.multiclassBrier)),
    observedTies: rows.filter(row => row.actual.home === row.actual.away).length,
    // Equal-width bins, including empty bins. Ties count as "home did not win".
    homeWinReliability: Array.from({ length: 10 }, (_, index) => {
      const bin = rows.filter(row => Math.min(9, Math.floor(row.prediction.probabilities[1] * 10)) === index);
      return {
        lower: index / 10, upper: (index + 1) / 10, games: bin.length,
        predictedHomeWin: mean(bin.map(row => row.prediction.probabilities[1])),
        observedHomeWin: mean(bin.map(row => Number(row.actual.home > row.actual.away))),
      };
    }),
  };
}

/** Descriptive paired bootstrap by GAME, never by Monte Carlo run or player. */
export function pairedDifferences(baseline: ScoredForecast[], weighted: ScoredForecast[]) {
  if (!baseline.length) return null;
  if (baseline.length !== weighted.length) throw new Error("Unpaired forecasts.");
  const before = baseline.map(losses), after = weighted.map(losses);
  const keys = Object.keys(before[0]!) as (keyof ReturnType<typeof losses>)[];
  let state = 20261003;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Object.fromEntries(keys.map(key => {
    const differences = before.map((row, i) => after[i]![key] - row[key]);
    const bootstrap = Array.from({ length: 2000 }, () =>
      mean(differences.map(() => differences[Math.floor(random() * differences.length)]!))!);
    bootstrap.sort((a, b) => a - b);
    return [key, {
      weightedMinusBaseline: mean(differences),
      descriptiveGameBootstrap95: differences.length < 2 ? null : [bootstrap[49], bootstrap[1949]],
    }];
  }));
}

export function summarizePlayerErrors(rows: { baseline: number; weighted: number; actual: number; gameId: string }[]) {
  if (!rows.length) return null;
  const summarize = (mode: "baseline" | "weighted") => ({
    MAE: mean(rows.map(row => Math.abs(row[mode] - row.actual))),
    RMSE: Math.sqrt(mean(rows.map(row => (row[mode] - row.actual) ** 2))!),
  });
  return {
    observedPlayerGames: rows.length, games: new Set(rows.map(row => row.gameId)).size,
    baseline: summarize("baseline"), weighted: summarize("weighted"),
    // Equal game weighting prevents games with more reported targets dominating.
    gameBalancedMAEDifference: mean([...new Set(rows.map(row => row.gameId))].map(gameId =>
      mean(rows.filter(row => row.gameId === gameId).map(row =>
        Math.abs(row.weighted - row.actual) - Math.abs(row.baseline - row.actual)))!)),
  };
}