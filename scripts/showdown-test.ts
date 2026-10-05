import assert from 'node:assert/strict';
import { simulatorLineupsBrowserFixture as original } from './simulator-lineups-test';
import { simulateGame } from '../artifacts/gridiron-sim/src/lib/simulator';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { simulatorLineupSource } from '../artifacts/gridiron-sim/src/lib/simulator-lineups';
import { calculateKickerDraftKings, defensiveTouchdowns } from '../artifacts/gridiron-sim/src/lib/showdown-scoring';
import { calculateDefenseDraftKings } from '../artifacts/gridiron-sim/src/lib/draftkings-defense';
import { parseSalaryCsv, exportLineups, lineupSlots, TEAM_CODES, type Lineup, type LineupPlayer } from '../artifacts/gridiron-sim/src/lib/lineups';
import { buildShowdownPool, optimizeShowdownLineups } from '../artifacts/gridiron-sim/src/lib/showdown-lineups';
import { gameProjections } from '../artifacts/gridiron-sim/src/lib/game-projections';
import { replayLineupScenarios } from '../artifacts/gridiron-sim/src/lib/lineup-scenarios';

assert.equal(calculateKickerDraftKings({ extraPoints: 2, fieldGoals039: 1, fieldGoals4049: 2, fieldGoals50Plus: 1 }), 18);
assert.equal(calculateDefenseDraftKings({ sacks: 3, interceptions: 1, fumblesRecovered: 2, pointsAllowed: 0,
  defensiveTD: 2, returnTD: 1, safeties: 1, blockedKicks: 1, conversionReturns: 1 }), 43);
assert.equal(defensiveTouchdowns(3, 2, () => 0), 5);
assert.equal(defensiveTouchdowns(3, 2, () => 1), 0);
assert.throws(() => calculateKickerDraftKings({ extraPoints: -1, fieldGoals039: 0, fieldGoals4049: 0, fieldGoals50Plus: 0 }));
const fixture = structuredClone(original);
for (const [i, team] of fixture.teams.entries()) {
  team.players.push({ id: `kicker-${i}`, name: `Test Kicker ${i}`, position: 'K', side: 'offense', active: true, depthRank: 1 });
}
for (const [i, entry] of fixture.entries.entries()) {
  entry.setup!.showdownModel = 'showdown-v1';
  entry.setup!.away.kicker = `Test Kicker ${i * 2}`;
  entry.setup!.home.kicker = `Test Kicker ${i * 2 + 1}`;
  entry.result = simulateEnsemble({ ...entry.setup!, seed: entry.result.seed }, 50);
}
const source = simulatorLineupSource(fixture.entries, fixture.season);
const slate = source.slates[0]!, game = slate.forecasts[0]!;
assert.equal(game.kickers!.length, 2);
assert.ok(gameProjections(fixture.entries[0]!.result)!.some(p => p.position === 'K'));
assert.ok(gameProjections(fixture.entries[0]!.result)!.some(p => p.position === 'DST'));
const input = { ...fixture.entries[0]!.setup!, seed: 55 };
const legacyInput = { ...input }; delete legacyInput.showdownModel;
const legacy = simulateGame(legacyInput);
assert.equal(legacy.kickers, undefined);
assert.equal(legacy.defenses![0]!.defensiveTD, undefined);
let totalDefTD = 0;
for (let seed = 1; seed <= 200; seed++) {
  const normal = simulateGame({ ...legacyInput, seed });
  const captain = simulateGame({ ...input, seed });
  assert.deepEqual(captain.players, normal.players, 'Versioned special scoring does not rewrite offensive outcomes');
  assert.equal(captain.homeScore - captain.defenses![0]!.pointsAllowed, 6 * captain.defenses![1]!.defensiveTD!, 'Defensive TDs excluded from opponent DST points allowed; XP included');
  for (const [i, k] of captain.kickers!.entries()) {
    assert.equal(k.draftKings, calculateKickerDraftKings({ extraPoints: k.extraPoints, fieldGoals039: k.fieldGoals039,
      fieldGoals4049: k.fieldGoals4049, fieldGoals50Plus: k.fieldGoals50Plus }));
    assert.equal(i ? captain.homeScore : captain.awayScore, 7 * k.extraPoints + 3 * (k.fieldGoals039 + k.fieldGoals4049 + k.fieldGoals50Plus));
    assert.ok(captain.defenses![i]!.defensiveTD! <= captain.defenses![i]!.interceptions + captain.defenses![i]!.fumblesRecovered);
    totalDefTD += captain.defenses![i]!.defensiveTD!;
  }
}
assert.ok(totalDefTD > 0, 'Defensive touchdowns actually enter simulations, not just scoring tables');

const code = (team: string) => Object.entries(TEAM_CODES).find(([, name]) => name === team)![0];
const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(new Date(game.kickoff));
const part = (type: string) => parts.find(p => p.type === type)!.value;
const info = `${code(game.awayTeam)}@${code(game.homeTeam)} ${part('month')}/${part('day')}/${part('year')} ${part('hour')}:${part('minute')}${part('dayPeriod')} ET`;
let csv = 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\r\n';
let id = 970000;
for (const p of [...game.players, ...game.kickers!.map(k => ({ ...k, position: 'K' })),
  ...[game.awayTeam, game.homeTeam].map(team => ({ team, position: 'DST', name: team.split(' ').at(-1)! }))]) {
  const salary = p.position === 'QB' ? 10000 : p.position === 'RB' ? 7800 : p.position === 'WR' ? 6600 : p.position === 'TE' ? 5000 : p.position === 'K' ? 4200 : 3800;
  for (const role of ['CPT', 'FLEX']) {
    const pid = id++;
    csv += [p.position, `${p.name} (${pid})`, p.name, pid, role, salary * (role === 'CPT' ? 1.5 : 1),
      info, code(p.team), 999].join(',') + '\r\n';
  }
}
fixture.csv = csv;
const rows = parseSalaryCsv(csv, 'showdown');
assert.ok(rows.some(p => p.position === 'K' && p.rosterPosition === 'CPT'));
assert.throws(() => parseSalaryCsv(csv), /Captain|Showdown/);
assert.throws(() => parseSalaryCsv(original.csv, 'showdown'), /eligibility/);
assert.throws(() => parseSalaryCsv(csv.replace(',15000,', ',14999,'), 'showdown'), /salary/);
const pool = buildShowdownPool(rows, slate, game.gameId, fixture.teams);
assert.equal(pool.issues.length, 0);
assert.equal(new Set(pool.players.map(p => p.gameId)).size, 1);
assert.ok(pool.players.some(p => p.position === 'DST'));
for (const c of pool.players.filter(p => p.rosterPosition === 'CPT')) {
  const flex = pool.players.find(p => p.name === c.name && p.team === c.team && p.rosterPosition === 'FLEX')!;
  assert.equal(c.mean, flex.mean * 1.5, 'Captain multiplier applied once to QB/RB/WR/TE/K/DST, including negative totals');
  assert.equal(c.salary, flex.salary * 1.5);
}
const average = optimizeShowdownLineups(pool.players, 3);
const tournament = optimizeShowdownLineups(pool.players, 3, slate);
assert.equal(average.length, 3); assert.equal(tournament.length, 3);
for (const lineup of [...average, ...tournament]) {
  assert.equal(lineupSlots(lineup).length, 6);
  assert.equal(lineupSlots(lineup)[0]!.slot, 'CPT');
  assert.equal(new Set(lineup.players.map(p => `${p.team}:${p.name}`)).size, 6);
  assert.equal(new Set(lineup.players.map(p => p.team)).size, 2);
  assert.ok(lineup.salary <= 50000);
}
assert.equal(tournament[0]!.tournament!.targetScore, 120);
assert.ok(exportLineups(average).startsWith('CPT,FLEX,FLEX,FLEX,FLEX,FLEX\r\n'));
assert.doesNotThrow(() => replayLineupScenarios(pool.players, slate, 100, 'showdown'));
assert.throws(() => buildShowdownPool(rows, simulatorLineupSource(original.entries, original.season).slates[0]!, game.gameId), /again/);
assert.equal(buildShowdownPool(rows, slate, game.gameId, fixture.teams, Date.parse(game.kickoff)).players.length, 0);
const out = structuredClone(fixture.teams); out[0]!.players.find(p => p.position === 'K')!.active = false;
assert.ok(buildShowdownPool(rows, slate, game.gameId, out).issues.some(p => p.player.position === 'K'));

// Exhaustive comparison for a small pool: top five, ties, cap, both teams, Captain identity.
const small = pool.players.filter(p => ['QB', 'K', 'DST', 'TE'].includes(p.position));
const brute: Lineup[] = [];
for (const captain of small.filter(p => p.rosterPosition === 'CPT')) {
  const flex = small.filter(p => p.rosterPosition === 'FLEX' && !(p.team === captain.team && p.name === captain.name));
  const search = (start: number, picked: LineupPlayer[]) => {
    if (picked.length === 5) {
      const players = [captain, ...picked], salary = players.reduce((n, p) => n + p.salary, 0);
      if (salary <= 50000 && new Set(players.map(p => p.team)).size === 2) brute.push({ format: 'showdown', players, salary, points: players.reduce((n, p) => n + p.mean, 0) });
      return;
    }
    for (let i = start; i < flex.length; i++) search(i + 1, [...picked, flex[i]!]);
  };
  search(0, []);
}
const sign = (l: Lineup) => l.players.map(p => p.id).sort().join(',');
brute.sort((a, b) => b.points - a.points || a.salary - b.salary || sign(a).localeCompare(sign(b)));
assert.deepEqual(optimizeShowdownLineups(small, 5).map(sign), brute.slice(0, 5).map(sign), 'Exact Captain optimizer agrees with exhaustive legal combinations');
export const showdownBrowserFixture = fixture;
console.log('Showdown: official kicker/DST scoring, versioned events, six-player/Captain rules, strict salaries/IDs, exact average, frozen upside replay, availability, lock and export passed.');
