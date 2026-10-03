import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { draftKingsAccuracy } from '../artifacts/gridiron-sim/src/lib/draftkings-accuracy';
import { readDKArchive, writeDKArchive, type DKArchive } from '../artifacts/gridiron-sim/src/lib/draftkings-archive';
import type { DKOfficialScore, DKSlate } from '../artifacts/gridiron-sim/src/lib/draftkings-board';
import type { TeamSeasonRecord } from '@workspace/api-client-react';
import type { TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';
import DraftKingsAccuracy from '../artifacts/gridiron-sim/src/components/DraftKingsAccuracy';

const positions = ['QB', 'RB', 'WR', 'TE'] as const;
const roster = positions.map(position => ({ id: position, name: position, position, side: 'offense' as const, active: true }));
const setup: TeamSetup = { name: 'Buffalo Bills', qb: 'QB', rb: 'RB', wr1: 'WR', wr2: '', wr3: '', te: 'TE', kicker: '', passRating: 60, rushRating: 60, defenseRating: 60, context: '', roster };
const team: TeamSeasonRecord = { season: 2026, team: setup.name, version: 1, updatedAt: '2026-10-05T12:00:00Z', players: roster,
  weeks: [{ week: 4, status: 'played', opponent: 'Detroit Lions', venue: 'away', result: 'W', teamScore: 24, opponentScore: 20, teamDefense: {}, playerStats: {} }],
};
const slate: DKSlate = { id: 'first', season: 2026, sunday: '2026-10-04', createdAt: '2026-10-04T14:00:00Z', savedAt: '2026-10-04T16:00:00Z', timezone: 'America/Chicago', failures: [],
  forecasts: [{ gameId: 'game-4', generatedAt: '2026-10-04T15:00:00Z', week: 4, kickoff: '2026-10-04T17:00:00Z', awayTeam: setup.name, homeTeam: 'Detroit Lions', seed: 5, runs: 200, warnings: [],
    input: { away: setup, home: { ...setup, name: 'Detroit Lions' }, weather: { temperatureF: 68, windMph: 5, precipitation: 'none' } },
    players: positions.map((position, i) => ({ playerId: position, name: position, position, team: setup.name, mean: [20, 15, 10, 5][i]!, p10: 0, p90: 30, elite1x: true })),
  }],
};
const official: DKOfficialScore[] = positions.map((position, i) => ({ season: 2026, team: setup.name, playerId: position, week: 4, points: [14, 18, 10, -1][i]!, enteredAt: '2026-10-04T23:00:00Z' }));
const now = Date.parse('2026-10-05T12:00:00Z');
const evaluate = (s: DKSlate[] = [slate], t: TeamSeasonRecord[] = [team], scores: DKOfficialScore[] = official) => draftKingsAccuracy(s, t, scores, 2026, now);
const before = JSON.stringify({ slate, team, official });
const report = evaluate();
assert.deepEqual(report.overall, { count: 4, games: 1, meanAbsoluteError: 3.75, bias: 2.25 });
assert.deepEqual(report.positions.map(p => [p.position, p.count, p.bias]), [['QB', 1, 6], ['RB', 1, -3], ['WR', 1, 0], ['TE', 1, 6]]);
assert.equal(JSON.stringify({ slate, team, official }), before, 'Reporting must not mutate saved forecasts/history');
const latest = structuredClone(slate);
latest.id = 'latest'; latest.savedAt = '2026-10-04T16:30:00Z';
latest.forecasts[0]!.players = latest.forecasts[0]!.players.slice(0, 1);
latest.forecasts[0]!.players[0]!.mean = 16;
const repeated = evaluate([slate, latest]);
assert.equal(repeated.overall.count, 1, 'Use the last whole-game snapshot; do not resurrect removed players');
assert.equal(repeated.overall.bias, 2);
assert.equal(repeated.skipped.duplicateForecasts, 1);
assert.deepEqual(evaluate([latest, slate]), repeated, 'Archive order must not change selection');
for (const mutate of [
  (s: DKSlate) => { delete s.savedAt; },
  (s: DKSlate) => { delete s.forecasts[0]!.generatedAt; },
  (s: DKSlate) => { s.savedAt = '2026-10-04T17:00:00Z'; },
  (s: DKSlate) => { s.forecasts[0]!.generatedAt = '2026-10-04T17:05:00Z'; },
  (s: DKSlate) => { s.forecasts[0]!.generatedAt = 'invalid'; },
]) {
  const invalid = structuredClone(slate); mutate(invalid);
  assert.equal(evaluate([invalid]).overall.count, 0);
  assert.equal(evaluate([invalid]).skipped.timing, 1);
}
assert.equal(draftKingsAccuracy([slate], [team], official, 2026, Date.parse('2026-10-04T16:45:00Z')).overall.count, 0, 'Upcoming games are not actual outcomes');
assert.equal(evaluate([{ ...slate, season: 2025 }]).overall.count, 0);
assert.equal(evaluate([slate], [team], []).skipped.unavailable, 4, 'Missing scores are never zero');
const partial = structuredClone(team);
partial.weeks[0]!.playerStats = Object.fromEntries(positions.map(p => [p, { receivingYards: 50 }]));
assert.equal(evaluate([slate], [partial], []).skipped.partial, 4);
assert.equal(evaluate([slate], [team], official.map(s => ({ ...s, points: 0 }))).overall.count, 4, 'Explicit official zero is valid');
assert.equal(evaluate([slate], [team], official.map(s => ({ ...s, enteredAt: slate.createdAt }))).skipped.mismatch, 4, 'Actual entries made before kickoff cannot count');
for (const patch of [{ opponent: 'Wrong team' }, { venue: 'home' as const }, { status: 'bye' as const }]) {
  const mismatch = structuredClone(team); Object.assign(mismatch.weeks[0]!, patch);
  assert.equal(evaluate([slate], [mismatch]).overall.count, 0);
}
const full = structuredClone(team);
const zeros = Object.fromEntries(['passYards','passTD','interceptions','rushYards','rushTD','receptions','receivingYards','receivingTD','fumblesLost','kickReturnTD','puntReturnTD','fieldGoalReturnTD','twoPointConversions','offensiveFumbleRecoveryTD'].map(k => [k, 0]));
full.weeks[0]!.playerStats = Object.fromEntries(positions.map(p => [p, { ...zeros }]));
assert.equal(evaluate([slate], [full], []).overall.count, 4, 'Fully specified recorded scoring lines can count without manual scores');
const wrongEvent = structuredClone(full);
wrongEvent.weeks[0]!.source = { provider: 'ESPN', url: 'https://espn.com/', fetchedAt: '2026-10-05T01:00:00Z', eventId: 'different-game' };
assert.equal(evaluate([slate], [wrongEvent], []).skipped.mismatch, 4);
const storage = { value: '', getItem() { return this.value; }, setItem(_key: string, value: string) { this.value = value; } };
const archive: DKArchive = { version: 1, slates: [slate], official };
writeDKArchive(storage, archive);
const restored = readDKArchive(storage);
assert.equal(restored.slates[0]!.savedAt, slate.savedAt);
assert.equal(restored.slates[0]!.forecasts[0]!.generatedAt, slate.forecasts[0]!.generatedAt);
assert.equal(restored.slates[0]!.forecasts[0]!.players[0]!.elite1x, true);
assert.deepEqual(evaluate(restored.slates, [team], restored.official), report, 'Reload retains timing and report results');
const legacy = structuredClone(slate); delete legacy.savedAt; delete legacy.forecasts[0]!.generatedAt;
writeDKArchive(storage, { ...archive, slates: [legacy] });
assert.equal(readDKArchive(storage).slates.length, 1, 'Legacy archives still load; no migration or deletion');
Object.defineProperty(globalThis, 'window', { value: { location: { search: '?section=accuracy' } }, configurable: true });
const render = (r: typeof report) => renderToStaticMarkup(createElement(DraftKingsAccuracy, { report: r, season: 2026, loading: false, failed: false, refresh: () => {} }));
const html = render(report);
assert.ok(html.includes('3.75') && html.includes('High by 2.25') && html.includes('Low by 3.00'));
assert.ok(render(evaluate([], [], [])).includes('No complete comparisons yet'));
assert.ok(!render(evaluate([], [], [])).includes('NaN'));
console.log('Accuracy metrics, bias signs, timing guards, repeat-run selection, all positions, unknown/partial/zero scores, matchup identity, archive reload, legacy preservation and report rendering passed.');