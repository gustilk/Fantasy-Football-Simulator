/** Inventory only: saved history is not independently frozen pregame evidence. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TeamSeasonRecord } from '../../lib/api-client-react/src/generated/api.schemas';
import { ListSeasonTeamsResponse } from '../../lib/api-zod/src/generated/api';
import { auditHistory, dkFields } from './h2h-history-audit';

export function auditSecondaryHistory(teams: TeamSeasonRecord[], season: number) {
  const audit = auditHistory(teams, season), seen = new Set<string>(), rows: Record<string, unknown>[] = [];
  const byTeam = new Map(teams.map(team => [team.team, team]));
  for (const team of teams) for (const game of team.weeks.filter(g => g.status === 'played')) {
    const key = JSON.stringify([game.week, ...[team.team, game.opponent].sort()]);
    if (seen.has(key)) continue;
    seen.add(key);
    const other = byTeam.get(game.opponent), mirror = other?.weeks.find(g => g.status === 'played' && g.week === game.week && g.opponent === team.team);
    const prior = (owner: TeamSeasonRecord | undefined) => (owner?.weeks ?? [])
      .filter(g => g.status === 'played' && g.week < game.week).sort((a, b) => a.week - b.week).slice(-4).map(g => g.week);
    const first = prior(team), second = prior(other);
    const targetRows = [game, ...(mirror ? [mirror] : [])].flatMap(g => Object.values(g.playerStats));
    rows.push({ season, week: game.week, teams: [team.team, game.opponent], eventId: game.source?.eventId ?? null,
      priorCompletedWeeks: [first, second], bothHaveFourPriorGames: first.length === 4 && second.length === 4,
      mirroredHistory: !!mirror, recordedFinalScores: [game.teamScore, game.opponentScore],
      recordedPlayerRows: targetRows.length,
      completeDraftKingsLedgers: targetRows.filter(stats => dkFields.every(field => typeof stats[field] === 'number' && Number.isFinite(stats[field]))).length,
      status: 'excluded',
      reasons: ['No independently archived pregame eligibility and complete input/source freeze supplied.',
        'No source-reviewed historical passing-play/last-four inventory in saved library.',
        ...(first.length < 4 || second.length < 4 ? ['Fewer than four saved prior completed games for at least one team (a shorter window could be eligible if independently archived).'] : [])] });
  }
  return { kind: 'secondary-evidence-feasibility-audit', season, savedTeams: audit.savedTeams,
    savedTeamGameRows: audit.teamGameRows, candidateGames: rows.length,
    candidatesWithFourSavedPriorGamesBothTeams: rows.filter(r => r.bothHaveFourPriorGames).length,
    eligibleHeldOutGames: 0, completeDraftKingsLedgers: rows.reduce((n, r) => n + Number(r.completeDraftKingsLedgers), 0),
    calibrationGames: 0, heldOutGames: 0, accuracyMetrics: null,
    conclusion: 'Insufficient point-in-time evidence; neither improvement nor harm is established. Keep model behavior unchanged.',
    games: rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [path, season] = process.argv.slice(2);
  if (!path || !season) throw new Error('Usage: secondary-history-audit.ts <teams-json> <season>');
  const bytes = readFileSync(path, 'utf8');
  const teams = JSON.parse(JSON.stringify(ListSeasonTeamsResponse.parse(JSON.parse(bytes))));
  console.log(JSON.stringify({ auditedAt: new Date().toISOString(),
    librarySnapshotSha256: createHash('sha256').update(bytes).digest('hex'),
    ...auditSecondaryHistory(teams, Number(season)) }, null, 2));
}
