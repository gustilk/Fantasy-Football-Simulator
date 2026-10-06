import type { PlayerAccumulator, PlayerRecentStats, SimulatedDrive, SimulationInput, TeamSetup, TeamSimulation } from './simulator';
import { matchupDriveRates, simulatePossessionDrive, DRIVE_PRIORS, type DriveProfile, type PossessionRates } from './possession-drive';
import { defensiveEventPriorities } from './defensive-tiers';
import { passingStrategyAdjustment } from './standings';
import { quarterbackPassShare } from './quarterback-strategy';
import { backfieldEfficiency } from './backfield-workload';
import { secondaryMatchup, secondaryNotes } from './secondary-matchup';
import { protectedSackProbability } from './offensive-line';

type Random = () => number;
interface Helpers {
  makeTeam: (setup: TeamSetup) => TeamSimulation;
  receiver: (team: TeamSimulation, random: Random, redZone?: boolean) => PlayerAccumulator;
  runner: (team: TeamSimulation, random: Random, goalLine?: boolean) => PlayerAccumulator;
  recent: (team: TeamSimulation, player: PlayerAccumulator) => PlayerRecentStats | undefined;
  reliability: (setup: TeamSetup, player: PlayerAccumulator) => number;
  fumbleChance: (setup: TeamSetup, player: PlayerAccumulator, stats: PlayerRecentStats | undefined, baseline: number) => number;
  footballPassShare: (share: number, offense: TeamSetup, defense: TeamSetup) => number;
}
const bound = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const precipitationImpact = { none: 0, light: 0.025, moderate: 0.06, heavy: 0.105 };
/** Shared regulation clock: possessions actually alternate and inherit field
 * position, rather than merging two independently generated game logs. */
export function simulatePossessionGame(input: SimulationInput, random: Random, awayPace: number, homePace: number, h: Helpers) {
  const away = h.makeTeam(input.away), home = h.makeTeam(input.home);
  const secondaries = input.secondaryModel === 'secondary-v1' ? [away, home].map((team, i) =>
    secondaryMatchup(team.setup.footballEvidence?.secondaryOffense, (i === 0 ? home : away).setup.footballEvidence?.secondaryDefense)) : undefined;
  const wet = precipitationImpact[input.weather.precipitation], wind = bound(input.weather.windMph * 0.0018, 0, 0.19);
  const profiles = [away, home].map((team, i): DriveProfile => {
    const defense = (i === 0 ? home : away).setup, setup = team.setup;
    const priorities = defensiveEventPriorities(defense), qb = team.players[0]!, stats = h.recent(team, qb);
    const rates = matchupDriveRates(setup.footballEvidence?.driveOffense, defense.footballEvidence?.driveDefense);
    const observedSuccess = setup.footballEvidence?.driveOffense?.successRate !== undefined || defense.footballEvidence?.driveDefense?.successRate !== undefined;
    const ratingEdge = (setup.passRating + setup.rushRating) / 2 - defense.defenseRating;
    const qbEdge = setup.passRating - (defense.footballEvidence?.passDefenseRating ?? defense.defenseRating);
    const recentInts = stats?.passAttempts ? (stats.interceptions ?? 0) / stats.passAttempts : undefined;
    let share = bound(0.575 + (setup.passRating - setup.rushRating) * 0.0022 - wind * 0.6 - wet * 0.75 +
      passingStrategyAdjustment(setup, defense, input.importance), 0.4, 0.68);
    share = quarterbackPassShare(h.footballPassShare(share, setup, defense), setup);
    return {
      ...rates,
      successRate: bound((rates.successRate + (observedSuccess ? 0 : ratingEdge * 0.001) - wind * 0.25 - wet * 0.3) /
        (1 + (priorities.passesDefended - 1) * share * 0.25 + (priorities.runStops - 1) * (1 - share) * 0.25), 0.02, 0.95),
      explosivePlayRate: bound(rates.explosivePlayRate * (1 - wind - wet), 0.001, 0.9),
      passShare: share,
      interceptionRate: bound(((recentInts ?? 0.022 - qbEdge * 0.00038) +
        ((defense.defenseRecent?.interceptions ?? 0.8) - 0.8) * 0.006) * priorities.interceptions, 0.006, 0.075),
      sackRate: protectedSackProbability(bound((defense.footballEvidence?.sackRate ?? 0.047 +
        ((defense.footballEvidence?.passDefenseRating ?? defense.defenseRating) - setup.passRating) * 0.001) * priorities.sacks, 0.015, 0.13), setup.offensiveLineTier),
      fumbleRate: bound((0.012 + wet * 0.04) * priorities.fumblesForced, 0.003, 0.04),
      fieldGoalPenalty: wind * 0.4 + wet * 0.2,
      // Incompletions stop the clock, so use a modest pace normalization.
      secondsPerPlay: 3600 / (awayPace + homePace) / 0.96,
    };
  });
  const notes = ['Possession model: alternating drives on a shared 60-minute regulation clock. Success means gaining 40%/60%/100% of yards to go on downs 1/2/3–4; an explosive play gains at least 15 yards. Red-zone efficiency is offensive TDs per drive reaching the opponent’s 20.',
    'Drive mappings and small-sample shrinkage are heuristic, not validated accuracy improvements. Extra points are assumed successful; overtime and safeties are not modeled.'];
  for (const [i, team] of [away, home].entries()) {
    const offense = team.setup.footballEvidence?.driveOffense ?? {}, defense = (i === 0 ? home : away).setup.footballEvidence?.driveDefense ?? {};
    const labels: Record<keyof typeof DRIVE_PRIORS, string> = { successRate: 'success', explosivePlayRate: '15+ yard', redZoneTdRate: 'red-zone TD' };
    const sample: Record<keyof typeof DRIVE_PRIORS, keyof PossessionRates> = { successRate: 'successSamples', explosivePlayRate: 'explosiveSamples', redZoneTdRate: 'redZoneTrips' };
    notes.push(`${team.setup.name} drive inputs (matchup-adjusted): ${Object.keys(DRIVE_PRIORS).map(key => {
      const k = key as keyof typeof DRIVE_PRIORS;
      const knownOffense = offense[k] !== undefined && (offense[sample[k]] ?? 0) > 0;
      const knownDefense = defense[k] !== undefined && (defense[sample[k]] ?? 0) > 0;
      return `${labels[k]} ${(profiles[i]![k] * 100).toFixed(1)}% (${knownOffense || knownDefense ? 'observed evidence, shrunk toward prior' : 'model prior; no observed sample'})`;
    }).join('; ')}.`);
  }
  const drives: SimulatedDrive[] = [];
  if (secondaries) {
    notes.push('Secondary method: 10–19 and 20+ air-yard completion/efficiency evidence, passing-only 15+ gains and YAC. Current last-four completed games are primary; any prior-season evidence is capped and separately identified. Changes affect pass outcomes and route depth, not fantasy-point multipliers. Missing metrics add no secondary-specific adjustment.');
    notes.push(secondaryNotes(home.setup.name, home.setup.footballEvidence?.secondaryDefense, secondaries[0]!),
      secondaryNotes(away.setup.name, away.setup.footballEvidence?.secondaryDefense, secondaries[1]!));
  }
  let elapsed = 0, yardsToGoal = 75, awayBall = random() < 0.5;
  while (elapsed < 3600) {
    const team = awayBall ? away : home, profile = profiles[awayBall ? 0 : 1]!, qb = team.players[0]!;
    const defense = awayBall ? home.setup : away.setup, priorities = defensiveEventPriorities(defense);
    const highlights: string[] = [];
    let actor = qb;
    const drive = simulatePossessionDrive({
      profile, random, startYardsToGoal: yardsToGoal, secondsAvailable: 3600 - elapsed,
      opportunity: (kind, distance) => {
        actor = kind === 'pass' ? h.receiver(team, random, distance <= 15) : h.runner(team, random, distance <= 5);
        const recent = h.recent(team, actor), reliability = h.reliability(team.setup, actor);
        const observedEfficiency = kind === 'pass' ? (recent?.receptions ? (recent.receivingYards ?? 12 * recent.receptions) / recent.receptions / 12 : 1)
          : (recent?.rushAttempts ? (recent.rushYards ?? 4.5 * recent.rushAttempts) / recent.rushAttempts / 4.5 : 1);
        const efficiency = team.setup.backfieldModel === 'usage-v1' && actor.position === 'RB'
          ? backfieldEfficiency(actor.backfieldEvidence, kind === 'pass') : 1 + (observedEfficiency - 1) * 0.4 * reliability;
        const qbStats = h.recent(team, qb);
        const qbCompletion = qbStats?.passAttempts && qbStats.passCompletions !== undefined ? qbStats.passCompletions / qbStats.passAttempts : 0.645;
        const catchRate = recent?.targets && recent.receptions !== undefined ? recent.receptions / recent.targets : qbCompletion;
        const completionRate = bound((qbCompletion * 0.75 + catchRate * 0.25 - wind - wet * 0.65) / priorities.passesDefended, 0.25, 0.9);
        const secondary = secondaries?.[awayBall ? 0 : 1];
        const passing = kind === 'pass' ? secondary?.sample(random, distance, completionRate, actor.football?.airYardsPerTarget) : undefined;
        return {
          efficiency: bound(efficiency, 0.65, 1.4),
          completionRate, passing,
          fumbleRate: bound((h.fumbleChance(team.setup, actor, recent, kind === 'pass' ? 0.009 : 0.012) + wet * 0.04 +
            ((defense.defenseRecent?.fumblesForced ?? 0.7) - 0.7) * 0.004) * priorities.fumblesForced, 0.002, 0.04),
        };
      },
      onPlay: play => {
        team.plays++; qb.played = true;
        let text: string;
        if (play.kind === 'sack') { team.sacksAllowed++; text = `${qb.name} sacked for ${Math.abs(play.gain)} yards`; }
        else if (play.kind === 'pass') {
          qb.attempts++;
          if (play.turnover === 'interception') { qb.interceptions++; text = `${qb.name} intercepted`; }
          else if (play.completed) {
            actor.played = true; qb.completions++; qb.passYards += play.gain; actor.receptions++; actor.receivingYards += play.gain;
            if (play.touchdown) { qb.passTD++; actor.receivingTD++; }
            text = `${qb.name} to ${actor.name} for ${play.gain} yards`;
            if (play.airYards !== undefined) text += ` (${play.airYards} air yards, ${play.yardsAfterCatch} YAC)`;
          } else text = `${qb.name} pass incomplete`;
        } else {
          actor.played = true; actor.rushYards += play.gain;
          if (play.touchdown) actor.rushTD++;
          text = `${actor.name} runs for ${play.gain} yards`;
        }
        if (play.turnover === 'fumble') { actor.fumblesLost++; text += ' — fumble recovered by the defense'; }
        if (play.touchdown) text += ' — TOUCHDOWN';
        if (play.explosive || play.turnover || play.touchdown) highlights.push(text);
      },
    });
    let terminal: string, result: string;
    if (drive.outcome === 'TD') { team.score += 7; team.kicking.extraPoints++; result = 'Touchdown'; terminal = 'Touchdown and assumed extra point.'; }
    else if (drive.outcome === 'FG') {
      team.score += 3;
      if (drive.fieldGoalDistance! < 40) team.kicking.fieldGoals039++;
      else if (drive.fieldGoalDistance! < 50) team.kicking.fieldGoals4049++;
      else team.kicking.fieldGoals50Plus++;
      result = 'Field goal'; terminal = `${team.setup.kicker || 'Kicker'} converts from ${drive.fieldGoalDistance} yards.`;
    } else if (drive.turnover === 'missed-fg') { result = 'Missed field goal'; terminal = `Missed ${drive.fieldGoalDistance}-yard field goal; possession changes.`; }
    else if (drive.outcome === 'Turnover') { result = 'Turnover'; terminal = 'Turnover ends the drive.'; }
    else if (drive.outcome === 'Punt') { result = 'Punt'; terminal = 'Fourth down; the drive ends with a punt.'; }
    else { result = 'Game ends'; terminal = 'Regulation clock expires.'; }
    drives.push({ id: drives.length + 1, quarter: Math.min(4, Math.floor(elapsed / 900) + 1), team: team.setup.name, result,
      summary: `${drive.plays.length} plays · ${terminal}`, plays: highlights.slice(-3), snapCount: drive.plays.length });
    elapsed += drive.elapsedSeconds;
    if (drive.outcome === 'End') break;
    if (drive.outcome === 'TD' || drive.outcome === 'FG') yardsToGoal = 75;
    else if (drive.outcome === 'Punt') {
      const landing = 100 - drive.endYardsToGoal + Math.round(35 + random() * 15);
      yardsToGoal = landing >= 100 ? 80 : bound(landing, 1, 99);
    } else if (drive.turnover === 'missed-fg') yardsToGoal = bound(100 - drive.endYardsToGoal - 7, 1, 80);
    else yardsToGoal = bound(100 - drive.endYardsToGoal, 1, 99);
    awayBall = !awayBall;
  }
  return { away, home, drives, notes };
}
