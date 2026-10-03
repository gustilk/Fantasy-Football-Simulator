import type { NflDepthChart, NflImportPreview, NumericStats, RosterPlayer, TeamWeek } from "@workspace/api-zod";
import { parseDepthChart, depthSource, type SourceDepthChart } from "./nfl-depth-chart";

// Public ESPN site data is not a contracted feed. Reject incomplete/wrong-season
// responses instead of silently substituting an older season or invented zeros.
type Athlete = {
  id: string; displayName: string; position?: { abbreviation?: string; parent?: { abbreviation?: string } };
  status?: { type?: string }; injuries?: { status?: string }[];
};
type Category = { name: string; keys: string[]; totals?: string[]; athletes?: { athlete: Athlete; stats: string[]; didNotPlay?: boolean }[] };
type BoxTeam = { team: { id: string; displayName: string }; statistics: Category[] };
type Competitor = { id: string; homeAway: string; score: string | { value: number }; team: { displayName: string } };
type Event = {
  id: string; date: string; season?: { year: number }; week?: { number: number };
  competitions: { competitors: Competitor[]; status: { type: { completed?: boolean } } }[];
};
type Roster = { season?: { year: number }; team?: { id: string }; athletes?: { position: string; items: Athlete[] }[] };
type Schedule = { season?: { year: number; type: number }; events?: Event[] };
type Summary = {
  header?: { season: { year: number; type: number }; week: number; competitions: Event["competitions"] };
  boxscore?: { players: BoxTeam[] };
};

const API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/";
const sourceCache = new Map<string, { expires: number; value: Promise<unknown> }>();
const previewCache = new Map<string, { expires: number; value: Promise<NflImportPreview> }>();
const TTL = 5 * 60_000;
let pendingPreviews = 0;
export class NflSourceError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

async function json<T>(path: string): Promise<T> {
  const cached = sourceCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.value as Promise<T>;
  const value = (async () => {
    try {
      const response = await fetch(API + path, { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as T;
    } catch {
      sourceCache.delete(path);
      throw new NflSourceError("ESPN data could not be reached. Nothing was saved. Try again shortly.");
    }
  })();
  if (sourceCache.size > 256) {
    for (const [key, entry] of sourceCache) if (entry.expires <= Date.now()) sourceCache.delete(key);
    if (sourceCache.size > 256) sourceCache.delete(sourceCache.keys().next().value!);
  }
  sourceCache.set(path, { expires: Date.now() + TTL, value });
  return value;
}

const number = (value: unknown): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim().replaceAll(",", "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= -1000 && n <= 10000 ? n : undefined;
};
const assign = (row: NumericStats, key: string, raw: unknown) => {
  const n = number(raw);
  if (n !== undefined && (n >= 0 || /yards/i.test(key))) row[key] = n;
};
const pair = (row: NumericStats, a: string, b: string, raw: string | undefined) => {
  const parts = raw?.split("/");
  if (parts?.length === 2) { assign(row, a, parts[0]); assign(row, b, parts[1]); }
};
const positions: Record<string, RosterPlayer["position"]> = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", PK: "K", K: "K",
  C: "OL", G: "OL", OG: "OL", OT: "OL", T: "OL", LS: "OL",
  DE: "EDGE", DT: "DL", NT: "DL", DL: "DL", LB: "LB", ILB: "LB", OLB: "LB", MLB: "LB",
  CB: "CB", DB: "CB", S: "S", FS: "S", SS: "S",
};
const defensive = new Set(["EDGE", "DL", "LB", "CB", "S"]);
const commonKeys: Record<string, string> = {
  passingYards: "passYards", passingTouchdowns: "passTD", rushingAttempts: "rushAttempts",
  rushingYards: "rushYards", rushingTouchdowns: "rushTD", receptions: "receptions",
  receivingYards: "receivingYards", receivingTouchdowns: "receivingTD", receivingTargets: "targets",
  fumbles: "fumbles", fumblesLost: "fumblesLost", fumblesRecovered: "fumblesRecovered",
  soloTackles: "soloTackles", sacks: "sacks", tacklesForLoss: "tacklesForLoss",
  passesDefended: "passesDefended", QBHits: "qbHits", defensiveTouchdowns: "defensiveTD",
  interceptionYards: "interceptionYards", interceptionTouchdowns: "interceptionTD",
  kickReturns: "kickReturns", kickReturnYards: "kickReturnYards", kickReturnTouchdowns: "kickReturnTD",
  puntReturns: "puntReturns", puntReturnYards: "puntReturnYards", puntReturnTouchdowns: "puntReturnTD",
  punts: "punts", puntYards: "puntYards", touchbacks: "touchbacks", puntsInside20: "puntsInside20",
};

export function parseStatLine(category: Category, values: string[], side: RosterPlayer["side"]): NumericStats {
  const row: NumericStats = {};
  for (let i = 0; i < category.keys.length; i++) {
    const key = category.keys[i]!;
    const raw = values[i];
    if (key === "completions/passingAttempts") pair(row, "passCompletions", "passAttempts", raw);
    else if (key === "fieldGoalsMade/fieldGoalAttempts") pair(row, "fieldGoalsMade", "fieldGoalAttempts", raw);
    else if (key === "extraPointsMade/extraPointAttempts") pair(row, "extraPointsMade", "extraPointAttempts", raw);
    else if (key === "interceptions") {
      assign(row, category.name === "passing" || side === "defense" ? "interceptions" : "defensiveInterceptions", raw);
    } else if (commonKeys[key]) assign(row, commonKeys[key]!, raw);
  }
  const total = number(values[category.keys.indexOf("totalTackles")]);
  if (total !== undefined && row.soloTackles !== undefined && total >= row.soloTackles) row.assistedTackles = total - row.soloTackles;
  return row;
}

const score = (c: Competitor) => {
  const n = number(typeof c.score === "object" ? c.score.value : c.score);
  if (n === undefined || n < 0 || n > 100) throw new NflSourceError("ESPN returned an incomplete final score. Nothing was saved.");
  return n;
};

export async function getNflDepthChart(season: number, team: string): Promise<NflDepthChart> {
  const list = await json<{ sports: { leagues: { teams: { team: { id: string; displayName: string; abbreviation: string } }[] }[] }[] }>("teams?limit=32");
  const sourceTeam = list.sports?.[0]?.leagues?.[0]?.teams?.find(t => t.team.displayName === team)?.team;
  if (!sourceTeam) throw new NflSourceError("Choose one of the 32 NFL teams.", 400);
  const raw = await json<SourceDepthChart>(`teams/${sourceTeam.id}/depthcharts?season=${season}`);
  try {
    return depthSource(season, team, parseDepthChart(raw, season, sourceTeam.id), `https://www.espn.com/nfl/team/depth/_/name/${sourceTeam.abbreviation.toLowerCase()}`);
  } catch {
    throw new NflSourceError("ESPN has no matching offensive depth chart for this season. Set depth roles manually in Team Library; no different season was substituted.");
  }
}

async function buildPreview(season: number, team: string): Promise<NflImportPreview> {
  const list = await json<{ sports: { leagues: { teams: { team: { id: string; displayName: string; abbreviation: string } }[] }[] }[] }>("teams?limit=32");
  const sourceTeam = list.sports?.[0]?.leagues?.[0]?.teams?.find(t => t.team.displayName === team)?.team;
  if (!sourceTeam) throw new NflSourceError("Choose one of the 32 NFL teams.", 400);
  const [roster, schedule] = await Promise.all([
    json<Roster>(`teams/${sourceTeam.id}/roster?season=${season}`),
    json<Schedule>(`teams/${sourceTeam.id}/schedule?season=${season}&seasontype=2`),
  ]);
  if (roster.season?.year !== season || schedule.season?.year !== season || schedule.season.type !== 2 ||
      roster.team?.id !== sourceTeam.id || !roster.athletes?.length || !Array.isArray(schedule.events)) {
    throw new NflSourceError(`ESPN has not supplied a complete ${season} roster and regular-season schedule for this team. Nothing was saved.`);
  }
  const fetchedAt = new Date();
  const rosterUrl = `https://www.espn.com/nfl/team/roster/_/name/${sourceTeam.abbreviation.toLowerCase()}?season=${season}`;
  const players = new Map<string, RosterPlayer>();
  for (const group of roster.athletes) for (const athlete of group.items) {
    if (!athlete.id || !athlete.displayName) throw new NflSourceError("ESPN returned an incomplete roster. Nothing was saved.");
    const original = athlete.position?.abbreviation ?? "OTHER";
    const position = positions[original] ?? "OTHER";
    const injury = athlete.injuries?.[0]?.status;
    const active = ["offense", "defense", "specialTeam"].includes(group.position) &&
      athlete.status?.type === "active" && !["Out", "Suspended", "Injured Reserve", "Doubtful"].includes(injury ?? "");
    const player: RosterPlayer = {
      id: `espn:${athlete.id}`, name: athlete.displayName, position,
      side: defensive.has(position) || athlete.position?.parent?.abbreviation === "DEF" ? "defense" : "offense",
      active, sourcePosition: original, availability: injury || group.position,
      source: { provider: "ESPN", url: rosterUrl, fetchedAt, athleteId: athlete.id },
    };
    // Some ESPN groups repeat the same athlete; prefer the available roster entry.
    if (!players.has(player.id) || player.active) players.set(player.id, player);
  }
  const events = schedule.events.filter(event => event.season?.year === season &&
    event.competitions?.[0]?.status?.type?.completed === true &&
    Number.isFinite(Date.parse(event.date)) && Date.parse(event.date) <= Date.now() &&
    (event.week?.number ?? 0) >= 1 && (event.week?.number ?? 0) <= 18)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).slice(-3);
  const weeks: TeamWeek[] = [];
  for (const event of events) {
    const game = await json<Summary>(`summary?event=${event.id}`);
    const competition = game.header?.competitions?.[0];
    if (game.header?.season.year !== season || game.header.season.type !== 2 ||
        game.header.week !== event.week!.number || !competition?.status?.type?.completed ||
        !game.boxscore?.players?.length) {
      throw new NflSourceError(`The week ${event.week!.number} box score is not complete. Nothing was saved.`);
    }
    const own = competition.competitors.find(c => c.id === sourceTeam.id);
    const opponent = competition.competitors.find(c => c.id !== sourceTeam.id);
    const box = game.boxscore.players.find(b => b.team.id === sourceTeam.id);
    const otherBox = game.boxscore.players.find(b => b.team.id === opponent?.id);
    if (!own || !opponent || !box || !otherBox || !box.statistics.some(s => s.name === "defensive" && s.athletes?.length)) {
      throw new NflSourceError(`Week ${event.week!.number} is missing offensive or defensive box-score data. Nothing was saved.`);
    }
    const url = `https://www.espn.com/nfl/boxscore/_/gameId/${event.id}`;
    const teamScore = score(own), opponentScore = score(opponent);
    const week: TeamWeek = {
      week: event.week!.number, status: "played", opponent: opponent.team.displayName,
      venue: own.homeAway === "home" ? "home" : "away",
      result: teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L",
      teamScore, opponentScore, playerStats: {}, teamDefense: {},
      source: { provider: "ESPN", url, fetchedAt, eventId: event.id },
    };
    for (const category of box.statistics) for (const item of category.athletes ?? []) {
      if (item.didNotPlay || !item.athlete?.id || !item.athlete.displayName) continue;
      const id = `espn:${item.athlete.id}`;
      if (!players.has(id)) {
        const defense = ["defensive", "interceptions"].includes(category.name);
        const position = category.name === "passing" ? "QB" : category.name === "rushing" ? "RB" : category.name === "receiving" ? "WR" : category.name === "kicking" ? "K" : "OTHER";
        players.set(id, { id, name: item.athlete.displayName, position, side: defense ? "defense" : "offense", active: false,
          availability: "Historical game participant; not on source roster",
          source: { provider: "ESPN", url, fetchedAt, athleteId: item.athlete.id } });
      }
      const stats = parseStatLine(category, item.stats, players.get(id)!.side);
      if (Object.keys(stats).length) week.playerStats[id] = { ...week.playerStats[id], ...stats };
    }
    const total = (b: BoxTeam, category: string, key: string) => {
      const group = b.statistics.find(s => s.name === category);
      return group ? number(group.totals?.[group.keys.indexOf(key)]) : undefined;
    };
    for (const [dest, category, key] of [
      ["passYardsAllowed", "passing", "passingYards"], ["passTDAllowed", "passing", "passingTouchdowns"],
      ["rushYardsAllowed", "rushing", "rushingYards"], ["rushTDAllowed", "rushing", "rushingTouchdowns"],
      ["interceptions", "passing", "interceptions"],
    ]) assign(week.teamDefense, dest!, total(otherBox, category!, key!));
    for (const key of ["sacks", "passesDefended"]) assign(week.teamDefense, key, total(box, "defensive", key));
    weeks.push(week);
  }
  let depthWarning: string | undefined;
  try {
    const depth = await getNflDepthChart(season, team);
    for (const role of depth.roles) {
      const player = players.get(`espn:${role.athleteId}`);
      if (player?.position === role.position) {
        player.depthRank = role.depthRank;
        player.depthSource = depth.source;
      }
    }
  } catch {
    depthWarning = "Depth chart unavailable for the requested season. Saved roles are preserved; set QB/RB/WR/TE ranks manually rather than treating statistics as an official depth chart.";
  }
  return {
    season, team, fetchedAt, rosterUrl, players: [...players.values()], weeks: weeks.sort((a, b) => a.week - b.week),
    warnings: [
      ...(depthWarning ? [depthWarning] : []),
      ...(events.length < 3 ? [`Only ${events.length} completed regular-season games are available for ${season}; no older season was substituted.`] : []),
      "Unknown or unpublished fields remain blank. Box scores do not consistently publish OL blocking metrics, snaps or forced fumbles.",
      "Active follows ESPN roster/injury categories. Reserve, practice-squad and unavailable players retain their history but are inactive. Verify availability before simulating.",
      "ESPN public data is not a guaranteed feed. Imports use a five-minute cache; corrections may appear on a later refresh.",
    ],
  };
}

export async function previewNflTeam(season: number, team: string): Promise<NflImportPreview> {
  const key = `${season}:${team}`;
  const cached = previewCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pendingPreviews >= 4) throw new NflSourceError("Several teams are refreshing. Wait a moment and try again.", 429);
  pendingPreviews++;
  const value = buildPreview(season, team).catch(error => { previewCache.delete(key); throw error; }).finally(() => pendingPreviews--);
  for (const [key, entry] of previewCache) if (entry.expires <= Date.now()) previewCache.delete(key);
  previewCache.set(key, { expires: Date.now() + TTL, value });
  return value;
}