import type { NflImportPreview, NumericStats, RosterPlayer, TeamWeek } from "@workspace/api-client-react";
import { resolveDepthRoles } from "./depth-chart";

export type ImportDraft = { players: RosterPlayer[]; weeks: TeamWeek[] };
const nameKey = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const paired = [["passCompletions", "passAttempts"], ["receptions", "targets"], ["fieldGoalsMade", "fieldGoalAttempts"], ["extraPointsMade", "extraPointAttempts"]];

/** Pure preview merger. Only an explicit Save team action persists the result. */
export function mergeNflImport(current: ImportDraft, preview: NflImportPreview, options: { replaceStats: boolean; updateRoster: boolean }) {
  const draft = structuredClone(current);
  let addedPlayers = 0, statConflicts = 0, rosterChanges = 0, changedValues = 0;
  const skippedWeeks: number[] = [];
  const ids = new Map<string, string>();
  const sourceIds = new Set(preview.players.map(p => p.source?.athleteId));
  for (const incoming of preview.players) {
    let player = draft.players.find(p => p.id === incoming.id || (p.source?.athleteId && p.source.athleteId === incoming.source?.athleteId));
    if (!player) {
      const matches = draft.players.filter(p => !p.source?.athleteId && p.position === incoming.position && nameKey(p.name) === nameKey(incoming.name));
      if (matches.length === 1) player = matches[0];
    }
    if (!player) {
      player = structuredClone(incoming); draft.players.push(player); addedPlayers++;
    } else {
      const differs = player.name !== incoming.name || player.position !== incoming.position || player.side !== incoming.side || player.active !== incoming.active;
      if (differs) rosterChanges++;
      const manualDepth = player.depthRank !== undefined && !player.depthSource ? player.depthRank : undefined;
      const manualAvailability = player.availabilityOverride;
      const manualElite = player.elite1x;
      if (options.updateRoster) Object.assign(player, incoming, { id: player.id });
      else Object.assign(player, { source: incoming.source, sourcePosition: incoming.sourcePosition, availability: incoming.availability, availabilityReport: incoming.availabilityReport });
      if (manualAvailability) player.availabilityOverride = manualAvailability;
      if (manualElite !== undefined) player.elite1x = player.side === "offense" && ["QB", "RB", "WR", "TE"].includes(player.position) ? manualElite : false;
      if (manualDepth !== undefined) { player.depthRank = manualDepth; player.depthSource = undefined; }
      else if (incoming.depthRank !== undefined) { player.depthRank = incoming.depthRank; player.depthSource = incoming.depthSource; }
    }
    ids.set(incoming.id, player.id);
  }
  // Never delete former players or their history. Updating roster status is opt-in.
  for (const player of draft.players) if (player.source?.athleteId && !sourceIds.has(player.source.athleteId) && player.active) {
    rosterChanges++;
    if (options.updateRoster) { player.active = false; player.availability = "No longer on refreshed source roster"; }
  }
  const mergeStats = (existing: NumericStats, incoming: NumericStats): NumericStats => {
    const result = { ...existing };
    const blocked = new Set<string>();
    // Partial source rows must not contradict an existing paired field,
    // even when replacement is enabled.
    const candidate = options.replaceStats ? { ...existing, ...incoming } : { ...incoming, ...existing };
    for (const [made, attempted] of paired) {
      const m = candidate[made!], a = candidate[attempted!];
      if (m !== undefined && a !== undefined && m > a) {
        for (const key of [made!, attempted!]) {
          if (incoming[key] !== undefined && (options.replaceStats || existing[key] === undefined)) blocked.add(key);
        }
      }
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (blocked.has(key)) { statConflicts++; continue; }
      if (existing[key] !== undefined && existing[key] !== value) statConflicts++;
      if ((options.replaceStats || existing[key] === undefined) && result[key] !== value) { result[key] = value; changedValues++; }
    }
    return result;
  };
  for (const sourceWeek of preview.weeks) {
    const incoming = structuredClone(sourceWeek);
    incoming.playerStats = Object.fromEntries(Object.entries(incoming.playerStats).map(([id, stats]) => [ids.get(id)!, stats]));
    const index = draft.weeks.findIndex(w => w.week === incoming.week);
    const old = draft.weeks[index];
    const pristine = !old || (old.status === "upcoming" && !old.opponent && old.result === "none" && old.teamScore === null &&
      old.opponentScore === null && !Object.keys(old.teamDefense).length && !Object.keys(old.playerStats).length);
    const sameGame = old && old.status !== "bye" && old.opponent === incoming.opponent && old.venue === incoming.venue;
    if (!pristine && !sameGame && !options.replaceStats) {
      skippedWeeks.push(incoming.week); statConflicts++; continue;
    }
    let merged = incoming;
    if (!pristine && sameGame && old) {
      const teamScore = options.replaceStats ? incoming.teamScore : old.teamScore ?? incoming.teamScore;
      const opponentScore = options.replaceStats ? incoming.opponentScore : old.opponentScore ?? incoming.opponentScore;
      if (old.teamScore !== null && old.teamScore !== incoming.teamScore) statConflicts++;
      if (old.opponentScore !== null && old.opponentScore !== incoming.opponentScore) statConflicts++;
      merged = {
        ...old, ...incoming, teamScore, opponentScore,
        result: teamScore !== null && opponentScore !== null ? teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L" :
          options.replaceStats || old.result === "none" ? incoming.result : old.result,
        teamDefense: mergeStats(old.teamDefense, incoming.teamDefense),
        playerStats: { ...old.playerStats },
      };
      for (const [id, stats] of Object.entries(incoming.playerStats)) merged.playerStats[id] = mergeStats(old.playerStats[id] ?? {}, stats);
    } else {
      changedValues += Object.values(incoming.playerStats).reduce((sum, s) => sum + Object.keys(s).length, 0) + Object.keys(incoming.teamDefense).length;
    }
    if (index < 0) draft.weeks.push(merged); else draft.weeks[index] = merged;
  }
  draft.weeks.sort((a, b) => a.week - b.week);
  draft.players = resolveDepthRoles(draft.players);
  return { draft, addedPlayers, statConflicts, rosterChanges, skippedWeeks, changedValues };
}