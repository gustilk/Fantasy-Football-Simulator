import { lineupSlots, type Lineup, type LineupPlayer, type LineupPosition } from './lineups';
import { replayLineupScenarios, seededRandom, summarizeLineup, type JointScenarios } from './lineup-scenarios';
import type { DKSlate } from './draftkings-board';

type Evaluated = Lineup & { tournament: NonNullable<Lineup['tournament']> };
const round = (value: number) => Math.round(value * 100) / 100;
const identity = (players: LineupPlayer[]) => players.map(p => p.id).sort().join(',');
const eligible = (player: LineupPlayer, slot: string) => slot === 'FLEX' ? ['RB', 'WR', 'TE'].includes(player.position) : player.position === slot;
const stackNames = (players: LineupPlayer[]) => {
  const qb = players.find(p => p.position === 'QB');
  return qb ? players.filter(p => p.team === qb.team && ['WR', 'TE'].includes(p.position)).map(p => p.name) : [];
};
function evaluate(players: LineupPlayer[], scenarios: JointScenarios): Evaluated {
  const lineup: Lineup = { players, salary: players.reduce((sum, p) => sum + p.salary, 0), points: players.reduce((sum, p) => sum + p.mean, 0) };
  lineupSlots(lineup);
  return { ...lineup, tournament: { ...summarizeLineup(players, scenarios), candidates: 0, stackNames: stackNames(players) } };
}
const compare = (a: Evaluated, b: Evaluated) => b.tournament.p90 - a.tournament.p90 || b.points - a.points || a.salary - b.salary || identity(a.players).localeCompare(identity(b.players));

/** Bounded, deterministic candidate search, NOT a claimed globally exact upside
 * optimum. Rank whole-lineup outcomes; player ceilings are proposal heuristics only. */
export function optimizeTournamentLineups(players: LineupPlayer[], slate: DKSlate, count = 3): Lineup[] {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Choose 1–5 lineups.');
  const ids = new Set<string>(), names = new Set<string>();
  for (const player of players) {
    const name = `${player.team}:${player.name.toLowerCase()}`;
    if (ids.has(player.id) || names.has(name) || !['QB', 'RB', 'WR', 'TE', 'DST'].includes(player.position)
      || !Number.isFinite(player.mean) || !Number.isSafeInteger(player.salary) || player.salary <= 0 || player.salary > 50000) {
      throw new Error('Invalid or duplicate tournament player.');
    }
    ids.add(player.id); names.add(name);
  }
  const scenarios = replayLineupScenarios(players, slate);
  const groups = new Map<LineupPosition, LineupPlayer[]>();
  for (const position of ['QB', 'RB', 'WR', 'TE', 'DST'] as const) groups.set(position, players.filter(p => p.position === position));
  if ([['QB', 1], ['RB', 2], ['WR', 3], ['TE', 1], ['DST', 1]].some(([position, required]) => groups.get(position as LineupPosition)!.length < Number(required))) {
    return [];
  }
  const random = seededRandom(246813579);
  const marginal = new Map(players.map(p => {
    const values = Float64Array.from(scenarios.samples.get(p.id)!).sort();
    return [p.id, values[Math.floor((values.length - 1) * 0.9)]!] as const;
  }));
  const pairs = groups.get('QB')!.flatMap(qb => players.filter(p => p.team === qb.team && ['WR', 'TE'].includes(p.position)).map(receiver => [qb, receiver] as const));
  if (!pairs.length) throw new Error('No eligible QB and same-team WR/TE combination fits this contest pool. Try Highest average or check excluded players.');
  const found = new Map<string, Evaluated>();
  const add = (chosen: LineupPlayer[]) => {
    if (!stackNames(chosen).length || new Set(chosen.map(p => p.gameId)).size < 2) return;
    const key = identity(chosen);
    if (found.has(key)) return;
    found.set(key, evaluate(chosen, scenarios));
  };
  // Cover each QB/receiver pair first, then additional randomized completions.
  const attempts = Math.min(2400, Math.max(700, pairs.length * 3));
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j]!, pairs[i]!];
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const [qb, receiver] = pairs[attempt < pairs.length ? attempt : Math.floor(random() * pairs.length)]!;
    const chosen = [qb, receiver];
    const slots = ['RB', 'RB', ...Array(receiver.position === 'WR' ? 2 : 3).fill('WR'),
      ...(receiver.position === 'TE' ? [] : ['TE']), 'DST', 'FLEX'];
    // Vary positional order so expensive good candidates can fit different budgets.
    if (attempt % 3) for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [slots[i], slots[j]] = [slots[j]!, slots[i]!];
    }
    for (const [index, slot] of slots.entries()) {
      const used = new Set(chosen.map(p => p.id));
      const available = players.filter(p => !used.has(p.id));
      const reserved = slots.slice(index + 1).reduce((sum, future) => {
        const costs = available.filter(p => eligible(p, future)).map(p => p.salary);
        return sum + (costs.length ? Math.min(...costs) : Infinity);
      }, 0);
      const budget = 50000 - chosen.reduce((sum, p) => sum + p.salary, 0) - reserved;
      const options = available.filter(p => eligible(p, slot) && p.salary <= budget);
      const upsideWeight = attempt % 4 === 0 ? 0 : attempt % 4 === 1 ? 0.35 : 0.7;
      const proposals = options.map(p => ({
        player: p,
        utility: (p.mean + upsideWeight * (marginal.get(p.id)! - p.mean)) *
          (attempt % 5 === 0 ? 5000 / p.salary : 1) * (0.8 + random() * 0.4),
      })).sort((a, b) => b.utility - a.utility || a.player.id.localeCompare(b.player.id));
      if (!proposals.length) break;
      chosen.push(proposals[0]!.player);
    }
    if (chosen.length === 9 && chosen.reduce((sum, p) => sum + p.salary, 0) <= 50000) add(chosen);
  }
  // Improve legal candidates through same-position swaps, retaining QB stacks.
  for (const anchor of [...found.values()].sort(compare).slice(0, 18)) {
    for (const outgoing of anchor.players) {
      for (const incoming of groups.get(outgoing.position)!) {
        if (anchor.players.some(p => p.id === incoming.id) || anchor.salary - outgoing.salary + incoming.salary > 50000) continue;
        add(anchor.players.map(p => p.id === outgoing.id ? incoming : p));
      }
    }
  }
  const selected: Evaluated[] = [];
  for (const candidate of [...found.values()].sort(compare)) {
    if (selected.some(lineup => candidate.players.filter(p => lineup.players.some(q => q.id === p.id)).length > 7)) continue;
    selected.push(candidate);
    if (selected.length === count) break;
  }
  if (!selected.length) throw new Error('The bounded tournament search did not find a legal stacked lineup. Try Highest average or check the contest pool; this does not prove no legal lineup exists.');
  return selected.map(lineup => {
    const report = summarizeLineup(lineup.players, scenarios.reporting!);
    return { ...lineup, tournament: { ...lineup.tournament,
      ...report, p10: round(report.p10), p90: round(report.p90), simulatedMean: round(report.simulatedMean),
      chance220: round(report.chance220), candidates: found.size,
    } };
  }).sort(compare);
}