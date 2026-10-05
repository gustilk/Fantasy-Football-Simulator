import { gameForecast, type DKSlate } from './draftkings-board';
import type { SavedSimulation } from './saved-simulations';

export interface SimulatorLineupSource {
  slates: DKSlate[];
  warnings: string[];
  error: string;
  preferredWeek?: number;
}

/** Adapt complete, frozen weekly inputs without mutating either forecast archive.
 * Keep batches separate; never combine unrelated reruns or infer missing timing. */
export function simulatorLineupSource(entries: SavedSimulation[], season: number): SimulatorLineupSource {
  const groups = new Map<string, SavedSimulation[]>();
  let legacy = 0;
  for (const entry of entries) {
    if (entry.setup?.market?.season !== season) continue;
    if (!entry.weeklyRunId || !entry.generatedAt) { legacy++; continue; }
    const week = entry.setup.market.week;
    if (!Number.isInteger(week) || week! < 1) { legacy++; continue; }
    const key = `${week}:${entry.weeklyRunId}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const slates: DKSlate[] = [];
  let excluded = 0;
  for (const group of groups.values()) {
    const week = group[0]!.setup!.market!.week!;
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const slate: DKSlate = {
      id: `simulator:${season}:${week}:${JSON.stringify(sorted.map(entry => entry.id))}`,
      season, sunday: `${season} · Week ${week}`, timezone: 'America/Chicago',
      createdAt: sorted.map(e => e.generatedAt!).sort()[0]!,
      savedAt: sorted.map(e => e.savedAt).sort().at(-1)!,
      forecasts: [], failures: [],
    };
    const seen = new Set<string>();
    for (const entry of sorted) {
      const market = entry.setup!.market!;
      try {
        const kickoff = Date.parse(market.kickoff ?? '');
        const generated = Date.parse(entry.generatedAt!);
        const saved = Date.parse(entry.savedAt);
        if (!market.gameId || seen.has(market.gameId)) throw new Error('Missing or duplicate game identity in this batch.');
        seen.add(market.gameId);
        if (![kickoff, generated, saved].every(Number.isFinite) || generated > saved || saved > Date.now() || saved >= kickoff) {
          throw new Error('Not a confirmed pregame forecast. Rerun an upcoming week with confirmed kickoff times.');
        }
        if (entry.setup!.away.name !== entry.awayName || entry.setup!.home.name !== entry.homeName ||
            market.awayTeam !== entry.awayName || market.homeTeam !== entry.homeName ||
            !Number.isInteger(entry.result.seed)) throw new Error('Saved matchup or seed does not match its frozen input.');
        const forecast = gameForecast({
          id: market.gameId, week, date: market.kickoff!, awayTeam: entry.awayName, homeTeam: entry.homeName,
        }, { ...structuredClone(entry.setup!), seed: entry.result.seed }, entry.result);
        forecast.generatedAt = entry.generatedAt;
        slate.forecasts.push(forecast);
      } catch (cause) {
        excluded++;
        slate.failures.push({ gameId: market.gameId ?? entry.id, matchup: `${entry.awayName} at ${entry.homeName}`,
          reason: cause instanceof Error ? cause.message : 'Incomplete saved projection.' });
      }
    }
    if (slate.forecasts.length) slates.push(slate);
  }
  slates.sort((a, b) => Date.parse(b.savedAt!) - Date.parse(a.savedAt!) || a.id.localeCompare(b.id));
  return {
    slates, error: '',
    warnings: [
      ...(legacy ? [`${legacy} older saved simulation(s) lack complete run identity or generation timing. They remain available as results; select and rerun the matching game to use it for lineups.`] : []),
      ...(excluded ? [`${excluded} simulation(s) were excluded because their frozen matchup, projections or pregame timing could not be verified.`] : []),
    ],
  };
}
