import { NFL_TEAM_NAMES, isDivisionGame } from './nfl-divisions';
import type { TeamSetup, SimulationInput } from './simulator';

export interface StandingEntry {
  team: string;
  record?: { wins: number; losses: number; ties: number };
  needsWin: boolean;
}
export interface StandingsSnapshot {
  season: number;
  /** Records entering this week, never including this week's outcomes. */
  week: number;
  savedAt: string;
  entries: StandingEntry[];
}
export interface StandingContext extends StandingEntry {
  season: number;
  week: number;
  savedAt: string;
}
export const STANDINGS_STORAGE_KEY = 'gridiron-sim-standings-v1';
export const NEEDS_WIN_PASS_ADJUSTMENT = 0.012;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

export function validateStandings(snapshot: StandingsSnapshot): void {
  if (!snapshot || !Number.isInteger(snapshot.season) || snapshot.season < 2002 || snapshot.season > 2100 ||
      !Number.isInteger(snapshot.week) || snapshot.week < 1 || snapshot.week > 18 ||
      typeof snapshot.savedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.savedAt)) || !Array.isArray(snapshot.entries)) {
    throw new Error('Standings need a valid season, week (1–18) and save date.');
  }
  const seen = new Set<string>();
  const maxGames = Math.min(snapshot.week - 1, snapshot.season >= 2021 ? 17 : 16);
  for (const entry of snapshot.entries) {
    if (!entry || !(NFL_TEAM_NAMES as readonly string[]).includes(entry.team) || seen.has(entry.team) ||
        typeof entry.needsWin !== 'boolean') throw new Error('Standings contain an unknown or duplicate team, or an invalid needs-win flag.');
    seen.add(entry.team);
    if (entry.record !== undefined) {
      const { wins, losses, ties } = entry.record;
      if (![wins, losses, ties].every(value => Number.isInteger(value) && value >= 0) ||
          wins + losses + ties > maxGames) {
        throw new Error(`${entry.team}: enter whole, nonnegative wins/losses/ties totaling at most ${maxGames} games before week ${snapshot.week}.`);
      }
    }
  }
}

export function readStandings(storage: Pick<Storage, 'getItem'>): StandingsSnapshot[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(STANDINGS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(data)) throw new Error('Invalid archive.');
    const keys = new Set<string>();
    for (const snapshot of data) {
      validateStandings(snapshot);
      const key = `${snapshot.season}-${snapshot.week}`;
      if (keys.has(key)) throw new Error('Duplicate snapshots.');
      keys.add(key);
    }
    return data;
  } catch {
    throw new Error('Saved standings could not be read. Existing data has not been replaced.');
  }
}

export function findStandings(snapshots: StandingsSnapshot[], season: number, week: number): StandingsSnapshot | undefined {
  return snapshots.find(snapshot => snapshot.season === season && snapshot.week === week);
}

export function saveStandings(storage: StorageAccess, snapshot: StandingsSnapshot): StandingsSnapshot[] {
  validateStandings(snapshot);
  const snapshots = [snapshot, ...readStandings(storage).filter(item => item.season !== snapshot.season || item.week !== snapshot.week)];
  try { storage.setItem(STANDINGS_STORAGE_KEY, JSON.stringify(snapshots)); }
  catch { throw new Error('Could not save standings. Previous saves are unchanged; browser storage is full or unavailable.'); }
  return snapshots;
}

export function deleteStandings(storage: StorageAccess, season: number, week: number): StandingsSnapshot[] {
  const snapshots = readStandings(storage).filter(item => item.season !== season || item.week !== week);
  try { storage.setItem(STANDINGS_STORAGE_KEY, JSON.stringify(snapshots)); }
  catch { throw new Error('Could not remove standings. Previous saves are unchanged.'); }
  return snapshots;
}

export function standingPercentage(entry: StandingEntry): number | null {
  if (!entry.record) return null;
  const { wins, losses, ties } = entry.record;
  const games = wins + losses + ties;
  return games ? (wins + ties / 2) / games : null;
}

/** Exact week only. Never use future records or reuse a stale pressure flag. */
export function applyStandings(team: TeamSetup, snapshot: StandingsSnapshot | undefined, season: number, week: number): TeamSetup {
  if (!snapshot || snapshot.season !== season || snapshot.week !== week) return team;
  validateStandings(snapshot);
  const entry = snapshot.entries.find(entry => entry.team === team.name);
  if (!entry) return team;
  return {
    ...team,
    record: entry.record ? { ...entry.record } : team.record,
    standings: structuredClone({ ...entry, season, week, savedAt: snapshot.savedAt }),
  };
}

/** Strategy assumption only: no efficiency, rating or fantasy-point multiplier. */
export function passingStrategyAdjustment(team: TeamSetup, opponent: TeamSetup, importance: SimulationInput['importance']): number {
  const legacy = importance === 'must-win' ? 0.012 : importance === 'playoff' ? 0.008 : 0;
  const manual = team.standings?.team === team.name && team.standings.needsWin &&
    isDivisionGame(team.name, opponent.name) ? NEEDS_WIN_PASS_ADJUSTMENT : 0;
  // Do not stack two different descriptions of game pressure.
  return Math.max(legacy, manual);
}

export function standingsNotes(away: TeamSetup, home: TeamSetup): string[] {
  return ([ [away, home], [home, away] ] as const).flatMap(([team, opponent]) => {
    const s = team.standings;
    if (!s) return [];
    return [
      `${team.name}: manually entered standings before ${s.season} week ${s.week}, saved ${s.savedAt}. ${s.record ? `Record ${s.record.wins}-${s.record.losses}-${s.record.ties} replaces the history-derived record prior.` : 'Record not entered; history-derived record retained.'}`,
      ...(s.needsWin ? [isDivisionGame(team.name, opponent.name)
        ? `${team.name}: manually marked needs a win in this division game. Baseline passing share increases by up to 1.2 percentage points (not stacked with game importance). This unvalidated strategy assumption is not an efficiency, effort, scoring or fantasy-point boost and does not guarantee a win.`
        : `${team.name}: needs-win mark is inactive against this non-division opponent.`] : []),
    ];
  });
}
