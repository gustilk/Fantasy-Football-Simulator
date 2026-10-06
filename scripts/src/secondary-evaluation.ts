/** Read-only paired study. Never writes Team Library or browser forecast archives. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateGame, type SimulationInput } from '../../artifacts/gridiron-sim/src/lib/simulator';
import { object, number, text, timestamp, playerKey } from './market-evaluation-evidence';
import { loadSecondaryGame, observedFantasy, observedPassing } from './secondary-evaluation-evidence';
import { covered, interval, mean, passCounters, recordPlay, passMetrics, summarizeMetrics, summarizeDiagnostic, type MetricRow } from './secondary-evaluation-metrics';

const RUNS = 200;
const passingKeys = ['attempts', 'completions', 'intermediateAttempts', 'intermediateCompletions', 'deepAttempts',
  'deepCompletions', 'intermediateCompletionRate', 'deepCompletionRate', 'passing15PlusRate', 'yacMean',
  'yac5PlusFrequency', 'yac10PlusFrequency'] as const;
export function secondaryFingerprint() {
  const hash = createHash('sha256');
  // Conservative lock: include all simulator helpers (including future local dependencies).
  const root = new URL('../../artifacts/gridiron-sim/src/lib/', import.meta.url);
  for (const file of readdirSync(root).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
    hash.update(file).update(readFileSync(new URL(file, root)));
  }
  for (const file of ['secondary-evaluation.ts', 'secondary-evaluation-evidence.ts', 'secondary-evaluation-metrics.ts',
    'market-evaluation-evidence.ts', 'market-evaluation.ts']) hash.update(file).update(readFileSync(new URL(file, import.meta.url)));
  for (const file of ['nfl-passing-depth.ts', 'nfl-advanced-csv.ts', 'nfl-advanced-data.ts']) hash.update(file).update(readFileSync(new URL(`../../artifacts/api-server/src/lib/${file}`, import.meta.url)));
  return hash.digest('hex');
}

/** Same seeds and all non-secondary input fields; do not rederive baseline ratings. */
export function secondaryForecast(input: SimulationInput, seeds: number[]) {
  const forecast = (secondary: boolean) => {
    const scores = { away: [] as number[], home: [] as number[] };
    const passes = new Map([input.away.name, input.home.name].map(team => [team, passCounters()]));
    const players = new Map<string, number[]>();
    const perSeedScores: { awayMean: number | null; homeMean: number | null }[] = [];
    for (const seed of seeds) {
      const seedScores = { away: [] as number[], home: [] as number[] };
      for (let i = 0; i < RUNS; i++) {
        const result = simulateGame({ ...input, secondaryModel: secondary ? 'secondary-v1' : undefined,
          seed: (seed + Math.imul(i, 2654435761)) >>> 0 }, (team, play) => recordPlay(passes.get(team)!, play));
        scores.away.push(result.awayScore); scores.home.push(result.homeScore);
        seedScores.away.push(result.awayScore); seedScores.home.push(result.homeScore);
        for (const p of result.players.filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.position))) {
          const key = playerKey(p), values = players.get(key) ?? [];
          values.push(p.draftKings); players.set(key, values);
        }
      }
      perSeedScores.push({ awayMean: mean(seedScores.away), homeMean: mean(seedScores.home) });
    }
    for (const values of players.values()) if (values.length !== seeds.length * RUNS) throw new Error('Simulation cohort changed across seeds.');
    const passing = Object.fromEntries([...passes].map(([team, counts]) => {
      const metrics = passMetrics(counts);
      for (const key of ['attempts', 'completions', 'intermediateAttempts', 'intermediateCompletions', 'deepAttempts', 'deepCompletions'] as const) {
        if (metrics[key] !== null) metrics[key] /= seeds.length * RUNS;
      }
      return [team, { ...metrics, simulatedGames: seeds.length * RUNS,
        rawDenominators: { attempts: counts.attempts, completions: counts.completions, knownAirAttempts: counts.depthKnown,
          intermediateAttempts: counts.intermediateAttempts, deepAttempts: counts.deepAttempts,
          passing15PlusSamples: counts.explosiveSamples, yacCompletions: counts.yacSamples } }];
    }));
    return { scores: { away: interval(scores.away), home: interval(scores.home) },
      players: new Map([...players].map(([key, values]) => [key, interval(values)])), passing, perSeedScores };
  };
  return { baseline: forecast(false), secondary: forecast(true) };
}

export function evaluateSecondary(value: unknown, root: string) {
  const manifest = object(value);
  if (manifest.version !== 1 || !Array.isArray(manifest.games) || !Array.isArray(manifest.seeds)) throw new Error('Invalid study manifest.');
  const registered = timestamp(manifest.registeredAt), seeds = manifest.seeds.map(number);
  if (!seeds.length || seeds.length > 20 || new Set(seeds).size !== seeds.length ||
    seeds.some(n => !Number.isInteger(n) || n < 1 || n > 0xffffffff)) throw new Error('Use 1–20 unique nonzero uint32 seeds.');
  const fingerprint = secondaryFingerprint();
  if (manifest.games.length && manifest.modelRevision !== fingerprint) throw new Error('Study model fingerprint changed; do not silently re-register tuned holdouts.');
  const ids = new Set<string>(), games = manifest.games.map(raw => {
    const g = object(raw), id = text(g.id);
    if (ids.has(id)) throw new Error('Duplicate study game ID.');
    ids.add(id);
    if (!['calibration', 'held-out'].includes(text(g.split))) throw new Error('Explicit calibration or held-out split required.');
    timestamp(g.kickoff);
    return g;
  });
  const calibration = games.filter(g => g.split === 'calibration'), held = games.filter(g => g.split === 'held-out');
  if (calibration.length && held.length && Math.max(...calibration.map(g => timestamp(g.kickoff))) >= Math.min(...held.map(g => timestamp(g.kickoff)))) {
    throw new Error('Calibration must precede the separate held-out period.');
  }
  const bucket = () => ({ scoring: [] as MetricRow[], fantasy: [] as MetricRow[], passing: {} as Record<string, MetricRow[]>,
    diagnostic: {} as Record<string, { gameId: string; predicted: number; actual: number }[]> });
  const buckets = { calibration: bucket(), 'held-out': bucket() };
  const rows: Record<string, unknown>[] = [], matchups = new Set<string>();
  for (const game of games) {
    const row: Record<string, unknown> = { id: game.id, split: game.split, kickoff: game.kickoff };
    rows.push(row);
    try {
      const loaded = loadSecondaryGame(root, game, registered), { input, actual, roster, targets } = loaded;
      const key = JSON.stringify([timestamp(game.kickoff), ...[input.away.name, input.home.name].sort()]);
      if (matchups.has(key)) throw new Error('Duplicate matchup under another ID.');
      matchups.add(key);
      const pair = secondaryForecast(input, seeds), bucket = buckets[game.split as keyof typeof buckets], gameId = text(game.id);
      if (pair.baseline.players.size !== roster.size || pair.secondary.players.size !== roster.size ||
        [...roster.keys()].some(k => !pair.baseline.players.has(k) || !pair.secondary.players.has(k))) throw new Error('Projected roster differs from frozen eligibility.');
      const scoreRows: MetricRow[] = [], fantasyRows: MetricRow[] = [], passingRows: Record<string, MetricRow[]> = {};
      const diagnostics: typeof bucket.diagnostic = {};
      for (const side of ['away', 'home'] as const) scoreRows.push({
        gameId, baseline: pair.baseline.scores[side].mean!, secondary: pair.secondary.scores[side].mean!, actual: actual[side],
        baselineCovered: covered(pair.baseline.scores[side], actual[side]), secondaryCovered: covered(pair.secondary.scores[side], actual[side]),
      });
      const playerExclusions: { playerId: string; reason: string }[] = [], players: Record<string, unknown>[] = [];
      for (const [key, playerId] of roster) {
        try {
          if (!targets.has(playerId)) throw new Error('Missing observed ledger; not zero/DNP.');
          const target = observedFantasy(targets.get(playerId)), b = pair.baseline.players.get(key)!, s = pair.secondary.players.get(key)!;
          fantasyRows.push({ gameId, baseline: b.mean!, secondary: s.mean!, actual: target,
            baselineCovered: covered(b, target), secondaryCovered: covered(s, target) });
          players.push({ playerId, actual: target, baseline: b, secondary: s });
        } catch (error) { playerExclusions.push({ playerId, reason: String(error) }); }
      }
      const passing: Record<string, unknown>[] = [];
      for (const team of [input.away.name, input.home.name]) {
        const baseline = pair.baseline.passing[team]!, secondary = pair.secondary.passing[team]!;
        const passRow: Record<string, unknown> = { team, baseline, secondary };
        passing.push(passRow);
        try {
          const observed = observedPassing(object(loaded.outcome.passing)[team], { id: gameId, season: loaded.season, week: loaded.week, team });
          passRow.observed = observed;
          for (const metric of passingKeys) {
            const b = baseline[metric], s = secondary[metric], a = observed[metric];
            if (a !== null && s !== null) {
              // Baseline lacks air-depth / YAC. Retain secondary-only diagnostic, never fabricate a paired improvement.
              passRow[metric] = { observed: a, baseline: b, secondary: s, secondaryError: s - a, paired: b !== null };
              (diagnostics[metric] ??= []).push({ gameId, predicted: s, actual: a });
              if (b !== null) (passingRows[metric] ??= []).push({ gameId, baseline: b, secondary: s, actual: a });
            }
          }
        } catch (error) { passRow.exclusion = String(error); }
      }
      bucket.scoring.push(...scoreRows); bucket.fantasy.push(...fantasyRows);
      for (const [key, metricRows] of Object.entries(passingRows)) (bucket.passing[key] ??= []).push(...metricRows);
      for (const [key, metricRows] of Object.entries(diagnostics)) (bucket.diagnostic[key] ??= []).push(...metricRows);
      Object.assign(row, { status: 'paired', activeSecondary: loaded.active, actual, archives: loaded.archives,
        scores: { baseline: pair.baseline.scores, secondary: pair.secondary.scores },
        perSeedScores: { baseline: pair.baseline.perSeedScores, secondary: pair.secondary.perSeedScores },
        players, playerExclusions, unmatchedOutcomePlayers: [...targets.keys()].filter(id => ![...roster.values()].includes(id)), passing });
    } catch (error) { row.status = 'excluded'; row.reason = String(error); }
  }
  const summary = (split: keyof typeof buckets) => {
    const bucket = buckets[split], included = rows.filter(r => r.split === split && r.status === 'paired');
    return { suppliedGames: games.filter(g => g.split === split).length, eligibleGames: included.length,
      activeSecondaryGames: included.filter(r => r.activeSecondary).length,
      excludedGames: rows.filter(r => r.split === split && r.status === 'excluded').length,
      teamScoring: summarizeMetrics(bucket.scoring), fantasy: summarizeMetrics(bucket.fantasy),
      pairedPassing: Object.fromEntries(passingKeys.map(key => [key, summarizeMetrics(bucket.passing[key] ?? [])])),
      secondaryPassingDiagnostics: Object.fromEntries(passingKeys.map(key => [key, summarizeDiagnostic(bucket.diagnostic[key] ?? [])])) };
  };
  return { status: buckets['held-out'].scoring.length ? 'descriptive-only' : 'insufficient-evidence',
    conclusion: 'No predictive improvement is established automatically. Do not tune on evaluation outcomes.',
    modelFingerprint: fingerprint, registeredAt: manifest.registeredAt, seeds, runsPerSeedPerModel: RUNS,
    calibration: summary('calibration'), heldOut: summary('held-out'), games: rows,
    limitations: ['Independent archive/source authenticity requires review; hashes and local declarations do not prove pregame availability.',
      'P10–P90 intervals are model uncertainty, not guaranteed 80% empirical coverage.',
      'Possession-v1 has no air-depth or YAC outputs; those baseline metrics are unavailable, not zero.',
      'Counts disclose known-air throws; interceptions without generated air depth remain unknown.',
      'YAC frequencies use >=5 and >=10 yards per measured completion, not passing explosives.',
      'Paired seeds reduce simulation noise but are not additional real games. Repeated teams/weeks remain dependent.'] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: secondary-evaluation.ts <research-manifest.json>');
  console.log(JSON.stringify(evaluateSecondary(JSON.parse(readFileSync(path, 'utf8')), dirname(resolve(path))), null, 2));
}
