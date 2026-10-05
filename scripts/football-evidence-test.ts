import assert from 'node:assert/strict';
import { footballBlend, footballSetup } from '../artifacts/gridiron-sim/src/lib/football-evidence';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { simulateGame, footballPassingShare } from '../artifacts/gridiron-sim/src/lib/simulator';
import { runSingleGameSimulation } from '../artifacts/gridiron-sim/src/lib/weekly-simulations';
import type { NflAdvancedReport, TeamSeasonRecord } from '@workspace/api-client-react';

const team: TeamSeasonRecord = { season: 2026, team: 'Buffalo Bills', version: 1,
  players: ['QB', 'RB', 'WR', 'TE'].map((position, i) => ({
    id: `espn:${i + 100}`, name: `Sample ${position}`, position: position as 'QB' | 'RB' | 'WR' | 'TE',
    side: 'offense', active: true, depthRank: 1,
  })),
  weeks: Array.from({ length: 6 }, (_, i) => ({ week: i + 1, opponent: 'Detroit Lions', venue: 'away' as const,
    status: 'played' as const, result: 'W' as const, scoreFor: 24, scoreAgainst: 21,
    playerStats: { 'espn:100': { passAttempts: i === 1 ? 60 : 30, passCompletions: 20, passYards: 230, passTD: 1 },
      'espn:101': { rushAttempts: 18, rushYards: 80, receptions: 3, targets: 4, receivingYards: 24 },
      'espn:102': { targets: 8, receptions: 5, receivingYards: 65 },
      'espn:103': { targets: 6, receptions: 4, receivingYards: 45 } },
    teamDefense: { passYardsAllowed: 225, rushYardsAllowed: 115 } })),
};
function report(season: number, games = 4): NflAdvancedReport {
  return { season, team: team.team, beforeWeek: season === 2026 ? 7 : 19, fetchedAt: '2026-10-01T00:00:00Z',
    status: 'available', games, sampleWeeks: Array.from({ length: games }, (_, i) => i + 1),
    dataThroughWeek: games, unmatchedPlayers: 0, sources: [], warnings: [],
    players: [{ playerId: 'espn:101', sourcePlayerId: 'gsis:RB', name: 'Sample RB', position: 'RB',
      games, snapGames: games, opportunityGames: games, offenseSnaps: 140, snapShare: 0.65,
      targets: 12, targetShare: 0.18, carries: 70, carryShare: 0.7, airYards: -4, airYardsPerTarget: -0.3, airYardTargets: 12,
      redZoneTargetShare: 0.3, goalLineCarryShare: 0.9 }],
    defense: { passPlays: 140, rushPlays: 100, passEpaPlays: 140, rushEpaPlays: 100, passEpaAllowed: 0.25,
      rushEpaAllowed: -0.2, sackHitPlays: 140, sackHitRate: 0.14, pressureRate: null, offensePlaysPerGame: 64,
      sackRate: 0.05, receivingEpaAllowed: 0.1, positionEpaAllowed: { RB: 0.4, WR: 0.1, TE: -0.2 },
      positionEpaSamples: { RB: 24, WR: 50, TE: 24 } },
    offense: { dropbackShare: 0.65, passEpa: 0.2, rushEpa: -0.1, passSamples: 140, rushSamples: 100, playsPerGame: 64 } };
}
assert.equal(footballBlend(undefined, undefined, 4, 17), undefined);
assert.equal(footballBlend(0, 10, 4, 17), 30 / 7, 'Reported zero counts; prior capped at three game equivalents');
const current = report(2026), prior = report(2025, 17), before = JSON.stringify({ team, current, prior });
const setup = footballSetup(team, 7, 'away', 'Detroit Lions', { current, prior, issues: [] });
assert.equal(setup.footballEvidence?.version, 'football-v2');
assert.equal(setup.footballEvidence?.sources.length, 2);
assert.ok(setup.footballEvidence!.passDefenseRating < setup.footballEvidence!.rushDefenseRating);
assert.ok(Math.abs(setup.roster!.find(p => p.id === 'espn:101')!.football!.goalLineCarryShare! - 0.9) < 1e-10);
assert.ok(setup.footballEvidence!.positionMatchups.RB!.delta > 0);
assert.ok(setup.footballEvidence!.positionMatchups.TE!.delta < 0);
assert.equal(JSON.stringify({ team, current, prior }), before, 'Evidence builder cannot mutate source/library rows');
const unavailable = footballSetup(team, 7, 'away', 'Detroit Lions', { issues: ['Source offline'] });
assert.equal(unavailable.footballEvidence?.sources.length, 0);
assert.ok(unavailable.footballEvidence?.warnings.some(w => w.includes('Source offline')));
assert.equal(unavailable.footballEvidence?.dropbackShare, undefined);
assert.equal(footballSetup(team, 7, 'away', 'Detroit Lions', { current: { ...current, season: 2025 }, issues: [] }).footballEvidence?.sources.length, 0);
assert.equal(footballSetup(team, 7, 'away', 'Detroit Lions', { current: { ...current, dataThroughWeek: 7 }, issues: [] }).footballEvidence?.sources.length, 0);
const inactive = structuredClone(team); inactive.players[1]!.active = false;
assert.ok(!footballSetup(inactive, 7, 'away', 'Detroit Lions', { current, prior, issues: [] }).roster?.some(p => p.id === 'espn:101'));
const base = setupFromHistory(team, 7, 'away', 'Detroit Lions');
assert.equal(base.footballEvidence, undefined, 'Legacy builder never activates new behavior');
assert.notEqual(base.roster?.[0]?.recentStats?.passAttempts, unavailable.roster?.[0]?.recentStats?.passAttempts, 'New four-game window differs from old five-game window');
const input = { away: setup, home: { ...setup, name: 'Detroit Lions' }, seed: 90210,
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' as const } };
assert.equal(JSON.stringify(simulateGame(input)), JSON.stringify(simulateGame(JSON.parse(JSON.stringify(input)))), 'Frozen JSON replay is deterministic');
const original = simulateGame({ ...input, away: base, home: { ...base, name: 'Detroit Lions' } });
const oldAgain = simulateGame({ ...input, away: JSON.parse(JSON.stringify(base)), home: JSON.parse(JSON.stringify({ ...base, name: 'Detroit Lions' })) });
assert.equal(JSON.stringify(original), JSON.stringify(oldAgain), 'Legacy inputs stay reproducible without advanced fields');
// Controlled defense swap isolates passing-vs-rushing strategic response.
const lowPass = structuredClone(input), highPass = structuredClone(input);
lowPass.home.footballEvidence!.passDefenseRating = 30; lowPass.home.footballEvidence!.rushDefenseRating = 75;
highPass.home.footballEvidence!.passDefenseRating = 75; highPass.home.footballEvidence!.rushDefenseRating = 30;
assert.ok(footballPassingShare(0.575, lowPass.away, lowPass.home) > footballPassingShare(0.575, highPass.away, highPass.home),
  'Weak passing defense directly increases passing choice');
const homeTeam = { ...structuredClone(team), team: 'Detroit Lions' };
const saved: Parameters<Parameters<typeof runSingleGameSimulation>[0]['save']>[0][] = [];
const run = await runSingleGameSimulation({ season: 2026, week: 7, gameId: 'evidence-game',
  games: [{ id: 'evidence-game', week: 7, seasonType: 'regular', awayTeam: team.team, homeTeam: homeTeam.team,
    date: '2026-10-18T17:00:00Z', timeConfirmed: true }],
  teams: [team, homeTeam], fetchedAt: current.fetchedAt, onProgress: () => {}, yieldUI: async () => {},
  loadDepth: async () => { throw new Error('Fixture uses verified saved ranks'); },
  loadEvidence: async (_season, name) => ({ current: { ...current, team: name }, prior: { ...prior, team: name }, issues: [] }),
  simulate: input => simulateGame(input), save: entry => saved.push(entry),
});
assert.equal(run.failures.length, 0);
assert.equal(saved.length, 1);
assert.equal(saved[0]?.setup?.away.footballEvidence?.sources.length, 2);
assert.equal(saved[0]?.setup?.home.footballEvidence?.sources.length, 2);
current.sampleWeeks!.push(99);
assert.ok(!saved[0]?.setup?.away.footballEvidence?.sources[0]?.weeks.includes(99), 'Saved evidence owns its sample metadata');
console.log('Football evidence: prior shrinkage, recent-four windows, partial/invalid sources, identity/availability, position matchups, frozen replay and passing strategy passed.');
