import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateEnsemble } from '../../artifacts/gridiron-sim/src/lib/ensemble';
import { simulateGame, type TeamSetup, type SimulationInput } from '../../artifacts/gridiron-sim/src/lib/simulator';
import { gameForecast } from '../../artifacts/gridiron-sim/src/lib/draftkings-board';
import { emptyDKArchive, validateDKArchive, addDKSlate } from '../../artifacts/gridiron-sim/src/lib/draftkings-archive';

function team(name: string): TeamSetup {
  return {
    name, qb: `${name} QB`, rb: `${name} RB`, wr1: `${name} WR1`, wr2: `${name} WR2`,
    wr3: `${name} WR3`, te: `${name} TE`, kicker: `${name} K`,
    passRating: 75, rushRating: 75, defenseRating: 65, context: '',
    roster: ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE'].map((role, i) => ({
      id: `${name}-${i}`, name: `${name} ${role}`, position: role.startsWith('WR') ? 'WR' : role as 'QB' | 'RB' | 'TE',
    })),
  };
}
const base: SimulationInput = {
  away: team('Away'), home: team('Home'), weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 98765,
};

for (const driveModel of [undefined, 'possession-v1'] as const) {
  test(`high-scoring summaries reach +20% with unchanged raw outcomes (${driveModel ?? 'legacy'})`, () => {
    const input = { ...base, driveModel };
    const baseline = simulateEnsemble(input, 200);
    const original = structuredClone(input);
    const flagged = simulateEnsemble({ ...input, highScoring: true }, 200);
    assert.deepEqual(input, original);
    assert.deepEqual(simulateEnsemble({ ...input, highScoring: false }, 200), baseline);
    assert.deepEqual(flagged.players, baseline.players);
    assert.deepEqual(flagged.defenses, baseline.defenses);
    assert.deepEqual(flagged.drives, baseline.drives);
    assert.equal(flagged.awayScore, baseline.awayScore);
    assert.equal(flagged.homeScore, baseline.homeScore);
    const evidence = flagged.ensemble!.highScoring!;
    assert.ok(Math.abs(evidence.adjustedTotal - evidence.targetTotal) < 1e-6);
    assert.ok(Math.abs(evidence.targetTotal / evidence.baselineTotal - 1.2) < 1e-8);
    assert.ok(flagged.ensemble!.fantasy.reduce((sum, p) => sum + p.mean, 0)
      > baseline.ensemble!.fantasy.reduce((sum, p) => sum + p.mean, 0));
    assert.notDeepEqual(flagged.ensemble!.fantasy, baseline.ensemble!.fantasy);
    assert.notDeepEqual(flagged.ensemble!.defenseFantasy, baseline.ensemble!.defenseFantasy);
    assert.ok(Math.abs(flagged.ensemble!.awayWinPct + flagged.ensemble!.homeWinPct + flagged.ensemble!.tiePct - 100) <= 0.02);
    // Neither single-game stat generation nor point calculation consults the manual flag.
    assert.deepEqual(simulateGame({ ...input, highScoring: true }), simulateGame(input));
  });
}

test('manual setting composes with market odds and records the resulting expectation', () => {
  const input: SimulationInput = { ...base, driveModel: 'possession-v1', market: {
    enabled: true, source: 'manual', awayTeam: 'Away', homeTeam: 'Home',
    total: 50, homeSpread: -3, recordedAt: new Date().toISOString(),
  } };
  const market = simulateEnsemble(input, 200);
  const combined = simulateEnsemble({ ...input, highScoring: true }, 200);
  const evidence = combined.ensemble!.highScoring!;
  assert.deepEqual(combined.ensemble!.market, market.ensemble!.market);
  assert.ok(Math.abs(evidence.baselineTotal - (market.ensemble!.market!.weighted.away + market.ensemble!.market!.weighted.home)) <= 0.02);
  assert.ok(Math.abs(evidence.adjustedTotal - evidence.baselineTotal * 1.2) < 1e-6);
});

test('archive/export/replay freezes selection and leaves legacy forecasts untouched', () => {
  const game = { id: 'game', week: 6, date: '2026-10-11T17:00:00Z', awayTeam: 'Away', homeTeam: 'Home' };
  const input = { ...base, driveModel: 'possession-v1' as const, highScoring: true };
  const result = simulateEnsemble(input, 200);
  const forecast = gameForecast(game, input, result);
  const legacy = gameForecast({ ...game, id: 'legacy' }, base, simulateEnsemble(base, 200));
  const legacyBefore = JSON.parse(JSON.stringify(legacy));
  const slate = { id: 'slate', season: 2026, sunday: '2026-10-11', createdAt: new Date().toISOString(),
    timezone: 'America/Chicago' as const, forecasts: [forecast, legacy], failures: [] };
  const archive = addDKSlate({ ...emptyDKArchive(), marketDrafts: {
    '2026:game': { enabled: false, manual: false, total: '', homeSpread: '', recordedAt: '', highScoring: true },
  } }, slate);
  const reread = validateDKArchive(JSON.parse(JSON.stringify(archive)));
  assert.equal(reread.marketDrafts!['2026:game']!.highScoring, true);
  assert.equal(reread.slates[0]!.forecasts[0]!.input.highScoring, true);
  assert.deepEqual(reread.slates[0]!.forecasts[0]!.highScoring, result.ensemble!.highScoring);
  reread.marketDrafts!['2026:game']!.highScoring = false;
  assert.deepEqual(simulateEnsemble(reread.slates[0]!.forecasts[0]!.input, 200), result);
  assert.deepEqual(reread.slates[0]!.forecasts[1], legacyBefore);
  assert.equal('highScoring' in reread.slates[0]!.forecasts[1]!.input, false);
  assert.ok(forecast.warnings.some(w => w.includes('Manual high-scoring')));
  assert.throws(() => validateDKArchive({ ...archive, marketDrafts: {
    '2026:game': { ...archive.marketDrafts!['2026:game'], highScoring: 'yes' },
  } }));
});

test('invalid high-scoring input fails explicitly', () => {
  assert.throws(() => simulateEnsemble({ ...base, highScoring: true }, 10), /at least 20/);
  assert.throws(() => simulateEnsemble({ ...base, highScoring: 'yes' as unknown as boolean }, 20), /on or off/);
});
