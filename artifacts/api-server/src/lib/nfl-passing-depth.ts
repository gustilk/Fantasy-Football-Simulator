import type { NflPassingDepth } from '@workspace/api-zod';
import { sourceNumber } from './nfl-advanced-csv';

const bands = ['short', 'intermediate', 'deep'] as const;
export interface PassingCounters {
  bands: Record<typeof bands[number], { attempts: number; completions: number; epa: number; epaSamples: number }>;
  unknownDepthAttempts: number; explosives: number; explosiveSamples: number; yac: number; yacSamples: number;
}
export function newPassingCounters(): PassingCounters {
  return { bands: { short: { attempts: 0, completions: 0, epa: 0, epaSamples: 0 },
    intermediate: { attempts: 0, completions: 0, epa: 0, epaSamples: 0 }, deep: { attempts: 0, completions: 0, epa: 0, epaSamples: 0 } },
  unknownDepthAttempts: 0, explosives: 0, explosiveSamples: 0, yac: 0, yacSamples: 0 };
}
/** Caller already excludes deleted plays, kneels, spikes and two-point plays. */
export function recordPassingDepth(row: Record<string, string | undefined>, ...teams: PassingCounters[]) {
  if (row.play_type !== 'pass' || row.pass_attempt !== '1' || row.sack === '1' || row.rush_attempt === '1' || row.qb_scramble === '1') return;
  const air = sourceNumber(row.air_yards), gain = sourceNumber(row.yards_gained), yac = sourceNumber(row.yards_after_catch), epa = sourceNumber(row.epa);
  const completionKnown = row.complete_pass === '0' || row.complete_pass === '1';
  for (const team of teams) {
    if (air !== null && completionKnown) {
      const band = team.bands[air < 10 ? 'short' : air < 20 ? 'intermediate' : 'deep'];
      band.attempts++; band.completions += Number(row.complete_pass === '1');
      if (epa !== null) { band.epa += epa; band.epaSamples++; }
    } else team.unknownDepthAttempts++;
    if (gain !== null) { team.explosiveSamples++; team.explosives += Number(gain >= 15); }
    if (row.complete_pass === '1' && yac !== null) { team.yac += yac; team.yacSamples++; }
  }
}
export function passingDepthReport(rows: PassingCounters[]): NflPassingDepth {
  const total = newPassingCounters();
  for (const row of rows) {
    for (const band of bands) for (const key of ['attempts', 'completions', 'epa', 'epaSamples'] as const) total.bands[band][key] += row.bands[band][key];
    for (const key of ['unknownDepthAttempts', 'explosives', 'explosiveSamples', 'yac', 'yacSamples'] as const) total[key] += row[key];
  }
  const round = (v: number) => Math.round(v * 10000) / 10000;
  const result: NflPassingDepth = { unknownDepthAttempts: total.unknownDepthAttempts,
    passExplosiveSamples: total.explosiveSamples, passExplosiveRate: total.explosiveSamples ? round(total.explosives / total.explosiveSamples) : null,
    yacSamples: total.yacSamples, yacPerCompletion: total.yacSamples ? round(total.yac / total.yacSamples) : null };
  for (const band of bands) {
    const b = total.bands[band];
    result[`${band}Attempts`] = b.attempts;
    result[`${band}CompletionRate`] = b.attempts ? round(b.completions / b.attempts) : null;
    result[`${band}EpaSamples`] = b.epaSamples;
    result[`${band}Epa`] = b.epaSamples ? round(b.epa / b.epaSamples) : null;
  }
  return result;
}
