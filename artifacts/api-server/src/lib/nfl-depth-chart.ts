import type { NflDepthChart, NflDepthRole } from "@workspace/api-zod";

type Slot = { position?: { abbreviation?: string; parent?: { abbreviation?: string } }; athletes?: { id?: string }[] };
export type SourceDepthChart = { season?: { year: number }; team?: { id: string }; depthchart?: { positions?: Record<string, Slot> }[] };
const skill = ["QB", "RB", "WR", "TE"] as const;

/** Source-listed starters first, then their backups. Never infer talent from missed games. */
export function parseDepthChart(raw: SourceDepthChart, season: number, teamId: string): NflDepthRole[] {
  if (raw.season?.year !== season || raw.team?.id !== teamId) throw new Error("ESPN depth chart does not match the requested season/team.");
  const chart = raw.depthchart?.find(chart => Object.values(chart.positions ?? {}).some(slot => slot.position?.abbreviation === "QB"));
  if (!chart?.positions) throw new Error("ESPN has not supplied an offensive depth chart.");
  const roles: NflDepthRole[] = [];
  const seen = new Set<string>();
  for (const position of skill) {
    const slots = Object.entries(chart.positions).filter(([, slot]) =>
      (slot.position?.abbreviation === position || slot.position?.parent?.abbreviation === position) && slot.position?.abbreviation !== "FB",
    ).sort(([a], [b]) => (Number(a.match(/\d+$/)?.[0] ?? 1) - Number(b.match(/\d+$/)?.[0] ?? 1)) || a.localeCompare(b));
    const tiers = Math.max(0, ...slots.map(([, slot]) => slot.athletes?.length ?? 0));
    let rank = 0;
    for (let tier = 0; tier < tiers; tier++) for (const [, slot] of slots) {
      const athleteId = slot.athletes?.[tier]?.id;
      if (!athleteId || seen.has(athleteId)) continue;
      seen.add(athleteId);
      roles.push({ athleteId, position, depthRank: ++rank });
    }
  }
  if (!skill.every(position => roles.some(role => role.position === position)) || roles.some(role => role.depthRank > 50)) {
    throw new Error("ESPN offensive depth chart is incomplete.");
  }
  return roles;
}

export function depthSource(season: number, team: string, roles: NflDepthRole[], url: string): NflDepthChart {
  return { season, team, roles, source: { provider: "ESPN", url, fetchedAt: new Date() } };
}