/**
 * Read-only held-out evaluation. JSON on stdout; diagnostics/exclusions in report.
 * Usage: pnpm --filter @workspace/scripts exec tsx src/market-evaluation.ts <manifest>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateGame, type SimulationInput } from "../../artifacts/gridiron-sim/src/lib/simulator";
import { MARKET_BLEND, marketOutcomeWeights, validateMarketOdds } from "../../artifacts/gridiron-sim/src/lib/market-odds";
import { calculateDraftKings } from "../../artifacts/gridiron-sim/src/lib/draftkings";
import {
  object, number, text, timestamp, readArchive, requirePregame, parseInput, playerKey,
} from "./market-evaluation-evidence";
import {
  summarizeForecasts, pairedDifferences, summarizePlayerErrors, type Forecast, type ScoredForecast,
} from "./market-evaluation-metrics";

const RUNS = 200;
export const scoringFields = [
  "passYards", "passTD", "interceptions", "rushYards", "rushTD", "receptions",
  "receivingYards", "receivingTD", "fumblesLost", "kickReturnTD", "puntReturnTD",
  "fieldGoalReturnTD", "twoPointConversions", "offensiveFumbleRecoveryTD",
] as const;
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Lock operational model source, not a caller-supplied version label. */
export function modelFingerprint() {
  const hash = createHash("sha256");
  for (const file of ["simulator.ts", "ensemble.ts", "market-odds.ts", "draftkings.ts", "nfl-divisions.ts"]) {
    hash.update(file).update(readFileSync(new URL(`../../artifacts/gridiron-sim/src/lib/${file}`, import.meta.url)));
  }
  return hash.digest("hex");
}

/** Exactly the production ensemble seed schedule, with unrounded metric inputs. */
export function pairedForecast(input: SimulationInput, seeds: number[], quote?: { homeSpread: number; total: number; provider: string; capturedAt: string }, kickoff?: string) {
  const predictions: { baseline: Forecast; weighted?: Forecast }[] = [];
  const effectiveRuns: number[] = [], maximumWeights: number[] = [];
  const warnings = new Set<string>();
  const players = new Map<string, { baseline: number[]; weighted: number[] }>();
  for (const seed of seeds) {
    const first = simulateGame({ ...input, seed, market: undefined });
    const games = [first];
    for (let i = 1; i < RUNS; i++) {
      games.push(simulateGame({ ...input, market: undefined, seed: (first.seed + Math.imul(i, 2654435761)) >>> 0 }));
    }
    const scores = games.map(game => ({ away: game.awayScore, home: game.homeScore }));
    const baselineWeights = scores.map(() => 1 / RUNS);
    let weightedWeights: number[] | undefined;
    if (quote) {
      // Use the archived freeze time, not the machine's current clock.
      const now = timestamp(quote.capturedAt);
      const valid = validateMarketOdds({
        enabled: true, source: "manual", awayTeam: input.away.name, homeTeam: input.home.name,
        homeSpread: quote.homeSpread, total: quote.total, provider: quote.provider,
        recordedAt: quote.capturedAt, kickoff,
      }, input.away.name, input.home.name, now)!;
      const weighted = marketOutcomeWeights(scores, valid, now);
      weightedWeights = weighted.weights;
      effectiveRuns.push(1 / weightedWeights.reduce((sum, weight) => sum + weight ** 2, 0));
      maximumWeights.push(Math.max(...weightedWeights));
      // The production timestamp disclaimer is not a verification of this archive.
      weighted.evidence.warnings.filter(warning => !warning.startsWith("Manual odds")).forEach(warning => warnings.add(warning));
    }
    const summarize = (weights: number[]): Forecast => ({
      total: scores.reduce((sum, score, i) => sum + (score.home + score.away) * weights[i]!, 0),
      margin: scores.reduce((sum, score, i) => sum + (score.home - score.away) * weights[i]!, 0),
      probabilities: [
        scores.reduce((sum, score, i) => sum + Number(score.away > score.home) * weights[i]!, 0),
        scores.reduce((sum, score, i) => sum + Number(score.home > score.away) * weights[i]!, 0),
        scores.reduce((sum, score, i) => sum + Number(score.home === score.away) * weights[i]!, 0),
      ],
    });
    predictions.push({ baseline: summarize(baselineWeights), weighted: weightedWeights && summarize(weightedWeights) });
    first.players.forEach((player, index) => {
      const key = playerKey(player);
      const row = players.get(key) ?? { baseline: [], weighted: [] };
      if (games.some(game => playerKey(game.players[index]!) !== key)) throw new Error("Simulation player alignment changed.");
      row.baseline.push(average(games.map(game => game.players[index]!.draftKings)));
      if (weightedWeights) row.weighted.push(games.reduce((sum, game, i) => sum + game.players[index]!.draftKings * weightedWeights[i]!, 0));
      players.set(key, row);
    });
  }
  const combine = (mode: "baseline" | "weighted"): Forecast => ({
    total: average(predictions.map(row => row[mode]!.total)),
    margin: average(predictions.map(row => row[mode]!.margin)),
    probabilities: [0, 1, 2].map(index => average(predictions.map(row => row[mode]!.probabilities[index]!))) as Forecast["probabilities"],
  });
  return {
    baseline: combine("baseline"), weighted: quote ? combine("weighted") : undefined,
    players: [...players].map(([key, row]) => ({
      key, baseline: average(row.baseline), weighted: quote ? average(row.weighted) : undefined,
    })),
    concentration: quote ? {
      effectiveRunsBySeed: effectiveRuns, minEffectiveRuns: Math.min(...effectiveRuns),
      meanEffectiveRuns: average(effectiveRuns), minEffectiveFraction: Math.min(...effectiveRuns) / RUNS,
      maxOutcomeWeight: Math.max(...maximumWeights), baselineEffectiveRuns: RUNS,
      baselineOutcomeWeight: 1 / RUNS, warnings: [...warnings],
    } : null,
  };
}

export function evaluateMarket(manifestValue: unknown, root: string) {
  const manifest = object(manifestValue);
  if (manifest.version !== 1 || !Array.isArray(manifest.games) || !Array.isArray(manifest.seeds) || !manifest.seeds.length) {
    throw new Error("Invalid manifest version, games, or seeds.");
  }
  const registered = timestamp(manifest.registeredAt);
  const seeds = manifest.seeds.map(value => {
    const seed = number(value);
    if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) throw new Error("Seed must be a nonzero uint32.");
    return seed;
  });
  if (new Set(seeds).size !== seeds.length || seeds.length > 20) throw new Error("Use 1–20 unique paired seeds.");
  const revision = modelFingerprint();
  if (manifest.games.length && manifest.modelRevision !== revision) throw new Error("Frozen model fingerprint differs from current model.");
  const rows: Record<string, unknown>[] = [];
  const allBaseline: ScoredForecast[] = [], pairedBaseline: ScoredForecast[] = [], pairedWeighted: ScoredForecast[] = [];
  const playerErrors: { baseline: number; weighted: number; actual: number; gameId: string }[] = [];
  const seen = new Set<string>(), seenMatchups = new Set<string>();
  let missingQuotes = 0, rejectedQuotes = 0, excludedGames = 0, excludedPlayerTargets = 0, missingPlayerTargets = 0;
  for (const raw of manifest.games) {
    const game = object(raw), id = text(game.id);
    if (seen.has(id)) throw new Error("Duplicate game ID.");
    seen.add(id);
    const row: Record<string, unknown> = { id };
    rows.push(row);
    if (game.quote == null) missingQuotes++;
    try {
      if (game.split !== "held-out") throw new Error("Not a held-out game.");
      const kickoff = timestamp(game.kickoff);
      if (registered >= kickoff) throw new Error("Prospective evaluation was not registered before kickoff.");
      const inputArchive = readArchive(root, game.input, id, "input");
      requirePregame(inputArchive, kickoff);
      const frozen = timestamp(inputArchive.capturedAt), payload = object(inputArchive.payload);
      if (timestamp(payload.historyThrough) > frozen) throw new Error("History includes observations after input freeze.");
      const input = parseInput(payload.input);
      const matchup = JSON.stringify([game.kickoff, input.away.name, input.home.name]);
      if (seenMatchups.has(matchup)) throw new Error("Duplicate matchup under a different ID.");
      seenMatchups.add(matchup);
      const eligibilityArchive = readArchive(root, game.eligibility, id, "eligibility");
      requirePregame(eligibilityArchive, kickoff, frozen);
      const eligibility = object(eligibilityArchive.payload);
      if (eligibility.complete !== true || !Array.isArray(eligibility.players)) throw new Error("Incomplete pregame eligibility.");
      const roster = new Map<string, string>();
      const ids = new Set<string>();
      for (const rawPlayer of eligibility.players) {
        const player = object(rawPlayer);
        const team = text(player.team), name = text(player.name), position = text(player.position), playerId = text(player.playerId);
        if (![input.away.name, input.home.name].includes(team) || !["QB", "RB", "WR", "TE"].includes(position)) {
          throw new Error("Invalid eligible team/position.");
        }
        const key = playerKey({ team, name, position });
        if (roster.has(key) || ids.has(playerId)) throw new Error("Duplicate eligibility identity.");
        roster.set(key, playerId); ids.add(playerId);
      }
      // Require explicit archived rosters, rather than current active flags or a default six.
      for (const team of [input.away, input.home]) {
        if (!team.roster) throw new Error("Evaluation requires explicit pregame input rosters.");
        for (const player of team.roster) {
          if (roster.get(playerKey({ team: team.name, ...player })) !== player.id) throw new Error("Input roster differs from eligibility.");
        }
      }
      if (roster.size !== input.away.roster!.length + input.home.roster!.length) throw new Error("Eligibility/input roster coverage differs.");
      const outcomeArchive = readArchive(root, game.outcome, id, "outcome");
      if (timestamp(outcomeArchive.capturedAt) <= kickoff) throw new Error("Outcome archive is not post-kickoff.");
      const outcome = object(outcomeArchive.payload);
      if (outcome.final !== true) throw new Error("Outcome is not final.");
      const actual = { away: number(outcome.awayScore), home: number(outcome.homeScore) };
      if (Object.values(actual).some(score => score < 0 || !Number.isInteger(score))) throw new Error("Invalid final score.");
      const targets = new Map<string, Record<string, unknown>>();
      if (outcome.players !== undefined && !Array.isArray(outcome.players)) throw new Error("Invalid player target list.");
      for (const rawTarget of (outcome.players ?? []) as unknown[]) {
        const target = object(rawTarget), playerId = text(target.playerId);
        if (targets.has(playerId)) throw new Error("Duplicate player target ID.");
        targets.set(playerId, target);
      }
      let quote: Parameters<typeof pairedForecast>[2];
      if (game.quote != null) {
        try {
          const archive = readArchive(root, game.quote, id, "quote");
          requirePregame(archive, kickoff, frozen);
          const line = object(archive.payload);
          if (line.awayTeam !== input.away.name || line.homeTeam !== input.home.name) throw new Error("Quote teams differ.");
          quote = { homeSpread: number(line.homeSpread), total: number(line.total), provider: text(line.provider), capturedAt: archive.capturedAt };
          validateMarketOdds({
            ...quote, recordedAt: quote.capturedAt, kickoff: text(game.kickoff),
            awayTeam: input.away.name, homeTeam: input.home.name, enabled: true, source: "manual",
          }, input.away.name, input.home.name, frozen);
          row.quoteAgeAtFreezeHours = (frozen - timestamp(archive.capturedAt)) / 3_600_000;
          row.quoteArchive = archive.archiveUrl;
        } catch (error) {
          quote = undefined; rejectedQuotes++;
          row.quoteExclusion = error instanceof Error ? error.message : String(error);
        }
      } else row.quoteExclusion = "Missing archived spread/total.";
      const prediction = pairedForecast(input, seeds, quote, text(game.kickoff));
      // Catch any simulator defaults/dropped players that disagree with the frozen eligible cohort.
      const projected = prediction.players.filter(player => ["QB", "RB", "WR", "TE"].includes(JSON.parse(player.key)[2]));
      if (projected.length !== roster.size || projected.some(player => !roster.has(player.key))) {
        throw new Error("Projected cohort differs from archived eligibility.");
      }
      allBaseline.push({ prediction: prediction.baseline, actual });
      row.status = quote ? "paired" : "baseline-only";
      row.actual = actual; row.baseline = prediction.baseline; row.weighted = prediction.weighted ?? null;
      row.concentration = prediction.concentration;
      if (!prediction.weighted) continue;
      pairedBaseline.push({ prediction: prediction.baseline, actual });
      pairedWeighted.push({ prediction: prediction.weighted, actual });
      const exclusions: { playerId: string; reason: string }[] = [];
      for (const player of projected) {
        const playerId = roster.get(player.key)!, target = targets.get(playerId);
        if (!target) { missingPlayerTargets++; exclusions.push({ playerId, reason: "No independently observed target; not zero." }); continue; }
        try {
          // Explicit complete game ledger is required, including unusual scoring events.
          if (target.observed !== true) throw new Error("Participation/scoring observation not established.");
          const stats = object(target.stats);
          for (const field of scoringFields) {
            const value = number(stats[field]);
            if (!["passYards", "rushYards", "receivingYards"].includes(field) && (!Number.isInteger(value) || value < 0)) {
              throw new Error("Observed scoring-event count is not a nonnegative integer.");
            }
          }
          const actualDK = calculateDraftKings(stats as Record<string, number>);
          playerErrors.push({ gameId: id, baseline: player.baseline, weighted: player.weighted!, actual: actualDK });
        } catch (error) {
          excludedPlayerTargets++;
          exclusions.push({ playerId, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      row.playerTargetExclusions = exclusions;
      row.unmatchedOutcomePlayers = [...targets.keys()].filter(playerId => !ids.has(playerId));
    } catch (error) {
      excludedGames++;
      row.status = "excluded"; row.reason = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    status: pairedBaseline.length ? "descriptive-evaluation-only" : "insufficient-evidence",
    conclusion: "No accuracy improvement is established. The 35% blend is unchanged. Independently audit archive provenance and use a powered, preregistered held-out study before any gain claim or tuning.",
    evidenceCaveat: "Checksums bind local bytes; URLs and capturedAt alone do not authenticate historical publication. A reviewer must verify the linked independent archive and the full roster/scoring ledger. ESPN retrieval times and manual declarations are not accepted as proof.",
    modelFingerprint: revision, registeredAt: manifest.registeredAt,
    blend: MARKET_BLEND, runsPerSeed: RUNS, seeds, seedReplicatesAreNotIndependentGames: true,
    counts: {
      suppliedGames: rows.length, pairedGames: pairedBaseline.length,
      baselineOnlyGames: allBaseline.length - pairedBaseline.length, excludedGames,
      missingQuotes, rejectedQuotes, missingPlayerTargets, excludedPlayerTargets,
    },
    baselineAllEligible: summarizeForecasts(allBaseline),
    paired: {
      baseline: summarizeForecasts(pairedBaseline), weighted: summarizeForecasts(pairedWeighted),
      differences: pairedDifferences(pairedBaseline, pairedWeighted),
      draftKings: summarizePlayerErrors(playerErrors),
    },
    uncertaintyCaveat: "Bootstrap intervals are descriptive, assume independent games, and may be too narrow with repeated teams/weeks. Do not treat players or seed replicates as independent samples.",
    games: rows,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: market-evaluation.ts <research-manifest.json>");
  console.log(JSON.stringify(evaluateMarket(JSON.parse(readFileSync(path, "utf8")), dirname(resolve(path))), null, 2));
}