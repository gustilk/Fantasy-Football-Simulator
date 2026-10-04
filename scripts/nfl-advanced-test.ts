import assert from 'node:assert/strict';
import { csvRecords, sourceNumber } from '../artifacts/api-server/src/lib/nfl-advanced-csv';
import { advancedReport, parseAdvancedSeason } from '../artifacts/api-server/src/lib/nfl-advanced-data';
import type { NflAdvancedSource } from '@workspace/api-zod';

const csv = (header: string[], rows: Record<string, string | number>[]) => header.join(',') + '\n' + rows.map(row =>
  header.map(key => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
const ids = csv(['gsis_id', 'pfr_id', 'espn_id', 'display_name', 'position'], [
  { gsis_id: 'WR1', pfr_id: 'Wr0100', espn_id: 100, display_name: 'Receiver One', position: 'WR' },
  { gsis_id: 'RB1', pfr_id: 'Rb0100', espn_id: 101, display_name: 'Runner One', position: 'RB' },
  { gsis_id: 'QB1', pfr_id: 'Qb0100', espn_id: 102, display_name: 'Quarterback One', position: 'QB' },
  { gsis_id: 'QB2', pfr_id: 'Qb0200', espn_id: 103, display_name: 'Backup Zero Snaps', position: 'QB' },
  { gsis_id: 'WR2', pfr_id: 'Wr0200', espn_id: 200, display_name: 'Opponent Receiver', position: 'WR' },
]);
const headers = ['season', 'season_type', 'week', 'game_id', 'play_id', 'game_date', 'home_team', 'away_team', 'posteam', 'defteam',
  'play_type', 'qb_dropback', 'rush_attempt', 'pass_attempt', 'epa', 'air_yards', 'qb_hit', 'sack', 'receiver_player_id', 'receiver_player_name',
  'rusher_player_id', 'rusher_player_name', 'passer_player_id', 'passer_player_name', 'desc', 'qb_kneel', 'qb_spike', 'two_point_attempt', 'time_of_day', 'play_deleted'];
const base = { season: 2026, season_type: 'REG', week: 1, game_id: '2026_01_BUF_DET', game_date: '2026-09-13',
  home_team: 'DET', away_team: 'BUF', posteam: 'BUF', defteam: 'DET', qb_dropback: 0, rush_attempt: 0, pass_attempt: 0, qb_hit: 0, sack: 0, play_type: 'pass', desc: 'Valid play' };
const rows = [
  { ...base, play_id: 1, qb_dropback: 1, pass_attempt: 1, receiver_player_id: 'WR1', air_yards: -2, epa: 0.2 },
  { ...base, play_id: 2, qb_dropback: 1, pass_attempt: 1, receiver_player_id: 'WR1', air_yards: 12, epa: 0.4 },
  { ...base, play_id: 3, play_type: 'run', rush_attempt: 1, rusher_player_id: 'RB1', epa: -0.1 },
  { ...base, play_id: 4, play_type: 'run', rush_attempt: 1, rusher_player_id: 'QB1', qb_dropback: 1, epa: 0.5 },
  { ...base, play_id: 5, play_type: 'run', rush_attempt: 1, rusher_player_id: 'QB1', qb_kneel: 1 },
  { ...base, play_id: 6, play_type: 'no_play', pass_attempt: 1, qb_dropback: 1, receiver_player_id: 'WR1', air_yards: 100 },
  { ...base, play_id: 7, pass_attempt: 1, qb_dropback: 1, receiver_player_id: 'WR1', two_point_attempt: 1, air_yards: 100 },
  { ...base, play_id: 8, posteam: 'DET', defteam: 'BUF', qb_dropback: 1, pass_attempt: 1, receiver_player_id: 'WR2', epa: 1.2, qb_hit: 1, sack: 1 },
  { ...base, play_id: 9, posteam: 'DET', defteam: 'BUF', qb_dropback: 1, pass_attempt: 1, receiver_player_id: 'WR2', epa: -0.4 },
  { ...base, play_id: 10, play_type: '', desc: 'END GAME' },
  { ...base, play_id: 1, game_id: '2026_02_BUF_DET', week: 2, game_date: '2026-09-20', pass_attempt: 1, qb_dropback: 1, receiver_player_id: 'WR1', air_yards: 99 }, // no end marker
  { ...base, play_id: 1, game_id: '2026_03_BUF_DET', week: 3, game_date: '2026-09-27', pass_attempt: 1, qb_dropback: 1, receiver_player_id: 'WR1', air_yards: 99 },
  { ...base, play_id: 2, game_id: '2026_03_BUF_DET', week: 3, game_date: '2026-09-27', play_type: '', desc: 'END GAME' },
  { ...base, play_id: 1, game_id: '2026_04_BUF_DET', week: 4, game_date: '2026-10-04', play_type: '', desc: 'END GAME', time_of_day: '2026-10-04T23:00:00Z' },
];
const snapHeaders = ['season', 'game_type', 'week', 'game_id', 'pfr_player_id', 'player', 'position', 'team', 'offense_snaps', 'offense_pct'];
const snapBase = { season: 2026, game_type: 'REG', week: 1, game_id: '2026_01_BUF_DET', team: 'BUF' };
const snaps = csv(snapHeaders, [
  { ...snapBase, pfr_player_id: 'Wr0100', player: 'Source Alias', position: 'WR', offense_snaps: 10, offense_pct: 0.5 },
  { ...snapBase, pfr_player_id: 'Rb0100', player: 'Runner One', position: 'RB', offense_snaps: 5, offense_pct: 0.25 },
  { ...snapBase, pfr_player_id: 'Qb0100', player: 'Quarterback One', position: 'QB', offense_snaps: 20, offense_pct: 1 },
  { ...snapBase, pfr_player_id: 'Qb0200', player: 'Backup Zero Snaps', position: 'QB', offense_snaps: 0, offense_pct: 0 },
]);
const pbp = csv(headers, rows), original = JSON.stringify({ pbp, snaps, ids });
const data = parseAdvancedSeason(2026, pbp, snaps, ids);
const sources: NflAdvancedSource[] = ['play-by-play', 'snap-counts', 'player-identities'].map(kind => ({ kind: kind as NflAdvancedSource['kind'], url: 'https://example.test', status: 'available', fetchedAt: null, updatedAt: null }));
const now = Date.parse('2026-10-04T11:00:00Z');
const report = advancedReport(data, 'Buffalo Bills', 3, sources, now);
assert.equal(report.games, 1, 'Cutoff excludes its own week and uncompleted games');
assert.equal(report.dataThroughWeek, 1);
const receiver = report.players.find(p => p.playerId === 'espn:100')!;
assert.equal(receiver.name, 'Receiver One', 'Stable ID mapping, not source-name guessing');
assert.equal(receiver.targets, 2);
assert.equal(receiver.airYards, 10);
assert.equal(receiver.airYardsPerTarget, 5);
assert.equal(receiver.snapShare, 0.5);
assert.equal(receiver.targetShare, 1);
assert.equal(report.players.find(p => p.playerId === 'espn:102')!.carryShare, 0.5, 'Count QB scrambles as carries, exclude kneels');
const backup = report.players.find(p => p.playerId === 'espn:103')!;
assert.equal(backup.offenseSnaps, 0, 'A recorded zero snap count is valid');
assert.equal(backup.targets, null, 'No observed participation must not invent zero opportunity');
assert.equal(report.defense.passEpaAllowed, 0.4);
assert.equal(report.defense.sackHitRate, 0.5, 'Overlapping hit+sack counts once');
assert.equal(report.defense.pressureRate, null, 'Never call hit/sack coverage a true pressure rate');
assert.equal(advancedReport(data, 'Buffalo Bills', 5, sources, now).games, 2, 'Future end timestamp excluded even when source marks complete');
assert.equal(advancedReport(data, 'Buffalo Bills', 1, sources, now).games, 0);
assert.equal(advancedReport(parseAdvancedSeason(2026), 'Buffalo Bills', 4, [], now).status, 'unavailable');
assert.equal(advancedReport(parseAdvancedSeason(2026, pbp, undefined, ids), 'Buffalo Bills', 3, sources, now).players.find(p => p.playerId === 'espn:100')!.snapShare, null);
const unknown = advancedReport(parseAdvancedSeason(2026, pbp, snaps), 'Buffalo Bills', 3, sources, now);
assert.ok(unknown.unmatchedPlayers > 0);
assert.ok(unknown.players.every(p => p.playerId === null), 'No crosswalk means no invented ESPN IDs');
assert.throws(() => parseAdvancedSeason(2025, pbp, snaps, ids), /Wrong-season/);
assert.throws(() => parseAdvancedSeason(2026, csv(headers, [...rows, rows[0]!]), snaps, ids), /Duplicate play/);
assert.throws(() => parseAdvancedSeason(2026, 'bad,headers'), /columns changed/);
assert.deepEqual([...csvRecords('a,b\n"hello,\n""world""",2\n')], [{ a: 'hello,\n"world"', b: '2' }]);
assert.equal(sourceNumber('NA'), null); assert.equal(sourceNumber(''), null); assert.equal(sourceNumber('-8'), -8);
assert.equal(sourceNumber('1.2e-7'), 1.2e-7); assert.equal(sourceNumber('Infinity'), null);
assert.equal(JSON.stringify({ pbp, snaps, ids }), original);
console.log('Advanced stats: season/cutoff/completion safeguards, stable identity matching, unknown/DNP handling, shares, negative air yards, EPA, unique sack/hit proxy, partial coverage, CSV and unchanged inputs passed.');