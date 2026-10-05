import { calculateDraftKings } from "./draftkings";
import { defensiveEventPriorities, DEFENSE_TIER_WARNING, type TeamDefenseTier, type SimulationDefender } from "./defensive-tiers";
import { calculateKickerDraftKings, defensiveTouchdowns, SHOWDOWN_MODEL_WARNING, type KickerStats, type KickerProjection } from './showdown-scoring';
import type { DefenseStats } from './draftkings-defense';
import { getDivision, isDivisionGame } from "./nfl-divisions";
import { passingStrategyAdjustment, standingsNotes, type StandingContext } from "./standings";
import { quarterbackPassShare, quarterbackStrategyNotes, type QuarterbackStrategy } from "./quarterback-strategy";
import type { AvailabilityCheck } from "./availability";
import type { historyStrength, playerUsage } from "./history-signals";
import type { PriorSeasonEvidence } from "./prior-season-baseline";
import type { FootballEvidence, FootballPlayerEvidence } from "./football-evidence";
import type { MarketOdds, MarketEvidence } from "./market-odds";
import { getEliteTier, eliteOpportunityWeight, type EliteTier } from "./elite-players";
import { backfieldOpportunityWeight, backfieldReceivingPrior, backfieldEfficiency, type BackfieldEvidence } from "./backfield-workload";

export type Precipitation = "none" | "light" | "moderate" | "heavy";

export interface WeatherSetup {
  temperatureF: number;
  windMph: number;
  precipitation: Precipitation;
}

export interface PlayerRecentStats {
  fumblesLost?: number;
  passAttempts?: number;
  passCompletions?: number;
  passYards?: number;
  passTD?: number;
  interceptions?: number;
  rushAttempts?: number;
  rushYards?: number;
  rushTD?: number;
  targets?: number;
  receptions?: number;
  receivingYards?: number;
  receivingTD?: number;
}

export interface DefenseRecentStats {
  passYardsAllowed?: number;
  passTDAllowed?: number;
  rushYardsAllowed?: number;
  rushTDAllowed?: number;
  interceptions?: number;
  fumblesForced?: number;
  sacks?: number;
  passesDefended?: number;
}

export interface SimulationRosterPlayer {
  football?: FootballPlayerEvidence;
  id: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  recentStats?: PlayerRecentStats;
  depthRank?: number;
  depthRankBasis?: "ESPN" | "saved" | "usage";
  historyObservations?: number;
  elite1x?: boolean;
  eliteTier?: EliteTier;
  usage?: ReturnType<typeof playerUsage>;
  backfieldEvidence?: BackfieldEvidence;
}

export interface TeamSetup {
  /** Frozen opt-in: absence preserves all legacy simulated outcomes. */
  footballEvidence?: FootballEvidence;
  /** Absent on older frozen forecasts: retain their original workload behavior. */
  backfieldModel?: "usage-v1";
  /** New-input opt-in; absent on legacy forecasts to preserve their replay. */
  quarterbackStrategy?: QuarterbackStrategy;
  name: string;
  qb: string;
  rb: string;
  wr1: string;
  wr2: string;
  wr3: string;
  te: string;
  kicker: string;
  passRating: number;
  rushRating: number;
  defenseRating: number;
  context: string;
  elite1x?: Partial<Record<"qb" | "rb" | "wr1" | "wr2" | "wr3" | "te", boolean>>;
  eliteTiers?: Partial<Record<"qb" | "rb" | "wr1" | "wr2" | "wr3" | "te", EliteTier>>;
  recentStats?: {
    qb?: PlayerRecentStats;
    rb?: PlayerRecentStats;
    wr1?: PlayerRecentStats;
    wr2?: PlayerRecentStats;
    wr3?: PlayerRecentStats;
    te?: PlayerRecentStats;
  };
  defenseRecent?: DefenseRecentStats;
  defenseTier?: TeamDefenseTier;
  defenders?: SimulationDefender[];
  roster?: SimulationRosterPlayer[];
  record?: { wins: number; losses: number; ties: number };
  /** Manual, exact-week context frozen with the forecast; absent in legacy saves. */
  standings?: StandingContext;
  historyGames?: number;
  /** Captured in new input snapshots only; legacy replay never consults live priors. */
  priorSeasonBaseline?: PriorSeasonEvidence;
  headToHead?: { opponent: string; games: number; usableGames: number; maxWeight: number };
  depthChartSource?: { fetchedAt: string; url: string };
  availabilityChecks?: AvailabilityCheck[];
  modelEvidence?: { strength: ReturnType<typeof historyStrength>["evidence"]; warnings: string[] };
}

export interface SimulationInput {
  away: TeamSetup;
  home: TeamSetup;
  weather: WeatherSetup;
  seed?: number;
  importance?: "regular" | "must-win" | "playoff";
  /** Optional market weighting is applied to ensemble summaries, not a single game's raw stats. */
  market?: MarketOdds;
  /** Opt-in so legacy frozen forecasts retain their original scoring/replay. */
  showdownModel?: 'showdown-v1';
}

export interface SimulatedDrive {
  id: number;
  quarter: number;
  team: string;
  result: string;
  summary: string;
  plays: string[];
  snapCount: number;
}

export interface PlayerProjection {
  /** Stable roster identity, when simulating from saved team history. */
  id?: string;
  name: string;
  position: string;
  team: string;
  depthRank?: number;
  elite1x?: boolean;
  eliteTier?: EliteTier;
  passYards: number;
  passTD: number;
  interceptions: number;
  rushYards: number;
  rushTD: number;
  receptions: number;
  receivingYards: number;
  receivingTD: number;
  fumblesLost: number;
  draftKings: number;
  played: boolean;
}

export interface SimulationResult {
  seed: number;
  awayScore: number;
  homeScore: number;
  totalPlays: { away: number; home: number };
  overview: string[];
  drives: SimulatedDrive[];
  players: PlayerProjection[];
  defenses?: ({ team: string } & DefenseStats)[];
  kickers?: KickerProjection[];
  ensemble?: {
    runs: number;
    awayWinPct: number;
    homeWinPct: number;
    tiePct: number;
    fantasy: { mean: number; p10: number; p90: number }[];
    defenseFantasy?: { team: string; mean: number; p10: number; p90: number }[];
    kickerFantasy?: { team: string; name: string; mean: number; p10: number; p90: number }[];
    market?: MarketEvidence;
  };
}

interface PlayerAccumulator extends Omit<PlayerProjection, "draftKings"> {
  football?: FootballPlayerEvidence;
  backfieldEvidence?: BackfieldEvidence;
  historyObservations?: number;
  usage?: ReturnType<typeof playerUsage>;
  attempts: number;
  completions: number;
  recentStats?: PlayerRecentStats;
}

interface TeamSimulation {
  setup: TeamSetup;
  score: number;
  plays: number;
  sacksAllowed: number;
  kicking: KickerStats;
  players: PlayerAccumulator[];
  drives: Omit<SimulatedDrive, "id" | "quarter">[];
}

type Random = () => number;

const precipImpact: Record<Precipitation, number> = {
  none: 0,
  light: 0.025,
  moderate: 0.06,
  heavy: 0.105,
};

function makeRandom(seed: number): Random {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function integerBetween(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function supplied(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function blend(baseline: number, recent: number, recentWeight = 0.4): number {
  return baseline * (1 - recentWeight) + recent * recentWeight;
}

function makePlayer(
  name: string,
  position: string,
  team: string,
  depthRank = 1,
): PlayerAccumulator {
  return {
    name: name.trim() || position,
    position,
    team,
    depthRank,
    elite1x: getEliteTier({ name, position }) > 0,
    eliteTier: getEliteTier({ name, position }),
    passYards: 0,
    passTD: 0,
    interceptions: 0,
    rushYards: 0,
    rushTD: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTD: 0,
    fumblesLost: 0,
    played: false,
    attempts: 0,
    completions: 0,
  };
}

function makeTeamSimulation(setup: TeamSetup): TeamSimulation {
  const teamName = setup.name.trim() || "Team";
  const ranks: Record<string, number> = {};
  return {
    setup,
    score: 0,
    plays: 0,
    sacksAllowed: 0,
    kicking: { extraPoints: 0, fieldGoals039: 0, fieldGoals4049: 0, fieldGoals50Plus: 0 },
    players: setup.roster ? setup.roster.map(player => {
      ranks[player.position] = (ranks[player.position] ?? 0) + 1;
      return {
        ...makePlayer(player.name, player.position, teamName, player.depthRank ?? ranks[player.position]),
        id: player.id,
        elite1x: getEliteTier(player) > 0,
        eliteTier: getEliteTier(player),
        recentStats: player.recentStats, historyObservations: player.historyObservations, usage: player.usage, backfieldEvidence: player.backfieldEvidence, football: player.football,
      };
    }) : [
      makePlayer(setup.qb, "QB", teamName),
      makePlayer(setup.rb, "RB", teamName),
      makePlayer(setup.wr1, "WR", teamName),
      makePlayer(setup.wr2, "WR", teamName, 2),
      makePlayer(setup.wr3?.trim() || "WR3", "WR", teamName, 3),
      makePlayer(setup.te, "TE", teamName),
    ].map((player, index) => {
      const slot = (["qb", "rb", "wr1", "wr2", "wr3", "te"] as const)[index]!;
      const eliteTier = getEliteTier({ ...player, eliteTier: setup.eliteTiers?.[slot], elite1x: setup.elite1x?.[slot] });
      return { ...player, eliteTier, elite1x: eliteTier > 0 };
    }),
    drives: [],
  };
}

function receiverFor(
  team: TeamSimulation,
  random: Random,
  redZone: boolean,
): PlayerAccumulator {
  const receivers = team.players.filter(player => ["RB", "WR", "TE"].includes(player.position));
  const fallback = receivers.map(player => team.setup.backfieldModel === "usage-v1" && player.position === "RB"
    ? backfieldReceivingPrior(player.depthRank ?? 1) : receivingRoleWeight(player.position, player.depthRank ?? 1));
  const weighted = receivers.map((player, index) => {
    const playerStats = recentForPlayer(team, player);
    if (team.setup.footballEvidence) {
      const share = redZone && supplied(player.football?.redZoneTargetShare)
        ? player.football.redZoneTargetShare : player.football?.targetShare;
      if (supplied(share)) return eliteOpportunityWeight(player.position === 'RB'
        ? backfieldOpportunityWeight(fallback[index]!, share * 34, player.football?.observations ?? 0)
        : roleGuidedWeight(fallback[index]!, share * 34, clamp((player.football?.observations ?? 0) / 5, 0, 0.75)), player.eliteTier ?? 0);
      if (!supplied(player.usage?.targetShare) && !supplied(playerStats?.targets) && supplied(player.football?.snapShare)) {
        return eliteOpportunityWeight(fallback[index]! * clamp(player.football.snapShare / 0.6, 0.35, 1.35), player.eliteTier ?? 0);
      }
    }
    const targetWeight = supplied(player.usage?.targetShare) ? player.usage.targetShare * 34 : playerStats?.targets;
    const usageReliability = supplied(player.usage?.targetShare) ? clamp((player.usage.targetGames + 1) / 6, 0.2, 1) : playerReliability(team.setup, player);
    const recentTargetWeight = team.setup.backfieldModel === "usage-v1" && player.position === "RB"
      ? backfieldOpportunityWeight(fallback[index]!, playerStats?.targets, player.usage?.targetGames ?? 0)
      : supplied(targetWeight)
      ? roleGuidedWeight(fallback[index]!, targetWeight, usageReliability)
      : fallback[index]!;
    const redZoneBoost =
      redZone && supplied(playerStats?.receivingTD)
        ? 1 + clamp(playerStats.receivingTD * 0.035, 0, 0.16)
        : 1;
    return eliteOpportunityWeight(recentTargetWeight * redZoneBoost, player.eliteTier ?? 0);
  });
  const total = weighted.reduce((sum, value) => sum + value, 0);
  const finalWeights = total > 0 ? weighted : fallback;
  const roll = random() * finalWeights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  for (let index = 0; index < receivers.length; index += 1) {
    cumulative += finalWeights[index]!;
    if (roll < cumulative) {
      return receivers[index]!;
    }
  }
  return receivers[receivers.length - 1]!;
}

function recentForPlayer(
  team: TeamSimulation,
  player: PlayerAccumulator,
): PlayerRecentStats | undefined {
  if (team.setup.roster) return player.recentStats;
  const slots = ["qb", "rb", "wr1", "wr2", "wr3", "te"] as const;
  const slot = slots[team.players.indexOf(player)];
  return slot ? team.setup.recentStats?.[slot] : undefined;
}

function historyReliability(setup: TeamSetup): number {
  return setup.historyGames === undefined ? 1 : clamp((setup.historyGames + 1) / 6, 0.2, 1);
}

function playerReliability(setup: TeamSetup, player: PlayerAccumulator): number {
  return player.historyObservations === undefined ? historyReliability(setup) : clamp((player.historyObservations + 1) / 6, 0.2, 1);
}

function observedFumbleChance(setup: TeamSetup, player: PlayerAccumulator, stats: PlayerRecentStats | undefined, baseline: number) {
  const touches = supplied(stats?.rushAttempts) && supplied(stats?.receptions) ? stats.rushAttempts + stats.receptions : 0;
  return setup.footballEvidence && supplied(stats?.fumblesLost) && touches > 0
    ? blend(baseline, clamp(stats.fumblesLost / touches, 0, 0.08), 0.4 * playerReliability(setup, player)) : baseline;
}

/** Workload priors, not fixed points or talent guarantees. */
export function receivingRoleWeight(position: string, rank: number): number {
  if (position === "WR") return [10, 7, 4][rank - 1] ?? 0.9 / Math.max(1, rank - 3);
  if (position === "RB") return [4, 2][rank - 1] ?? 0.4 / Math.max(1, rank - 2);
  return [5, 1.5][rank - 1] ?? 0.4 / Math.max(1, rank - 2);
}

export function rushingRoleWeight(rank: number): number {
  return [20, 7, 1][rank - 1] ?? 0.3 / Math.max(1, rank - 3);
}

export function roleGuidedWeight(prior: number, reported: number, reliability: number): number {
  // A recent stint replacing an injured starter must not give today's deep
  // backup a starter's entire workload. These are relative selection weights.
  return clamp(blend(prior, reported, Math.min(0.75, reliability)), prior * 0.65, prior * 1.75);
}

function runningBackFor(team: TeamSimulation, random: Random, goalLine = false): PlayerAccumulator {
  if (team.setup.roster) {
    const runners = team.players.filter((player, index) => index === 0 || (player.position !== "QB" && (player.position === "RB" || (player.recentStats?.rushAttempts ?? 0) > 0)));
    const defaults = runners.map(player => player.position === "QB" ? 3 : player.position === "RB" ? rushingRoleWeight(player.depthRank ?? 1) : 1);
    let weights = runners.map((player, index) => {
      if (team.setup.footballEvidence) {
        const share = goalLine && supplied(player.football?.goalLineCarryShare)
          ? player.football.goalLineCarryShare : player.football?.carryShare;
        if (supplied(share)) return player.position === 'RB'
          ? backfieldOpportunityWeight(defaults[index]!, share * 28, player.football?.observations ?? 0)
          : roleGuidedWeight(defaults[index]!, share * 28, clamp((player.football?.observations ?? 0) / 5, 0, 0.75));
        if (!supplied(player.recentStats?.rushAttempts) && !supplied(player.usage?.carryShare) && supplied(player.football?.snapShare)) {
          return defaults[index]! * clamp(player.football.snapShare / 0.6, 0.35, 1.35);
        }
      }
      if (team.setup.backfieldModel === "usage-v1" && player.position === "RB") {
        return backfieldOpportunityWeight(defaults[index]!, player.recentStats?.rushAttempts, player.usage?.carryGames ?? 0);
      }
      const carries = supplied(player.usage?.carryShare) ? player.usage.carryShare * 28 : player.recentStats?.rushAttempts;
      const reliability = supplied(player.usage?.carryShare) ? clamp((player.usage.carryGames + 1) / 6, 0.2, 1) : playerReliability(team.setup, player);
      return carries === undefined ? defaults[index]! : roleGuidedWeight(defaults[index]!, carries, reliability);
    });
    if (weights.every(weight => weight === 0)) weights = defaults;
    weights = weights.map((weight, index) => eliteOpportunityWeight(weight, runners[index]!.eliteTier ?? 0));
    let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < runners.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return runners[i]!;
    }
    return runners[runners.length - 1]!;
  }
  const qb = team.players[0]!;
  const rb = team.players[1]!;
  const qbCarries = team.setup.recentStats?.qb?.rushAttempts;
  const rbCarries = team.setup.recentStats?.rb?.rushAttempts;
  let qbShare = 0.09;
  if (supplied(qbCarries) && supplied(rbCarries) && qbCarries + rbCarries > 0) {
    qbShare = qbCarries / (qbCarries + rbCarries);
  } else if (supplied(qbCarries)) {
    qbShare = qbCarries / (qbCarries + 20);
  } else if (supplied(rbCarries) && rbCarries > 0) {
    qbShare = 0.09 * (20 / rbCarries);
  }
  const baseShare = clamp(qbShare, 0.025, 0.4);
  const qbWeight = eliteOpportunityWeight(baseShare, qb.eliteTier ?? 0);
  const rbWeight = eliteOpportunityWeight(1 - baseShare, rb.eliteTier ?? 0);
  return random() < qbWeight / (qbWeight + rbWeight) ? qb : rb;
}

function weightedPassYards(random: Random): number {
  const roll = random();
  if (roll < 0.1) return integerBetween(random, 1, 4);
  if (roll < 0.47) return integerBetween(random, 5, 9);
  if (roll < 0.78) return integerBetween(random, 10, 17);
  if (roll < 0.94) return integerBetween(random, 18, 27);
  if (roll < 0.99) return integerBetween(random, 28, 39);
  return integerBetween(random, 40, 55);
}

function weightedRushYards(random: Random, ratingEdge: number): number {
  const roll = random();
  const edge = ratingEdge * 0.035;
  if (roll < 0.055) return -integerBetween(random, 1, 4);
  if (roll < 0.13) return 0;
  if (roll < 0.49) return integerBetween(random, 1, 3);
  if (roll < 0.79) return integerBetween(random, 4, 6);
  if (roll < 0.94) return integerBetween(random, 7, 12);
  if (roll < 0.985) return integerBetween(random, 13, 24);
  return integerBetween(random, 25, 45) + Math.max(0, edge);
}

function weatherLabel(weather: WeatherSetup): string {
  const conditions: string[] = [];
  conditions.push(`${weather.temperatureF}°F`);
  conditions.push(`${weather.windMph} mph wind`);
  if (weather.precipitation !== "none") {
    conditions.push(`${weather.precipitation} precipitation`);
  } else {
    conditions.push("dry conditions");
  }
  return conditions.join(", ");
}

export function footballPassingShare(base: number, setup: TeamSetup, defense: TeamSetup): number {
  if (!setup.footballEvidence) return base;
  let share = supplied(setup.footballEvidence.dropbackShare)
    ? blend(base, clamp(setup.footballEvidence.dropbackShare, 0.35, 0.78), 0.45) : base;
  const matchup = defense.footballEvidence;
  if (matchup) share += clamp((matchup.rushDefenseRating - matchup.passDefenseRating) * 0.0015, -0.05, 0.05);
  return clamp(share, 0.35, 0.76);
}

function simulateTeam(
  setup: TeamSetup,
  defense: TeamSetup,
  weather: WeatherSetup,
  targetPlays: number,
  random: Random,
  isHome: boolean,
  importance: SimulationInput["importance"],
): TeamSimulation {
  const team = makeTeamSimulation(setup);
  const qb = team.players[0]!;
  const precipitation = precipImpact[weather.precipitation];
  const windPenalty = clamp(weather.windMph * 0.0018, 0, 0.19);
  const coldPenalty = weather.temperatureF < 28 ? 0.025 : 0;
  const qbRecent = recentForPlayer(team, qb);
  const reliability = playerReliability(setup, qb);
  const defenseReliability = historyReliability(defense);
  const defenseRecent = defense.defenseRecent;
  const defensePriority = defensiveEventPriorities(defense);
  const recentCarries = setup.roster
    ? setup.roster.filter(player => player.position === "RB").reduce((sum, player) => sum + (player.recentStats?.rushAttempts ?? 0), 0) || undefined
    : setup.recentStats?.rb?.rushAttempts;
  const recordGames = setup.record ? setup.record.wins + setup.record.losses + setup.record.ties : 0;
  const recordEdge = recordGames > 0 ? ((setup.record!.wins + setup.record!.ties / 2) / recordGames - 0.5) * 0.015 : 0;
  const recentPassingShare = supplied(qbRecent?.passAttempts)
    ? clamp(qbRecent.passAttempts / targetPlays, 0.4, 0.68)
    : supplied(recentCarries)
      ? clamp(1 - (recentCarries + (qbRecent?.rushAttempts ?? 3)) / targetPlays, 0.4, 0.68)
      : undefined;
  const basePassShare = clamp(
    0.575 +
      (setup.passRating - setup.rushRating) * 0.0022 -
      windPenalty * 0.6 -
      precipitation * 0.75 +
      (isHome ? 0.005 : 0) +
      passingStrategyAdjustment(setup, defense, importance),
    0.4,
    0.68,
  );
  let passShare = clamp(
    recentPassingShare === undefined
      ? basePassShare
      : blend(basePassShare, recentPassingShare, 0.42 * reliability),
    0.4,
    0.68,
  );
  passShare = quarterbackPassShare(footballPassingShare(passShare, setup, defense), setup);
  const ratingEdge = setup.rushRating - (defense.footballEvidence?.rushDefenseRating ?? defense.defenseRating);
  const passYardsPerAttempt =
    supplied(qbRecent?.passYards) && supplied(qbRecent?.passAttempts) &&
    qbRecent.passAttempts > 0
      ? qbRecent.passYards / qbRecent.passAttempts
      : undefined;
  const passEfficiencyFactor =
    passYardsPerAttempt === undefined
      ? 1
      : clamp(blend(1, passYardsPerAttempt / 7, 0.42 * reliability), 0.8, 1.22);
  const passDefenseFactor = supplied(defense.footballEvidence?.passEpaAllowed)
    ? clamp(1 + defense.footballEvidence.passEpaAllowed * 0.3 * defense.footballEvidence.passSamples / (defense.footballEvidence.passSamples + 100), 0.82, 1.2)
    : supplied(defenseRecent?.passYardsAllowed)
    ? clamp(blend(1, defenseRecent.passYardsAllowed / 225, 0.36 * defenseReliability), 0.82, 1.2)
    : 1;
  const rushDefenseFactor = supplied(defense.footballEvidence?.rushEpaAllowed)
    ? clamp(1 + defense.footballEvidence.rushEpaAllowed * 0.3 * defense.footballEvidence.rushSamples / (defense.footballEvidence.rushSamples + 80), 0.82, 1.2)
    : supplied(defenseRecent?.rushYardsAllowed)
    ? clamp(blend(1, defenseRecent.rushYardsAllowed / 115, 0.36 * defenseReliability), 0.82, 1.2)
    : 1;
  const receiverTouchdowns = (setup.roster ? setup.roster.map(player => player.recentStats?.receivingTD) : [
    setup.recentStats?.wr1?.receivingTD,
    setup.recentStats?.wr2?.receivingTD,
    setup.recentStats?.wr3?.receivingTD,
    setup.recentStats?.te?.receivingTD,
    setup.recentStats?.rb?.receivingTD,
  ]).filter(supplied).reduce((sum, value) => sum + value, 0);
  const passTouchdowns = supplied(qbRecent?.passTD)
    ? qbRecent.passTD
    : receiverTouchdowns;
  const rushTouchdowns = (setup.roster ? setup.roster.map(player => player.recentStats?.rushTD) : [
    setup.recentStats?.qb?.rushTD,
    setup.recentStats?.rb?.rushTD,
  ]).filter(supplied).reduce((sum, value) => sum + value, 0);
  const knownRecentTouchdowns = passTouchdowns + rushTouchdowns;
  const redZonePassShare = setup.quarterbackStrategy?.model === 'backup-run-v1' && setup.quarterbackStrategy.backup &&
    setup.quarterbackStrategy.quarterback === setup.qb ? passShare :
    knownRecentTouchdowns > 0
      ? clamp(
          blend(
            passShare,
            passTouchdowns / knownRecentTouchdowns,
            0.18,
          ),
          0.3,
          0.76,
        )
      : passShare;

  while (team.plays < targetPlays) {
    let yardsToGoal = integerBetween(random, 66, 78);
    let down = 1;
    let yardsToFirst = 10;
    const maxSnaps = Math.min(11, targetPlays - team.plays);
    const highlights: string[] = [];
    let result = "Punt";
    let terminalSummary = "";
    let driveSnaps = 0;

    for (let driveSnap = 0; driveSnap < maxSnaps; driveSnap += 1) {
      team.plays += 1;
      qb.played = true;
      driveSnaps += 1;
      const pass = random() < (yardsToGoal <= 15 ? redZonePassShare : passShare);
      let gain = 0;
      let turnover = false;
      let playText = "";
      let scorer: PlayerAccumulator | undefined;
      const qbEdge = setup.passRating - (defense.footballEvidence?.passDefenseRating ?? defense.defenseRating);

      if (pass) {
        qb.attempts += 1;
        const baselineInterceptionChance = 0.022 - qbEdge * 0.00038;
        const recentInterceptionChance =
          supplied(qbRecent?.interceptions) &&
          supplied(qbRecent?.passAttempts) &&
          qbRecent.passAttempts > 0
            ? qbRecent.interceptions / qbRecent.passAttempts
            : undefined;
        const unboostedInterceptionChance = clamp(
          (recentInterceptionChance === undefined
            ? baselineInterceptionChance
            : blend(baselineInterceptionChance, recentInterceptionChance, 0.4 * reliability)) +
            (supplied(defenseRecent?.interceptions)
              ? (defenseRecent.interceptions - 0.8) * 0.006
              : 0),
          0.006,
          0.075,
        );
        const baseSackChance = supplied(defense.footballEvidence?.sackRate)
          ? blend(0.047, defense.footballEvidence.sackRate, 0.5)
          : 0.047 + ((defense.footballEvidence?.passDefenseRating ?? defense.defenseRating) - setup.passRating) * 0.001;
        const interceptionChance = clamp(unboostedInterceptionChance * defensePriority.interceptions, 0.006, 0.075);
        const unboostedSackChance = clamp(!supplied(defense.footballEvidence?.sackRate) && supplied(defenseRecent?.sacks)
          ? blend(baseSackChance, defenseRecent.sacks / 35, 0.4 * defenseReliability)
          : baseSackChance, 0.015, 0.13);
        const sackChance = clamp(unboostedSackChance * defensePriority.sacks, 0.015, 0.13);

        if (random() < interceptionChance) {
          qb.interceptions += 1;
          turnover = true;
          playText = `${qb.name} intercepted — possession changes hands`;
        } else if (random() < sackChance) {
          team.sacksAllowed += 1;
          gain = -integerBetween(random, 3, 9);
          playText = `${qb.name} sacked for ${Math.abs(gain)} yards`;
        } else {
          const receiver = receiverFor(team, random, yardsToGoal <= 15);
          receiver.played = true;
          const receiverRecent = recentForPlayer(team, receiver);
          let completionChance = clamp(
            0.645 +
              qbEdge * 0.0024 +
              (isHome ? 0.012 : 0) -
              windPenalty -
              precipitation * 0.65 -
              coldPenalty + recordEdge -
              (supplied(defenseRecent?.passesDefended) ? clamp((defenseRecent.passesDefended - 4) * 0.002, -0.01, 0.025) : 0),
            0.39,
            0.76,
          );
          if (
            supplied(qbRecent?.passCompletions) &&
            supplied(qbRecent?.passAttempts) &&
            qbRecent.passAttempts > 0
          ) {
            completionChance = blend(
              completionChance,
              clamp(qbRecent.passCompletions / qbRecent.passAttempts, 0.3, 0.85),
              0.32 * reliability,
            );
          }
          if (
            supplied(receiverRecent?.receptions) &&
            supplied(receiverRecent?.targets) &&
            receiverRecent.targets > 0
          ) {
            completionChance = blend(
              completionChance,
              clamp(receiverRecent.receptions / receiverRecent.targets, 0.25, 0.9),
              0.3 * playerReliability(setup, receiver),
            );
          }
          if (yardsToGoal <= 15 && supplied(defenseRecent?.passTDAllowed)) {
            completionChance += (defenseRecent.passTDAllowed - 1.4) * 0.025;
          }
          if (defensePriority.passesDefended > 1) {
            completionChance = clamp(1 - (1 - completionChance) * defensePriority.passesDefended, 0.25, 0.9);
          }
          if (supplied(defense.footballEvidence?.nonSackHitRate)) {
            completionChance = clamp(completionChance - clamp((defense.footballEvidence.nonSackHitRate - 0.09) * 0.15, -0.02, 0.03), 0.25, 0.9);
          }
          if (random() >= completionChance) {
            playText = `${qb.name} pass incomplete`;
          } else {
            const positionMatchup = defense.footballEvidence?.positionMatchups[receiver.position];
            const positionEfficiency = positionMatchup
              ? 1 + clamp(positionMatchup.delta * 0.25 * positionMatchup.samples / (positionMatchup.samples + 30), -0.1, 0.1) : 1;
            const receiverEfficiency = setup.backfieldModel === "usage-v1" && receiver.position === "RB"
              ? backfieldEfficiency(receiver.backfieldEvidence, true) :
              supplied(receiverRecent?.receivingYards) &&
              supplied(receiverRecent?.receptions) &&
              receiverRecent.receptions > 0
                ? clamp(
                    blend(1, receiverRecent.receivingYards / receiverRecent.receptions / 12, 0.4 * playerReliability(setup, receiver)),
                    0.65,
                    1.4,
                  )
                : 1;
            gain = Math.min(
              yardsToGoal,
              Math.max(1, Math.round(weightedPassYards(random) * passEfficiencyFactor * passDefenseFactor * receiverEfficiency * positionEfficiency *
                (setup.footballEvidence && supplied(receiver.football?.airYardsPerTarget)
                  ? 1 + clamp((receiver.football.airYardsPerTarget - 8) / 20, -0.4, 0.5) * (random() < 0.5 ? -1 : 1)
                  : 1))),
            );
            const fumbled = random() < clamp(
              (observedFumbleChance(setup, receiver, receiverRecent, 0.009) + precipitation * 0.035 +
                (supplied(defenseRecent?.fumblesForced)
                  ? (defenseRecent.fumblesForced - 0.7) * 0.004
                  : 0)) * defensePriority.fumblesForced,
              0.002,
              0.035,
            );
            qb.completions += 1;
            qb.passYards += gain;
            receiver.receptions += 1;
            receiver.receivingYards += gain;
            if (fumbled) {
              receiver.fumblesLost += 1;
              turnover = true;
              playText = `${receiver.name} fumbles after a ${gain}-yard catch — recovered by the defense`;
            } else {
              scorer = receiver;
              playText = `${qb.name} to ${receiver.name} for ${gain} yards`;
            }
          }
        }
      } else {
        const runner = runningBackFor(team, random, yardsToGoal <= 5);
        const runnerRecent = recentForPlayer(team, runner);
        const runnerEfficiency = setup.backfieldModel === "usage-v1" && runner.position === "RB"
          ? backfieldEfficiency(runner.backfieldEvidence, false) :
          supplied(runnerRecent?.rushYards) &&
          supplied(runnerRecent?.rushAttempts) &&
          runnerRecent.rushAttempts > 0
            ? clamp(
                blend(1, runnerRecent.rushYards / runnerRecent.rushAttempts / 4.5, 0.5 * reliability),
                0.65,
                1.4,
              )
            : 1;
        const goalLineDefense =
          yardsToGoal <= 10 && supplied(defenseRecent?.rushTDAllowed)
            ? clamp(1 + (defenseRecent.rushTDAllowed - 0.9) * 0.12, 0.8, 1.2)
            : 1;
        gain = Math.min(
          yardsToGoal,
          Math.round(
            (weightedRushYards(random, ratingEdge) + ratingEdge * 0.035) *
              runnerEfficiency * rushDefenseFactor * goalLineDefense,
          ),
        );
        if (defensePriority.runStops > 1) {
          gain = Math.round(gain >= 0 ? gain / defensePriority.runStops : gain * defensePriority.runStops);
        }
        const fumbled = random() < clamp(
          (observedFumbleChance(setup, runner, runnerRecent, 0.012) + precipitation * 0.045 +
            (supplied(defenseRecent?.fumblesForced)
              ? (defenseRecent.fumblesForced - 0.7) * 0.004
              : 0)) * defensePriority.fumblesForced,
          0.003,
          0.04,
        );
        runner.rushYards += gain;
        runner.played = true;
        if (fumbled) {
          runner.fumblesLost += 1;
          turnover = true;
          playText = `${runner.name} fumbles after a ${Math.max(gain, 0)}-yard run — recovered by the defense`;
        } else {
          scorer = runner;
          playText = `${runner.name} runs for ${gain} yards`;
        }
      }

      if (turnover) {
        result = "Turnover";
        terminalSummary = "Turnover ends the drive.";
        highlights.push(playText);
        break;
      }

      yardsToGoal -= gain;
      yardsToFirst -= gain;

      if (yardsToGoal <= 0) {
        team.score += 7;
        team.kicking.extraPoints++;
        if (pass && scorer) {
          qb.passTD += 1;
          scorer.receivingTD += 1;
        } else if (scorer) {
          scorer.rushTD += 1;
        }
        result = "Touchdown";
        terminalSummary = `${setup.name} finds the end zone. The simulation assumes a successful extra point.`;
        highlights.push(`${playText} — TOUCHDOWN`);
        break;
      }

      if (
        Math.abs(gain) >= 14 ||
        (gain >= 8 && yardsToGoal <= 35) ||
        (driveSnap === maxSnaps - 1 && maxSnaps <= 3)
      ) {
        highlights.push(playText);
      }

      if (yardsToFirst <= 0) {
        down = 1;
        yardsToFirst = Math.min(10, yardsToGoal);
      } else {
        down += 1;
      }

      if (down === 4) {
        const fgDistance = yardsToGoal + 17;
        const canTryFieldGoal = fgDistance <= 59;
        if (canTryFieldGoal) {
          const makeChance = clamp(0.96 - Math.max(0, fgDistance - 35) * 0.012 - windPenalty * 0.4 - precipitation * 0.2, 0.3, 0.96);
          if (random() < makeChance) {
            team.score += 3;
            if (fgDistance < 40) team.kicking.fieldGoals039++;
            else if (fgDistance < 50) team.kicking.fieldGoals4049++;
            else team.kicking.fieldGoals50Plus++;
            result = "Field goal";
            terminalSummary = `${setup.kicker || "Kicker"} converts from ${fgDistance} yards.`;
            highlights.push(terminalSummary);
          } else {
            result = "Missed field goal";
            terminalSummary = `${setup.kicker || "Kicker"} misses from ${fgDistance} yards.`;
            highlights.push(terminalSummary);
          }
        } else {
          result = "Punt";
          terminalSummary = "Fourth down; the drive ends with a punt.";
        }
        break;
      }
    }

    if (team.plays >= targetPlays && !terminalSummary) {
      result = "Game ends";
      terminalSummary = "The simulation reaches its final snap.";
      if (highlights.length === 0) {
        highlights.push("Final play of the game.");
      }
    } else if (!terminalSummary) {
      result = "Punt";
      terminalSummary = "The drive ends without a score.";
    }

    const details = highlights.slice(-3);
    team.drives.push({
      team: setup.name,
      result,
      summary: `${driveSnaps} plays · ${terminalSummary}`,
      plays: details,
      snapCount: driveSnaps,
    });
  }

  return team;
}

function makeOverview(
  input: SimulationInput,
  away: TeamSimulation,
  home: TeamSimulation,
): string[] {
  const wind = input.weather.windMph;
  const precipitation = input.weather.precipitation;
  const overview = [
    "Depth-chart roles guide workload: WR1/RB1/TE1 get primary-role priors, second/third options and deeper backups get progressively smaller priors. Reported usage still matters; rank is not a points floor. Missing injury-game rows are not inserted as zero performances.",
    `Conditions: ${weatherLabel(input.weather)}. ${
      wind >= 15 || precipitation === "heavy"
        ? "Wind and/or heavy rain lower the passing outlook and shift play selection toward the run."
        : precipitation === "moderate" || wind >= 9
          ? "Some weather friction trims downfield passing efficiency."
          : "Weather is unlikely to force a major change in the game plan."
    }`,
    `Home field: ${home.setup.name} receives a small home-field edge in the model; ratings and weather have a larger effect.`,
    `${away.setup.name}: passing rating ${away.setup.passRating}, rushing rating ${away.setup.rushRating}, opposing-defense rating ${home.setup.defenseRating}. ${away.setup.context.trim() ? `Context supplied: ${away.setup.context.trim()}` : "No injury or trend notes supplied."}`,
    `${home.setup.name}: passing rating ${home.setup.passRating}, rushing rating ${home.setup.rushRating}, opposing-defense rating ${away.setup.defenseRating}. ${home.setup.context.trim() ? `Context supplied: ${home.setup.context.trim()}` : "No injury or trend notes supplied."}`,
    `Recent stats: ${
      [input.away, input.home].filter(team =>
        (team.roster?.some(player => Object.values(player.recentStats ?? {}).some(supplied)) ?? false) ||
        Object.values(team.recentStats ?? {}).some(stats =>
          Object.values(stats).some(supplied)) ||
        Object.values(team.defenseRecent ?? {}).some(supplied),
      ).map(team => team.name).join(" and ") || "none supplied"
    }. Entered averages are blended with baseline rates, not treated as guaranteed outcomes. Context notes do not change probabilities; adjust ratings for injuries.`,
  ];
  if (input.away.record || input.home.record) {
    const record = (team: TeamSetup) => team.record ? `${team.record.wins}-${team.record.losses}-${team.record.ties}` : "unknown";
    overview.push(`Records before this matchup: ${input.away.name} ${record(input.away)}; ${input.home.name} ${record(input.home)}. Winning percentage is only a small strength prior, not a guarantee.`);
  }
  const awayDivision = getDivision(input.away.name), homeDivision = getDivision(input.home.name);
  overview.push(...standingsNotes(input.away, input.home));
  overview.push(...quarterbackStrategyNotes(input.away), ...quarterbackStrategyNotes(input.home));
  overview.push(isDivisionGame(input.away.name, input.home.name)
    ? `Division game: both teams are in ${awayDivision}. Familiarity can matter, but no blanket difficulty, scoring or fantasy-point penalty is applied.`
    : `Non-division or unclassified matchup: ${input.away.name} (${awayDivision ?? "unknown division"}) vs ${input.home.name} (${homeDivision ?? "unknown division"}). Division labels use current NFL alignment.`);
  for (const [team, opponent] of [[input.away, input.home], [input.home, input.away]] as const) {
    if (team.footballEvidence) {
      const e = team.footballEvidence;
      overview.push(`${team.name}: football-v2 uses recent-four box scores plus ${e.sources.map(s => `${s.season}: ${s.games} verified game(s), weeks ${s.weeks.join('/')}`).join('; ') || 'no verified PBP games'}. ${e.matchedPlayers} eligible players uniquely matched. Passing/rushing defenses modeled separately (${e.passDefenseRating.toFixed(1)}/${e.rushDefenseRating.toFixed(1)}).`);
      overview.push(`${team.name}: PBP passing/rushing EPA informs efficiency; RB/WR/TE target EPA measures position matchups relative to that defense's receiving average; dropback share informs pass volume; snap coverage supports missing-workload estimates; targets/carries and red-zone/goal-line shares replace overlapping workload estimates; air yards vary receiving upside without a blanket mean-points boost; sacks and non-sack hits affect passing disruption (not a full pressure-rate measurement); observed play volume informs pace. Missing fields stay neutral. These bounded mappings are heuristics, not validated accuracy gains.`);
      overview.push(...e.warnings.map(w => `${team.name}: ${w}`));
    }
    if (team.modelEvidence) {
      overview.push(`${team.name}: ${team.modelEvidence.strength.basis}. Strength ratings shrink toward baseline 55 with sparse history. Workload shares use reported targets/carries, not verified complete snap or route coverage.`);
      overview.push(...team.modelEvidence.warnings.map(warning => `${team.name}: ${warning}`));
    }
    const evidence = team.headToHead;
    overview.push(evidence?.opponent === opponent.name && evidence.usableGames > 0
      ? `${team.name}: ${evidence.games} earlier head-to-head game(s) against ${opponent.name}, ${evidence.usableGames} with usable model statistics. Opponent-specific averages contribute up to ${Math.round(evidence.maxWeight * 100)}% per reported field; changes are bounded and can raise or lower projections. This is an uncalibrated heuristic, not a guaranteed rivalry effect.`
      : `${team.name}: no usable earlier head-to-head statistics loaded against ${opponent.name}. No opponent-specific history adjustment is applied.`);
  }
  let defensiveTagsApplied = false;
  for (const setup of [input.away, input.home]) {
    const priorities = defensiveEventPriorities(setup);
    if (Object.values(priorities).some(value => value > 1)) {
      defensiveTagsApplied = true;
      const names = (setup.defenders ?? []).filter(p => p.active !== false && p.defensiveTier > 0).map(p => `${p.name} ${p.defensiveTier}x`);
      overview.push(`${setup.name}: defensive team priority ${setup.defenseTier ?? 0}x; included defender tags ${names.join(', ') || 'none'}. Event priority: sacks ${priorities.sacks.toFixed(2)}, interceptions ${priorities.interceptions.toFixed(2)}, forced fumbles ${priorities.fumblesForced.toFixed(2)}, pass breakups ${priorities.passesDefended.toFixed(2)}, run stops ${priorities.runStops.toFixed(2)}.`);
    }
  }
  if (defensiveTagsApplied) overview.push(DEFENSE_TIER_WARNING);
  if (input.importance && input.importance !== "regular") overview.push(`Game importance: ${input.importance}. A small passing-aggression adjustment is applied; motivation cannot be measured reliably from this label.`);
  return overview;
}

export function simulateGame(input: SimulationInput): SimulationResult {
  if (input.away.name === input.home.name) {
    throw new Error("Choose different teams for the away and home sides.");
  }
  if (
    !Number.isFinite(input.weather.temperatureF) ||
    input.weather.temperatureF < -30 || input.weather.temperatureF > 120 ||
    !Number.isFinite(input.weather.windMph) ||
    input.weather.windMph < 0 || input.weather.windMph > 80
  ) {
    throw new Error("Enter a temperature from -30 to 120°F and wind from 0 to 80 mph.");
  }
  for (const team of [input.away, input.home]) {
    if (team.roster && (!team.roster.length || team.roster[0]?.position !== "QB" || !team.roster.some(p => p.position === "RB") || !team.roster.some(p => ["WR", "TE"].includes(p.position)))) {
      throw new Error(`${team.name}: save an active QB, RB, and WR or TE before simulating from the library.`);
    }
    const stats = [...Object.values(team.recentStats ?? {}), ...(team.roster ?? []).map(player => player.recentStats ?? {})];
    const values = [...stats.flatMap(player => Object.values(player)), ...Object.values(team.defenseRecent ?? {})];
    if (values.some(value => value !== undefined && (!Number.isFinite(value) || value < -1000 || value > 1000))) {
      throw new Error(`${team.name}: recent averages must be between -1,000 and 1,000; only yardage may be negative.`);
    }
    for (const player of stats) {
      if (Object.entries(player).some(([key, value]) => value !== undefined && value < 0 && !/yards/i.test(key))) {
        throw new Error(`${team.name}: only yardage averages can be negative.`);
      }
      if (supplied(player.passCompletions) && supplied(player.passAttempts) && player.passCompletions > player.passAttempts) {
        throw new Error(`${team.name}: completions cannot exceed passing attempts.`);
      }
      if (supplied(player.receptions) && supplied(player.targets) && player.receptions > player.targets) {
        throw new Error(`${team.name}: receptions cannot exceed targets.`);
      }
    }
  }
  const seed =
    input.seed ??
    Math.floor(Math.random() * 0xffffffff) + 1;
  const random = makeRandom(seed);
  const plannedPlays = (setup: TeamSetup) => {
    const base = integerBetween(random, 62, 68);
    return supplied(setup.footballEvidence?.playsPerGame)
      ? Math.round(clamp(blend(base, setup.footballEvidence.playsPerGame, 0.4), 48, 82)) : base;
  };
  const targetAwayPlays = plannedPlays(input.away);
  const targetHomePlays = plannedPlays(input.home);
  const away = simulateTeam(
    input.away,
    input.home,
    input.weather,
    targetAwayPlays,
    random,
    false,
    input.importance,
  );
  const home = simulateTeam(
    input.home,
    input.away,
    input.weather,
    targetHomePlays,
    random,
    true,
    input.importance,
  );

  const mergedDrives: SimulatedDrive[] = [];
  let awayIndex = 0;
  let homeIndex = 0;
  let awayFirst = random() < 0.5;
  let playedSnaps = 0;

  while (awayIndex < away.drives.length || homeIndex < home.drives.length) {
    const takeAway =
      (awayFirst && awayIndex < away.drives.length) ||
      homeIndex >= home.drives.length;
    const drive = takeAway
      ? away.drives[awayIndex++]
      : home.drives[homeIndex++];
    if (!drive) break;

    const totalSnaps = away.plays + home.plays;
    const quarter = Math.min(
      4,
      Math.floor((playedSnaps / Math.max(totalSnaps, 1)) * 4) + 1,
    );
    mergedDrives.push({
      ...drive,
      id: mergedDrives.length + 1,
      quarter,
    });
    playedSnaps += drive.snapCount;
    awayFirst = !awayFirst;
  }

  const players = [...away.players, ...home.players].map((player) => {
    const { attempts: _attempts, completions: _completions, recentStats: _recentStats, backfieldEvidence: _backfieldEvidence, football: _football, ...projection } = player;
    return { ...projection, draftKings: calculateDraftKings({
      passYards: player.passYards, passTD: player.passTD, interceptions: player.interceptions,
      rushYards: player.rushYards, rushTD: player.rushTD, receptions: player.receptions,
      receivingYards: player.receivingYards, receivingTD: player.receivingTD, fumblesLost: player.fumblesLost,
    }) };
  });
  const defenses: NonNullable<SimulationResult['defenses']> = [
    { team: away.setup.name, sacks: home.sacksAllowed, interceptions: home.players.reduce((n, p) => n + p.interceptions, 0), fumblesRecovered: home.players.reduce((n, p) => n + p.fumblesLost, 0), pointsAllowed: home.score },
    { team: home.setup.name, sacks: away.sacksAllowed, interceptions: away.players.reduce((n, p) => n + p.interceptions, 0), fumblesRecovered: away.players.reduce((n, p) => n + p.fumblesLost, 0), pointsAllowed: away.score },
  ];
  let kickers: KickerProjection[] | undefined;
  if (input.showdownModel === 'showdown-v1') {
    const eventRandom = makeRandom((seed ^ 0x51d0ca7) >>> 0);
    defenses.forEach((defense, i) => {
      defense.defensiveTD = defensiveTouchdowns(defense.interceptions, defense.fumblesRecovered, eventRandom);
      const team = i === 0 ? away : home;
      team.score += 7 * defense.defensiveTD;
      team.kicking.extraPoints += defense.defensiveTD;
    });
    // Opponent defensive TDs are excluded from points allowed, but their XPs count.
    defenses[0]!.pointsAllowed += defenses[1]!.defensiveTD!;
    defenses[1]!.pointsAllowed += defenses[0]!.defensiveTD!;
    kickers = [away, home].filter(t => !!t.setup.kicker && t.setup.kicker !== 'Kicker').map(t => ({
      name: t.setup.kicker, team: t.setup.name, ...t.kicking, draftKings: calculateKickerDraftKings(t.kicking),
    }));
  }

  return {
    seed,
    awayScore: away.score,
    homeScore: home.score,
    totalPlays: { away: away.plays, home: home.plays },
    overview: [...makeOverview(input, away, home), ...(kickers ? [SHOWDOWN_MODEL_WARNING,
      `Simulated defensive return touchdowns: ${away.setup.name} ${defenses[0]!.defensiveTD}; ${home.setup.name} ${defenses[1]!.defensiveTD}. Team totals include these TDs and assumed extra points.`] : [])],
    drives: mergedDrives,
    players,
    defenses,
    ...(kickers ? { kickers } : {}),
  };
}