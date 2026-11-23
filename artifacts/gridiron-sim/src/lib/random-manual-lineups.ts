import type { ManualSalaryCandidate, ManualSalaryLineup } from './manual-lineups';

const CAP = 50_000;
const FLEX_POSITIONS = ['RB', 'WR', 'TE'] as const;
type FlexPosition = typeof FLEX_POSITIONS[number];
type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'DST';

const randomIndex = (length: number, random: () => number) => {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Random source must return a number from 0 inclusive to 1 exclusive.');
  return Math.floor(value * length);
};

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function cheapestSalary(players: readonly ManualSalaryCandidate[], count: number): number {
  if (players.length < count) return Infinity;
  return players.map(p => p.salary).sort((a, b) => a - b).slice(0, count).reduce((sum, salary) => sum + salary, 0);
}

function createRandomLineup(
  playersByPosition: Map<Position, ManualSalaryCandidate[]>,
  flexPosition: FlexPosition,
  random: () => number,
): ManualSalaryCandidate[] | null {
  const needs: Record<Position, number> = { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1 };
  needs[flexPosition]++;
  const groups = shuffled((Object.keys(needs) as Position[])
    .filter(position => needs[position] > 0)
    .map(position => ({ position, count: needs[position], candidates: playersByPosition.get(position) ?? [] })), random)
    .sort((a, b) => a.candidates.length / a.count - b.candidates.length / b.count);
  if (groups.some(group => group.candidates.length < group.count)) return null;

  const futureMinimum = Array<number>(groups.length + 1).fill(0);
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!;
    futureMinimum[i] = futureMinimum[i + 1]! + cheapestSalary(group.candidates, group.count);
  }
  if (futureMinimum[0]! > CAP) return null;

  const selected: ManualSalaryCandidate[] = [];
  function chooseGroup(groupIndex: number, spent: number): ManualSalaryCandidate[] | null {
    if (groupIndex === groups.length) {
      return selected.length === 9 && new Set(selected.map(p => p.gameId)).size >= 2 ? [...selected] : null;
    }
    const group = groups[groupIndex]!;
    const order = shuffled(group.candidates, random);
    return chooseFromGroup(groupIndex, order, 0, group.count, spent);
  }

  function chooseFromGroup(
    groupIndex: number,
    order: ManualSalaryCandidate[],
    start: number,
    remaining: number,
    spent: number,
  ): ManualSalaryCandidate[] | null {
    if (remaining === 0) return chooseGroup(groupIndex + 1, spent);
    const lastStart = order.length - remaining;
    if (lastStart < start) return null;

    const indices = shuffled(Array.from({ length: lastStart - start + 1 }, (_, i) => start + i), random);
    for (const index of indices) {
      const player = order[index]!;
      const currentMinimum = cheapestSalary(order.slice(index + 1), remaining - 1);
      if (spent + player.salary + currentMinimum + futureMinimum[groupIndex + 1]! > CAP) continue;
      selected.push(player);
      const result = chooseFromGroup(groupIndex, order, index + 1, remaining - 1, spent + player.salary);
      if (result) return result;
      selected.pop();
    }
    return null;
  }

  return chooseGroup(0, 0);
}

function validatePool(players: ManualSalaryCandidate[]) {
  const ids = new Set<string>();
  const identities = new Set<string>();
  const games = new Set<string>();
  const grouped = new Map<Position, ManualSalaryCandidate[]>([
    ['QB', []], ['RB', []], ['WR', []], ['TE', []], ['DST', []],
  ]);
  for (const player of players) {
    const identity = `${player.team}:${player.name.toLowerCase()}`;
    if (!player.id || !player.name || ids.has(player.id) || identities.has(identity)
      || !grouped.has(player.position as Position) || !Number.isSafeInteger(player.salary)
      || player.salary < 1 || player.salary > CAP || !player.gameId
      || !Number.isFinite(Date.parse(player.kickoff)) || Date.parse(player.kickoff) <= Date.now()) {
      throw new Error('Invalid, duplicate, or started player in the salary pool.');
    }
    ids.add(player.id);
    identities.add(identity);
    games.add(player.gameId);
    grouped.get(player.position as Position)!.push(player);
  }
  return { grouped, games };
}

/**
 * Generate distinct, random legal Classic lineups. Salary is only a cap constraint;
 * the output carries no point estimates and is not ranked by salary or projection.
 */
export function generateRandomManualLineups(
  players: ManualSalaryCandidate[],
  count = 150,
  random: () => number = Math.random,
): ManualSalaryLineup[] {
  if (!Number.isInteger(count) || count < 1 || count > 150) throw new Error('Choose 1–150 lineups.');
  const { grouped, games } = validatePool(players);
  if (games.size < 2) return [];

  const results: ManualSalaryLineup[] = [];
  const seen = new Set<string>();
  let repeated = 0;
  const repeatLimit = Math.max(3000, count * 20);
  const maxAttempts = Math.max(6000, count * 2500);
  const flexOptions: FlexPosition[] = [...FLEX_POSITIONS];

  for (let attempt = 0; attempt < maxAttempts && results.length < count && repeated < repeatLimit; attempt++) {
    let chosen: ManualSalaryCandidate[] | null = null;
    for (const flex of shuffled(flexOptions, random)) {
      chosen = createRandomLineup(grouped, flex, random);
      if (chosen) break;
    }
    if (!chosen) break;
    const key = chosen.map(player => player.id).sort().join(',');
    if (seen.has(key)) {
      repeated++;
      continue;
    }
    repeated = 0;
    seen.add(key);
    results.push({ players: chosen, salary: chosen.reduce((sum, player) => sum + player.salary, 0) });
  }
  return results;
}
