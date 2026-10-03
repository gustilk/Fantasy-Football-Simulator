import type { RosterPlayer } from "@workspace/api-client-react";
import { availabilityForWeek, availabilityLabels } from "@/lib/availability";

type Props = { player: RosterPlayer; week: number; onChange: (patch: Partial<RosterPlayer>) => void };

export default function PlayerAvailabilityEditor({ player, week, onChange }: Props) {
  const check = availabilityForWeek(player, week);
  const report = player.availabilityReport;
  const value = player.availabilityOverride?.week === week ? player.availabilityOverride.status : "";
  return <div className="tl-availability">
    <select aria-label={`Week ${week} availability for ${player.name}`} data-testid={`availability-${player.id}`} value={value}
      onChange={event => onChange({ availabilityOverride: event.target.value ? {
        week, status: event.target.value as NonNullable<RosterPlayer["availabilityOverride"]>["status"], updatedAt: new Date().toISOString(),
      } : undefined })}>
      <option value="">Use saved Active flag</option>
      <option value="available">Available this week</option>
      <option value="out">Out this week</option>
      <option value="questionable">Questionable · include</option>
      <option value="limited">Limited · include</option>
      <option value="doubtful">Doubtful · exclude</option>
    </select>
    <small>Week {week}: {check.included ? "included" : "excluded"} · {availabilityLabels[check.status]}</small>
    <small>{report ? <>Roster report: {availabilityLabels[report.status]} · checked {new Date(report.source.fetchedAt).toLocaleString()}</> : "No timestamped availability report"}</small>
    {value && <small>Manual override set {new Date(player.availabilityOverride!.updatedAt).toLocaleString()}</small>}
    {player.availabilityOverride && player.availabilityOverride.week !== week && <small>Override saved for Week {player.availabilityOverride.week}. A new choice replaces it.</small>}
  </div>;
}