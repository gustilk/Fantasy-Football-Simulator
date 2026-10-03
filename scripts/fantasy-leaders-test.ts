import assert from 'node:assert/strict';
import { groupFantasyLeaders } from '../artifacts/gridiron-sim/src/lib/fantasy-leaders';

const players = [
  { name: 'Away QB', position: 'QB', draftKings: 20 },
  { name: 'Home QB', position: 'QB', draftKings: 32.5 },
  { name: 'Below threshold', position: 'WR', draftKings: 19.99 },
  { name: 'Receiver', position: 'WR', draftKings: 25 },
  { name: 'Running back', position: 'RB', draftKings: 21 },
  { name: 'Kicker', position: 'K', draftKings: 30 },
  { name: 'Invalid', position: 'TE', draftKings: NaN },
];
const before = JSON.stringify(players);
const groups = groupFantasyLeaders(players);
assert.deepEqual(groups.map(group => group.label), ['QB', 'Receivers', 'RB', 'Tight End']);
assert.deepEqual(groups[0].players.map(player => player.name), ['Home QB', 'Away QB']);
assert.deepEqual(groups[1].players.map(player => player.name), ['Receiver']);
assert.equal(groups[2].players.length, 1);
assert.equal(groups[3].players.length, 0);
assert.equal(JSON.stringify(players), before, 'Grouping must not mutate original results');
assert.ok(groupFantasyLeaders([]).every(group => group.players.length === 0));
console.log('Fantasy leader threshold, positions, descending order, and empty-state tests passed.');