import type { TeamSeasonRecord, TeamWeek } from "@workspace/api-client-react";

const known = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
const blended = (values: number[]) => values.length ? mean(values) * 0.35 + mean(values.slice(-5)) * 0.65 : undefined;
const bound = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/** Ratios only use paired observations; absent rows never become zero performances. */
function yardsPerAttempt(games: TeamWeek[], yards: string, attempts: string, ids?: Set<string>): number[] {
  return games.flatMap(game => {
    const paired = Object.entries(game.playerStats).filter(([id, row]) =>
      (!ids || ids.has(id)) && Number.isFinite(row[yards]) && known(row[attempts]),
    ).map(([, row]) => row);
    const totalAttempts = paired.reduce((sum, row) => sum + row[attempts]!, 0);
    return totalAttempts > 0 ? [paired.reduce((sum, row) => sum + row[yards]!, 0) / totalAttempts] : [];
  });
}

export function historyStrength(team: TeamSeasonRecord, games: TeamWeek[]) {
  const qbs = new Set(team.players.filter(p => p.position === "QB").map(p => p.id));
  const passing = yardsPerAttempt(games, "passYards", "passAttempts", qbs);
  const rushing = yardsPerAttempt(games, "rushYards", "rushAttempts");
  const passAllowed = games.flatMap(g => known(g.teamDefense.passYardsAllowed) ? [g.teamDefense.passYardsAllowed] : []);
  const rushAllowed = games.flatMap(g => known(g.teamDefense.rushYardsAllowed) ? [g.teamDefense.rushYardsAllowed] : []);
  const rating = (values: number[], reference: number, direction = 1) => {
    const value = blended(values);
    return value === undefined ? 55 : Math.round(bound(55 + direction * (value / reference - 1) * 30 * values.length / (values.length + 5), 35, 75));
  };
  const defensive = [
    ...(passAllowed.length ? [rating(passAllowed, 225, -1)] : []),
    ...(rushAllowed.length ? [rating(rushAllowed, 115, -1)] : []),
  ];
  return {
    passRating: rating(passing, 7),
    rushRating: rating(rushing, 4.3),
    defenseRating: defensive.length ? Math.round(mean(defensive)) : 55,
    evidence: {
      passGames: passing.length, rushGames: rushing.length,
      passDefenseGames: passAllowed.length, rushDefenseGames: rushAllowed.length,
      basis: "History-derived heuristic; not opponent-adjusted or accuracy-calibrated",
    },
  };
}

function reportedShare(games: TeamWeek[], id: string, key: string) {
  const values: number[] = [];
  for (const game of games) {
    const own = game.playerStats[id]?.[key];
    if (!known(own)) continue;
    const reported = Object.values(game.playerStats).map(row => row[key]).filter(known);
    const total = reported.reduce((sum, n) => sum + n, 0);
    if (total > 0) values.push(bound(own / total, 0, 1));
  }
  return { share: blended(values), games: values.length };
}

export function playerUsage(games: TeamWeek[], id: string) {
  const targets = reportedShare(games, id, "targets");
  const carries = reportedShare(games, id, "rushAttempts");
  return {
    targetShare: targets.share, targetGames: targets.games,
    carryShare: carries.share, carryGames: carries.games,
  };
}

export function historyWarnings(games: TeamWeek[], evidence: ReturnType<typeof historyStrength>["evidence"]) {
  const warnings: string[] = [];
  if (games.length < 5) warnings.push(`Limited history: ${games.length} recorded game(s); recent-five and season averages overlap. More simulations cannot replace missing history.`);
  if (!evidence.passGames) warnings.push("Passing strength uses baseline 55: no paired passing-yard/attempt observations.");
  if (!evidence.rushGames) warnings.push("Rushing strength uses baseline 55: no paired rushing-yard/attempt observations.");
  if (!evidence.passDefenseGames || !evidence.rushDefenseGames) warnings.push("Defensive strength has missing passing or rushing totals; unavailable components are not invented.");
  return warnings;
}