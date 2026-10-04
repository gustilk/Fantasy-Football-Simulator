import assert from 'node:assert/strict';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { gameForecast, type DKSlate } from '../artifacts/gridiron-sim/src/lib/draftkings-board';
import { TEAM_CODES, lineupSlots, type LineupPlayer } from '../artifacts/gridiron-sim/src/lib/lineups';
import { replayLineupScenarios, summarizeLineup } from '../artifacts/gridiron-sim/src/lib/lineup-scenarios';
import { optimizeTournamentLineups } from '../artifacts/gridiron-sim/src/lib/tournament-lineups';
import { optimizeLineups } from '../artifacts/gridiron-sim/src/lib/lineup-optimizer';
import type { SimulationInput } from '../artifacts/gridiron-sim/src/lib/simulator';

const setup = (code: string): SimulationInput['away'] => ({
  name: TEAM_CODES[code]!, qb: `${code} QB`, rb: `${code} RB1`, wr1: `${code} WR1`, wr2: `${code} WR2`, wr3: `${code} WR3`, te: `${code} TE`, kicker: `${code} K`,
  passRating: 65, rushRating: 60, defenseRating: 65, context: '',
  roster: ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'WR4', 'TE'].map(role => ({
    id: `${code}-${role}`, name: `${code} ${role}`, position: role.replace(/\d/g, ''),
    depthRank: Number(role.match(/\d/)?.[0] ?? 1),
  })),
});
const slate: DKSlate = { id: 'tournament-test', season: 2030, sunday: '2030-09-08', timezone: 'America/Chicago', createdAt: '2030-09-07T12:00:00Z', forecasts: [], failures: [] };
for (const [index, codes] of [['BUF', 'DET'], ['LAR', 'PHI']].entries()) {
  const input: SimulationInput = { away: setup(codes[0]!), home: setup(codes[1]!), seed: 19 + index,
    weather: { temperatureF: 68, windMph: 5, precipitation: 'none' } };
  const game = { id: `game-${index}`, date: '2030-09-08T17:00:00Z', awayTeam: input.away.name, homeTeam: input.home.name, week: 1, seasonType: 'regular' as const, timeConfirmed: true };
  slate.forecasts.push(gameForecast(game, input, simulateEnsemble(input, 50)));
}
const players: LineupPlayer[] = [];
for (const forecast of slate.forecasts) {
  for (const player of forecast.players) {
    const code = Object.entries(TEAM_CODES).find(([, name]) => name === player.team)![0];
    players.push({ id: String(players.length + 100), name: player.name, team: code, position: player.position,
      salary: player.position === 'QB' ? 6500 : 4500, rosterPosition: player.position, gameInfo: '', mean: player.mean,
      gameId: forecast.gameId, kickoff: forecast.kickoff, projectionSource: 'Test frozen forecast' });
  }
  for (const defense of forecast.defenses!) {
    const code = Object.entries(TEAM_CODES).find(([, name]) => name === defense.team)![0];
    players.push({ id: String(players.length + 100), name: code, team: code, position: 'DST', salary: 2500, rosterPosition: 'DST',
      gameInfo: '', mean: defense.mean, gameId: forecast.gameId, kickoff: forecast.kickoff, projectionSource: 'Test frozen DST' });
  }
}
const before = JSON.stringify({ players, slate });
const scenarios = replayLineupScenarios(players, slate);
for (const player of players) {
  const values = scenarios.samples.get(player.id)!;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(Math.abs(mean - player.mean) < 0.02, 'Stratified unweighted replay preserves saved marginal means');
}
const lineups = optimizeTournamentLineups(players, slate, 3);
assert.ok(lineups.length > 0 && lineups.length <= 3);
for (const lineup of lineups) {
  lineupSlots(lineup);
  assert.ok(lineup.salary <= 50000);
  assert.equal(lineup.points, lineup.players.reduce((sum, player) => sum + player.mean, 0), 'Do not inflate the displayed average');
  assert.ok(lineup.tournament!.stackNames.length > 0, 'Require a same-team QB + WR/TE stack');
  assert.ok(lineup.tournament!.p10 <= lineup.tournament!.p90);
  assert.ok(lineup.tournament!.chance220 >= 0 && lineup.tournament!.chance220 <= 100);
  assert.equal(lineup.tournament!.scenarios, 1000);
}
for (const [index, a] of lineups.entries()) for (const b of lineups.slice(index + 1)) {
  assert.ok(a.players.filter(player => b.players.some(other => other.id === player.id)).length <= 7);
}
const average = optimizeLineups(players, 1)[0]!;
assert.ok(average.points + 1e-8 >= Math.max(...lineups.map(lineup => lineup.points)), 'Original exact mean optimizer remains available');
assert.equal(JSON.stringify({ players, slate }), before, 'Never rewrite frozen forecasts or salaries');
assert.deepEqual(optimizeTournamentLineups(players, slate, 3), lineups, 'Search is reproducible');
const mismatched = structuredClone(slate);
mismatched.forecasts[0]!.players[0]!.mean += 10;
assert.throws(() => replayLineupScenarios([{ ...players[0]!, mean: players[0]!.mean + 10 }, ...players.slice(1)], mismatched), /no longer matches/);
const a = players[0]!, b = players[1]!;
const antiCorrelated = { count: 4, samples: new Map([[a.id, Float64Array.of(0, 100, 0, 100)], [b.id, Float64Array.of(100, 0, 100, 0)]]) };
assert.equal(summarizeLineup([a, b], antiCorrelated).p90, 100, 'Whole-lineup ceiling is not the sum of individual ceilings (200)');
assert.equal(summarizeLineup([a, b], antiCorrelated).chance220, 0);
const weighted = structuredClone(slate);
weighted.forecasts[0]!.input.market = { enabled: true, homeSpread: -3, total: 45, recordedAt: new Date().toISOString(), source: 'manual',
  awayTeam: weighted.forecasts[0]!.awayTeam, homeTeam: weighted.forecasts[0]!.homeTeam, kickoff: weighted.forecasts[0]!.kickoff };
const replay = simulateEnsemble(weighted.forecasts[0]!.input, weighted.forecasts[0]!.runs);
weighted.forecasts[0] = { ...weighted.forecasts[0]!, ...gameForecast({ id: weighted.forecasts[0]!.gameId, date: weighted.forecasts[0]!.kickoff, awayTeam: weighted.forecasts[0]!.awayTeam,
  homeTeam: weighted.forecasts[0]!.homeTeam, week: 1, seasonType: 'regular', timeConfirmed: true }, weighted.forecasts[0]!.input, replay) };
const weightedPlayers = players.map(player => {
  if (player.gameId !== weighted.forecasts[0]!.gameId) return player;
  const game = weighted.forecasts[0]!;
  const mean = player.position === 'DST' ? game.defenses!.find(d => d.team === TEAM_CODES[player.team])!.mean : game.players.find(p => p.name === player.name)!.mean;
  return { ...player, mean };
});
assert.equal(replayLineupScenarios(weightedPlayers, weighted).samples.size, players.length, 'Optional market weighting preserves paired outcomes');
console.log(`Tournament checks passed: ${lineups.length} legal stacked/diverse lineups, frozen replay, whole-lineup ranges, market weights, unchanged means, original average optimization and reproducibility.`);