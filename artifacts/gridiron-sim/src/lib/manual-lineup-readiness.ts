import { optimizeLineups } from './lineup-optimizer';
import type { LineupPlayer, SalaryPlayer } from './lineups';
import type { ManualPicks, ManualSalaryCandidate } from './manual-lineups';

const requirements = [['QB', 1], ['RB', 2], ['WR', 3], ['TE', 1], ['DST', 1]] as const;
export function manualRosterReadiness(players: SalaryPlayer[], picks: ManualPicks) {
  const selected = players.filter(p => picks[p.id]?.selected);
  const positions = requirements.map(([position, required]) => ({
    position, required, count: selected.filter(p => p.position === position).length,
  }));
  const missing = positions.filter(p => p.count < p.required);
  const flexCount = selected.filter(p => ['RB', 'WR', 'TE'].includes(p.position)).length;
  const flexMissing = Math.max(0, 7 - flexCount);
  const issues = missing.map(p => p.position === 'DST'
    ? 'Select at least 1 DST (team defense).'
    : `Select ${p.required - p.count} more ${p.position}${p.required - p.count > 1 ? ' players' : ' player'} (${p.count} selected; ${p.required} required).`);
  if (!missing.some(p => ['RB', 'WR', 'TE'].includes(p.position)) && flexMissing) {
    issues.push('Select 1 more RB, WR, or TE for FLEX. You need 7 RB/WR/TE candidates in total.');
  }
  return { positions, flexCount, flexMissing, issues };
}

/** Distinguish an impossible roster from an over-budget one without altering picks. */
export function manualLineupIssue(pool: ManualSalaryCandidate[]): string {
  const picks = Object.fromEntries(pool.map(p => [p.id, { selected: true, points: '' }]));
  const roster = manualRosterReadiness(pool, picks);
  const issues = [...roster.issues];
  if (new Set(pool.map(p => p.gameId)).size < 2) {
    issues.push('Select candidates from at least 2 different games; Classic does not allow a single-game lineup.');
  }
  if (issues.length) return issues.join(' ');
  // Uniform nominal costs remove the cap for this diagnostic only. This temporary
  // negative-salary objective finds the cheapest legal roster; it is not a projection.
  const diagnosticPlayers: LineupPlayer[] = pool.map(p => ({
    ...p, salary: 1, mean: -p.salary, projectionSource: 'Salary feasibility diagnostic',
  }));
  const [cheapest] = optimizeLineups(diagnosticPlayers, 1);
  if (!cheapest) return 'Your selected players cannot fill a legal Classic roster across two games.';
  const minimum = -cheapest.points;
  return minimum > 50000
    ? `The cheapest legal lineup from your selected players costs $${minimum.toLocaleString('en-US')} — $${(minimum - 50000).toLocaleString('en-US')} over the $50,000 cap. Add lower-salary candidates; you can keep your existing picks selected.`
    : '';
}
