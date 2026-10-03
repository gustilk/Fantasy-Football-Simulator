import type { NumericStats, TeamSeasonRecord, TeamWeek } from "@workspace/api-client-react";
import type { PlayerRecentStats, SimulationRosterPlayer, TeamSetup } from "./simulator";

const average = (rows: NumericStats[], key: string): number | undefined => {
  const values = rows.map(row => row[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
};

function blendedStats(rows: { stats: NumericStats; venue: string }[], venue: string): NumericStats {
  const result: NumericStats = {};
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
    result[key] = value;
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

export function setupFromHistory(team: TeamSeasonRecord, week: number, venue: "home" | "away"): TeamSetup {
  const games = priorGames(team, week);
  const skill = new Set(["QB", "RB", "WR", "TE"]);
  const roster: SimulationRosterPlayer[] = team.players.filter(player => player.active && player.side === "offense" && skill.has(player.position)).map(player => {
    const rows = games.filter(game => game.playerStats[player.id] !== undefined).map(game => ({ stats: game.playerStats[player.id]!, venue: game.venue }));
    return { id: player.id, name: player.name, position: player.position as SimulationRosterPlayer["position"], recentStats: blendedStats(rows, venue) as PlayerRecentStats };
  });
  const order = { QB: 0, RB: 1, WR: 2, TE: 3 };
  const volume = (player: SimulationRosterPlayer) => player.position === "QB"
    ? player.recentStats?.passAttempts ?? 0
    : player.position === "RB" ? player.recentStats?.rushAttempts ?? 0 : player.recentStats?.targets ?? 0;
  roster.sort((a, b) => order[a.position] - order[b.position] || volume(b) - volume(a));
  const defenseRows = games.map(game => {
    const stats = { ...game.teamDefense };
    for (const key of ["interceptions", "fumblesForced", "sacks", "passesDefended"]) {
      if (stats[key] !== undefined) continue;
      const values = team.players.filter(player => player.side === "defense").map(player => game.playerStats[player.id]?.[key]).filter((value): value is number => value !== undefined);
      if (values.length) stats[key] = values.reduce((sum, value) => sum + value, 0);
    }
    return { stats, venue: game.venue };
  });
  const names = (position: string) => roster.filter(player => player.position === position);
  return {
    name: team.team,
    qb: names("QB")[0]?.name ?? "",
    rb: names("RB")[0]?.name ?? "",
    wr1: names("WR")[0]?.name ?? "",
    wr2: names("WR")[1]?.name ?? "",
    wr3: names("WR")[2]?.name ?? "",
    te: names("TE")[0]?.name ?? "",
    kicker: team.players.find(player => player.active && player.side === "offense" && player.position === "K")?.name ?? "Kicker",
    passRating: 55, rushRating: 55, defenseRating: 55,
    roster,
    record: teamRecord(team, week),
    historyGames: games.length,
    defenseRecent: blendedStats(defenseRows, venue),
    context: `${team.season} season: ${games.length} recorded games before week ${week}. Season/recent-five averages are blended; matching-venue splits contribute when at least two observations exist. Missing values are unknown, not zero.`,
  };
}