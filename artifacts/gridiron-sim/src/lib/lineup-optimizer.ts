import { lineupSlots, type Lineup, type LineupPlayer } from './lineups';

interface Candidate extends Lineup { counts: number[]; coverage: string }
const positions = ['QB', 'RB', 'WR', 'TE', 'DST'];
const max = [1, 3, 4, 2, 1], min = [1, 2, 3, 1, 1], weights = [1, 2, 8, 40, 120];
const compare = (a: Lineup, b: Lineup) => (Math.abs(b.points - a.points) > 1e-9 ? b.points - a.points : 0) || a.salary - b.salary
  || a.players.map(p => p.id).sort().join(',').localeCompare(b.players.map(p => p.id).sort().join(','));
const stateCode = (counts: number[]) => counts.reduce((n, count, i) => n + count * weights[i]!, 0);
const stateKey = (candidate: Candidate) => `${stateCode(candidate.counts)}|${candidate.coverage}|${candidate.salary}`;
function prune(states: Map<string, Candidate[]>, count: number) {
  const groups = new Map<string, Candidate[][]>();
  for (const [key, paths] of states) {
    const group = key.slice(0, key.lastIndexOf('|'));
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(paths);
  }
  const result = new Map<string, Candidate[]>();
  for (const costs of groups.values()) {
    costs.sort((a, b) => a[0]!.salary - b[0]!.salary);
    let best: Candidate[] = [];
    for (const paths of costs) {
      const keep = paths.filter(path => best.length < count || compare(path, best[count - 1]!) < 0);
      if (keep.length) result.set(stateKey(keep[0]!), keep);
      best = [...best, ...paths].sort(compare).slice(0, count);
    }
  }
  return result;
}

/** Exact top-K 0/1 dynamic programming. Dominance pruning retains K superior,
 * cheaper prefixes with identical slots/game coverage; no heuristic player cutoff. */
export function optimizeLineups(players: LineupPlayer[], count = 3): Lineup[] {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Choose 1–5 lineups.');
  const ids = new Set<string>(), identities = new Set<string>();
  for (const player of players) {
    const identity = `${player.team}:${player.name.toLowerCase()}`;
    if (ids.has(player.id) || identities.has(identity) || !positions.includes(player.position)
      || !Number.isFinite(player.mean) || !Number.isSafeInteger(player.salary) || player.salary <= 0 || player.salary > 50000
      || !player.gameId) throw new Error('Invalid or duplicate optimizer player.');
    ids.add(player.id); identities.add(identity);
  }
  let states = new Map<string, Candidate[]>();
  const empty: Candidate = { players: [], salary: 0, points: 0, counts: [0, 0, 0, 0, 0], coverage: '' };
  states.set(stateKey(empty), [empty]);
  const sorted = [...players].sort((a, b) => positions.indexOf(a.position) - positions.indexOf(b.position) || b.mean - a.mean || a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++) {
    const player = sorted[i]!, position = positions.indexOf(player.position);
    for (const [, paths] of [...states]) {
      for (const path of paths) {
        if (path.counts[position]! >= max[position]! || path.players.length >= 9 || path.salary + player.salary > 50000) continue;
        const counts = [...path.counts]; counts[position]!++;
        if (Math.max(0, counts[1]! - 2) + Math.max(0, counts[2]! - 3) + Math.max(0, counts[3]! - 1) > 1) continue;
        const next: Candidate = { players: [...path.players, player], salary: path.salary + player.salary, points: path.points + player.mean, counts,
          coverage: !path.coverage ? player.gameId : path.coverage === player.gameId ? path.coverage : '*' };
        const key = stateKey(next), existing = states.get(key) ?? [];
        if (existing.length === count && compare(next, existing[count - 1]!) >= 0) continue;
        states.set(key, [...existing, next].sort(compare).slice(0, count));
      }
    }
    if (i % 8 === 7 || i === sorted.length - 1) states = prune(states, count);
    if (states.size > 750000) throw new Error('This pool exceeds the exact optimizer memory limit. No approximate lineup was returned.');
  }
  const results = [...states.values()].flat().filter(path => path.players.length === 9 && path.coverage === '*'
    && path.counts.every((n, i) => n >= min[i]!)).sort(compare).slice(0, count)
    .map(({ players, salary, points }) => ({ players, salary, points }));
  results.forEach(lineupSlots);
  return results;
}