import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCaptainGroup, validateCaptainCsv, validateCaptainMatchup, CaptainUnavailable } from './captain-salaries.ts';

const matchup = { season: 2026, awayTeam: 'Tampa Bay Buccaneers', homeTeam: 'Dallas Cowboys', kickoff: '2026-10-09T00:15:00Z' };
const now = Date.parse('2026-10-05T12:00:00Z');
const draftGroup = { DraftGroupId: 123, Sport: 'NFL', GameTypeId: 96, GameCount: 1,
  StartDate: matchup.kickoff, DraftGroupTag: 'Featured', GameSetKey: 'match' };
const competition = { Sport: 'NFL', Status: 'Pre-Game', StartDate: matchup.kickoff, Description: 'TB @ DAL',
  AwayTeamCity: 'Tampa Bay', AwayTeamName: 'Buccaneers', HomeTeamCity: 'Dallas', HomeTeamName: 'Cowboys' };
const lobby = { SelectedSport: 'NFL', DraftGroups: [draftGroup], GameSets: [{ GameSetKey: 'match', Competitions: [competition] }] };
const group = selectCaptainGroup(lobby, matchup, now);
const header = 'Position,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev';
const rows = Array.from({ length: 6 }, (_, i) => {
  const team = i < 3 ? 'TB' : 'DAL';
  const position = i === 4 ? 'K' : i === 5 ? 'DST' : 'WR';
  return [`${position},Player ${i},${100 + i},FLEX,6000,TB@DAL 10/08/2026 08:15PM ET,${team}`,
    `${position},Player ${i},${200 + i},CPT,9000,TB@DAL 10/08/2026 08:15PM ET,${team}`];
}).flat();
const csv = [header, ...rows].join('\n');

test('selects only full-game Captain for exact teams and kickoff', () => {
  assert.equal(group.DraftGroupId, 123);
  assert.equal(group.awayAbbrev, 'TB');
  for (const GameTypeId of [1, 159, 192, 354, 108, 110]) {
    assert.throws(() => selectCaptainGroup({ ...lobby, DraftGroups: [{ ...draftGroup, GameTypeId }] }, matchup, now), CaptainUnavailable);
  }
  for (const changed of [{ homeTeam: 'New Orleans Saints' }, { kickoff: '2026-10-16T00:15:00Z' }]) {
    assert.throws(() => selectCaptainGroup(lobby, { ...matchup, ...changed }, now), CaptainUnavailable);
  }
});
test('requires confirmed single pregame competition and valid lobby', () => {
  for (const games of [[], [competition, competition], [{ ...competition, Status: 'In-Progress' }],
    [{ ...competition, StartDate: '2026-10-16T00:15:00Z' }]]) {
    assert.throws(() => selectCaptainGroup({ ...lobby, GameSets: [{ GameSetKey: 'match', Competitions: games }] }, matchup, now), CaptainUnavailable);
  }
  assert.throws(() => selectCaptainGroup({ ...lobby, SelectedSport: 'NBA' }, matchup, now));
});
test('rejects past kickoff, wrong season and identical teams', () => {
  assert.throws(() => validateCaptainMatchup(matchup, Date.parse(matchup.kickoff)));
  assert.throws(() => validateCaptainMatchup({ ...matchup, season: 2025 }, now));
  assert.throws(() => validateCaptainMatchup({ ...matchup, homeTeam: matchup.awayTeam }, now));
  assert.throws(() => validateCaptainMatchup({ ...matchup, kickoff: 'not-a-date' }, now));
});
test('validates complete paired CPT/FLEX rows including kickers and DST', () => {
  assert.doesNotThrow(() => validateCaptainCsv(csv, group));
  assert.throws(() => validateCaptainCsv([header, ...rows.filter(r => !r.includes(',CPT,'))].join('\n'), group));
  assert.throws(() => validateCaptainCsv(csv.replace('CPT,9000', 'CPT,8000'), group));
  assert.throws(() => validateCaptainCsv(csv.replace(',200,CPT', ',100,CPT'), group));
  assert.throws(() => validateCaptainCsv(csv.replace('WR,Player 0,200,CPT', 'QB,Player 0,200,CPT'), group));
});
test('rejects wrong matchup, kickoff, game count, duplicate rows, malformed CSV', () => {
  for (const invalid of [csv.replace('TB@DAL', 'ATL@NO'), csv.replace('08:15PM', '08:20PM'),
    csv.replace('10/08/2026', '10/15/2026'), csv + '\n' + rows[0],
    csv.replace('Player 0', '"Unclosed'), '<html>Sign in</html>']) {
    assert.throws(() => validateCaptainCsv(invalid, group));
  }
});
