import assert from 'node:assert/strict';
import { advancedReport, parseAdvancedSeason } from '../artifacts/api-server/src/lib/nfl-advanced-data.ts';

const fields = ['season', 'season_type', 'week', 'game_id', 'play_id', 'game_date', 'home_team', 'away_team', 'posteam', 'defteam',
  'play_type', 'qb_dropback', 'rush_attempt', 'pass_attempt', 'epa', 'air_yards', 'qb_hit', 'sack', 'receiver_player_id', 'rusher_player_id', 'desc',
  'yards_gained', 'down', 'ydstogo', 'drive', 'fixed_drive', 'yardline_100', 'touchdown', 'td_team', 'interception', 'fumble_lost', 'qb_kneel'];
const base = { season: '2025', season_type: 'REG', week: '1', game_id: '2025_01_GB_DET', game_date: '2025-09-07', home_team: 'DET', away_team: 'GB',
  posteam: 'GB', defteam: 'DET', play_type: 'run', qb_dropback: '0', rush_attempt: '1', pass_attempt: '0', epa: '0', air_yards: 'NA',
  qb_hit: '0', sack: '0', receiver_player_id: 'NA', rusher_player_id: 'NA', desc: 'PLAY', down: '1', ydstogo: '10', touchdown: '0',
  td_team: 'NA', interception: '0', fumble_lost: '0', fixed_drive: 'NA' };
const rows: Record<string, string>[] = [
  { drive: '1', yardline_100: '75', yards_gained: '15' },
  { drive: '1', yardline_100: '60', yards_gained: '4' },
  { drive: '2', yardline_100: '20', yards_gained: '0' },
  { drive: '2', yardline_100: '20', yards_gained: '20', down: '2', touchdown: '1', td_team: 'GB' },
  { drive: '3', yardline_100: '12', yards_gained: '4', down: '3', ydstogo: '5' },
  { drive: '4', yardline_100: '10', yards_gained: '1', down: '4', ydstogo: '2' },
  { drive: '5', yardline_100: '45', yards_gained: '45', touchdown: '1', td_team: 'GB' },
  { drive: '6', yardline_100: '12', yards_gained: 'NA', down: 'NA', touchdown: 'NA' },
  { drive: '7', yardline_100: '8', yards_gained: '20', qb_kneel: '1', touchdown: '1', td_team: 'GB' },
  { desc: 'END GAME', play_type: 'no_play', rush_attempt: '0' },
  { week: '2', game_id: '2025_02_GB_DET', game_date: '2025-09-14', drive: '1', yardline_100: '5', yards_gained: '5', touchdown: '1', td_team: 'GB' },
  { week: '2', game_id: '2025_02_GB_DET', game_date: '2025-09-14', desc: 'END GAME', play_type: 'no_play', rush_attempt: '0' },
];
const csv = (items: Record<string, string>[], columns = fields) => [columns.join(','), ...items.map((row, i) => columns.map(k => ({ ...base, play_id: String(i + 1), ...row } as Record<string, string>)[k] ?? '').join(','))].join('\n');
const data = parseAdvancedSeason(2025, csv(rows));
const now = Date.parse('2025-10-01T12:00:00Z');
const offense = advancedReport(data, 'Green Bay Packers', 2, [], now).offense!;
const defense = advancedReport(data, 'Detroit Lions', 2, [], now).defense;
assert.equal(offense.successSamples, 7);
assert.equal(offense.successRate, 0.5714);
assert.equal(offense.explosiveSamples, 7);
assert.equal(offense.explosivePlayRate, 0.4286, '15-yard boundary is inclusive.');
assert.equal(offense.redZoneTrips, 3, 'A drive counts once, not once per red-zone play.');
assert.equal(offense.redZoneTdRate, 0.3333, 'Long touchdowns from outside the zone are not red-zone trips.');
assert.equal(defense.successRateAllowed, offense.successRate);
assert.equal(defense.explosivePlayRateAllowed, offense.explosivePlayRate);
assert.equal(defense.redZoneTdRateAllowed, offense.redZoneTdRate);
assert.equal(defense.redZoneTrips, 3);
assert.equal(advancedReport(data, 'Green Bay Packers', 1, [], now).offense!.explosivePlayRate, null, 'No post-cutoff evidence leaks.');
const missing = parseAdvancedSeason(2025, csv(rows.slice(0, 10), fields.filter(k => !['yards_gained', 'down', 'ydstogo', 'drive', 'fixed_drive', 'touchdown', 'td_team'].includes(k))));
const unknown = advancedReport(missing, 'Green Bay Packers', 2, [], now).offense!;
assert.equal(unknown.successRate, null);
assert.equal(unknown.explosivePlayRate, null);
assert.equal(unknown.redZoneTdRate, null);
console.log('Observed drive metrics: sample denominators, missing evidence, red-zone deduplication, defensive symmetry and pre-week cutoff passed.');
