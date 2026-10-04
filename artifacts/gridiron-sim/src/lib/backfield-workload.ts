export interface BackfieldEvidence {
  rushAttempts: number;
  rushYards: number;
  receivingCatches: number;
  receivingYards: number;
}

/** One role-prior game, then observed workload. No fixed minimum tied to RB rank.
 * The upper bound still protects against a deep backup's old starter stint.
 * These are heuristic opportunity weights, not calibrated fantasy-point targets. */
export function backfieldOpportunityWeight(prior: number, reported: number | undefined, games: number): number {
  if (reported === undefined || games <= 0) return prior;
  return Math.max(0, Math.min(prior * 1.75, (prior + reported * games) / (games + 1)));
}

/** Leading the rushing depth chart is not evidence of leading receiving work. */
export function backfieldReceivingPrior(rank: number): number {
  return rank <= 2 ? 2 : 0.4 / Math.max(1, rank - 2);
}

/** Shrink paired observed efficiency by attempts/catches, not unrelated games.
 * Small samples retain explicit priors; absent fields are never invented zeroes. */
export function backfieldEfficiency(evidence: BackfieldEvidence | undefined, receiving: boolean): number {
  const attempts = receiving ? evidence?.receivingCatches : evidence?.rushAttempts;
  const yards = receiving ? evidence?.receivingYards : evidence?.rushYards;
  if (attempts === undefined || yards === undefined || attempts <= 0) return receiving ? 8 / 12 : 1;
  const prior = receiving ? 8 : 4.5;
  const pseudoAttempts = receiving ? 10 : 12;
  const efficiency = (prior * pseudoAttempts + yards) / (pseudoAttempts + attempts);
  return Math.max(0.35, Math.min(1.4, efficiency / (receiving ? 12 : 4.5)));
}