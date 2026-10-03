import assert from "node:assert/strict";
import type { TeamSeasonRecord, TeamWeek } from "../../lib/api-client-react/src/generated/api.schemas";
import { auditHistory, dkFields } from "./h2h-history-audit";

const home = "Arizona Cardinals", away = "San Francisco 49ers";
const week = (n: number, opponent: string, venue: "home" | "away"): TeamWeek => ({
  week: n, opponent, venue, status: "played", result: "T",
  teamScore: 10, opponentScore: 10, teamDefense: {},
  playerStats: { qb: { passYards: 0 } },
});
const team = (name: string, weeks: TeamWeek[]): TeamSeasonRecord => ({
  team: name, season: 2026, version: 1,
  // A current inactive flag must not discard a historical target.
  players: [{ id: "qb", name: "QB", side: "offense", position: "QB", active: false }], weeks,
});
const teams = [
  team(home, [week(1, away, "home"), week(3, away, "home")]),
  team(away, [week(1, home, "away"), week(3, home, "away")]),
];
const before = JSON.stringify(teams);
const audit = auditHistory(teams, 2026);
assert.equal(audit.teamGameRows, 4);
assert.equal(audit.counts.divisional.savedGames, 2, "Do not double count reciprocal games");
assert.equal(audit.counts.divisional.withPriorHistoryBothTeams, 1);
assert.equal(audit.counts.divisional.withEarlierMeetingAndPriorHistory, 1);
assert.equal(audit.counts.divisional.priorSeenPlayerRows, 2);
assert.equal(audit.counts.divisional.completeDkPlayerRows, 0, "Missing scoring fields do not become zero");
assert.equal(audit.counts.divisional.missingDkFields.passYards, 0, "Explicit zero is observed");
assert.equal(audit.metrics, null, "An audit must not invent error metrics");
assert.equal(JSON.stringify(teams), before, "Do not mutate saved data");
assert.throws(() => auditHistory(teams, 2025), /different season/);
assert.throws(() => auditHistory([...teams, teams[0]!], 2026), /Duplicate saved team/);
const complete = structuredClone(teams);
complete[0]!.weeks[1]!.playerStats.qb = Object.fromEntries(dkFields.map(field => [field, 0]));
delete complete[1]!.weeks[1]!.playerStats.qb;
assert.equal(auditHistory(complete, 2026).counts.divisional.completeDkPlayerRows, 1);
assert.equal(auditHistory(complete, 2026).counts.divisional.priorSeenPlayerRows, 1, "DNP is excluded, not scored as zero");
const futureOnly = teams.map(owner => ({ ...owner, weeks: [owner.weeks[0]!] }));
assert.equal(auditHistory(futureOnly, 2026).counts.divisional.withEarlierMeeting, 0, "Held-out/future games cannot supply an earlier meeting");
const conflict = structuredClone(teams);
conflict[1]!.weeks[1]!.teamScore = 99;
assert.equal(auditHistory(conflict, 2026).counts.divisional.conflictingCounterpart, 1);
assert.equal(auditHistory(conflict, 2026).counts.divisional.withPriorHistoryBothTeams, 0);
const missing = auditHistory([teams[0]!], 2026);
assert.equal(missing.counts.divisional.missingCounterpart, 2);
console.log("History feasibility audit: cutoff, reciprocal deduplication, season rejection, DNP/unknown/zero handling, inactive historical targets and read-only behavior passed.");