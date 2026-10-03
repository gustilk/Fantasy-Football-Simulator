/**
 * Read-only feasibility audit, not a backtest. No data fetching or team writes.
 * Usage: pnpm --filter @workspace/scripts exec tsx src/h2h-history-audit.ts <saved-json> <season>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TeamSeasonRecord } from "../../lib/api-client-react/src/generated/api.schemas";
import { ListSeasonTeamsResponse } from "../../lib/api-zod/src/generated/api";
import { priorGames } from "../../artifacts/gridiron-sim/src/lib/season-model";
import { isDivisionGame } from "../../artifacts/gridiron-sim/src/lib/nfl-divisions";

// Full Classic ground truth requires explicit observations, including unusual
// scoring events. The app's reported-stat subtotal is not a complete DK target.
export const dkFields = [
  "passYards", "passTD", "interceptions", "rushYards", "rushTD",
  "receptions", "receivingYards", "receivingTD", "fumblesLost",
  "kickReturnTD", "puntReturnTD", "fieldGoalReturnTD",
  "twoPointConversions", "offensiveFumbleRecoveryTD",
] as const;
const known = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const group = () => ({
  savedGames: 0, missingCounterpart: 0, conflictingCounterpart: 0,
  withPriorHistoryBothTeams: 0, withThreePriorGamesBothTeams: 0,
  withEarlierMeeting: 0, withEarlierMeetingAndPriorHistory: 0,
  scoredHeldOutGames: 0, priorSeenPlayerRows: 0, completeDkPlayerRows: 0,
  missingDkFields: Object.fromEntries(dkFields.map(field => [field, 0])),
});

export function auditHistory(teams: TeamSeasonRecord[], season: number) {
  if (!Number.isInteger(season) || season < 2000 || season > 2100) throw new Error("Specify a season from 2000 to 2100.");
  if (teams.some(team => team.season !== season)) throw new Error("Saved data contains a different season; refusing to combine seasons.");
  if (new Set(teams.map(team => team.team)).size !== teams.length) throw new Error("Duplicate saved team.");
  for (const team of teams) {
    if (new Set(team.weeks.map(week => week.week)).size !== team.weeks.length) throw new Error("Duplicate saved week.");
    if (new Set(team.players.map(player => player.id)).size !== team.players.length) throw new Error("Duplicate player ID.");
  }
  const counts = { divisional: group(), nonDivisional: group() };
  const byTeam = new Map(teams.map(team => [team.team, team]));
  const seen = new Set<string>();
  let teamGameRows = 0;
  for (const team of teams) {
    for (const game of team.weeks.filter(week => week.status === "played")) {
      teamGameRows++;
      const key = JSON.stringify([game.week, ...[team.team, game.opponent].sort()]);
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = isDivisionGame(team.team, game.opponent) ? counts.divisional : counts.nonDivisional;
      bucket.savedGames++;
      const opponent = byTeam.get(game.opponent);
      const mirror = opponent?.weeks.find(week => week.week === game.week && week.status === "played" && week.opponent === team.team);
      if (!opponent || !mirror) { bucket.missingCounterpart++; continue; }
      if (game.venue === mirror.venue ||
          (known(game.teamScore) && known(mirror.opponentScore) && game.teamScore !== mirror.opponentScore) ||
          (known(game.opponentScore) && known(mirror.teamScore) && game.opponentScore !== mirror.teamScore) ||
          (game.source?.eventId && mirror.source?.eventId && game.source.eventId !== mirror.source.eventId)) {
        bucket.conflictingCounterpart++;
        continue;
      }
      const earlier = priorGames(team, game.week);
      const opponentEarlier = priorGames(opponent, game.week);
      const meeting = earlier.some(week => week.opponent === opponent.team) ||
        opponentEarlier.some(week => week.opponent === team.team);
      if (meeting) bucket.withEarlierMeeting++;
      if (!earlier.length || !opponentEarlier.length) continue;
      bucket.withPriorHistoryBothTeams++;
      if (earlier.length >= 3 && opponentEarlier.length >= 3) bucket.withThreePriorGamesBothTeams++;
      if (meeting) bucket.withEarlierMeetingAndPriorHistory++;
      // Never reconstruct an unknown outcome from missing/partial scores.
      if (known(game.teamScore) && known(game.opponentScore) &&
          known(mirror.teamScore) && known(mirror.opponentScore)) bucket.scoredHeldOutGames++;
      for (const [owner, target, history] of [
        [team, game, earlier], [opponent, mirror, opponentEarlier],
      ] as const) {
        // Do not use today's active flags or held-out participation to select
        // forecasting inputs. This only audits targets for previously seen IDs.
        const priorIds = new Set(history.flatMap(week => Object.keys(week.playerStats)));
        for (const player of owner.players.filter(player =>
          player.side === "offense" && ["QB", "RB", "WR", "TE"].includes(player.position) && priorIds.has(player.id))) {
          const stats = target.playerStats[player.id];
          if (!stats || !Object.values(stats).some(known)) continue; // DNP/unknown is not zero.
          bucket.priorSeenPlayerRows++;
          const missing = dkFields.filter(field => !known(stats[field]));
          if (!missing.length) bucket.completeDkPlayerRows++;
          for (const field of missing) bucket.missingDkFields[field]!++;
        }
      }
    }
  }
  const repeated = counts.divisional.withEarlierMeetingAndPriorHistory + counts.nonDivisional.withEarlierMeetingAndPriorHistory;
  return {
    season, savedTeams: teams.length, teamGameRows,
    playedWeeksPerTeam: teams.map(team => ({ team: team.team, weeks: priorGames(team, 19).map(game => game.week) })),
    counts,
    conclusion: repeated === 0
      ? "Insufficient history: no held-out game with prior history on both sides has an earlier same-season meeting. No improvement estimate or weight change is justified."
      : "Repeat matchups exist; this is only a feasibility audit. Historical roster/availability and complete scoring targets must be verified before a backtest.",
    metrics: null,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [path, requestedSeason] = process.argv.slice(2);
  if (!path || !requestedSeason) throw new Error("Usage: h2h-history-audit.ts <saved-json> <season>");
  // The generated validator coerces source timestamps to Date; normalize back
  // to the JSON wire format expected by the simulator's API types.
  const teams: TeamSeasonRecord[] = JSON.parse(JSON.stringify(
    ListSeasonTeamsResponse.parse(JSON.parse(readFileSync(path, "utf8"))),
  ));
  console.log(JSON.stringify(auditHistory(teams, Number(requestedSeason)), null, 2));
}