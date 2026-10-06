export interface HighScoringEvidence {
  increase: 0.2;
  baselineTotal: number;
  targetTotal: number;
  adjustedTotal: number;
  effectiveRuns: number;
  warnings: string[];
}

/**
 * Tilt complete simulated outcomes toward a 20% higher combined-score mean.
 * The same weights must be used for offense, defense and scoring summaries.
 * Never multiply fantasy points or manufacture yards/touchdowns.
 */
export function highScoringWeights(totals: number[], baseWeights: number[]): { weights: number[]; evidence: HighScoringEvidence } {
  if (totals.length < 20 || totals.length !== baseWeights.length
    || totals.some(n => !Number.isFinite(n) || n < 0)
    || baseWeights.some(n => !Number.isFinite(n) || n <= 0)) {
    throw new Error('High-scoring mode requires at least 20 complete, valid simulation outcomes.');
  }
  const sum = baseWeights.reduce((a, b) => a + b, 0);
  const base = baseWeights.map(w => w / sum);
  const mean = (weights: number[]) => totals.reduce((n, total, i) => n + total * weights[i]!, 0);
  const baselineTotal = mean(base);
  const targetTotal = baselineTotal * 1.2;
  const max = Math.max(...totals);
  const min = Math.min(...totals);
  const warnings = ['Manual high-scoring assumption, not a verified prediction or calibrated accuracy improvement. Player increases vary; some projections can decrease.'];
  const at = (lambda: number) => {
    const logs = totals.map((total, i) => Math.log(base[i]!) + lambda * (total - max));
    const largest = Math.max(...logs);
    const raw = logs.map(value => Math.exp(value - largest));
    const denominator = raw.reduce((a, b) => a + b, 0);
    return raw.map(w => w / denominator);
  };
  let weights = base;
  if (targetTotal > baselineTotal && max > min) {
    if (targetTotal >= max) {
      const mass = base.reduce((n, w, i) => n + (totals[i] === max ? w : 0), 0);
      weights = base.map((w, i) => totals[i] === max ? w / mass : 0);
    } else {
      let low = 0, high = 1;
      while (mean(at(high)) < targetTotal && high < 1024) high *= 2;
      for (let step = 0; step < 60; step++) {
        const middle = (low + high) / 2;
        if (mean(at(middle)) < targetTotal) low = middle;
        else high = middle;
      }
      weights = at((low + high) / 2);
    }
  }
  const adjustedTotal = mean(weights);
  if (targetTotal > max || (max === min && targetTotal > baselineTotal)) {
    warnings.push('The generated outcomes cannot reach the full +20% target. The actual adjusted total is shown; no extra points were invented.');
  }
  const effectiveRuns = 1 / weights.reduce((n, w) => n + w * w, 0);
  if (effectiveRuns < totals.length * 0.6) warnings.push('High-scoring weighting concentrates on fewer outcomes; projections are less robust.');
  return { weights, evidence: { increase: 0.2, baselineTotal, targetTotal, adjustedTotal, effectiveRuns, warnings } };
}
