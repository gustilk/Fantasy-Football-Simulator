import type { NumericStats, TeamSeasonRecord, TeamWeek } from "@workspace/api-client-react";
import type { PlayerRecentStats, SimulationRosterPlayer, TeamSetup } from "./simulator";
import { availabilityForWeek, availabilityWarnings } from "./availability";
import { historyStrength, historyWarnings, playerUsage } from "./history-signals";
import { getEliteTier } from "./elite-players";
import { getDefenderTier, getTeamDefenseTier, isDefensivePosition } from "./defensive-tiers";
import { PRIOR_GAMES, baseline2025, priorTeam, priorPlayer, priorWeight, blendPriorStats, blendPriorUsage,
  priorBackfieldEvidence, priorTeamStrength, priorDefenseRecord, priorDefenderRecord, type PriorSeasonEvidence } from "./prior-season-baseline";

const average = (rows: NumericStats[], key: string): number | undefined => {
  const values = rows.map(row => row[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
};

type HistoryRow = { stats: NumericStats; venue: string; opponent: string };
export const headToHeadWeight = (observations: number) => Math.min(0.15, observations * 0.05);

function blendedStats(rows: HistoryRow[], venue: string, opponent?: string): NumericStats {
  const result: NumericStats = {};
  const baseline: NumericStats = {};
  const all = rows.map(row => row.stats);
  const recent = all.slice(-5);
  const split = rows.filter(row => row.venue === venue).map(row => row.stats);
  const keys = new Set(all.flatMap(row => Object.keys(row)));
  for (const key of keys) {
    const season = average(all, key);
    const lastFive = average(recent, key);
    if (season === undefined) continue;
    let value = season * 0.35 + (lastFive ?? season) * 0.65;
    const venueAverage = average(split, key);
    if (split.filter(row => row[key] !== undefined).length >= 2 && venueAverage !== undefined) value = value * 0.8 + venueAverage * 0.2;
    baseline[key] = value;
    const meetings = opponent ? rows.filter(row => row.opponent === opponent).map(row => row.stats) : [];
    const matchupAverage = average(meetings, key);
    if (matchupAverage !== undefined) {
      const count = meetings.filter(row => Number.isFinite(row[key])).length;
      const delta = (matchupAverage - value) * headToHeadWeight(count);
      // Sparse head-to-head samples must not overwhelm season/recent history.
      const limit = Math.max(Math.abs(value) * 0.2, 0.2);
      value += Math.max(-limit, Math.min(limit, delta));
    }
    result[key] = value;
  }
  // Opponent rows may omit one half of a pair. Skip the adjustment rather
  // than inventing attempts/targets or returning contradictory averages.
  for (const [made, attempts] of [['passCompletions', 'passAttempts'], ['receptions', 'targets']]) {
    if (result[made!] !== undefined && result[attempts!] !== undefined && result[made!]! > result[attempts!]!) {
      result[made!] = baseline[made!]!;
      result[attempts!] = baseline[attempts!]!;
    }
  }
  return result;
}

export function priorGames(team: TeamSeasonRecord, week: number): TeamWeek[] {
  return team.weeks.filter(game => game.week < week && game.status === "played").sort((a, b) => a.week - b.week);
}

export function teamRecord(team: TeamSeasonRecord, week = 19) {
  const games = priorGames(team, week);
  return {
    wins: games.filter(game => game.result === "W").length,
    losses: games.filter(game => game.result === "L").length,
    ties: games.filter(game => game.result === "T").length,
  };
}

export function setupFromHistory(team: TeamSeasonRecord, week: number, venue: "home" | "away", opponent?: string, options: { usePriorSeason?: boolean } = {}): TeamSetup {
  const games = priorGames(team, week);
  const historicalTeam = options.usePriorSeason === false ? undefined : priorTeam(team.season, team.team);
  const priorEvidence: PriorSeasonEvidence | undefined = historicalTeam ? {
    season: baseline2025.season, policy: 'three-game-prior-v1', retrievedAt: baseline2025.retrievedAt,
    effectivePriorGames: PRIOR_GAMES, matchedPlayers: [], unmatchedPlayers: [], teamChangedPlayers: [],
  } : undefined;
  const historicalPlayers = new Map(team.players.map(player => {
    const historical = historicalTeam ? priorPlayer(team.season, team.team, player) : undefined;
    if (priorEvidence && player.active && (player.side === 'defense' || ['QB', 'RB', 'WR', 'TE'].includes(player.position))) {
      if (historical?.record) priorEvidence.matchedPlayers.push(player.name);
      else if (historical?.teamChanged) priorEvidence.teamChangedPlayers.push(player.name);
      else priorEvidence.unmatchedPlayers.push(player.name);
    }
    return [player.id, historical?.record] as const;
  }));
  const matchupOpponent = opponent && opponent !== team.team ? opponent : undefined;
  const skill = new Set(["QB", "RB", "WR", "TE"]);
  const availabilityChecks = team.players.filter(p => p.side === "offense" && skill.has(p.position)).map(p => availabilityForWeek(p, week));
  const available = new Set(availabilityChecks.filter(p => p.included).map(p => p.id));
  const roster: SimulationRosterPlayer[] = team.players.filter(player => available.has(player.id)).map(player => {
    const rows = games.filter(game => game.playerStats[player.id] !== undefined).map(game => ({ stats: game.playerStats[player.id]!, venue: game.venue, opponent: game.opponent }));
    const historical = historicalPlayers.get(player.id);
    const evidence = priorBackfieldEvidence(historical);
    return {
      id: player.id, name: player.name, position: player.position as SimulationRosterPlayer["position"],
      elite1x: getEliteTier(player) > 0,
      eliteTier: getEliteTier(player),
      depthRank: player.depthRank, depthRankBasis: player.depthRank === undefined ? "usage" as const : player.depthSource ? "ESPN" as const : "saved" as const,
      historyObservations: rows.filter(row => ["passAttempts", "rushAttempts", "targets", "receptions", "receivingYards"].some(key => Number.isFinite(row.stats[key]))).length,
      recentStats: blendPriorStats(blendedStats(rows, venue, matchupOpponent), rows.map(row => row.stats), historical) as PlayerRecentStats,
      usage: blendPriorUsage(playerUsage(games, player.id), historicalTeam, historical),
      backfieldEvidence: player.position === "RB" ? (() => {
        const pairedRush = rows.filter(r => Number.isFinite(r.stats.rushAttempts) && r.stats.rushAttempts! > 0 && Number.isFinite(r.stats.rushYards));
        const pairedReceiving = rows.filter(r => Number.isFinite(r.stats.receptions) && r.stats.receptions! > 0 && Number.isFinite(r.stats.receivingYards));
        return {
          rushAttempts: pairedRush.reduce((n, r) => n + r.stats.rushAttempts!, 0) + evidence.rushAttempts,
          rushYards: pairedRush.reduce((n, r) => n + r.stats.rushYards!, 0) + evidence.rushYards,
          receivingCatches: pairedReceiving.reduce((n, r) => n + r.stats.receptions!, 0) + evidence.receivingCatches,
          receivingYards: pairedReceiving.reduce((n, r) => n + r.stats.receivingYards!, 0) + evidence.receivingYards,
        };
      })() : undefined,
    };
  });
  const order = { QB: 0, RB: 1, WR: 2, TE: 3 };
  const volume = (player: SimulationRosterPlayer) => player.position === "QB"
    ? player.recentStats?.passAttempts ?? 0
    : player.position === "RB" ? player.recentStats?.rushAttempts ?? 0 : player.recentStats?.targets ?? 0;
  roster.sort((a, b) => order[a.position] - order[b.position] || (a.depthRank ?? Infinity) - (b.depthRank ?? Infinity) || volume(b) - volume(a));
  for (const position of ["QB", "RB", "WR", "TE"]) {
    let rank = Math.max(0, ...team.players.filter(p => p.position === position).map(p => p.depthRank ?? 0));
    for (const player of roster.filter(p => p.position === position && p.depthRank === undefined)) player.depthRank = ++rank;
  }
  const defenseRows = games.map(game => {
    const stats = { ...game.teamDefense };
    for (const key of ["interceptions", "fumblesForced", "sacks", "passesDefended"]) {
      if (stats[key] !== undefined) continue;
      const values = team.players.filter(player => player.side === "defense").map(player => game.playerStats[player.id]?.[key]).filter((value): value is number => value !== undefined);
      if (values.length) stats[key] = values.reduce((sum, value) => sum + value, 0);
    }
    return { stats, venue: game.venue, opponent: game.opponent };
  });
  const meetings = matchupOpponent ? games.filter(game => game.opponent === matchupOpponent) : [];
  const modelKeys = new Set(['passAttempts', 'passCompletions', 'passYards', 'passTD', 'interceptions', 'rushAttempts', 'rushYards', 'rushTD', 'targets', 'receptions', 'receivingYards', 'receivingTD']);
  const defenseKeys = new Set(['passYardsAllowed', 'passTDAllowed', 'rushYardsAllowed', 'rushTDAllowed', 'interceptions', 'fumblesForced', 'sacks', 'passesDefended']);
  const usable = meetings.filter(game =>
    roster.some(player => Object.entries(game.playerStats[player.id] ?? {}).some(([key, value]) => modelKeys.has(key) && Number.isFinite(value))) ||
    Object.entries(defenseRows[games.indexOf(game)]!.stats).some(([key, value]) => defenseKeys.has(key) && Number.isFinite(value)),
  );
  const names = (position: string) => roster.filter(player => player.position === position);
  const strength = historyStrength(team, games);
  const historicalStrength = historicalTeam ? priorTeamStrength(historicalTeam) : undefined;
  const rating = (current: number, old: number | undefined, count: number) => {
    if (old === undefined) return current;
    const weight = priorWeight(count);
    return Math.round(current * (1 - weight) + old * weight);
  };
  const sameQB = roster.some(player => player.position === 'QB' && player.depthRank === 1 && historicalPlayers.has(player.id) && historicalPlayers.get(player.id));
  const sameRB = roster.some(player => player.position === 'RB' && historicalPlayers.get(player.id));
  const defenseComponents = [
    [strength.defenseComponents.passRating, historicalStrength?.passDefenseRating, strength.evidence.passDefenseGames],
    [strength.defenseComponents.rushRating, historicalStrength?.rushDefenseRating, strength.evidence.rushDefenseGames],
  ] as const;
  const blendedDefense = defenseComponents.flatMap(([current, historical, count]) =>
    current === undefined && historical === undefined ? [] : [rating(current ?? historical!, historical, count)]);
  const historicalDefense = historicalTeam ? priorDefenseRecord(historicalTeam) : undefined;
  const priorWarnings = priorEvidence ? [
    `2025 regular-season baseline active: up to ${PRIOR_GAMES} effective prior games per reported field, weight p/(p+n), where n is known 2026 observations. These are prior equivalents, not 2026 games. Heuristic policy; improved predictive accuracy is not established.`,
    `2025 player matching: ${priorEvidence.matchedPlayers.length} active players matched on this team; ${priorEvidence.unmatchedPlayers.length} missing/ambiguous/changed QB-role matches; ${priorEvidence.teamChangedPlayers.length} on different 2025 teams. Excluded matches receive no guessed historical workload.`,
    'Current roster, depth ranks, availability and elite/defensive tags remain authoritative. Team defensive continuity is an unverified assumption. Fantasy totals, red-zone and defense-versus-position tables are references, not extra multipliers.',
  ] : [];
  const warnings = historyWarnings(games, strength.evidence).filter(warning =>
    !(sameQB && warning.startsWith('Passing strength uses baseline 55')) &&
    !(sameRB && warning.startsWith('Rushing strength uses baseline 55')) &&
    !(historicalDefense && warning.startsWith('Defensive strength has missing')));
  return {
    backfieldModel: "usage-v1",
    name: team.team,
    qb: names("QB")[0]?.name ?? "",
    rb: names("RB")[0]?.name ?? "",
    wr1: names("WR")[0]?.name ?? "",
    wr2: names("WR")[1]?.name ?? "",
    wr3: names("WR")[2]?.name ?? "",
    te: names("TE")[0]?.name ?? "",
    kicker: team.players.find(player => availabilityForWeek(player, week).included && player.side === "offense" && player.position === "K")?.name ?? "Kicker",
    passRating: rating(strength.passRating, sameQB ? historicalStrength?.passRating : undefined, strength.evidence.passGames),
    rushRating: rating(strength.rushRating, sameRB ? historicalStrength?.rushRating : undefined, strength.evidence.rushGames),
    defenseRating: historicalStrength && blendedDefense.length
      ? Math.round(blendedDefense.reduce((sum, value) => sum + value, 0) / blendedDefense.length) : strength.defenseRating,
    roster,
    defenseTier: getTeamDefenseTier(team),
    defenders: team.players.filter(p => p.side === "defense" && isDefensivePosition(p.position) && availabilityForWeek(p, week).included)
      .map(p => ({
        id: p.id, name: p.name, position: p.position as import("./defensive-tiers").DefensivePosition,
        defensiveTier: getDefenderTier(p),
        recentStats: blendPriorStats(blendedStats(games.map(g => ({ stats: g.playerStats[p.id] ?? {}, venue: g.venue, opponent: g.opponent })), venue, matchupOpponent),
          games.map(g => g.playerStats[p.id] ?? {}), priorDefenderRecord(historicalPlayers.get(p.id))),
      })),
    record: teamRecord(team, week),
    historyGames: games.length,
    ...(priorEvidence ? { priorSeasonBaseline: priorEvidence } : {}),
    availabilityChecks,
    modelEvidence: { strength: strength.evidence, warnings: [
      ...warnings, ...availabilityWarnings(availabilityChecks), ...priorWarnings,
      "Backfield workload uses observed carries/targets with one role-prior game and no fixed RB1 minimum. RB1/RB2 start with equal receiving priority. Paired rushing efficiency shrinks toward 4.5 yards/carry (12 prior carries); receiving efficiency toward 8 yards/catch (10 prior catches). These are uncalibrated heuristics, not verified snap shares or touchdown guarantees.",
    ] },
    depthChartSource: team.players.find(p => p.depthSource)?.depthSource,
    headToHead: matchupOpponent ? { opponent: matchupOpponent, games: meetings.length, usableGames: usable.length, maxWeight: headToHeadWeight(usable.length) } : undefined,
    defenseRecent: blendPriorStats(blendedStats(defenseRows, venue, matchupOpponent), defenseRows.map(row => row.stats), historicalDefense),
    context: `${team.season} season: ${games.length} recorded games before week ${week}. ${priorEvidence ? '2025 regular-season baseline blended separately; up to three effective prior games per reported field, decreasing as 2026 observations grow. ' : ''}Season/recent-five averages are blended; matching-venue splits contribute when at least two observations exist. ${matchupOpponent ? `${meetings.length} earlier head-to-head game(s) against ${matchupOpponent}; known fields receive up to ${Math.round(headToHeadWeight(usable.length) * 100)}% opponent-specific weight, capped at a 20% change to each baseline average (minimum cap 0.2). ` : ''}Missing values are unknown, not zero.`,
  };
}