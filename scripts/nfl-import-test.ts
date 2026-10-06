import assert from "node:assert/strict";
import { parseStatLine } from "../artifacts/api-server/src/lib/nfl-source";
import { mergeNflImport, type ImportDraft } from "../artifacts/gridiron-sim/src/lib/nfl-import-merge";
import type { NflImportPreview, TeamWeek } from "@workspace/api-client-react";

assert.deepEqual(parseStatLine({ name: "passing", keys: ["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"] }, ["15/27", "-2", "--", "0"], "offense"),
  { passCompletions: 15, passAttempts: 27, passYards: -2, interceptions: 0 });
assert.deepEqual(parseStatLine({ name: "defensive", keys: ["totalTackles", "soloTackles", "sacks", "QBHits"] }, ["17", "7", "0.5", ""], "defense"),
  { soloTackles: 7, sacks: 0.5, assistedTackles: 10 });
assert.deepEqual(parseStatLine({ name: "interceptions", keys: ["interceptions"] }, ["1"], "offense"), { defensiveInterceptions: 1 });
assert.deepEqual(parseStatLine({ name: "kicking", keys: ["fieldGoalsMade/fieldGoalAttempts", "extraPointsMade/extraPointAttempts"] }, ["2/3", "0/0"], "offense"),
  { fieldGoalsMade: 2, fieldGoalAttempts: 3, extraPointsMade: 0, extraPointAttempts: 0 });
assert.deepEqual(parseStatLine({ name: "rushing", keys: ["rushingAttempts", "rushingYards"] }, ["--", ""], "offense"), {});

const source = { provider: "ESPN" as const, url: "https://www.espn.com/nfl/teams", fetchedAt: "2026-10-03T12:00:00Z", athleteId: "123" };
const blank = (week: number): TeamWeek => ({ week, status: "upcoming", opponent: "", venue: "home", result: "none", teamScore: null, opponentScore: null, teamDefense: {}, playerStats: {} });
const current: ImportDraft = { players: [{ id: "manual", name: "Test Quarterback", position: "QB", side: "offense", active: true }],
  weeks: Array.from({ length: 18 }, (_, i) => blank(i + 1)) };
const preview: NflImportPreview = {
  season: 2026, team: "Test Team", fetchedAt: source.fetchedAt, rosterUrl: source.url, warnings: [],
  players: [{ id: "espn:123", name: "Test Quarterback", position: "QB", side: "offense", active: false, source }],
  weeks: [{ ...blank(3), status: "played", opponent: "Opponent", teamScore: 28, opponentScore: 14, result: "W",
    playerStats: { "espn:123": { passYards: 297, passAttempts: 27, passCompletions: 15 } },
    teamDefense: { sacks: 2 }, source: { ...source, eventId: "456" } }],
};
const keep = { replaceStats: false, updateRoster: false };
const untouched = JSON.stringify(current);
const imported = mergeNflImport(current, preview, keep);
assert.equal(JSON.stringify(current), untouched, "merging must not mutate the entered draft");
assert.equal(imported.addedPlayers, 0, "match manually entered names/positions without adding duplicates");
assert.equal(imported.draft.players[0]!.id, "manual");
assert.equal(imported.draft.players[0]!.active, true, "manual activity is kept by default");
assert.equal(imported.draft.weeks[2]!.playerStats.manual!.passYards, 297, "source player IDs are remapped");
assert.equal(imported.draft.weeks[2]!.playerStats["espn:123"], undefined);
assert.equal(imported.draft.weeks[2]!.teamDefense.fumblesForced, undefined, "absent fields remain unknown");
assert.equal(imported.draft.weeks[2]!.source?.fetchedAt, source.fetchedAt);
assert.equal(imported.draft.weeks.length, 18);
const edited = structuredClone(imported.draft);
edited.weeks[2]!.playerStats.manual!.passYards = 400;
edited.weeks[2]!.playerStats.manual!.customMetric = 7;
edited.weeks[0] = { ...blank(1), status: "bye" };
assert.equal(mergeNflImport(edited, preview, keep).draft.weeks[2]!.playerStats.manual!.passYards, 400);
const replaced = mergeNflImport(edited, preview, { replaceStats: true, updateRoster: true });
assert.equal(replaced.draft.weeks[2]!.playerStats.manual!.passYards, 297);
assert.equal(replaced.draft.weeks[2]!.playerStats.manual!.customMetric, 7);
assert.equal(replaced.draft.players[0]!.active, false);
assert.equal(replaced.draft.weeks[0]!.status, "bye", "weeks outside the three imports are unchanged");
assert.equal(mergeNflImport(imported.draft, preview, keep).draft.players.length, 1, "repeat imports are idempotent");
const conflict = structuredClone(edited); conflict.weeks[2]!.opponent = "Manually different game";
assert.deepEqual(mergeNflImport(conflict, preview, keep).skippedWeeks, [3]);
assert.equal(mergeNflImport(conflict, preview, keep).draft.weeks[2]!.opponent, "Manually different game");
assert.equal(mergeNflImport(conflict, preview, { ...keep, replaceStats: true }).draft.weeks[2]!.opponent, "Opponent");
const partial = structuredClone(preview); partial.weeks[0]!.playerStats["espn:123"] = { passCompletions: 60 };
assert.equal(mergeNflImport(edited, partial, { ...keep, replaceStats: true }).draft.weeks[2]!.playerStats.manual!.passCompletions, 15, "inconsistent partial source pairs are not merged");
const manualPartial = structuredClone(edited); manualPartial.weeks[2]!.playerStats.manual = { passCompletions: 60 };
assert.equal(mergeNflImport(manualPartial, preview, keep).draft.weeks[2]!.playerStats.manual!.passAttempts, undefined);
console.log("NFL import parsing and safe-merge regressions passed.");
const scheduled = structuredClone(current);
scheduled.weeks[2] = { ...scheduled.weeks[2]!, status: "upcoming", opponent: "Stale scheduled opponent",
  result: "none", teamScore: null, opponentScore: null, teamDefense: {}, playerStats: {} };
const completedSchedule = mergeNflImport(scheduled, preview, keep);
assert.equal(completedSchedule.draft.weeks[2]!.status, "played", "completed games replace empty upcoming schedule placeholders");
assert.equal(completedSchedule.draft.weeks[2]!.opponent, "Opponent");
assert.deepEqual(completedSchedule.skippedWeeks, []);