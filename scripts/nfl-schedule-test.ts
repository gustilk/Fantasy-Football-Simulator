import assert from 'node:assert/strict';
import { parseUpcomingSchedule, type ScheduleEvent } from '../artifacts/api-server/src/lib/nfl-schedule';

const names = new Map([['1', 'Atlanta Falcons'], ['2', 'Buffalo Bills']]);
const now = Date.parse('2026-10-03T12:00:00Z');
const event = (id: string, date = '2026-10-04T17:00:00Z'): ScheduleEvent => ({
  id, date, season: { year: 2026, type: 2 }, week: { number: 4 },
  status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
  competitions: [{ timeValid: true, competitors: [
    { homeAway: 'home', team: { id: '2' } }, { homeAway: 'away', team: { id: '1' } },
  ] }],
});
const january = { ...event('january', '2027-01-10T18:00:00Z'), week: { number: 18 } };
const postseason = { ...event('playoff', '2027-01-17T18:00:00Z'), season: { year: 2026, type: 3 }, week: { number: 1 } };
const tbd = { ...event('tbd'), competitions: [{ timeValid: false, competitors: [{ homeAway: 'home', team: { id: '0' } }] }] };
const past = event('past', '2026-10-02T17:00:00Z');
const finished = { ...event('finished'), status: { type: { state: 'post' } } };
const live = { ...event('live'), status: { type: { state: 'in' } } };
const cancelled = { ...event('cancelled'), status: { type: { state: 'pre', name: 'STATUS_CANCELED' } } };
const wrongSeason = { ...event('wrong'), season: { year: 2025, type: 2 } };
const preseason = { ...event('preseason'), season: { year: 2026, type: 1 } };
const invalidDate = event('invalid', 'not-a-date');
const unknownWeek = { ...event('week'), week: { number: 25 } };
const result = parseUpcomingSchedule([
  january, postseason, event('soon'), event('soon'), tbd, tbd, past, finished, live, cancelled,
  wrongSeason, preseason, invalidDate, unknownWeek,
], 2026, names, now);
assert.deepEqual(result.games.map(game => game.id), ['soon', 'january', 'playoff']);
assert.equal(result.games[0].awayTeam, 'Atlanta Falcons');
assert.equal(result.games[0].homeTeam, 'Buffalo Bills', 'Home/away is based on source labels, not array order');
assert.equal(result.games[1].week, 18);
assert.equal(result.games[2].week, 19, 'Playoffs use weeks after all regular-season history');
assert.equal(result.games[2].seasonType, 'postseason');
assert.equal(result.unannouncedGames, 1);
assert.deepEqual(parseUpcomingSchedule([], 2026, names, now), { games: [], unannouncedGames: 0 });
const unconfirmed = event('unconfirmed');
unconfirmed.competitions![0].timeValid = false;
assert.equal(parseUpcomingSchedule([unconfirmed], 2026, names, now).games[0].timeConfirmed, false);
console.log('NFL schedule season, future status, home/away, January, playoff, deduplication, order and TBD tests passed.');