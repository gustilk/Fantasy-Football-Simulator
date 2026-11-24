import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineupEligibility } from '../../artifacts/gridiron-sim/src/lib/availability';
import { parseSalaryCsv, buildLineupPool } from '../../artifacts/gridiron-sim/src/lib/lineups';
import { simulateEnsemble } from '../../artifacts/gridiron-sim/src/lib/ensemble';
import type { SimulationInput } from '../../artifacts/gridiron-sim/src/lib/simulator';
import { gameForecast, type DKSlate } from '../../artifacts/gridiron-sim/src/lib/draftkings-board';
import { reportedAvailability } from '../../artifacts/api-server/src/lib/nfl-source';

type RosterPlayer = Parameters<typeof lineupEligibility>[0];
type TeamSeasonRecord = NonNullable<Parameters<typeof buildLineupPool>[2]>[number];
const source = { provider: 'ESPN', url: 'https://example.test', fetchedAt: '2035-10-03T12:00:00Z' } as NonNullable<RosterPlayer['source']>;
const player = (patch: Partial<RosterPlayer> = {}) => ({ id: 'p1', name: 'Test Player', position: 'WR', side: 'offense', active: true, ...patch }) as RosterPlayer;
const report = (status: string, rosterActive = true) => ({ status, rosterActive, source }) as RosterPlayer['availabilityReport'];
const override = (week: number, status: string) => ({ week, status, updatedAt: '2035-10-03T12:00:00Z' }) as RosterPlayer['availabilityOverride'];

test('a source report of Out or Doubtful excludes a player even when the saved Active flag was never updated', () => {
  for (const status of ['out', 'doubtful']) {
    const result = lineupEligibility(player({ active: true, availabilityReport: report(status), availability: 'Injured Reserve' }), 4);
    assert.equal(result.eligible, false);
    assert.match(result.reason!, /Source reports/);
  }
  assert.match(lineupEligibility(player({ availabilityReport: report('out'), availability: 'Injured Reserve' }), 4).reason!, /Injured Reserve/);
});

test('questionable, limited, available and unknown players are not auto-excluded and unknown is never treated as Out', () => {
  for (const status of ['questionable', 'limited', 'available', 'unknown']) {
    assert.equal(lineupEligibility(player({ availabilityReport: report(status) }), 4).eligible, true, status);
  }
  assert.equal(lineupEligibility(player(), 4).eligible, true, 'no report at all stays eligible');
});

test('inactive saved roster players are excluded and weekly overrides take precedence in both directions for that week only', () => {
  assert.equal(lineupEligibility(player({ active: false }), 4).eligible, false);
  assert.equal(lineupEligibility(player({ active: true, availabilityReport: report('out'), availabilityOverride: override(4, 'available') }), 4).eligible, true);
  assert.equal(lineupEligibility(player({ active: false, availabilityOverride: override(4, 'questionable') }), 4).eligible, true);
  assert.equal(lineupEligibility(player({ active: true, availabilityOverride: override(4, 'out') }), 4).eligible, false);
  assert.equal(lineupEligibility(player({ active: true, availabilityOverride: override(4, 'doubtful') }), 4).eligible, false);
  // an override for another week does not apply
  assert.equal(lineupEligibility(player({ active: true, availabilityReport: report('out'), availabilityOverride: override(5, 'available') }), 4).eligible, false);
});

test('ESPN injury text for Out, injured reserve, PUP, NFI and suspension maps to out; other designations keep their status', () => {
  for (const text of ['Out', 'OUT', 'Injured Reserve', 'IR', 'Reserve/Injured', 'Reserve/PUP', 'PUP', 'NFI', 'Physically Unable to Perform', 'Non-Football Injury', 'Suspension', 'Suspended']) {
    assert.equal(reportedAvailability(text), 'out', text);
  }
  assert.equal(reportedAvailability('Doubtful'), 'doubtful');
  assert.equal(reportedAvailability('Questionable'), 'questionable');
  assert.equal(reportedAvailability('Limited Participation'), 'limited');
  assert.equal(reportedAvailability('Active'), 'available');
  assert.equal(reportedAvailability('Day-To-Day'), 'unknown');
  assert.equal(reportedAvailability(undefined), 'unknown');
});

// ---- integration through the real lineup-pool builder ----
const csv = 'Position,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev\r\nQB,Test QB,100,QB,5000,BUF@DET 10/04/2035 01:00PM ET,BUF\r\n';
const salaries = parseSalaryCsv(csv);
const kickoff = '2035-10-04T17:00:00Z';
const input: SimulationInput = {
  away: { name: 'Buffalo Bills', qb: 'Test QB', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K', passRating: 60, rushRating: 60, defenseRating: 60, context: '',
    roster: [{ id: 'a-qb', name: 'Test QB', position: 'QB' }, { id: 'a-rb', name: 'RB', position: 'RB' }, { id: 'a-wr1', name: 'WR1', position: 'WR' }, { id: 'a-wr2', name: 'WR2', position: 'WR' }, { id: 'a-te', name: 'TE', position: 'TE' }] },
  home: { name: 'Detroit Lions', qb: 'Other QB', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K', passRating: 60, rushRating: 60, defenseRating: 60, context: '',
    roster: [{ id: 'h-qb', name: 'Other QB', position: 'QB' }, { id: 'h-rb', name: 'RB', position: 'RB' }, { id: 'h-wr1', name: 'WR1', position: 'WR' }, { id: 'h-te', name: 'TE', position: 'TE' }] },
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 7,
};
const game = { id: 'game1', week: 4, date: kickoff, awayTeam: input.away.name, homeTeam: input.home.name } as Parameters<typeof gameForecast>[0];
const slate: DKSlate = { id: 'slate', season: 2035, sunday: '2035-10-04', createdAt: '2035-10-03T12:00:00Z', timezone: 'America/Chicago',
  forecasts: [gameForecast(game, input, simulateEnsemble(input, 50))], failures: [] };
const now = Date.parse('2035-10-03T12:00:00Z');
const teams = (patch: Partial<RosterPlayer>) => [{ team: input.away.name, season: 2035,
  players: [{ id: 'a-qb', name: 'Test QB', active: true, position: 'QB', side: 'offense', ...patch }] }] as unknown as TeamSeasonRecord[];

test('buildLineupPool excludes a source-reported Out/IR player with a clear reason, and an Available override brings them back', () => {
  const reportedOut = buildLineupPool(salaries, slate, teams({ availabilityReport: report('out'), availability: 'Injured Reserve' }), now);
  assert.equal(reportedOut.players.length, 0);
  assert.match(reportedOut.issues[0]!.reason, /Source reports Out \(Injured Reserve\)/);
  const forcedIn = buildLineupPool(salaries, slate, teams({ availabilityReport: report('out'), availabilityOverride: override(4, 'available') }), now);
  assert.equal(forcedIn.players.length, 1);
  const questionable = buildLineupPool(salaries, slate, teams({ availabilityReport: report('questionable') }), now);
  assert.equal(questionable.players.length, 1, 'Questionable is flagged elsewhere but not auto-excluded');
  // DraftKings ID and salary stay exactly as imported
  assert.equal(questionable.players[0]!.id, '100');
  assert.equal(questionable.players[0]!.salary, 5000);
});
