export type Precipitation = "none" | "light" | "moderate" | "heavy";

export interface WeatherSetup {
  temperatureF: number;
  windMph: number;
  precipitation: Precipitation;
}

export interface TeamSetup {
  name: string;
  qb: string;
  rb: string;
  wr1: string;
  wr2: string;
  te: string;
  kicker: string;
  passRating: number;
  rushRating: number;
  defenseRating: number;
  context: string;
}

export interface SimulationInput {
  away: TeamSetup;
  home: TeamSetup;
  weather: WeatherSetup;
  seed?: number;
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
  halfPpr: number;
}

export interface SimulationResult {
  seed: number;
  awayScore: number;
  homeScore: number;
  totalPlays: { away: number; home: number };
  overview: string[];
  drives: SimulatedDrive[];
  players: PlayerProjection[];
}

interface PlayerAccumulator extends Omit<PlayerProjection, "halfPpr"> {
  attempts: number;
  completions: number;
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

function pick<T>(random: Random, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function integerBetween(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
    players: [
      makePlayer(setup.qb, "QB", teamName),
      makePlayer(setup.rb, "RB", teamName),
      makePlayer(setup.wr1, "WR", teamName),
      makePlayer(setup.wr2, "WR", teamName),
      makePlayer(setup.te, "TE", teamName),
    ],
    drives: [],
  };
}

function receiverFor(team: TeamSimulation, random: Random): PlayerAccumulator {
  const [rb, wr1, wr2, te] = team.players.slice(1);
  const roll = random();
  if (roll < 0.22) return rb!;
  if (roll < 0.53) return wr1!;
  if (roll < 0.79) return wr2!;
  return te!;
}

function runningBackFor(team: TeamSimulation, random: Random): PlayerAccumulator {
  const qb = team.players[0]!;
  const rb = team.players[1]!;
  return random() < 0.09 ? qb : rb;
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
): TeamSimulation {
  const team = makeTeamSimulation(setup);
  const qb = team.players[0]!;
  const precipitation = precipImpact[weather.precipitation];
  const windPenalty = clamp(weather.windMph * 0.0018, 0, 0.19);
  const coldPenalty = weather.temperatureF < 28 ? 0.025 : 0;
  const passShare = clamp(
    0.575 +
      (setup.passRating - setup.rushRating) * 0.0022 -
      windPenalty * 0.6 -
      precipitation * 0.75 +
      (isHome ? 0.005 : 0),
    0.4,
    0.68,
  );
  const ratingEdge = setup.rushRating - defense.defenseRating;

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
      driveSnaps += 1;
      const pass = random() < passShare;
      let gain = 0;
      let turnover = false;
      let playText = "";
      let scorer: PlayerAccumulator | undefined;
      const qbEdge = setup.passRating - defense.defenseRating;

      if (pass) {
        qb.attempts += 1;
        const interceptionChance = clamp(0.022 - qbEdge * 0.00038, 0.009, 0.052);
        const sackChance = clamp(0.047 + (defense.defenseRating - setup.passRating) * 0.001, 0.025, 0.085);

        if (random() < interceptionChance) {
          qb.interceptions += 1;
          turnover = true;
          playText = `${qb.name} intercepted — possession changes hands`;
        } else if (random() < sackChance) {
          gain = -integerBetween(random, 3, 9);
          playText = `${qb.name} sacked for ${Math.abs(gain)} yards`;
        } else {
          const completionChance = clamp(
            0.645 +
              qbEdge * 0.0024 +
              (isHome ? 0.012 : 0) -
              windPenalty -
              precipitation * 0.65 -
              coldPenalty,
            0.39,
            0.76,
          );
          if (random() >= completionChance) {
            playText = `${qb.name} pass incomplete`;
          } else {
            const receiver = receiverFor(team, random);
            gain = weightedPassYards(random);
            const fumbled = random() < 0.009 + precipitation * 0.035;
            if (fumbled) {
              receiver.fumblesLost += 1;
              turnover = true;
              playText = `${receiver.name} fumbles after a ${gain}-yard catch — recovered by the defense`;
            } else {
              qb.completions += 1;
              qb.passYards += gain;
              receiver.receptions += 1;
              receiver.receivingYards += gain;
              scorer = receiver;
              playText = `${qb.name} to ${receiver.name} for ${gain} yards`;
            }
          }
        }
      } else {
        const runner = runningBackFor(team, random);
        gain = weightedRushYards(random, ratingEdge);
        const fumbled = random() < 0.012 + precipitation * 0.045;
        if (fumbled) {
          runner.fumblesLost += 1;
          turnover = true;
          playText = `${runner.name} fumbles after a ${Math.max(gain, 0)}-yard run — recovered by the defense`;
        } else {
          runner.rushYards += gain;
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
          const makeChance = clamp(0.96 - Math.max(0, fgDistance - 35) * 0.012, 0.38, 0.96);
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

function calculateHalfPpr(player: PlayerAccumulator): number {
  // Follows the supplied scoring rules: no interception or fumble deductions.
  return Math.round(
    (player.passYards / 25 +
      player.passTD * 4 +
      player.rushYards / 10 +
      player.rushTD * 6 +
      player.receivingYards / 10 +
      player.receivingTD * 6 +
      player.receptions * 0.5) *
      10,
  ) / 10;
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
  ];
  return overview;
}

export function simulateGame(input: SimulationInput): SimulationResult {
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
  );
  const home = simulateTeam(
    input.home,
    input.away,
    input.weather,
    targetHomePlays,
    random,
    true,
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

  const players = [...away.players, ...home.players].map((player) => ({
    ...player,
    halfPpr: calculateHalfPpr(player),
  }));

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