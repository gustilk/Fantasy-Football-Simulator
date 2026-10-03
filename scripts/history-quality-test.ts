import assert from "node:assert/strict";
import { availabilityForWeek, availabilityWarnings } from "../artifacts/gridiron-sim/src/lib/availability";
import { historyStrength, playerUsage } from "../artifacts/gridiron-sim/src/lib/history-signals";
import { setupFromHistory } from "../artifacts/gridiron-sim/src/lib/season-model";
import { simulateEnsemble } from "../artifacts/gridiron-sim/src/lib/ensemble";
import { mergeNflImport } from "../artifacts/gridiron-sim/src/lib/nfl-import-merge";
import { previewNflTeam, reportedAvailability } from "../artifacts/api-server/src/lib/nfl-source";
import { SaveSeasonTeamBody, PreviewNflTeamResponse, PreviewNflTeamQueryParams } from "../lib/api-zod/src/generated/api";

type Team = Parameters<typeof setupFromHistory>[0];
const source = { provider: "ESPN" as const, url: "https://www.espn.com/nfl/", fetchedAt: new Date().toISOString() };
const team: Team = {
  season: 2026, team: "History Test", version: 1,
  players: [
    { id: "qb", name: "QB1", position: "QB", side: "offense", active: true, depthRank: 1 },
    { id: "rb", name: "RB1", position: "RB", side: "offense", active: true, depthRank: 1 },
    { id: "wr", name: "WR1", position: "WR", side: "offense", active: true, depthRank: 1,
      availabilityReport: { status: "questionable", rosterActive: true, source } },
    { id: "wr2", name: "WR2", position: "WR", side: "offense", active: true, depthRank: 2 },
  ],
  weeks: [1, 2, 3].map(week => ({
    week, status: "played", opponent: "Opponent", venue: "home", result: "W",
    teamScore: 28, opponentScore: 14,
    playerStats: {
      qb: { passAttempts: 30, passCompletions: 20, passYards: 300 },
      rb: { rushAttempts: 20, rushYards: 120 },
      ...(week === 1 ? { wr: { targets: 9, receptions: 5, receivingYards: 74 } } : {}),
      wr2: { targets: 6, receptions: 4, receivingYards: 50 },
    },
    teamDefense: { passYardsAllowed: 150, rushYardsAllowed: 80 },
  })),
};

const original = JSON.stringify(team);
const setup = setupFromHistory(team, 4, "away");
assert.ok(setup.passRating > 55 && setup.rushRating > 55 && setup.defenseRating > 55);
assert.equal(setup.modelEvidence!.strength.passGames, 3);
assert.equal(setup.roster!.find(p => p.id === "wr")!.recentStats!.targets, 9);
assert.equal(setup.roster!.find(p => p.id === "wr")!.usage!.targetGames, 1);
assert.equal(playerUsage(team.weeks, "wr").targetShare, 0.6);
assert.equal(playerUsage(team.weeks, "missing").targetShare, undefined);
assert.equal(historyStrength(team, []).passRating, 55);
const negative = structuredClone(team);
negative.weeks[0]!.playerStats.rb = { rushAttempts: 1, rushYards: -4 };
assert.ok(historyStrength(negative, [negative.weeks[0]!]).rushRating < 55);
const partial = structuredClone(team);
partial.weeks.forEach(w => { w.playerStats.qb = { passYards: 900 }; });
assert.equal(historyStrength(partial, partial.weeks).passRating, 55, "Unpaired fields cannot establish efficiency");
const future = structuredClone(team);
future.weeks.push({ ...future.weeks[0]!, week: 4, playerStats: { qb: { passYards: 900, passAttempts: 10 } } });
assert.equal(setupFromHistory(future, 4, "away").passRating, setup.passRating, "No target-week stat leakage");

const out = structuredClone(team);
out.players[2]!.availabilityOverride = { week: 4, status: "out", updatedAt: source.fetchedAt };
assert.equal(availabilityForWeek(out.players[2]!, 4).included, false);
assert.equal(availabilityForWeek(out.players[2]!, 5).included, true, "Override is week-specific");
const outSetup = setupFromHistory(out, 4, "away");
assert.equal(outSetup.wr1, "WR2");
assert.ok(!outSetup.roster!.some(p => p.id === "wr"));
assert.equal(out.players[2]!.depthRank, 1);
assert.equal(out.players[2]!.active, true);
assert.deepEqual(out.weeks, team.weeks, "An absence must not erase history");
const result = simulateEnsemble({ away: outSetup, home: { ...setup, name: "Opponent" }, seed: 42,
  weather: { temperatureF: 65, windMph: 5, precipitation: "none" } }, 20);
assert.ok(!result.players.some(p => p.team === out.team && p.name === "WR1"), "Out player cannot receive projected opportunities");
assert.ok(result.ensemble!.fantasy.every(p => Number.isFinite(p.mean)));
assert.ok(setup.modelEvidence!.warnings.some(w => w.includes("uncertainty")));
const stale = availabilityForWeek({ ...team.players[2]!, availabilityReport: { status: "unknown", rosterActive: true,
  source: { ...source, fetchedAt: "2020-01-01T00:00:00Z" } } }, 4);
assert.ok(availabilityWarnings([stale]).some(w => w.includes("24-hour")));
assert.ok(availabilityWarnings([stale]).some(w => w.includes("not confirmed healthy")));
assert.equal(reportedAvailability(), "unknown");
assert.equal(reportedAvailability("out"), "out");
assert.equal(reportedAvailability("Questionable"), "questionable");

const preview = { season: team.season, team: team.team, fetchedAt: source.fetchedAt, rosterUrl: source.url,
  warnings: [], players: team.players, weeks: team.weeks };
for (const updateRoster of [false, true]) {
  const merged = mergeNflImport({ players: out.players, weeks: out.weeks }, preview, { replaceStats: false, updateRoster });
  assert.equal(merged.draft.players[2]!.availabilityOverride!.status, "out", "Imports preserve manual weekly overrides");
}
const request = SaveSeasonTeamBody.parse({ expectedVersion: 1, players: out.players, weeks: out.weeks });
const roundTrip = PreviewNflTeamResponse.parse({ ...preview, players: request.players });
assert.equal(roundTrip.players[2]!.availabilityOverride!.week, 4);
assert.equal(roundTrip.players[2]!.availabilityReport!.status, "questionable");
const frozen = JSON.parse(JSON.stringify(outSetup));
assert.equal(frozen.availabilityChecks.find(p => p.id === "wr").included, false);
assert.equal(frozen.modelEvidence.strength.passGames, 3);
assert.equal(PreviewNflTeamQueryParams.parse({}).gameLimit, 17);
assert.equal(PreviewNflTeamQueryParams.safeParse({ gameLimit: 18 }).success, false);
assert.equal(JSON.stringify(team), original, "Derived signals are read-only");

// Deterministic public-source fixture checks range selection, cache isolation, dates and season validation.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  let data: unknown;
  const competitors = [
    { id: "1", homeAway: "home", score: "28", team: { displayName: "History Source Test" } },
    { id: "2", homeAway: "away", score: "14", team: { displayName: "Opponent" } },
  ];
  const completed = { type: { completed: true } };
  const athlete = (id: string, position: string) => ({ id, displayName: `Player ${id}`, position: { abbreviation: position }, status: { type: "active" } });
  if (url.pathname.endsWith("/teams")) data = { sports: [{ leagues: [{ teams: [{ team: { id: "1", displayName: "History Source Test", abbreviation: "tst" } }] }] }] };
  else if (url.pathname.endsWith("/roster")) data = { season: { year: 2026 }, team: { id: "1" }, athletes: [{ position: "offense", items: [
    athlete("qb", "QB"), athlete("rb", "RB"), { ...athlete("wr", "WR"), injuries: [{ status: "out" }] }, athlete("te", "TE"),
  ] }] };
  else if (url.pathname.endsWith("/schedule")) data = {
    season: { year: 2026, type: 2 },
    events: [
      ...Array.from({ length: 18 }, (_, i) => ({ id: String(i + 1), date: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
        season: { year: 2026 }, week: { number: i + 1 }, competitions: [{ competitors, status: completed }] })),
      { id: "future", date: "2999-01-01T00:00:00Z", season: { year: 2026 }, week: { number: 1 }, competitions: [{ competitors, status: completed }] },
    ],
  };
  else if (url.pathname.endsWith("/depthcharts")) data = { season: { year: 2026 }, team: { id: "1" }, depthchart: [{ positions:
    Object.fromEntries(["QB", "RB", "WR", "TE"].map(p => [p.toLowerCase(), { position: { abbreviation: p }, athletes: [{ id: p.toLowerCase() }] }])),
  }] };
  else if (url.pathname.endsWith("/summary")) data = {
    header: { season: { year: 2026, type: 2 }, week: Number(url.searchParams.get("event")), competitions: [{ competitors, status: completed }] },
    boxscore: { players: ["1", "2"].map(id => ({
      team: { id, displayName: id === "1" ? "History Source Test" : "Opponent" },
      statistics: [
        { name: "passing", keys: ["completions/passingAttempts", "passingYards"], totals: ["20/30", "240"], athletes: [{ athlete: athlete("qb", "QB"), stats: ["20/30", "240"] }] },
        { name: "defensive", keys: ["sacks"], totals: ["2"], athletes: [{ athlete: athlete("d", "LB"), stats: ["2"] }] },
      ],
    })) },
  };
  else throw new Error(`Unexpected fixture URL ${url}`);
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
};
try {
  const full = await previewNflTeam(2026, "History Source Test", 17);
  const recent = await previewNflTeam(2026, "History Source Test", 3);
  assert.equal(full.weeks.length, 17);
  assert.deepEqual(recent.weeks.map(w => w.week), [16, 17, 18]);
  assert.equal(full.players.find(p => p.id === "espn:wr")!.active, false, "Lowercase Out must exclude source player");
  assert.equal(full.players.find(p => p.id === "espn:qb")!.availabilityReport!.status, "unknown");
  assert.equal(full.weeks[0]!.week, 2);
  assert.ok(!full.weeks.some(w => w.source?.eventId === "future"));
  await assert.rejects(() => previewNflTeam(2025, "History Source Test"), /complete 2025/);
  await assert.rejects(() => previewNflTeam(2026, "History Source Test", 0), /between 1 and 17/);
} finally { globalThis.fetch = originalFetch; }
console.log("History ranges, source season/cutoff safety, strength/usage evidence, weekly exclusions, freshness, manual preservation and snapshot/save contracts passed.");