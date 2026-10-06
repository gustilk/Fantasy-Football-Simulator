export type DriveOutcome = 'TD' | 'FG' | 'Punt' | 'Turnover' | 'End';
export type DriveTurnover = 'interception' | 'fumble' | 'downs' | 'missed-fg';
export interface PossessionRates {
  successRate?: number; successSamples?: number;
  explosivePlayRate?: number; explosiveSamples?: number;
  redZoneTdRate?: number; redZoneTrips?: number;
}
export interface DriveProfile {
  successRate: number; explosivePlayRate: number; redZoneTdRate: number;
  passShare: number; interceptionRate: number; fumbleRate: number; sackRate: number;
  fieldGoalPenalty: number; secondsPerPlay: number;
}
export interface PossessionPlay {
  kind: 'pass' | 'run' | 'sack'; completed: boolean; gain: number; touchdown: boolean;
  turnover?: 'interception' | 'fumble'; explosive: boolean; successful: boolean;
}
export interface PossessionDrive {
  outcome: DriveOutcome; plays: PossessionPlay[]; elapsedSeconds: number;
  startYardsToGoal: number; endYardsToGoal: number; redZone: boolean;
  fieldGoalDistance?: number; turnover?: DriveTurnover;
}
const bound = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const integer = (random: () => number, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
export const DRIVE_PRIORS = { successRate: 0.43, explosivePlayRate: 0.08, redZoneTdRate: 0.55 } as const;
/** Missing observations use explicit heuristic priors, never fabricated source rates. */
export function matchupDriveRates(offense: PossessionRates = {}, defense: PossessionRates = {}) {
  const samples = { successRate: 'successSamples', explosivePlayRate: 'explosiveSamples', redZoneTdRate: 'redZoneTrips' } as const;
  return Object.fromEntries(Object.entries(DRIVE_PRIORS).map(([key, prior]) => {
    const k = key as keyof typeof DRIVE_PRIORS, sample = samples[k];
    const estimate = (rates: PossessionRates) => {
      const value = rates[k], n = rates[sample] ?? 0;
      if (value === undefined) return prior;
      if (!Number.isFinite(value) || value < 0 || value > 1 || !Number.isFinite(n) || n < 0) throw new Error(`Invalid possession metric: ${k}. Use a rate from 0 to 1 and a nonnegative sample.`);
      const weight = n / (n + (k === 'redZoneTdRate' ? 12 : 100));
      return prior + (value - prior) * weight;
    };
    return [key, bound(estimate(offense) + estimate(defense) - prior, 0.001, 0.999)];
  })) as Record<keyof typeof DRIVE_PRIORS, number>;
}
/** One possession with downs, field position and a finite shared-clock budget.
 * Success and 15+ yard explosiveness are separate inputs: explosiveness controls
 * the tail, while success controls non-explosive chain-moving plays.
 * Red-zone rate supplies a finishing hazard over a nominal four-play visit.
 * These mappings are heuristics, not an accuracy-calibrated football model. */
export function simulatePossessionDrive(options: {
  profile: DriveProfile; random: () => number; startYardsToGoal?: number; secondsAvailable: number;
  opportunity?: (kind: 'pass' | 'run', yardsToGoal: number) => { efficiency: number; completionRate: number; fumbleRate: number };
  onPlay?: (play: PossessionPlay, yardsToGoal: number) => void;
}): PossessionDrive {
  const { profile: p, random } = options;
  for (const key of ['successRate', 'explosivePlayRate', 'redZoneTdRate', 'passShare', 'interceptionRate', 'fumbleRate', 'sackRate'] as const) {
    if (!Number.isFinite(p[key]) || p[key] < 0 || p[key] > 1) throw new Error(`Invalid drive probability: ${key}.`);
  }
  if (!Number.isFinite(options.secondsAvailable) || options.secondsAvailable < 0
    || !Number.isFinite(p.secondsPerPlay) || p.secondsPerPlay <= 0 || !Number.isFinite(p.fieldGoalPenalty)
    || (options.startYardsToGoal !== undefined && (!Number.isFinite(options.startYardsToGoal) || options.startYardsToGoal < 1 || options.startYardsToGoal > 99))) throw new Error('Invalid possession clock or field position.');
  const drive: PossessionDrive = {
    outcome: 'End', plays: [], elapsedSeconds: 0, startYardsToGoal: options.startYardsToGoal ?? 75,
    endYardsToGoal: options.startYardsToGoal ?? 75, redZone: false,
  };
  let down = 1, toGo = Math.min(10, drive.endYardsToGoal);
  const spend = (seconds: number) => { drive.elapsedSeconds = Math.min(options.secondsAvailable, drive.elapsedSeconds + seconds); };
  const kick = () => {
    drive.fieldGoalDistance = drive.endYardsToGoal + 17;
    spend(6);
    const chance = bound(0.96 - Math.max(0, drive.fieldGoalDistance - 35) * 0.012 - p.fieldGoalPenalty, 0.3, 0.96);
    drive.outcome = random() < chance ? 'FG' : 'Turnover';
    if (drive.outcome === 'Turnover') drive.turnover = 'missed-fg';
  };
  while (drive.elapsedSeconds < options.secondsAvailable) {
    if (down === 4) {
      if (drive.endYardsToGoal + 17 <= 59) kick();
      else { drive.outcome = 'Punt'; spend(6); }
      return drive;
    }
    const inRedZone = drive.endYardsToGoal <= 20;
    drive.redZone ||= inRedZone;
    const pass = random() < p.passShare;
    const opportunity = options.opportunity?.(pass ? 'pass' : 'run', drive.endYardsToGoal);
    const completionRate = opportunity?.completionRate ?? 0.645;
    const fumbleRate = opportunity?.fumbleRate ?? p.fumbleRate;
    const efficiency = opportunity?.efficiency ?? 1;
    if (![completionRate, fumbleRate].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || !Number.isFinite(efficiency) || efficiency <= 0) throw new Error('Invalid player opportunity probabilities.');
    const play: PossessionPlay = { kind: pass ? 'pass' : 'run', completed: false, gain: 0, touchdown: false, explosive: false, successful: false };
    if (pass && random() < p.interceptionRate) play.turnover = 'interception';
    else if (pass && random() < p.sackRate) { play.kind = 'sack'; play.gain = -integer(random, 3, 9); }
    else {
      const finishes = inRedZone && random() < 1 - Math.pow(1 - p.redZoneTdRate, 1 / 4);
      const explosive = random() < (pass ? Math.min(p.explosivePlayRate, completionRate) : p.explosivePlayRate);
      const successRate = pass ? Math.min(p.successRate, completionRate) : p.successRate;
      const nonExplosiveSuccess = bound((successRate - p.explosivePlayRate) / Math.max(0.001, 1 - p.explosivePlayRate), 0, 1);
      const successful = explosive || random() < nonExplosiveSuccess;
      const needed = Math.ceil(toGo * (down === 1 ? 0.4 : down === 2 ? 0.6 : 1));
      const failedCatch = pass && random() < bound((completionRate - successRate) / Math.max(0.001, 1 - successRate), 0, 1);
      play.gain = finishes ? drive.endYardsToGoal : explosive ? integer(random, 15, 50)
        : successful ? integer(random, Math.min(needed, 14), pass ? 14 : Math.min(14, Math.max(needed, 7)))
        : pass ? (failedCatch ? integer(random, 0, Math.max(0, Math.min(needed - 1, 6))) : 0)
        : integer(random, -2, Math.max(0, Math.min(needed - 1, 5)));
      // Player efficiency changes yards within the sampled tier, not the 15+
      // event probability. No hidden re-use of average yards as explosiveness.
      if (!finishes) play.gain = Math.round(bound(play.gain * efficiency, explosive ? 15 : successful ? Math.min(needed, 14) : -9,
        explosive ? 70 : successful ? 14 : Math.max(0, Math.min(needed - 1, 14))));
      // Inside the red zone, finishing is governed by conversion evidence rather
      // than unconstrained generic yardage. Long TDs outside it remain possible.
      play.gain = Math.min(play.gain, inRedZone && !finishes ? drive.endYardsToGoal - 1 : drive.endYardsToGoal);
      play.completed = pass && (finishes || successful || failedCatch);
      if ((!pass || play.completed) && random() < fumbleRate) play.turnover = 'fumble';
    }
    play.gain = Math.max(play.gain, drive.endYardsToGoal - 99);
    const startYards = drive.endYardsToGoal;
    drive.endYardsToGoal = bound(drive.endYardsToGoal - play.gain, 0, 99);
    play.touchdown = drive.endYardsToGoal === 0 && !play.turnover;
    play.explosive = play.gain >= 15;
    play.successful = !play.turnover && play.gain >= toGo * (down === 1 ? 0.4 : down === 2 ? 0.6 : 1);
    drive.plays.push(play);
    options.onPlay?.(play, startYards);
    spend(Math.max(3, p.secondsPerPlay * (pass && !play.completed ? 0.7 : 1) * (0.8 + random() * 0.4)));
    if (play.turnover) { drive.outcome = 'Turnover'; drive.turnover = play.turnover; return drive; }
    if (play.touchdown) { drive.outcome = 'TD'; return drive; }
    toGo -= play.gain;
    if (toGo <= 0) { down = 1; toGo = Math.min(10, drive.endYardsToGoal); } else down++;
  }
  return drive;
}
