import { simulateGame } from './simulator';
import { calculateDefenseDraftKings } from './draftkings-defense';
import { marketOutcomeWeights, validateMarketOdds } from './market-odds';
import { TEAM_CODES, playerNameKey, type LineupPlayer } from './lineups';
import type { DKSlate } from './draftkings-board';

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function hash(value: string) {
  let seed = 2166136261;
  for (const char of value) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}
export interface JointScenarios { samples: Map<string, Float64Array>; count: number; reporting?: JointScenarios }

/** Same-game players and DST share an outcome; different games are independently
 * shuffled. Stratified draws preserve marginal means and original market weights.
 * Replays frozen seeds/inputs, never current rosters or sums of player ceilings. */
export function replayLineupScenarios(players: LineupPlayer[], slate: DKSlate, count = 1000): JointScenarios {
  if (!Number.isInteger(count) || count < 100 || count > 3000) throw new Error('Invalid lineup scenario count.');
  const samples = new Map<string, Float64Array>();
  const reportSamples = new Map<string, Float64Array>();
  const ids = new Set<string>();
  for (const player of players) {
    if (ids.has(player.id)) throw new Error('Duplicate player in lineup scenarios.');
    ids.add(player.id);
  }
  for (const gameId of new Set(players.map(player => player.gameId))) {
    const matches = slate.forecasts.filter(game => game.gameId === gameId);
    if (matches.length !== 1) throw new Error('Tournament mode needs one frozen forecast per contest game.');
    const game = matches[0]!;
    if (!game.input?.away || !game.input.home || !Number.isInteger(game.runs) || game.runs < 1 || game.runs > 500) {
      throw new Error('Incomplete frozen forecast. Run and save a new slate before using tournament mode.');
    }
    const members = players.filter(player => player.gameId === gameId);
    const values = new Map(members.map(player => [player.id, [] as number[]]));
    const scores: { away: number; home: number }[] = [];
    for (let run = 0; run < game.runs; run++) {
      const result = simulateGame({ ...game.input, seed: (game.seed + Math.imul(run, 2654435761)) >>> 0 });
      scores.push({ away: result.awayScore, home: result.homeScore });
      for (const player of members) {
        const team = TEAM_CODES[player.team];
        let points: number;
        if (player.position === 'DST') {
          const defense = result.defenses?.filter(defense => defense.team === team) ?? [];
          if (defense.length !== 1) throw new Error(`Frozen DST identity is missing for ${player.name}.`);
          points = calculateDefenseDraftKings(defense[0]!);
        } else {
          const saved = game.players.filter(p => p.team === team && p.position === player.position && playerNameKey(p.name) === playerNameKey(player.name));
          const outcome = result.players.filter(p => p.team === team && p.position === player.position &&
            (p.id ? p.id === saved[0]?.playerId : playerNameKey(p.name) === playerNameKey(player.name)));
          if (saved.length !== 1 || outcome.length !== 1) throw new Error(`Frozen player identity is missing for ${player.name}.`);
          points = outcome[0]!.draftKings;
        }
        if (!Number.isFinite(points)) throw new Error('Invalid fantasy outcome in the frozen replay.');
        values.get(player.id)!.push(points);
      }
    }
    const market = validateMarketOdds(game.input.market, game.input.away.name, game.input.home.name);
    const weights = market ? marketOutcomeWeights(scores, market).weights : scores.map(() => 1 / game.runs);
    for (const player of members) {
      const mean = values.get(player.id)!.reduce((sum, point, i) => sum + point * weights[i]!, 0);
      if (Math.abs(mean - player.mean) > 0.15) {
        throw new Error(`The saved projection for ${player.name} no longer matches its frozen replay. Run and save a new slate for tournament mode.`);
      }
    }
    const cumulative: number[] = [];
    weights.forEach(weight => cumulative.push(weight + (cumulative.at(-1) ?? 0)));
    for (const [purpose, target] of [['selection', samples], ['reporting', reportSamples]] as const) {
      const random = seededRandom(hash(`${game.gameId}:${game.seed}:lineup-outcomes:${purpose}`));
      const draws = Array.from({ length: count }, (_, i) => (i + random()) / count);
      for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [draws[i], draws[j]] = [draws[j]!, draws[i]!];
      }
      const indices = draws.map(draw => {
        let low = 0, high = cumulative.length - 1;
        while (low < high) { const middle = (low + high) >>> 1; if (draw < cumulative[middle]!) high = middle; else low = middle + 1; }
        return low;
      });
      for (const player of members) target.set(player.id, Float64Array.from(indices, index => values.get(player.id)![index]!));
    }
  }
  // Independent cross-game recombinations reduce selection-sample optimism;
  // they are NOT independent NFL evidence or an accuracy validation.
  return { samples, count, reporting: { samples: reportSamples, count } };
}

export function summarizeLineup(players: LineupPlayer[], scenarios: JointScenarios) {
  const totals = new Float64Array(scenarios.count);
  for (const player of players) {
    const values = scenarios.samples.get(player.id);
    if (!values || values.length !== scenarios.count) throw new Error('A lineup player lacks joint simulation outcomes.');
    for (let i = 0; i < totals.length; i++) totals[i]! += values[i]!;
  }
  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const chance220 = totals.reduce((sum, value) => sum + Number(value >= 220), 0) / totals.length * 100;
  totals.sort();
  return { p10: totals[Math.floor((totals.length - 1) * 0.1)]!, p90: totals[Math.floor((totals.length - 1) * 0.9)]!,
    simulatedMean: mean, chance220, scenarios: scenarios.count };
}