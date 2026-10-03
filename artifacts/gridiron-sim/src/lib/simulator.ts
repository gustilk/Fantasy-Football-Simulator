import { calculateDraftKings } from "./draftkings";

export type Precipitation = "none" | "light" | "moderate" | "heavy";

export interface WeatherSetup {
  temperatureF: number;
  windMph: number;
  precipitation: Precipitation;
}

export interface PlayerRecentStats {
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
  id: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  recentStats?: PlayerRecentStats;
}

export interface TeamSetup {
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
  recentStats?: {
    qb?: PlayerRecentStats;
    rb?: PlayerRecentStats;
    wr1?: PlayerRecentStats;
    wr2?: PlayerRecentStats;
    wr3?: PlayerRecentStats;
    te?: PlayerRecentStats;
  };
  defenseRecent?: DefenseRecentStats;
  roster?: SimulationRosterPlayer[];
  record?: { wins: number; losses: number; ties: number };
  historyGames?: number;
}

export interface SimulationInput {
  away: TeamSetup;
  home: TeamSetup;
  weather: WeatherSetup;
  seed?: number;
  importance?: "regular" | "must-win" | "playoff";
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
  name: string;
  position: string;
  team: string;
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
  ensemble?: {
    runs: number;
    awayWinPct: number;
    homeWinPct: number;
    tiePct: number;
    fantasy: { mean: number; p10: number; p90: number }[];
  };
}

interface PlayerAccumulator extends Omit<PlayerProjection, "draftKings"> {
  attempts: number;
  completions: number;
  recentStats?: PlayerRecentStats;
}

interface TeamSimulation {
  setup: TeamSetup;
  score: number;
  plays: number;
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
): PlayerAccumulator {
  return {
    name: name.trim() || position,
    position,
    team,
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
  return {
    setup,
    score: 0,
    plays: 0,
    players: setup.roster ? setup.roster.map(player => ({
      ...makePlayer(player.name, player.position, teamName),
      recentStats: player.recentStats,
    })) : [
      makePlayer(setup.qb, "QB", teamName),
      makePlayer(setup.rb, "RB", teamName),
      makePlayer(setup.wr1, "WR", teamName),
      makePlayer(setup.wr2, "WR", teamName),
      makePlayer(setup.wr3?.trim() || "WR3", "WR", teamName),
      makePlayer(setup.te, "TE", teamName),
    ],
    drives: [],
  };
}

function receiverFor(
  team: TeamSimulation,
  random: Random,
  redZone: boolean,
): PlayerAccumulator {
  const receivers = team.players.filter(player => ["RB", "WR", "TE"].includes(player.position));
  let wrIndex = 0, rbIndex = 0, teIndex = 0;
  const fallback = receivers.map(player => player.position === "WR"
    ? ([7, 5, 3][wrIndex++] ?? 1)
    : player.position === "RB" ? (rbIndex++ === 0 ? 4 : 1)
      : (teIndex++ === 0 ? 4 : 1));
  const weighted = receivers.map((player, index) => {
    const playerStats = recentForPlayer(team, player);
    const recentTargetWeight = supplied(playerStats?.targets)
      ? blend(fallback[index]!, playerStats.targets, historyReliability(team.setup))
      : fallback[index]!;
    const redZoneBoost =
      redZone && supplied(playerStats?.receivingTD)
        ? 1 + clamp(playerStats.receivingTD * 0.035, 0, 0.16)
        : 1;
    return recentTargetWeight * redZoneBoost;
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

function runningBackFor(team: TeamSimulation, random: Random): PlayerAccumulator {
  if (team.setup.roster) {
    const runners = team.players.filter((player, index) => index === 0 || player.position === "RB" || (player.recentStats?.rushAttempts ?? 0) > 0);
    let rbIndex = 0;
    const defaults = runners.map(player => player.position === "QB" ? 3 : player.position === "RB" ? (rbIndex++ === 0 ? 20 : 5) : 1);
    let weights = runners.map((player, index) => player.recentStats?.rushAttempts === undefined
      ? defaults[index]!
      : blend(defaults[index]!, player.recentStats.rushAttempts, historyReliability(team.setup)));
    if (weights.every(weight => weight === 0)) weights = defaults;
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
  return random() < clamp(qbShare, 0.025, 0.4) ? qb : rb;
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
  const reliability = historyReliability(setup);
  const defenseReliability = historyReliability(defense);
  const defenseRecent = defense.defenseRecent;
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
      (importance === "must-win" ? 0.012 : importance === "playoff" ? 0.008 : 0),
    0.4,
    0.68,
  );
  const passShare = clamp(
    recentPassingShare === undefined
      ? basePassShare
      : blend(basePassShare, recentPassingShare, 0.42 * reliability),
    0.4,
    0.68,
  );
  const ratingEdge = setup.rushRating - defense.defenseRating;
  const passYardsPerAttempt =
    supplied(qbRecent?.passYards) && supplied(qbRecent?.passAttempts) &&
    qbRecent.passAttempts > 0
      ? qbRecent.passYards / qbRecent.passAttempts
      : undefined;
  const passEfficiencyFactor =
    passYardsPerAttempt === undefined
      ? 1
      : clamp(blend(1, passYardsPerAttempt / 7, 0.42 * reliability), 0.8, 1.22);
  const passDefenseFactor = supplied(defenseRecent?.passYardsAllowed)
    ? clamp(blend(1, defenseRecent.passYardsAllowed / 225, 0.36 * defenseReliability), 0.82, 1.2)
    : 1;
  const rushDefenseFactor = supplied(defenseRecent?.rushYardsAllowed)
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
  const redZonePassShare =
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
      const qbEdge = setup.passRating - defense.defenseRating;

      if (pass) {
        qb.attempts += 1;
        const baselineInterceptionChance = 0.022 - qbEdge * 0.00038;
        const recentInterceptionChance =
          supplied(qbRecent?.interceptions) &&
          supplied(qbRecent?.passAttempts) &&
          qbRecent.passAttempts > 0
            ? qbRecent.interceptions / qbRecent.passAttempts
            : undefined;
        const interceptionChance = clamp(
          (recentInterceptionChance === undefined
            ? baselineInterceptionChance
            : blend(baselineInterceptionChance, recentInterceptionChance, 0.4 * reliability)) +
            (supplied(defenseRecent?.interceptions)
              ? (defenseRecent.interceptions - 0.8) * 0.006
              : 0),
          0.006,
          0.075,
        );
        const baseSackChance = 0.047 + (defense.defenseRating - setup.passRating) * 0.001;
        const sackChance = clamp(supplied(defenseRecent?.sacks)
          ? blend(baseSackChance, defenseRecent.sacks / 35, 0.4 * defenseReliability)
          : baseSackChance, 0.015, 0.13);

        if (random() < interceptionChance) {
          qb.interceptions += 1;
          turnover = true;
          playText = `${qb.name} intercepted — possession changes hands`;
        } else if (random() < sackChance) {
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
              0.3 * reliability,
            );
          }
          if (yardsToGoal <= 15 && supplied(defenseRecent?.passTDAllowed)) {
            completionChance += (defenseRecent.passTDAllowed - 1.4) * 0.025;
          }
          if (random() >= completionChance) {
            playText = `${qb.name} pass incomplete`;
          } else {
            const receiverEfficiency =
              supplied(receiverRecent?.receivingYards) &&
              supplied(receiverRecent?.receptions) &&
              receiverRecent.receptions > 0
                ? clamp(
                    blend(1, receiverRecent.receivingYards / receiverRecent.receptions / 12, 0.4 * reliability),
                    0.65,
                    1.4,
                  )
                : 1;
            gain = Math.min(
              yardsToGoal,
              Math.max(1, Math.round(weightedPassYards(random) * passEfficiencyFactor * passDefenseFactor * receiverEfficiency)),
            );
            const fumbled = random() < clamp(
              0.009 + precipitation * 0.035 +
                (supplied(defenseRecent?.fumblesForced)
                  ? (defenseRecent.fumblesForced - 0.7) * 0.004
                  : 0),
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
        const runner = runningBackFor(team, random);
        const runnerRecent = recentForPlayer(team, runner);
        const runnerEfficiency =
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
        const fumbled = random() < clamp(
          0.012 + precipitation * 0.045 +
            (supplied(defenseRecent?.fumblesForced)
              ? (defenseRecent.fumblesForced - 0.7) * 0.004
              : 0),
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
  const targetAwayPlays = integerBetween(random, 62, 68);
  const targetHomePlays = integerBetween(random, 62, 68);
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
    const { attempts: _attempts, completions: _completions, recentStats: _recentStats, ...projection } = player;
    return { ...projection, draftKings: calculateDraftKings({
      passYards: player.passYards, passTD: player.passTD, interceptions: player.interceptions,
      rushYards: player.rushYards, rushTD: player.rushTD, receptions: player.receptions,
      receivingYards: player.receivingYards, receivingTD: player.receivingTD, fumblesLost: player.fumblesLost,
    }) };
  });

  return {
    seed,
    awayScore: away.score,
    homeScore: home.score,
    totalPlays: { away: away.plays, home: home.plays },
    overview: makeOverview(input, away, home),
    drives: mergedDrives,
    players,
  };
}