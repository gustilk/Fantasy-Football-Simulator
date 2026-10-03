import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { SimulationInput } from "../../artifacts/gridiron-sim/src/lib/simulator";

export interface ArchiveRef { path: string; sha256: string }
export interface Archive {
  gameId: string;
  kind: "input" | "eligibility" | "quote" | "outcome";
  capturedAt: string;
  sourceUrl: string;
  archiveUrl: string;
  payload: unknown;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object.");
  return value as Record<string, unknown>;
}

export function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Expected a timestamp with timezone.");
  }
  return Date.parse(value);
}

export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty text.");
  return value;
}

export function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected finite number.");
  return value;
}

function url(value: unknown) {
  const parsed = new URL(text(value));
  if (parsed.protocol !== "https:") throw new Error("Evidence URLs must use HTTPS.");
}

/** Only reads hashed local research archives. Never fetches data or writes teams. */
export function readArchive(root: string, ref: unknown, gameId: string, kind: Archive["kind"]): Archive {
  const reference = object(ref);
  const path = text(reference.path);
  if (isAbsolute(path)) throw new Error("Archive paths must be relative.");
  const realRoot = realpathSync(root), fullPath = realpathSync(resolve(root, path));
  const localPath = relative(realRoot, fullPath);
  if (localPath.startsWith("..") || isAbsolute(localPath)) throw new Error("Archive escapes the research directory.");
  const bytes = readFileSync(fullPath);
  if (!/^[a-f0-9]{64}$/.test(text(reference.sha256)) ||
      createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new Error("Archive checksum mismatch.");
  const archive = object(JSON.parse(bytes.toString("utf8")));
  if (archive.kind !== kind || archive.gameId !== gameId) throw new Error("Archive game/kind mismatch.");
  timestamp(archive.capturedAt);
  url(archive.sourceUrl);
  url(archive.archiveUrl);
  object(archive.payload);
  return archive as unknown as Archive;
}

export function requirePregame(archive: Archive, kickoff: number, cutoff?: number) {
  if (timestamp(archive.capturedAt) >= kickoff) throw new Error(`${archive.kind} was not archived before kickoff.`);
  if (cutoff !== undefined && timestamp(archive.capturedAt) > cutoff) throw new Error(`${archive.kind} was captured after input freeze.`);
}

export function playerKey(player: { team: string; name: string; position: string }) {
  return JSON.stringify([player.team, player.name, player.position]);
}

/** Validate the simulator's operational fields before accepting untrusted JSON. */
export function parseInput(value: unknown): SimulationInput {
  const input = object(value);
  if ("market" in input || "seed" in input) throw new Error("Frozen inputs must omit market and seed; evaluation owns them.");
  const numericObject = (value: unknown) => {
    for (const field of Object.values(object(value))) number(field);
  };
  for (const side of ["away", "home"]) {
    const team = object(input[side]);
    for (const field of ["name", "qb", "rb", "wr1", "wr2", "wr3", "te", "kicker"]) text(team[field]);
    if (typeof team.context !== "string") throw new Error("Missing team context.");
    for (const field of ["passRating", "rushRating", "defenseRating"]) {
      const rating = number(team[field]);
      if (rating < 0 || rating > 100) throw new Error("Rating out of range.");
    }
    if (team.recentStats !== undefined) Object.values(object(team.recentStats)).forEach(numericObject);
    if (team.defenseRecent !== undefined) numericObject(team.defenseRecent);
    if (team.record !== undefined) {
      const record = object(team.record);
      for (const field of ["wins", "losses", "ties"]) {
        const count = number(record[field]);
        if (count < 0 || !Number.isInteger(count)) throw new Error("Invalid prior record.");
      }
    }
    if (team.historyGames !== undefined && (number(team.historyGames) < 0 || !Number.isInteger(team.historyGames))) {
      throw new Error("Invalid history count.");
    }
    if (team.roster !== undefined) {
      if (!Array.isArray(team.roster) || !team.roster.length) throw new Error("Invalid roster.");
      const ids = new Set<string>(), keys = new Set<string>();
      for (const value of team.roster) {
        const player = object(value);
        const id = text(player.id), name = text(player.name), position = text(player.position);
        if (!["QB", "RB", "WR", "TE"].includes(position)) throw new Error("Unsupported roster position.");
        const key = playerKey({ team: text(team.name), name, position });
        if (ids.has(id) || keys.has(key)) throw new Error("Duplicate roster identity.");
        ids.add(id); keys.add(key);
        if (player.recentStats !== undefined) numericObject(player.recentStats);
        if (player.depthRank !== undefined && (number(player.depthRank) < 1 || !Number.isInteger(player.depthRank))) {
          throw new Error("Invalid depth rank.");
        }
        if (player.historyObservations !== undefined &&
            (number(player.historyObservations) < 0 || !Number.isInteger(player.historyObservations))) {
          throw new Error("Invalid player history count.");
        }
        if (player.usage !== undefined) {
          const usage = object(player.usage);
          for (const field of ["targetGames", "carryGames"]) {
            const count = number(usage[field]);
            if (!Number.isInteger(count) || count < 0) throw new Error("Invalid usage history count.");
          }
          for (const field of ["targetShare", "carryShare"]) {
            if (usage[field] !== undefined && (number(usage[field]) < 0 || number(usage[field]) > 1)) {
              throw new Error("Invalid reported usage share.");
            }
          }
        }
      }
    }
  }
  if (object(input.away).name === object(input.home).name) throw new Error("Teams must differ.");
  const weather = object(input.weather);
  if (!["none", "light", "moderate", "heavy"].includes(text(weather.precipitation))) throw new Error("Invalid precipitation.");
  number(weather.temperatureF);
  if (number(weather.windMph) < 0) throw new Error("Invalid wind.");
  if (input.importance !== undefined && !["regular", "must-win", "playoff"].includes(text(input.importance))) {
    throw new Error("Invalid importance.");
  }
  // Reject nonfinite supplied numeric values even in optional nested history fields.
  const inspect = (value: unknown) => {
    if (typeof value === "number") number(value);
    else if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === "object") Object.values(value).forEach(inspect);
  };
  inspect(input);
  return input as unknown as SimulationInput;
}