import assert from 'node:assert/strict';
import { rankGamesByScoring, orderGamesByProjection, type GameScoringProjection } from '../artifacts/gridiron-sim/src/lib/game-scoring-rankings';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { simulateGame } from '../artifacts/gridiron-sim/src/lib/simulator';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import type { NflScheduledGame, TeamSeasonRecord } from '@workspace/api-client-react';

const teams: TeamSeasonRecord[] = Array.from({ length: 4 }, (_, i) => ({
  season: 2026, team: `Team ${i}`, version: 1,
  players: ['QB', 'RB', 'WR', 'TE'].map((position, n) => ({
    id: `${i}-${n}`, name: `Player ${i}-${n}`, position: position as 'QB' | 'RB' | 'WR' | 'TE', side: 'offense', active: true, depthRank: 1,
  })),
  weeks: [1, 2, 3, 4, 5].map(week => ({
    week, status: 'played', opponent: 'Other', venue: 'home', result: 'W', teamScore: 24, opponentScore: 17,
    playerStats: {
      [`${i}-0`]: { passAttempts: 30, passYards: 230 },
      [`${i}-1`]: { rushAttempts: 12, rushYards: 48, targets: 3, receptions: 2, receivingYards: 14 },
      [`${i}-2`]: { targets: 8, receptions: 5, receivingYards: 70 },
      [`${i}-3`]: { targets: 5, receptions: 3, receivingYards: 30 },
    },
    teamDefense: { rushYardsAllowed: 100, passYardsAllowed: 220 },
  })),
}));
const games: NflScheduledGame[] = [0, 1].map(i => ({
  id: `game-${i}`, week: 4, date: `2026-10-0${i + 4}T17:00Z`,
  awayTeam: teams[2 * i]!.team, homeTeam: teams[2 * i + 1]!.team, timeConfirmed: true, seasonType: 'regular',
}));
const options: Parameters<typeof rankGamesByScoring>[0] = {
  season: 2026, week: 4, games, teams, fetchedAt: '2026-10-03T00:00Z',
  loadDepth: async () => { throw new Error('Use complete saved ranks'); },
  loadEvidence: async () => ({ issues: [] }), onProgress: () => {}, yieldUI: async () => {},
};
const before = JSON.stringify(teams);
const result = await rankGamesByScoring(options);
assert.equal(result.projections.length, 2);
assert.equal(result.failures.length, 0);
assert.ok(result.projections[0]!.totalMean >= result.projections[1]!.totalMean);
assert.ok(result.projections.every(p => Number.isFinite(p.totalMean) && p.totalP10 <= p.totalP90));
assert.deepEqual(await rankGamesByScoring(options), result, 'Stable sampling with identical inputs');
assert.equal(JSON.stringify(teams), before, 'Ranking never mutates saved source inputs');
const future = structuredClone(teams);
for (const team of future) for (const week of team.weeks.filter(w => w.week >= 4)) {
  week.teamScore = 99;
  for (const stats of Object.values(week.playerStats)) for (const key of Object.keys(stats)) stats[key] = 999;
}
assert.deepEqual(await rankGamesByScoring({ ...options, teams: future }), result, 'Never leak target-week or later outcomes into rankings');
const partial = await rankGamesByScoring({ ...options, teams: teams.slice(0, 2) });
assert.equal(partial.projections.length, 1);
assert.equal(partial.failures.length, 1);
assert.match(partial.failures[0]!.reason, /missing/);
const example = (gameId: string, totalMean: number): GameScoringProjection => ({
  gameId, totalMean, awayMean: totalMean / 2, homeMean: totalMean / 2, totalP10: 20, totalP90: 60, warnings: [],
});
assert.deepEqual(orderGamesByProjection(games, [example('game-0', 30), example('game-1', 50)]).map(g => g.id), ['game-1', 'game-0']);
assert.deepEqual(orderGamesByProjection(games, [example('game-1', 50)]).map(g => g.id), ['game-1', 'game-0'], 'Missing projections sort last, never as zero');
await assert.rejects(rankGamesByScoring({ ...options, shouldStop: () => true }), /stopped/);
let stop = false;
await assert.rejects(rankGamesByScoring({ ...options, shouldStop: () => stop,
  onProgress: value => { if (value.completed === 1) stop = true; } }), /stopped/, 'Cancellation does not publish partial/stale results');

const input = { away: setupFromHistory(teams[0]!, 4, 'away'), home: setupFromHistory(teams[1]!, 4, 'home'),
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' as const }, seed: 123 };
const ensemble = simulateEnsemble(input, 200);
const scores = Array.from({ length: 200 }, (_, i) => simulateGame({
  ...input, seed: i === 0 ? 123 : (123 + Math.imul(i, 2654435761)) >>> 0,
}));
const round = (n: number) => Math.round(n * 100) / 100;
const totals = scores.map(s => s.awayScore + s.homeScore).sort((a, b) => a - b);
assert.deepEqual(ensemble.ensemble!.scoring, {
  awayMean: round(scores.reduce((n, s) => n + s.awayScore, 0) / 200),
  homeMean: round(scores.reduce((n, s) => n + s.homeScore, 0) / 200),
  totalMean: round(totals.reduce((n, s) => n + s, 0) / 200),
  totalP10: totals[19], totalP90: totals[179],
}, 'Rank using actual mean scores, not one randomly displayed example');
console.log('Game scoring ranking regressions passed.');
