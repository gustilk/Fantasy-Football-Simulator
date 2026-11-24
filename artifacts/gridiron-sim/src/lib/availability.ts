import type { RosterPlayer } from "@workspace/api-client-react";

export const availabilityLabels = {
  available: "Available", out: "Out", questionable: "Questionable",
  doubtful: "Doubtful", limited: "Limited", unknown: "Unknown",
};

export function availabilityForWeek(player: RosterPlayer, week: number) {
  const override = player.availabilityOverride?.week === week ? player.availabilityOverride : undefined;
  const report = player.availabilityReport;
  const included = override ? !["out", "doubtful"].includes(override.status) : player.active;
  return {
    id: player.id, name: player.name, position: player.position, included,
    status: override?.status ?? report?.status ?? "unknown",
    basis: override ? "weekly override" as const : "saved roster" as const,
    checkedAt: override?.updatedAt ?? report?.source.fetchedAt,
    sourceStatus: report?.status,
    sourceRosterActive: report?.rosterActive,
    sourceUrl: report?.source.url,
  };
}

export type AvailabilityCheck = ReturnType<typeof availabilityForWeek>;

/** Statuses that keep a player out of generated lineups. Questionable/Limited are never auto-excluded. */
export const LINEUP_EXCLUDING_STATUSES = ["out", "doubtful"] as const;
const excludes = (status?: string) => (LINEUP_EXCLUDING_STATUSES as readonly string[]).includes(status ?? "");

/**
 * Lineup-builder eligibility. A weekly override always decides (so the user can force an Out player
 * back in, or take a player out). Without one, a player is excluded when the saved roster marks them
 * inactive OR the verified source report says Out/Doubtful (Out includes injured reserve, PUP, NFI and
 * suspension as mapped by the importer) even if the saved Active flag was never updated.
 * Unknown is never treated as Out, and missing data is never invented.
 */
export function lineupEligibility(player: RosterPlayer, week: number): { eligible: boolean; reason?: string } {
  const override = player.availabilityOverride?.week === week ? player.availabilityOverride : undefined;
  if (override) {
    return excludes(override.status)
      ? { eligible: false, reason: `Weekly override marks this player ${availabilityLabels[override.status]}.` }
      : { eligible: true };
  }
  if (!player.active) return { eligible: false, reason: "Inactive on the current saved roster." };
  const reported = player.availabilityReport?.status;
  if (excludes(reported)) {
    const detail = player.availability ? ` (${player.availability})` : "";
    return { eligible: false, reason: `Source reports ${availabilityLabels[reported!]}${detail}. Set a weekly Available override to include this player anyway.` };
  }
  return { eligible: true };
}

export function availabilityWarnings(checks: AvailabilityCheck[], now = Date.now()): string[] {
  const warnings: string[] = [];
  const unknown = checks.filter(p => p.included && p.status === "unknown");
  if (unknown.length) warnings.push(`${unknown.length} included skill player(s) have no explicit availability designation. Unknown is not confirmed healthy.`);
  const uncertain = checks.filter(p => p.included && ["questionable", "limited"].includes(p.status));
  if (uncertain.length) warnings.push(`Included despite uncertainty: ${uncertain.map(p => p.name).join(", ")}. No probability of missing the game is modeled; use a weekly Out override to compare scenarios.`);
  const mismatch = checks.filter(p => p.basis === "saved roster" && p.included && p.sourceRosterActive === false);
  if (mismatch.length) warnings.push(`Source reports unavailable but saved Active flags still include: ${mismatch.map(p => p.name).join(", ")}. Apply roster-status updates or set a weekly override.`);
  const stale = checks.filter(p => p.included && (!p.checkedAt || !Number.isFinite(Date.parse(p.checkedAt)) || now - Date.parse(p.checkedAt) > 24 * 60 * 60_000));
  if (stale.length) warnings.push(`${stale.length} included skill player(s) have missing or older-than-24-hour availability checks. Refresh the source and verify before kickoff.`);
  return warnings;
}