import type { NflDepthChart, RosterPlayer, TeamSeasonRecord } from "@workspace/api-client-react";

export function resolveDepthRoles(input: RosterPlayer[]): RosterPlayer[] {
  const players = input.map(player => ({ ...player }));
  for (const position of ["QB", "RB", "WR", "TE"]) {
    const group = players.filter(p => p.position === position && p.side === "offense");
    const taken = new Set(group.filter(p => p.depthRank !== undefined && !p.depthSource).map(p => p.depthRank!));
    for (const player of group.filter(p => p.depthRank !== undefined && p.depthSource).sort((a, b) => a.depthRank! - b.depthRank!)) {
      let rank = player.depthRank!;
      while (taken.has(rank)) rank++;
      player.depthRank = rank;
      taken.add(rank);
    }
  }
  return players;
}

/** Live source roles are read-only; explicit saved manual roles take priority. */
export function rolesForRoster(input: RosterPlayer[], chart?: NflDepthChart): RosterPlayer[] {
  if (!chart) return input;
  const players = input.map(player => {
    if (player.depthRank !== undefined && !player.depthSource) return { ...player };
    const role = chart.roles.find(role => role.athleteId === (player.source?.athleteId ?? player.id.replace(/^espn:/, "")) && role.position === player.position);
    return role ? { ...player, depthRank: role.depthRank, depthSource: chart.source } : { ...player };
  });
  return resolveDepthRoles(players);
}

export function withDepthChart(team: TeamSeasonRecord, chart?: NflDepthChart): TeamSeasonRecord {
  if (!chart) return team;
  if (chart.season !== team.season || chart.team !== team.team) throw new Error("Depth chart does not match the selected team/season.");
  return { ...team, players: rolesForRoster(team.players, chart) };
}