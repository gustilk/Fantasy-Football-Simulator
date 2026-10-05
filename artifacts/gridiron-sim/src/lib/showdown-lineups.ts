import type { TeamSeasonRecord } from '@workspace/api-client-react';
import type { DKSlate } from './draftkings-board';
import { availabilityForWeek } from './availability';
import { matchesGameInfo, defenseForecasts, playerNameKey, TEAM_CODES, lineupSlots,
  type SalaryPlayer, type LineupPlayer, type Lineup } from './lineups';
import { replayLineupScenarios, summarizeLineup } from './lineup-scenarios';
import { SHOWDOWN_MODEL_WARNING } from './showdown-scoring';

const identity = (p: SalaryPlayer) => `${p.team}:${playerNameKey(p.name)}`;
const signature = (l: Lineup) => l.players.map(p => p.id).sort().join(',');
const compare = (a: Lineup, b: Lineup) => b.points - a.points || a.salary - b.salary || signature(a).localeCompare(signature(b));

export function buildShowdownPool(salaries: SalaryPlayer[], slate: DKSlate, gameId: string, teams?: TeamSeasonRecord[], now = Date.now()) {
  const game = slate.forecasts.find(g => g.gameId === gameId);
  if (!game || game.input.showdownModel !== 'showdown-v1') throw new Error('Select, run and save this game again to capture Captain scoring, kickers and defensive TDs. Existing saved results stay unchanged.');
  const players: LineupPlayer[] = [], issues: { player: SalaryPlayer; reason: string }[] = [];
  const defenses = defenseForecasts(game);
  for (const player of salaries) {
    let mean: number | undefined;
    let reason = '';
    if (!matchesGameInfo(player, game)) reason = 'Salary row does not match the selected single game and confirmed kickoff.';
    else if (Date.parse(game.kickoff) <= now || !Number.isFinite(Date.parse(game.kickoff))) reason = 'Game has started or kickoff is unconfirmed. Only pregame lineups are supported.';
    else {
      const team = TEAM_CODES[player.team];
      const projections = player.position === 'DST' ? defenses.filter(p => p.team === team)
        : player.position === 'K' ? (game.kickers ?? []).filter(p => p.team === team && playerNameKey(p.name) === playerNameKey(player.name))
        : game.players.filter(p => p.team === team && p.position === player.position && playerNameKey(p.name) === playerNameKey(player.name));
      if (projections.length === 1) mean = projections[0]!.mean;
      if (teams && player.position !== 'DST') {
        const roster = teams.find(t => t.team === team && t.season === slate.season);
        const current = roster?.players.filter(p => p.position === player.position && playerNameKey(p.name) === playerNameKey(player.name)) ?? [];
        if (current.length !== 1 || !availabilityForWeek(current[0]!, game.week).included) reason = 'Excluded by current roster or weekly availability. Rerun after roster changes.';
      }
      if (!reason && !Number.isFinite(mean)) reason = `No unique saved ${player.position} projection. Check Team Library and rerun; missing projections are not zero points.`;
    }
    if (reason || mean === undefined) issues.push({ player, reason });
    else players.push({ ...player, mean: mean * (player.rosterPosition === 'CPT' ? 1.5 : 1), gameId: game.gameId, kickoff: game.kickoff, projectionSource: 'Frozen Showdown ensemble' });
  }
  return { players, issues, warnings: [SHOWDOWN_MODEL_WARNING], error: '' };
}

/** Exact top-K salary/slot/team DP for each Captain. Cheaper superior prefixes
 * dominate only within identical selected-count and team-coverage states. */
function candidates(players: LineupPlayer[], perCaptain: number): Lineup[] {
  const ids = new Set<string>();
  const roles = new Set<string>();
  for (const p of players) {
    const role = `${identity(p)}:${p.rosterPosition}`;
    if (ids.has(p.id) || roles.has(role) || !['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(p.position) ||
      !['CPT', 'FLEX'].includes(p.rosterPosition) || !Number.isFinite(p.mean) ||
      !Number.isSafeInteger(p.salary) || p.salary < 1 || p.salary > 50000) throw new Error('Invalid Showdown optimizer pool.');
    ids.add(p.id); roles.add(role);
  }
  if (new Set(players.map(p => p.gameId)).size !== 1 || new Set(players.map(p => p.team)).size !== 2) throw new Error('Showdown needs one game and players from both teams.');
  const output: Lineup[] = [];
  type Path = { players: LineupPlayer[]; salary: number; points: number; mask: number };
  const teams = [...new Set(players.map(p => p.team))].sort();
  const pathCompare = (a: Path, b: Path) => b.points - a.points || a.salary - b.salary || a.players.map(p => p.id).join(',').localeCompare(b.players.map(p => p.id).join(','));
  for (const captain of players.filter(p => p.rosterPosition === 'CPT')) {
    const flex = players.filter(p => p.rosterPosition === 'FLEX' && identity(p) !== identity(captain)).sort((a, b) => a.id.localeCompare(b.id));
    let states = new Map<string, Path[]>([['0:0:0', [{ players: [], salary: 0, points: 0, mask: 0 }]]]);
    for (const [index, player] of flex.entries()) {
      for (const paths of [...states.values()]) for (const path of paths) {
        if (path.players.length === 5 || path.salary + player.salary + captain.salary > 50000) continue;
        const next = { players: [...path.players, player], salary: path.salary + player.salary,
          points: path.points + player.mean, mask: path.mask | (player.team === teams[0] ? 1 : 2) };
        const key = `${next.players.length}:${next.salary}:${next.mask}`;
        states.set(key, [...(states.get(key) ?? []), next].sort(pathCompare).slice(0, perCaptain));
      }
      if (index % 5 === 4 || index === flex.length - 1) {
        const groups = new Map<string, Path[][]>();
        for (const paths of states.values()) {
          const key = `${paths[0]!.players.length}:${paths[0]!.mask}`;
          const group = groups.get(key) ?? []; group.push(paths); groups.set(key, group);
        }
        states = new Map();
        for (const group of groups.values()) {
          let best: Path[] = [];
          for (const paths of group.sort((a, b) => a[0]!.salary - b[0]!.salary)) {
            const keep = paths.filter(p => best.length < perCaptain || pathCompare(p, best[perCaptain - 1]!) < 0);
            if (keep.length) states.set(`${keep[0]!.players.length}:${keep[0]!.salary}:${keep[0]!.mask}`, keep);
            best = [...best, ...paths].sort(pathCompare).slice(0, perCaptain);
          }
        }
      }
      if (states.size > 200000) throw new Error('Showdown pool exceeds the exact optimizer memory limit. No approximate average result was returned.');
    }
    const mask = captain.team === teams[0] ? 1 : 2;
    const legal = [...states.values()].flat().filter(p => p.players.length === 5 && (p.mask | mask) === 3)
      .sort(pathCompare).slice(0, perCaptain);
    for (const path of legal) output.push({ format: 'showdown', players: [captain, ...path.players], salary: captain.salary + path.salary, points: captain.mean + path.points });
  }
  return output.sort(compare);
}

export function optimizeShowdownLineups(players: LineupPlayer[], count = 3, slate?: DKSlate): Lineup[] {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Choose 1–5 lineups.');
  const all = candidates(players, slate ? 20 : count);
  if (!slate || !all.length) return all.slice(0, count);
  const scenarios = replayLineupScenarios(players, slate, 1000, 'showdown');
  const ranked = all.map(lineup => {
    const selection = summarizeLineup(lineup.players, scenarios, 120);
    const report = summarizeLineup(lineup.players, scenarios.reporting!, 120);
    return { lineup, selection, report };
  }).sort((a, b) => b.selection.p90 - a.selection.p90 || compare(a.lineup, b.lineup));
  return ranked.slice(0, count).map(({ lineup, report }) => {
    lineupSlots(lineup);
    return { ...lineup, tournament: { ...report, scenarios: scenarios.count, candidates: all.length, stackNames: [] } };
  });
}
