import { AVAILABILITY_COUNTS, AVAILABILITY_RATE_SOURCE, type RatedDesignation, type RatedPosition } from './availability-rates';

/**
 * Pure distribution math for simulated DraftKings outcomes. Everything here is CALCULATED from the
 * simulation's own samples (plus, for availability, published historical base rates). Nothing is
 * observed game data and nothing is filled in when an input is missing.
 */

export interface DistributionSummary {
  mean: number; median: number; p10: number; p75: number; p90: number; p95: number;
  /** Standard error of the mean from Monte Carlo sampling (0 for a degenerate or weighted-by-one sample). */
  meanStdError: number;
  /** Number of simulated games behind the summary. */
  samples: number;
  /** Score below which the outcome is counted as a bust, in DraftKings points. */
  bustThreshold?: number;
  /** Probability of scoring strictly below `bustThreshold`, 0–1. */
  bustProbability?: number;
}

/** Position floors, in DraftKings Classic points, used to count a "bust". Heuristic, editable, not validated. */
export const BUST_FLOOR_POINTS: Record<RatedPosition | 'DST', number> = { QB: 12, RB: 6, WR: 6, TE: 4, DST: 2 };

const rounded = (value: number, places = 2) => { const f = 10 ** places; return Math.round(value * f) / f; };

function normalized(points: number[], weights?: number[]) {
  if (!points.length) throw new Error('A distribution needs at least one simulated outcome.');
  if (weights && weights.length !== points.length) throw new Error('Weights must match the simulated outcomes.');
  if (points.some(p => !Number.isFinite(p))) throw new Error('Simulated points must be finite.');
  const raw = weights ?? points.map(() => 1);
  if (raw.some(w => !Number.isFinite(w) || w < 0)) throw new Error('Weights must be finite and non-negative.');
  const total = raw.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) throw new Error('Weights must sum to a positive number.');
  return points.map((value, i) => ({ value, weight: raw[i]! / total })).sort((a, b) => a.value - b.value);
}
type Items = ReturnType<typeof normalized>;

/** Nearest-rank quantile: the smallest outcome whose cumulative weight reaches `q`. */
function quantile(items: Items, q: number): number {
  let cumulative = 0;
  for (const item of items) {
    cumulative += item.weight;
    if (cumulative >= q - 1e-12) return item.value;
  }
  return items[items.length - 1]!.value;
}

function summarize(items: Items, samples: number, bustBelow?: number): DistributionSummary {
  const mean = items.reduce((sum, i) => sum + i.value * i.weight, 0);
  const variance = items.reduce((sum, i) => sum + i.weight * (i.value - mean) ** 2, 0);
  // Kish effective sample size keeps the standard error honest when outcomes are re-weighted.
  const effective = 1 / items.reduce((sum, i) => sum + i.weight ** 2, 0);
  return {
    mean: rounded(mean), median: quantile(items, 0.5), p10: quantile(items, 0.1), p75: quantile(items, 0.75),
    p90: quantile(items, 0.9), p95: quantile(items, 0.95),
    meanStdError: rounded(Math.sqrt(variance / Math.max(1, effective)), 3), samples,
    ...(bustBelow === undefined ? {} : {
      bustThreshold: bustBelow,
      bustProbability: rounded(items.reduce((sum, i) => sum + (i.value < bustBelow ? i.weight : 0), 0), 4),
    }),
  };
}

/** Mean, median, P10/P75/P90/P95 and bust probability of simulated points (optionally outcome-weighted). */
export function summarizeDistribution(points: number[], weights?: number[], bustBelow?: number): DistributionSummary {
  return summarize(normalized(points, weights), points.length, bustBelow);
}

/** Probability of a player appearing, from published historical base rates. Undefined when the sample is too small. */
export interface PlayProbability { probability: number; n: number; played: number; source: string }
const MIN_RATE_SAMPLE = 30;
export function historicalPlayProbability(designation: string, position: string): PlayProbability | undefined {
  const row = (AVAILABILITY_COUNTS as Record<string, Record<string, { n: number; played: number }> | undefined>)[designation]?.[position];
  if (!row || row.n < MIN_RATE_SAMPLE) return undefined;
  return { probability: row.played / row.n, n: row.n, played: row.played, source: AVAILABILITY_RATE_SOURCE };
}
export const isRatedDesignation = (value: string): value is RatedDesignation => value in AVAILABILITY_COUNTS;

/**
 * Availability-adjusted distribution: with probability `play` the player scores like the simulated
 * games ("if active"); otherwise he does not appear and scores 0 DraftKings points.
 */
export function availabilityAdjustedDistribution(points: number[], weights: number[] | undefined, play: number, bustBelow?: number): DistributionSummary {
  if (!Number.isFinite(play) || play < 0 || play > 1) throw new Error('Play probability must be between 0 and 1.');
  const items = normalized(points, weights).map(i => ({ value: i.value, weight: i.weight * play }));
  if (play < 1) items.unshift({ value: 0, weight: 1 - play });
  // re-sort: zero-point mass belongs in order with the simulated values
  items.sort((a, b) => a.value - b.value);
  return summarize(items, points.length, bustBelow);
}

/** Weighted Pearson correlation. Undefined for fewer than 3 outcomes or a constant series. */
export function weightedCorrelation(x: number[], y: number[], weights?: number[]): number | undefined {
  if (x.length !== y.length || x.length < 3) return undefined;
  const raw = weights ?? x.map(() => 1);
  const total = raw.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return undefined;
  const w = raw.map(v => v / total);
  const mx = x.reduce((s, v, i) => s + v * w[i]!, 0), my = y.reduce((s, v, i) => s + v * w[i]!, 0);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx, dy = y[i]! - my;
    sxy += w[i]! * dx * dy; sxx += w[i]! * dx * dx; syy += w[i]! * dy * dy;
  }
  if (sxx <= 1e-12 || syy <= 1e-12) return undefined;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** Per-player report stored beside the legacy mean/P10/P90. `basis` marks it as calculated, not observed. */
export interface PlayerDistributionReport extends DistributionSummary {
  basis: 'simulated';
  /** Present only for a verified Questionable/Limited/Doubtful/Out designation with enough historical sample. */
  availability?: {
    status: string; statusBasis: 'weekly override' | 'saved roster'; checkedAt?: string;
    playProbability: number; sample: { n: number; played: number }; rateSource: string;
    /** Distribution including the chance the player does not appear (0 points). The main summary is "if active". */
    adjusted: DistributionSummary;
  };
}

export type CorrelationKind = 'qb-pass-catcher' | 'qb-rb' | 'rb-pass-catcher' | 'opposing';
export interface PlayerCorrelation { a: number; b: number; r: number; kind: CorrelationKind }
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);

/**
 * Correlations measured across the simulated games for the pairs a stacking decision needs:
 * a QB with his own receivers and backs, a back with his own receivers, and players on opposite
 * teams. They emerge from the simulator's shared game script; they are NOT fitted to historical data.
 * `a`/`b` index into the `players` array.
 */
export function pairCorrelations(
  players: { team: string; position: string }[], series: number[][], weights?: number[],
): PlayerCorrelation[] {
  if (players.length !== series.length) throw new Error('One outcome series is required per player.');
  const out: PlayerCorrelation[] = [];
  const push = (a: number, b: number, kind: CorrelationKind) => {
    const r = weightedCorrelation(series[a]!, series[b]!, weights);
    if (r !== undefined) out.push({ a, b, r: rounded(r, 3), kind });
  };
  for (let a = 0; a < players.length; a++) {
    const pa = players[a]!;
    if (!SKILL.has(pa.position)) continue;
    for (let b = a + 1; b < players.length; b++) {
      const pb = players[b]!;
      if (!SKILL.has(pb.position)) continue;
      const same = pa.team === pb.team;
      const positions = [pa.position, pb.position].sort().join('+');
      if (!same) {
        // Opposing pairs: only the pairs that matter for game-environment stacks (a QB, or two pass catchers).
        if (pa.position === 'QB' || pb.position === 'QB' || (['WR', 'TE'].includes(pa.position) && ['WR', 'TE'].includes(pb.position))) push(a, b, 'opposing');
      } else if (pa.position === 'QB' || pb.position === 'QB') {
        const other = pa.position === 'QB' ? pb.position : pa.position;
        if (other === 'QB') continue; // two QBs on one team are alternatives, not a stack
        push(a, b, other === 'RB' ? 'qb-rb' : 'qb-pass-catcher');
      } else if (positions === 'RB+TE' || positions === 'RB+WR') push(a, b, 'rb-pass-catcher');
    }
  }
  return out;
}
