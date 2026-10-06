import type { PossessionPlay } from '../../artifacts/gridiron-sim/src/lib/possession-drive';

export const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export const interval = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: mean(values), p10: sorted[Math.floor((sorted.length - 1) * 0.1)]!,
    p90: sorted[Math.floor((sorted.length - 1) * 0.9)]! };
};
export const covered = (forecast: ReturnType<typeof interval>, actual: number) => actual >= forecast.p10 && actual <= forecast.p90;

/** Match nfl-passing-depth denominators: no sacks, scrambles or rushes.
 * Baseline depth/YAC are unknown, not inferred from completed gain. */
export function passCounters() {
  return { attempts: 0, completions: 0, depthKnown: 0,
    intermediateAttempts: 0, intermediateCompletions: 0, deepAttempts: 0, deepCompletions: 0,
    explosiveSamples: 0, explosives: 0, yacSamples: 0, yac: 0, yac5Plus: 0, yac10Plus: 0 };
}
export function recordPlay(c: ReturnType<typeof passCounters>, p: Readonly<PossessionPlay>) {
  if (p.kind !== 'pass') return;
  c.attempts++; c.completions += Number(p.completed);
  c.explosiveSamples++; c.explosives += Number(p.gain >= 15);
  if (p.airYards !== undefined) {
    c.depthKnown++;
    if (p.airYards >= 20) { c.deepAttempts++; c.deepCompletions += Number(p.completed); }
    else if (p.airYards >= 10) { c.intermediateAttempts++; c.intermediateCompletions += Number(p.completed); }
  }
  if (p.completed && p.yardsAfterCatch !== undefined) {
    c.yacSamples++; c.yac += p.yardsAfterCatch;
    c.yac5Plus += Number(p.yardsAfterCatch >= 5); c.yac10Plus += Number(p.yardsAfterCatch >= 10);
  }
}
export function passMetrics(c: ReturnType<typeof passCounters>) {
  return {
    attempts: c.attempts, completions: c.completions as number | null, depthKnown: c.depthKnown,
    intermediateAttempts: c.depthKnown ? c.intermediateAttempts : null,
    intermediateCompletions: c.depthKnown ? c.intermediateCompletions : null,
    deepAttempts: c.depthKnown ? c.deepAttempts : null,
    deepCompletions: c.depthKnown ? c.deepCompletions : null,
    intermediateCompletionRate: c.intermediateAttempts ? c.intermediateCompletions / c.intermediateAttempts : null,
    deepCompletionRate: c.deepAttempts ? c.deepCompletions / c.deepAttempts : null,
    passing15PlusSamples: c.explosiveSamples,
    passing15PlusRate: c.explosiveSamples ? c.explosives / c.explosiveSamples : null,
    yacSamples: c.yacSamples,
    yacMean: c.yacSamples ? c.yac / c.yacSamples : null,
    yac5PlusFrequency: c.yacSamples ? c.yac5Plus / c.yacSamples : null,
    yac10PlusFrequency: c.yacSamples ? c.yac10Plus / c.yacSamples : null,
  };
}
export type PassMetrics = ReturnType<typeof passMetrics>;
export type MetricRow = { gameId: string; baseline: number; secondary: number; actual: number;
  baselineCovered?: boolean; secondaryCovered?: boolean };

/** Game-balanced descriptive losses; simulation outcomes never count as games. */
export function summarizeMetrics(rows: MetricRow[]) {
  if (!rows.length) return null;
  const games = [...new Set(rows.map(r => r.gameId))];
  const gameMean = (f: (r: MetricRow) => number) => mean(games.map(id => mean(rows.filter(r => r.gameId === id).map(f))!));
  const differences = games.map(id => mean(rows.filter(r => r.gameId === id).map(r =>
    Math.abs(r.secondary - r.actual) - Math.abs(r.baseline - r.actual)))!);
  let state = 20261006;
  const boot = games.length < 2 ? [] : Array.from({ length: 2000 }, () => mean(differences.map(() => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return differences[Math.floor(state / 4294967296 * differences.length)]!;
  }))!).sort((a, b) => a - b);
  return {
    observations: rows.length, games: games.length,
    baselineMAE: gameMean(r => Math.abs(r.baseline - r.actual)),
    secondaryMAE: gameMean(r => Math.abs(r.secondary - r.actual)),
    baselineRMSE: Math.sqrt(gameMean(r => (r.baseline - r.actual) ** 2)!),
    secondaryRMSE: Math.sqrt(gameMean(r => (r.secondary - r.actual) ** 2)!),
    secondaryMinusBaselineMAE: gameMean(r => Math.abs(r.secondary - r.actual) - Math.abs(r.baseline - r.actual)),
    descriptiveGameBootstrap95: boot.length ? [boot[49], boot[1949]] : null,
    baselineBias: gameMean(r => r.baseline - r.actual),
    secondaryBias: gameMean(r => r.secondary - r.actual),
    baselineP10P90Coverage: rows.every(r => r.baselineCovered !== undefined) ? gameMean(r => Number(r.baselineCovered)) : null,
    secondaryP10P90Coverage: rows.every(r => r.secondaryCovered !== undefined) ? gameMean(r => Number(r.secondaryCovered)) : null,
  };
}
export function summarizeDiagnostic(rows: { gameId: string; predicted: number; actual: number }[]) {
  if (!rows.length) return null;
  const games = [...new Set(rows.map(r => r.gameId))];
  const balanced = (f: (r: typeof rows[number]) => number) => mean(games.map(id => mean(rows.filter(r => r.gameId === id).map(f))!));
  return { observations: rows.length, games: games.length, predictedMean: balanced(r => r.predicted),
    observedMean: balanced(r => r.actual), MAE: balanced(r => Math.abs(r.predicted - r.actual)), bias: balanced(r => r.predicted - r.actual) };
}
