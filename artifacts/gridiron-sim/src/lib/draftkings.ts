/** DraftKings NFL Classic, not Showdown (no kicker or individual-defense slots). */
export const DRAFTKINGS_RULES_URL = 'https://www.draftkings.com/help/rules/1/1';
type Stats = Record<string, number | undefined>;
const value = (stats: Stats, key: string) => Number.isFinite(stats[key]) ? stats[key]! : 0;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const rules: [string, string, number][] = [
  ['passYards', 'Passing yards', 0.04], ['passTD', 'Passing TDs', 4],
  ['interceptions', 'Interceptions thrown', -1],
  ['rushYards', 'Rushing yards', 0.1], ['rushTD', 'Rushing TDs', 6],
  ['receptions', 'Receptions', 1], ['receivingYards', 'Receiving yards', 0.1],
  ['receivingTD', 'Receiving TDs', 6], ['fumblesLost', 'Fumbles lost', -1],
  ['kickReturnTD', 'Kick return TDs', 6], ['puntReturnTD', 'Punt return TDs', 6],
  ['fieldGoalReturnTD', 'Field-goal return TDs', 6],
  ['twoPointConversions', 'Two-point conversions', 2],
  ['offensiveFumbleRecoveryTD', 'Offensive fumble recovery TDs', 6],
];

export function draftKingsBreakdown(stats: Stats) {
  const breakdown = rules.filter(([key]) => value(stats, key) !== 0)
    .map(([key, label, multiplier]) => ({ label, points: round(value(stats, key) * multiplier) }));
  for (const [key, label, threshold] of [
    ['passYards', '300+ passing yards bonus', 300],
    ['rushYards', '100+ rushing yards bonus', 100],
    ['receivingYards', '100+ receiving yards bonus', 100],
  ] as const) {
    if (value(stats, key) >= threshold) breakdown.push({ label, points: 3 });
  }
  return breakdown;
}

/** A subtotal of reported scoring events. Missing fields are never written as zero. */
export function calculateDraftKings(stats: Stats): number {
  return round(draftKingsBreakdown(stats).reduce((sum, item) => sum + item.points, 0));
}

export function getDraftKingsDetails(player: { position: string; side: string }, stats: Stats) {
  const supported = player.side === 'offense' && ['QB', 'RB', 'WR', 'TE'].includes(player.position);
  const missing = rules.filter(([key]) => !Number.isFinite(stats[key])).map(([, label]) => label);
  const breakdown = supported ? draftKingsBreakdown(stats) : [];
  return {
    points: supported ? calculateDraftKings(stats) : null,
    bonus: breakdown.filter(item => item.label.includes('bonus')).reduce((sum, item) => sum + item.points, 0),
    partial: supported && missing.length > 0,
    missing, breakdown,
    note: supported
      ? 'Calculated from recorded stats. Unreported scoring plays may change the total.'
      : 'NFL Classic scores team DST, not individual defenders, kickers or offensive linemen.',
  };
}