import { lineupSlots, type Lineup, type LineupPlayer } from './lineups';
import { replayLineupScenarios, seededRandom, summarizeLineup, type JointScenarios } from './lineup-scenarios';
import { generateRandomManualLineups } from './random-manual-lineups';
import type { DKSlate } from './draftkings-board';

/**
 * Projection-based portfolio of Classic lineups ("My Picks from projections").
 *
 * Method (honest summary, also in docs/projection-lineups.md):
 * 1. Replay the frozen forecasts into joint fantasy-point scenarios (same-game players
 *    share one simulated game; different games are independent).
 * 2. For many scenarios, find a high-scoring legal lineup for THAT scenario with a
 *    multi-start local search (single swaps plus QB-and-pass-catcher swaps). This is a
 *    heuristic: it is NOT a proven optimum, but it is fast and produces correlated stacks
 *    wherever the scenarios reward them.
 * 3. Score every distinct candidate on a second, independent set of scenarios, then pick
 *    the portfolio greedily by upside (90th percentile) with player-exposure and
 *    lineup-overlap limits.
 * Selected players are options, not locks. Salary is only a cap. Nothing here guarantees winnings.
 */
export interface ProjectionLineupOptions {
  count?: number;
  /** Largest share of lineups any one player may appear in (0–1). Raised automatically when a position has too few candidates. */
  maxExposure?: number;
  /** Most players two lineups may share. Relaxed one step at a time if the portfolio cannot be filled. */
  maxOverlap?: number;
  /** Scenarios used to propose candidates (not the count scored for reporting). */
  proposalScenarios?: number;
  seed?: number;
}
export interface ProjectionPortfolio {
  lineups: Lineup[];
  requested: number;
  candidates: number;
  scenarios: number;
  maxExposureUsed: number;
  overlapUsed: number;
  notes: string[];
  exposure: { id: string; name: string; position: string; team: string; lineups: number; share: number }[];
}

const CAP = 50000;
const MIN: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1 };
const MAX: Record<string, number> = { QB: 1, RB: 3, WR: 4, TE: 2, DST: 1 };
const POSITIONS = Object.keys(MIN);
const round = (value: number) => Math.round(value * 100) / 100;
const identity = (players: { id: string }[]) => players.map(p => p.id).sort().join(',');

function validatePool(players: LineupPlayer[]) {
  const ids = new Set<string>(), names = new Set<string>();
  for (const player of players) {
    const name = `${player.team}:${player.name.toLowerCase()}`;
    if (ids.has(player.id) || names.has(name) || !POSITIONS.includes(player.position) || !Number.isFinite(player.mean)
      || !Number.isSafeInteger(player.salary) || player.salary <= 0 || player.salary > CAP || !player.gameId) {
      throw new Error('Invalid or duplicate player in the projection pool.');
    }
    ids.add(player.id); names.add(name);
  }
}

/** Counts are legal for Classic when QB/DST are exact and exactly one RB/WR/TE fills FLEX. */
function legalShape(counts: Record<string, number>) {
  return counts.QB === 1 && counts.DST === 1 && counts.RB! >= 2 && counts.RB! <= 3 && counts.WR! >= 3 && counts.WR! <= 4
    && counts.TE! >= 1 && counts.TE! <= 2 && counts.RB! - 2 + counts.WR! - 3 + counts.TE! - 1 === 1;
}

/** Best legal lineup found for one scenario's point values, starting from several legal rosters. */
function climb(start: number[], pool: LineupPlayer[], points: Float64Array, byTeamReceivers: Map<string, number[]>, qbs: number[]): number[] {
  const chosen = [...start];
  const inSet = new Set(chosen);
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  let salary = 0;
  for (const i of chosen) { counts[pool[i]!.position]!++; salary += pool[i]!.salary; }
  const gamesOf = (set: number[]) => new Set(set.map(i => pool[i]!.gameId)).size;
  for (let pass = 0; pass < 60; pass++) {
    let bestGain = 1e-9, best: number[] | null = null;
    // Single swaps.
    for (let slot = 0; slot < 9; slot++) {
      const out = chosen[slot]!;
      for (let incoming = 0; incoming < pool.length; incoming++) {
        if (inSet.has(incoming)) continue;
        const gain = points[incoming]! - points[out]!;
        if (gain <= bestGain) continue;
        const next = pool[incoming]!, old = pool[out]!;
        if (salary - old.salary + next.salary > CAP) continue;
        const shape = { ...counts }; shape[old.position]!--; shape[next.position]!++;
        if (!legalShape(shape)) continue;
        const candidate = [...chosen]; candidate[slot] = incoming;
        if (gamesOf(candidate) < 2) continue;
        bestGain = gain; best = candidate;
      }
    }
    // QB swap that moves a same-team pass catcher with it, so stacks can form or change.
    for (const qb of qbs) {
      if (inSet.has(qb)) continue;
      const qbSlot = chosen.findIndex(i => pool[i]!.position === 'QB');
      for (let slot = 0; slot < 9; slot++) {
        if (slot === qbSlot || !['WR', 'TE'].includes(pool[chosen[slot]!]!.position)) continue;
        for (const receiver of byTeamReceivers.get(pool[qb]!.team) ?? []) {
          if (inSet.has(receiver)) continue;
          const oldQb = chosen[qbSlot]!, oldRx = chosen[slot]!;
          const gain = points[qb]! + points[receiver]! - points[oldQb]! - points[oldRx]!;
          if (gain <= bestGain) continue;
          const nextSalary = salary - pool[oldQb]!.salary - pool[oldRx]!.salary + pool[qb]!.salary + pool[receiver]!.salary;
          if (nextSalary > CAP) continue;
          const shape = { ...counts }; shape[pool[oldRx]!.position]!--; shape[pool[receiver]!.position]!++;
          if (!legalShape(shape)) continue;
          const candidate = [...chosen]; candidate[qbSlot] = qb; candidate[slot] = receiver;
          if (gamesOf(candidate) < 2) continue;
          bestGain = gain; best = candidate;
        }
      }
    }
    if (!best) break;
    chosen.splice(0, 9, ...best);
    inSet.clear(); chosen.forEach(i => inSet.add(i));
    counts.QB = counts.RB = counts.WR = counts.TE = counts.DST = 0; salary = 0;
    for (const i of chosen) { counts[pool[i]!.position]!++; salary += pool[i]!.salary; }
  }
  return chosen;
}

/** Core generator. Takes already-built joint scenarios so it can be tested without a forecast slate. */
export function buildProjectionPortfolio(players: LineupPlayer[], scenarios: JointScenarios, options: ProjectionLineupOptions = {}): ProjectionPortfolio {
  const count = options.count ?? 150;
  if (!Number.isInteger(count) || count < 1 || count > 150) throw new Error('Choose 1–150 lineups.');
  const maxExposure = options.maxExposure ?? 0.6;
  if (!(maxExposure > 0 && maxExposure <= 1)) throw new Error('Maximum exposure must be above 0 and at most 100%.');
  validatePool(players);
  const notes: string[] = [];
  const empty = (message: string): ProjectionPortfolio => ({ lineups: [], requested: count, candidates: 0, scenarios: scenarios.count,
    maxExposureUsed: maxExposure, overlapUsed: options.maxOverlap ?? 7, notes: [message], exposure: [] });
  const byPosition = new Map(POSITIONS.map(position => [position, players.filter(p => p.position === position)]));
  if (POSITIONS.some(position => byPosition.get(position)!.length < MIN[position]!)) return empty('The selected players do not cover every Classic position.');
  if (new Set(players.map(p => p.gameId)).size < 2) return empty('Select players from at least two games.');
  for (const player of players) {
    const values = scenarios.samples.get(player.id);
    if (!values || values.length !== scenarios.count) throw new Error(`${player.name} has no simulated outcomes. Run and save its game forecast first.`);
  }

  const random = seededRandom((options.seed ?? 20260101) >>> 0);
  const proposals = Math.min(options.proposalScenarios ?? 700, scenarios.count);
  const qbs = players.map((p, i) => p.position === 'QB' ? i : -1).filter(i => i >= 0);
  const byTeamReceivers = new Map<string, number[]>();
  players.forEach((p, i) => { if (p.position === 'WR' || p.position === 'TE') byTeamReceivers.set(p.team, [...(byTeamReceivers.get(p.team) ?? []), i]); });

  // Legal random starting rosters (salary only), reused across scenarios.
  const starts = generateRandomManualLineups(players, Math.min(150, Math.max(20, count)), random)
    .map(lineup => lineup.players.map(p => players.findIndex(q => q.id === p.id)));
  if (!starts.length) return empty('No legal Classic lineup fits $50,000 with these players across two games.');

  const columns = players.map(p => scenarios.samples.get(p.id)!);
  const found = new Map<string, { indices: number[]; hits: number }>();
  const points = new Float64Array(players.length);
  const order = Array.from({ length: scenarios.count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
  for (let n = 0; n < proposals; n++) {
    const s = order[n]!;
    for (let i = 0; i < players.length; i++) points[i] = columns[i]![s]!;
    let best: number[] | null = null, bestValue = -Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = climb(starts[Math.floor(random() * starts.length)]!, players, points, byTeamReceivers, qbs);
      const value = result.reduce((sum, i) => sum + points[i]!, 0);
      if (value > bestValue) { bestValue = value; best = result; }
    }
    const key = identity(best!.map(i => players[i]!));
    const entry = found.get(key);
    if (entry) entry.hits++; else found.set(key, { indices: [...best!].sort((a, b) => a - b), hits: 1 });
  }

  // Score each distinct candidate on independent reporting scenarios.
  const reporting = scenarios.reporting ?? scenarios;
  const scored = [...found.values()].map(entry => {
    const lineupPlayers = entry.indices.map(i => players[i]!);
    const lineup: Lineup = { players: lineupPlayers, salary: lineupPlayers.reduce((n, p) => n + p.salary, 0), points: lineupPlayers.reduce((n, p) => n + p.mean, 0) };
    lineupSlots(lineup);
    const summary = summarizeLineup(lineupPlayers, reporting);
    return { lineup, hits: entry.hits, summary };
  }).sort((a, b) => b.summary.p90 - a.summary.p90 || b.lineup.points - a.lineup.points || b.hits - a.hits
    || identity(a.lineup.players).localeCompare(identity(b.lineup.players)));

  // Exposure caps cannot be below what mandatory positions need (one QB candidate means 100% QB).
  const positionNeed = (position: string) => Math.ceil(count * MIN[position]! / byPosition.get(position)!.length);
  const capFor = (player: LineupPlayer) => Math.min(count, Math.max(Math.ceil(maxExposure * count), positionNeed(player.position)));
  const usage = new Map<string, number>();
  const chosen: typeof scored = [];
  const taken = new Set<string>();
  let overlap = options.maxOverlap ?? 7;
  const startOverlap = overlap;
  while (chosen.length < count && overlap <= 8) {
    for (const candidate of scored) {
      if (chosen.length === count) break;
      const key = identity(candidate.lineup.players);
      if (taken.has(key)) continue;
      if (candidate.lineup.players.some(p => (usage.get(p.id) ?? 0) >= capFor(p))) continue;
      const ids = new Set(candidate.lineup.players.map(p => p.id));
      if (chosen.some(other => other.lineup.players.filter(p => ids.has(p.id)).length > overlap)) continue;
      chosen.push(candidate); taken.add(key);
      candidate.lineup.players.forEach(p => usage.set(p.id, (usage.get(p.id) ?? 0) + 1));
    }
    if (chosen.length < count) overlap++;
  }
  const overlapUsed = Math.min(overlap, 8);
  if (overlapUsed > startOverlap) notes.push(`Lineups may share up to ${overlapUsed} players because the pool was too small for ${startOverlap}.`);
  if (chosen.length < count) notes.push(`Only ${chosen.length} distinct lineups met the exposure and overlap limits. Select more players (especially at positions with few options) or raise the exposure limit.`);
  const exposureCapped = players.some(p => capFor(p) > Math.ceil(maxExposure * count));
  if (exposureCapped) notes.push('Some positions have so few selected players that their exposure had to exceed your limit.');

  const lineups: Lineup[] = chosen.map(({ lineup, summary }) => ({
    ...lineup,
    tournament: { p10: round(summary.p10), p90: round(summary.p90), simulatedMean: round(summary.simulatedMean), chance220: round(summary.chance220),
      scenarios: summary.scenarios, candidates: found.size, stackNames: stackNames(lineup.players) },
  }));
  const exposure = players.filter(p => usage.has(p.id)).map(p => ({
    id: p.id, name: p.name, position: p.position, team: p.team, lineups: usage.get(p.id)!, share: round(usage.get(p.id)! / Math.max(1, chosen.length)),
  })).sort((a, b) => b.lineups - a.lineups || a.name.localeCompare(b.name));
  return { lineups, requested: count, candidates: found.size, scenarios: scenarios.count, maxExposureUsed: maxExposure, overlapUsed, notes, exposure };
}

function stackNames(players: LineupPlayer[]) {
  const qb = players.find(p => p.position === 'QB');
  return qb ? players.filter(p => p.team === qb.team && ['WR', 'TE'].includes(p.position)).map(p => p.name) : [];
}

/** Replays the frozen forecasts, then builds the portfolio. Every player's game needs a saved forecast. */
export function generateProjectionLineups(players: LineupPlayer[], slate: DKSlate, options: ProjectionLineupOptions = {}): ProjectionPortfolio {
  validatePool(players);
  const scenarios = replayLineupScenarios(players, slate, 1500);
  return buildProjectionPortfolio(players, scenarios, options);
}

/** Merge several saved slates (Sunday board and Game Simulator runs) into one lookup. Newest save wins per game. */
export function combineForecastSlates(slates: DKSlate[], season: number): DKSlate {
  const newest = new Map<string, { forecast: DKSlate['forecasts'][number]; savedAt: number }>();
  for (const slate of slates) {
    if (slate.season !== season) continue;
    const savedAt = Date.parse(slate.savedAt ?? slate.createdAt) || 0;
    for (const forecast of slate.forecasts) {
      const existing = newest.get(forecast.gameId);
      if (!existing || savedAt > existing.savedAt) newest.set(forecast.gameId, { forecast, savedAt });
    }
  }
  return { id: `combined:${season}`, season, sunday: 'All saved forecasts', timezone: 'America/Chicago',
    createdAt: new Date(0).toISOString(), forecasts: [...newest.values()].map(entry => entry.forecast), failures: [] };
}
