import assert from 'node:assert/strict';
import type { TeamSeasonRecord } from '@workspace/api-client-react';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { simulatorLineupSource } from '../artifacts/gridiron-sim/src/lib/simulator-lineups';
import { buildLineupPool, parseSalaryCsv, TEAM_CODES } from '../artifacts/gridiron-sim/src/lib/lineups';
import { optimizeLineups } from '../artifacts/gridiron-sim/src/lib/lineup-optimizer';
import { replayLineupScenarios } from '../artifacts/gridiron-sim/src/lib/lineup-scenarios';
import { saveSimulation, readSavedSimulations, type SavedSimulation } from '../artifacts/gridiron-sim/src/lib/saved-simulations';

const season = new Date().getFullYear();
const now = Date.now();
const teams: TeamSeasonRecord[] = ['Buffalo Bills', 'Miami Dolphins', 'New England Patriots', 'New York Jets'].map((team, i) => ({
  season, team, version: 1, updatedAt: new Date(now).toISOString(), weeks: [],
  players: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE'].map((position, index) => ({
    id: `test-${i}-${index}`, name: `Test ${i} ${position} ${index}`,
    position: position as 'QB' | 'RB' | 'WR' | 'TE', side: 'offense' as const, active: true,
    depthRank: position === 'RB' ? index : position === 'WR' ? index - 2 : 1,
  })),
}));
const futureDay = (day: number) => {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + 14 + (day - date.getUTCDay() + 7) % 7);
  date.setUTCHours(23, 20, 0, 0);
  return date.toISOString();
};
const entries: SavedSimulation[] = [0, 1].map((i) => {
  const away = setupFromHistory(teams[i * 2]!, 5, 'away', teams[i * 2 + 1]!.team);
  const home = setupFromHistory(teams[i * 2 + 1]!, 5, 'home', away.name);
  const input = { away, home, weather: { temperatureF: 68, windMph: 5, precipitation: 'none' as const },
    market: { enabled: false, source: 'manual' as const, season, week: 5, gameId: `test-other-game-${i}`,
      awayTeam: away.name, homeTeam: home.name, kickoff: futureDay(i === 0 ? 4 : 1) }, seed: 123 + i };
  const result = simulateEnsemble(input, 25);
  const { seed: _seed, ...setup } = input;
  return { id: `test-save-${i}`, weeklyRunId: 'test-weekly-batch', generatedAt: new Date(now - 1000).toISOString(),
    savedAt: new Date(now).toISOString(), awayName: away.name, homeName: home.name, result, setup };
});
const before = JSON.stringify(entries);
const source = simulatorLineupSource(entries, season);
assert.equal(source.slates.length, 1);
const slate = source.slates[0]!;
assert.equal(slate.forecasts.length, 2, 'Non-Sunday games remain available');
assert.equal(slate.forecasts[0]!.seed, entries[0]!.result.seed);
assert.deepEqual(slate.forecasts[0]!.input.away, entries[0]!.setup!.away, 'Frozen roles and strategy are retained');
assert.equal(JSON.stringify(entries), before, 'Adapter never mutates saved archives');
assert.equal(simulatorLineupSource([...entries].reverse(), season).slates[0]!.id, slate.id, 'Stable identity independent of storage order');
assert.equal(simulatorLineupSource(entries, season + 1).slates.length, 0);
const rerun = structuredClone(entries);
for (const entry of rerun) { entry.id += '-rerun'; entry.weeklyRunId = 'new-batch'; }
assert.equal(simulatorLineupSource([...entries, ...rerun], season).slates.length, 2, 'Separate reruns must not be merged');
assert.notEqual(simulatorLineupSource(entries.slice(0, 1), season).slates[0]!.id, slate.id, 'Deleting a source game invalidates old pairing');
const legacy = structuredClone(entries[0]!);
delete legacy.generatedAt;
assert.equal(simulatorLineupSource([legacy], season).slates.length, 0);
assert.equal(simulatorLineupSource([legacy], season).warnings.length, 1, 'Missing generation timing is not invented');
for (const patch of [
  (e: SavedSimulation) => { e.savedAt = e.setup!.market!.kickoff!; },
  (e: SavedSimulation) => { delete e.setup!.market!.kickoff; },
  (e: SavedSimulation) => { e.generatedAt = new Date(now + 10000).toISOString(); },
  (e: SavedSimulation) => { e.setup!.away.name = 'Wrong team'; },
  (e: SavedSimulation) => { delete e.result.ensemble; },
]) {
  const broken = structuredClone(entries); patch(broken[0]!);
  const filtered = simulatorLineupSource(broken, season);
  assert.equal(filtered.slates[0]!.forecasts.length, 1);
  assert.equal(filtered.slates[0]!.failures.length, 1);
}
let csv = 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\r\n';
let id = 900001;
const code = (name: string) => Object.entries(TEAM_CODES).find(([, full]) => full === name)![0];
for (const forecast of slate.forecasts) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(new Date(forecast.kickoff));
  const p = (type: string) => parts.find(part => part.type === type)!.value;
  const gameInfo = `${code(forecast.awayTeam)}@${code(forecast.homeTeam)} ${p('month')}/${p('day')}/${p('year')} ${p('hour')}:${p('minute')}${p('dayPeriod')} ET`;
  for (const player of [...forecast.players, ...[forecast.awayTeam, forecast.homeTeam].map(team => ({
    name: team.split(' ').at(-1)!, team, position: 'DST',
  }))]) {
    const salary = player.position === 'QB' ? 6500 : player.position === 'RB' ? 5000 : player.position === 'WR' ? 4800 : player.position === 'TE' ? 3600 : 2800;
    const playerId = id++;
    csv += [player.position, `${player.name} (${playerId})`, player.name, playerId,
      ['RB', 'WR', 'TE'].includes(player.position) ? `${player.position}/FLEX` : player.position,
      salary, gameInfo, code(player.team), '999'].join(',') + '\r\n';
  }
}
const pool = buildLineupPool(parseSalaryCsv(csv), slate, teams, now);
assert.equal(pool.issues.length, 0);
assert.ok(pool.players.some(p => p.position === 'DST'));
const lineups = optimizeLineups(pool.players, 1);
assert.equal(lineups.length, 1);
assert.ok(lineups[0]!.salary <= 50000);
assert.equal(lineups[0]!.players.length, 9);
assert.ok(new Set(lineups[0]!.players.map(p => p.gameId)).size >= 2);
assert.doesNotThrow(() => replayLineupScenarios(lineups[0]!.players, slate, 100), 'Tournament replay uses the same frozen seeds and means');
const started = buildLineupPool(parseSalaryCsv(csv), slate, teams, Date.parse(futureDay(1)) + 14 * 86400000);
assert.equal(started.players.length, 0, 'Started games cannot enter a lineup');
let stored = '';
const storage = { getItem: () => stored || null, setItem: (_key: string, value: string) => { stored = value; } };
for (const entry of entries) saveSimulation(storage, entry);
assert.equal(JSON.stringify(simulatorLineupSource(readSavedSimulations(storage), season)), JSON.stringify(source),
  'JSON persistence retains forecast values (optional undefined fields are omitted)');
export const simulatorLineupsBrowserFixture = { season, teams, entries, csv };
console.log('Simulator lineups: non-Sunday games, batch isolation, frozen replay, timing/identity validation, salaries, DST, legal Classic lineup and reload passed.');
