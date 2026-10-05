export const SHOWDOWN_RULES_URL = 'https://www.draftkings.com/help/rules/1/96';
export interface KickerStats { extraPoints: number; fieldGoals039: number; fieldGoals4049: number; fieldGoals50Plus: number }
export interface KickerProjection extends KickerStats { team: string; name: string; draftKings: number }
export function calculateKickerDraftKings(stats: KickerStats): number {
  if (Object.values(stats).some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid kicker scoring events.');
  return stats.extraPoints + 3 * stats.fieldGoals039 + 4 * stats.fieldGoals4049 + 5 * stats.fieldGoals50Plus;
}
/** Explicit, uncalibrated return priors; never change a legacy frozen replay. */
export function defensiveTouchdowns(interceptions: number, fumbles: number, random: () => number): number {
  let touchdowns = 0;
  for (let i = 0; i < interceptions; i++) touchdowns += Number(random() < 0.12);
  for (let i = 0; i < fumbles; i++) touchdowns += Number(random() < 0.06);
  return touchdowns;
}
export const SHOWDOWN_MODEL_WARNING = 'Kicker points come from simulated made field goals by distance and extra points. Successful extra points are assumed. Defensive interception/fumble-return TDs use uncalibrated 12%/6% event priors, not observed game outcomes. Punt/kick returns, safeties, blocks and conversion returns are scored if supplied but are not simulated. These estimates are not accuracy-validated.';
