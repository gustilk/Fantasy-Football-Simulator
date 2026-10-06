import type { NflPassingDepth } from '@workspace/api-client-react';

export interface SecondaryEvidence {
  current?: NflPassingDepth; prior?: NflPassingDepth;
  season: number; weeks: number[]; priorSeason?: number;
}
export interface SecondaryPass {
  band: 'short' | 'intermediate' | 'deep'; airYards: number; completionRate: number; yacMean: number;
}
const bands = ['short', 'intermediate', 'deep'] as const;
const priors = { short: 0.72, intermediate: 0.58, deep: 0.4 };
const shares = { short: 0.6, intermediate: 0.25, deep: 0.15 };
const bound = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Sample-weighted current evidence plus capped, separately frozen prior data. */
function observation(e: SecondaryEvidence | undefined, rate: keyof NflPassingDepth, samples: keyof NflPassingDepth, cap: number) {
  const row = (stats: NflPassingDepth | undefined, limit: number) => {
    const value = stats?.[rate], n = stats?.[samples] ?? 0;
    if (value === undefined || value === null || !n) return { value: 0, n: 0 };
    if (!Number.isFinite(value) || !Number.isFinite(n) || n < 0) throw new Error('Invalid secondary evidence.');
    if (/Rate$/.test(rate) && (value < 0 || value > 1)) throw new Error('Secondary completion/explosive rates must be between 0 and 1.');
    return { value, n: Math.min(n, limit) };
  };
  const a = row(e?.current, Infinity), b = row(e?.prior, cap), n = a.n + b.n;
  return { value: n ? (a.value * a.n + b.value * b.n) / n : 0, n };
}
/** No team-name bonuses. Air depth, completion coverage, passing explosiveness
 * and YAC are distinct. EPA adjusts depth choice, not fantasy points. */
export function secondaryMatchup(offense?: SecondaryEvidence, defense?: SecondaryEvidence) {
  const data = bands.map(band => ({
    band,
    offense: observation(offense, `${band}CompletionRate`, `${band}Attempts`, 30),
    defense: observation(defense, `${band}CompletionRate`, `${band}Attempts`, 30),
    epa: observation(defense, `${band}Epa`, `${band}EpaSamples`, 30),
  }));
  const explosive = observation(defense, 'passExplosiveRate', 'passExplosiveSamples', 90);
  const offenseYac = observation(offense, 'yacPerCompletion', 'yacSamples', 50);
  const defenseYac = observation(defense, 'yacPerCompletion', 'yacSamples', 50);
  const active = data.some(d => d.offense.n || d.defense.n || d.epa.n) || explosive.n > 0 || offenseYac.n > 0 || defenseYac.n > 0;
  return {
    active, data, explosive, offenseYac, defenseYac,
    sample(random: () => number, distance: number, completion: number, receiverAir?: number): SecondaryPass | undefined {
      if (!active) return undefined;
      const total = data.reduce((n, d) => n + d.offense.n, 0);
      const epaN = data.reduce((n, d) => n + d.epa.n, 0);
      const meanEpa = epaN ? data.reduce((n, d) => n + d.epa.value * d.epa.n, 0) / epaN : 0;
      const tail = explosive.n ? bound((explosive.value - 0.12) * explosive.n / (explosive.n + 60), -0.06, 0.06) : 0;
      const weights = data.map(d => {
        if ((d.band === 'deep' && distance < 20) || (d.band === 'intermediate' && distance < 10)) return 0;
        const observed = total ? d.offense.n / total : shares[d.band];
        let weight = shares[d.band] + (observed - shares[d.band]) * total / (total + 80);
        // Player air-yard evidence affects route selection, not a points bonus.
        if (receiverAir !== undefined && Number.isFinite(receiverAir)) weight *= d.band === 'deep'
          ? bound(receiverAir / 8, 0.3, 1.8) : d.band === 'short' ? bound(1.5 - receiverAir / 16, 0.5, 1.5) : 1;
        weight += d.band === 'deep' ? tail : d.band === 'short' ? -tail : 0;
        weight += d.epa.n ? bound((d.epa.value - meanEpa) * 0.06 * d.epa.n / (d.epa.n + 30), -0.03, 0.03) : 0;
        return Math.max(0.02, weight);
      });
      let roll = random() * weights.reduce((n, w) => n + w, 0), index = 0;
      for (let i = 0; i < weights.length; i++) { if (weights[i] === 0) continue; roll -= weights[i]!; index = i; if (roll < 0) break; }
      const d = data[index]!, prior = priors[d.band];
      const base = bound(completion + prior - 0.645, 0.1, 0.95);
      const offenseWeight = d.offense.n / (d.offense.n + 30);
      const defenseDelta = d.defense.n ? bound((d.defense.value - prior) * d.defense.n / (d.defense.n + 30), -0.12, 0.12) : 0;
      const rate = bound(base * (1 - offenseWeight) + d.offense.value * offenseWeight + defenseDelta, 0.1, 0.95);
      const yacBase = offenseYac.n ? 4.5 + (offenseYac.value - 4.5) * offenseYac.n / (offenseYac.n + 40) : 4.5;
      const yacDelta = defenseYac.n ? bound((defenseYac.value - 4.5) * defenseYac.n / (defenseYac.n + 40), -2, 2) : 0;
      const lo = d.band === 'short' ? -3 : d.band === 'intermediate' ? 10 : 20;
      const hi = Math.min(distance, d.band === 'short' ? 9 : d.band === 'intermediate' ? 19 : 50);
      return { band: d.band, airYards: lo + Math.floor(random() * (hi - lo + 1)), completionRate: rate, yacMean: bound(yacBase + yacDelta, 0, 10) };
    },
  };
}
export function secondaryNotes(team: string, evidence: SecondaryEvidence | undefined, matchup: ReturnType<typeof secondaryMatchup>) {
  const current = evidence?.weeks.length ? `${evidence.season} last ${evidence.weeks.length} completed game(s), weeks ${evidence.weeks.join('/')}` : 'current last-four coverage unavailable';
  const baseline = evidence?.prior ? `; capped ${evidence.priorSeason} baseline kept separate` : '';
  const display = (band: 'intermediate' | 'deep') => {
    const row = matchup.data.find(d => d.band === band)!, d = row.defense;
    const rate = evidence?.current?.[`${band}CompletionRate`], attempts = evidence?.current?.[`${band}Attempts`] ?? 0;
    const recent = rate !== undefined && rate !== null && attempts > 0 ? `${(rate * 100).toFixed(1)}% allowed (${attempts} throws)` : 'unknown';
    return `${band === 'deep' ? '20+' : '10–19'} air yards: recent ${recent}; model evidence ${d.n ? `${(d.value * 100).toFixed(1)}% (${d.n} effective attempts)` : 'unknown'}; EPA/throw ${row.epa.n ? `${row.epa.value.toFixed(2)} (${row.epa.n} effective throws)` : 'unknown'}`;
  };
  return `${team} secondary evidence: ${current}${baseline}. ${display('intermediate')}; ${display('deep')}; passing 15+ gains ${matchup.explosive.n ? `${(matchup.explosive.value * 100).toFixed(1)}% (${matchup.explosive.n} effective throws)` : 'unknown'}; YAC allowed ${matchup.defenseYac.n ? `${matchup.defenseYac.value.toFixed(1)} yards (${matchup.defenseYac.n} effective catches)` : 'unknown'}. ${matchup.active ? 'Sample-weighted, bounded adjustments; not validated secondary grades.' : 'No measured coverage input: neutral, no secondary adjustment.'}`;
}
