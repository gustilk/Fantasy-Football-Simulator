import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateMarket, pairedForecast, modelFingerprint, scoringFields } from "./market-evaluation";
import { summarizeForecasts, pairedDifferences } from "./market-evaluation-metrics";
import { parseInput, readArchive } from "./market-evaluation-evidence";
import { simulateEnsemble } from "../../artifacts/gridiron-sim/src/lib/ensemble";
import type { SimulationInput, TeamSetup } from "../../artifacts/gridiron-sim/src/lib/simulator";

// Deliberately fabricated fixtures. Never presented as empirical NFL evidence.
const root = mkdtempSync(join(tmpdir(), "market-evaluation-test-"));
const kickoff = "2026-09-20T17:00:00Z", capturedAt = "2026-09-20T16:00:00Z";
const team = (name: string): TeamSetup => ({
  name, qb: `${name} QB`, rb: `${name} RB`, wr1: `${name} WR1`, wr2: `${name} WR2`,
  wr3: `${name} WR3`, te: `${name} TE`, kicker: `${name} K`,
  passRating: 55, rushRating: 55, defenseRating: 55, context: "",
  roster: [
    { id: `${name}-qb`, name: `${name} QB`, position: "QB" },
    { id: `${name}-rb`, name: `${name} RB`, position: "RB" },
    { id: `${name}-wr`, name: `${name} WR`, position: "WR" },
    { id: `${name}-te`, name: `${name} TE`, position: "TE" },
  ],
});
const input: SimulationInput = {
  away: team("Away"), home: team("Home"),
  weather: { temperatureF: 65, windMph: 5, precipitation: "none" },
};
const roster = [input.away, input.home].flatMap(team => team.roster!.map(player => ({
  team: team.name, name: player.name, position: player.position, playerId: player.id,
})));
const blankStats = Object.fromEntries(scoringFields.map(field => [field, 0]));
let archiveNumber = 0;
const save = (kind: string, payload: unknown, time = capturedAt, id = "fixture") => {
  const path = `${kind}-${id}-${archiveNumber++}.json`;
  const archive = {
    kind, gameId: id, capturedAt: time, sourceUrl: "https://example.org/fixture-not-real-data",
    archiveUrl: "https://example.org/fixture-not-real-data/archive", payload,
  };
  const bytes = JSON.stringify(archive);
  writeFileSync(join(root, path), bytes);
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
};
const base = {
  id: "fixture", split: "held-out", kickoff,
  input: save("input", { input, historyThrough: "2026-09-19T00:00:00Z" }),
  eligibility: save("eligibility", { complete: true, players: roster }),
  quote: save("quote", { awayTeam: "Away", homeTeam: "Home", homeSpread: -6, total: 48, provider: "Synthetic" }),
  outcome: save("outcome", {
    final: true, awayScore: 21, homeScore: 27,
    players: [
      { playerId: roster[0]!.playerId, observed: true, stats: { ...blankStats, passYards: 300, passTD: 2 } },
      { playerId: roster[1]!.playerId, observed: true, stats: { rushYards: 20 } },
      { playerId: roster[2]!.playerId, observed: true, stats: { ...blankStats, rushYards: -3 } },
    ],
  }, "2026-09-20T22:00:00Z"),
};
const manifest = {
  version: 1, modelRevision: modelFingerprint(), registeredAt: "2026-09-01T00:00:00Z",
  seeds: [123456], games: [base],
};
try {
  const before = JSON.stringify(input);
  const report = evaluateMarket(manifest, root);
  assert.equal(report.counts.pairedGames, 1);
  assert.equal(report.counts.excludedGames, 0);
  assert.equal(report.paired.draftKings?.observedPlayerGames, 2, "Only complete observed scoring ledgers qualify, including negative yardage.");
  assert.equal(report.counts.excludedPlayerTargets, 1);
  assert.equal(report.counts.missingPlayerTargets, 5);
  assert.equal(report.paired.differences!.totalAbsolute.descriptiveGameBootstrap95, null);
  assert.equal(report.paired.baseline!.games, 1);
  assert.equal(report.blend, 0.35);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(evaluateMarket(manifest, root), report);

  const quote = { capturedAt, total: 48, homeSpread: -6, provider: "Synthetic" };
  const pair = pairedForecast(input, manifest.seeds, quote, kickoff);
  const productionBaseline = simulateEnsemble({ ...input, seed: manifest.seeds[0] }, 200);
  const productionWeighted = simulateEnsemble({
    ...input, seed: manifest.seeds[0],
    market: { ...quote, recordedAt: capturedAt, source: "manual", awayTeam: "Away", homeTeam: "Home", enabled: true, kickoff },
  }, 200);
  const round = (n: number) => Math.round(n * 100) / 100;
  assert.equal(round(pair.baseline.probabilities[1] * 100), productionBaseline.ensemble!.homeWinPct);
  assert.equal(round(pair.weighted!.probabilities[1] * 100), productionWeighted.ensemble!.homeWinPct);
  assert.equal(round(pair.weighted!.margin), round(productionWeighted.ensemble!.market!.weighted.home - productionWeighted.ensemble!.market!.weighted.away));
  pair.players.forEach((player, i) => {
    assert.equal(round(player.baseline), productionBaseline.ensemble!.fantasy[i]!.mean);
    assert.equal(round(player.weighted!), productionWeighted.ensemble!.fantasy[i]!.mean);
  });
  assert.ok(pair.concentration!.minEffectiveRuns <= 200);
  assert.ok(pair.concentration!.maxOutcomeWeight >= 1 / 200);

  const missing = evaluateMarket({ ...manifest, games: [{ ...base, quote: null }] }, root);
  assert.equal(missing.counts.missingQuotes, 1);
  assert.equal(missing.counts.baselineOnlyGames, 1);
  assert.equal(missing.baselineAllEligible!.games, 1);
  assert.equal(missing.paired.baseline, null);
  assert.equal(missing.paired.weighted, null);
  assert.equal(missing.status, "insufficient-evidence");
  const lateQuote = save("quote", { awayTeam: "Away", homeTeam: "Home", homeSpread: -6, total: 48, provider: "Synthetic" }, "2026-09-20T18:00:00Z");
  const late = evaluateMarket({ ...manifest, games: [{ ...base, quote: lateQuote }] }, root);
  assert.equal(late.counts.rejectedQuotes, 1);
  assert.equal(late.counts.baselineOnlyGames, 1);
  const validQuote = save("quote", { awayTeam: "Away", homeTeam: "Home", homeSpread: -6, total: 48, provider: "Synthetic" });
  base.quote = validQuote;
  const lateRoster = save("eligibility", { complete: true, players: roster }, "2026-09-20T18:00:00Z");
  assert.equal(evaluateMarket({ ...manifest, games: [{ ...base, eligibility: lateRoster }] }, root).counts.excludedGames, 1);
  const wrongRoster = save("eligibility", { complete: true, players: roster.slice(1) });
  assert.equal(evaluateMarket({ ...manifest, games: [{ ...base, eligibility: wrongRoster }] }, root).counts.excludedGames, 1);
  const futureInput = save("input", { input, historyThrough: "2026-09-21T00:00:00Z" });
  assert.equal(evaluateMarket({ ...manifest, games: [{ ...base, input: futureInput }] }, root).counts.excludedGames, 1);
  assert.equal(evaluateMarket({ ...manifest, games: [{ ...base, split: "training" }] }, root).counts.excludedGames, 1);
  assert.equal(evaluateMarket({ ...manifest, registeredAt: kickoff }, root).counts.excludedGames, 1);
  assert.throws(() => evaluateMarket({ ...manifest, modelRevision: "changed" }, root), /fingerprint/);
  assert.throws(() => evaluateMarket({ ...manifest, games: [base, base] }, root), /Duplicate/);
  assert.throws(() => evaluateMarket({ ...manifest, seeds: [123, 123] }, root), /unique/);
  assert.throws(() => parseInput({ ...input, market: {} }), /omit/);
  assert.throws(() => parseInput({ ...input, seed: 2 }), /omit/);
  assert.throws(() => parseInput({ ...input, away: { ...input.away, record: { wins: "2", losses: 1, ties: 0 } } }), /finite/);
  assert.throws(() => parseInput({
    ...input, away: { ...input.away, roster: input.away.roster!.map(player => ({ ...player, depthRank: 0 })) },
  }), /depth rank/);
  assert.throws(() => readArchive(root, { path: "../escape.json", sha256: "0".repeat(64) }, "fixture", "quote"));
  writeFileSync(join(root, validQuote.path), "{}");
  const corrupt = evaluateMarket({ ...manifest, games: [base] }, root);
  assert.equal(corrupt.counts.rejectedQuotes, 1);
  assert.match(String(corrupt.games[0]!.quoteExclusion), /checksum/);

  const metricRows = [
    { actual: { away: 10, home: 20 }, prediction: { total: 35, margin: 8, probabilities: [0.2, 0.7, 0.1] as [number, number, number] } },
    { actual: { away: 20, home: 20 }, prediction: { total: 35, margin: 2, probabilities: [0.3, 0.5, 0.2] as [number, number, number] } },
  ];
  const metrics = summarizeForecasts(metricRows)!;
  assert.equal(metrics.totalMAE, 5); assert.equal(metrics.totalRMSE, 5);
  assert.equal(metrics.marginMAE, 2); assert.equal(metrics.marginRMSE, 2);
  assert.equal(metrics.observedTies, 1);
  assert.ok(Math.abs(metrics.homeWinBrier! - 0.17) < 1e-12);
  assert.equal(metrics.homeWinReliability.reduce((sum, bin) => sum + bin.games, 0), 2);
  assert.equal(pairedDifferences(metricRows, metricRows)!.totalAbsolute.weightedMinusBaseline, 0);
  assert.deepEqual(pairedDifferences(metricRows, metricRows)!.totalAbsolute.descriptiveGameBootstrap95, [0, 0]);
  assert.equal(summarizeForecasts([]), null);
  const empty = evaluateMarket(JSON.parse(readFileSync(new URL("../../research/market-evaluation/manifest.json", import.meta.url), "utf8")), root);
  assert.equal(empty.counts.suppliedGames, 0);
  assert.equal(empty.baselineAllEligible, null);
  console.log("Market evaluation: paired production parity, evidence gates, exclusions, complete DK targets, null baselines, metrics and deterministic game-level uncertainty passed. Fixtures are synthetic, not accuracy evidence.");
} finally {
  rmSync(root, { recursive: true, force: true });
}