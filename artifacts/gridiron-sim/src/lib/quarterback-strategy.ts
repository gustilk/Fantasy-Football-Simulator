import type { SimulationRosterPlayer, TeamSetup } from './simulator';

export interface QuarterbackStrategy {
  model: 'backup-run-v1';
  quarterback: string;
  backup: boolean;
  basis: 'manual' | 'depth-chart' | 'unknown';
  depthRank?: number;
}

/** Called only when creating new inputs, never while replaying legacy forecasts. */
export function captureQuarterbackStrategy(roster: SimulationRosterPlayer[]): QuarterbackStrategy {
  const qb = roster.find(player => player.position === 'QB');
  const knownRank = qb?.depthRankBasis !== 'usage' && Number.isInteger(qb?.depthRank) && qb!.depthRank! >= 1;
  return {
    model: 'backup-run-v1',
    quarterback: qb?.name ?? '',
    backup: !!knownRank && qb!.depthRank! > 1,
    basis: knownRank ? 'depth-chart' : 'unknown',
    ...(knownRank ? { depthRank: qb!.depthRank } : {}),
  };
}

/** Shift play calls, not efficiencies. Apply after history/weather/pressure blending. */
export function quarterbackPassShare(passShare: number, team: TeamSetup): number {
  const strategy = team.quarterbackStrategy;
  if (strategy?.model !== 'backup-run-v1' || !strategy.backup || strategy.quarterback !== team.qb) return passShare;
  return Math.max(0.28, Math.min(0.42, passShare - 0.12));
}

export function quarterbackStrategyNotes(team: TeamSetup): string[] {
  const s = team.quarterbackStrategy;
  if (s?.model !== 'backup-run-v1' || s.quarterback !== team.qb) return [];
  if (!s.backup) return s.basis === 'unknown'
    ? [`${team.name}: starting QB depth is unknown; no backup-QB run adjustment. Mark Backup QB for this week if the replacement is starting.`] : [];
  return [`${team.name}: ${s.quarterback} is treated as the starting backup QB (${s.basis === 'manual' ? 'manually marked for this week' : `listed QB${s.depthRank}`}). Run-heavy play selection reduces passing share by at least 12 percentage points, bounded to 28–42% passing (58–72% rushing), including red-zone calls. This is an unvalidated strategy assumption, not a rushing-efficiency or fantasy-point boost. Saved forecasts retain this context.`];
}
