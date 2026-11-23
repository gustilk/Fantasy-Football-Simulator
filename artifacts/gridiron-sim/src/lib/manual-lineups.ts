import { TEAM_CODES, type SalaryPlayer } from './lineups';

export interface ManualPick { selected: boolean; points: string }
export type ManualPicks = Record<string, ManualPick>;
export interface ManualSalaryCandidate extends SalaryPlayer { gameId: string; kickoff: string }
export interface ManualSalaryLineup { players: ManualSalaryCandidate[]; salary: number }
export const MANUAL_LINEUP_COUNT = 150;
export const MANUAL_PICKS_KEY = 'gridiron-manual-picks-v1';
const eastern = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false,
});
const code = (value: string) => ({ JAC: 'JAX', LA: 'LAR', WSH: 'WAS' }[value.toUpperCase()] ?? value.toUpperCase());

/** A contest fingerprint includes IDs, matchup dates, salaries and eligibility—not filenames. */
export function manualContestSignature(players: SalaryPlayer[]): string {
  return JSON.stringify([...players].sort((a, b) => a.id.localeCompare(b.id))
    .map(p => [p.id, p.name, p.team, p.position, p.salary, p.rosterPosition, p.gameInfo]));
}

/** Read the official CSV's Eastern kickoff; never invent a matchup or use today's date. */
export function manualSalaryGame(player: SalaryPlayer): { gameId: string; kickoff: string } {
  const match = player.gameInfo.trim().match(/^([A-Z]{2,4})@([A-Z]{2,4})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+(ET|EST|EDT)$/i);
  if (!match) throw new Error(`${player.name}: the salary file has no valid matchup and Eastern kickoff.`);
  const [, away, home, month, day, year, hours, minutes, period, zone] = match;
  const hour12 = Number(hours), minute = Number(minutes);
  const a = code(away!), h = code(home!);
  if (!TEAM_CODES[a] || !TEAM_CODES[h] || a === h || ![a, h].includes(player.team)
    || hour12 < 1 || hour12 > 12 || minute > 59) throw new Error(`${player.name}: invalid salary-file matchup.`);
  const hour = hour12 % 12 + (period!.toUpperCase() === 'PM' ? 12 : 0);
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute);
  const offsets = zone!.toUpperCase() === 'EST' ? [5] : zone!.toUpperCase() === 'EDT' ? [4] : [4, 5];
  for (const offset of offsets) {
    const instant = wall + offset * 3600000;
    const parts = eastern.formatToParts(new Date(instant));
    const part = (key: string) => Number(parts.find(p => p.type === key)?.value);
    if (part('year') === Number(year) && part('month') === Number(month) && part('day') === Number(day)
      && part('hour') % 24 === hour && part('minute') === minute) {
      const kickoff = new Date(instant).toISOString();
      return { gameId: `${a}@${h}:${kickoff}`, kickoff };
    }
  }
  throw new Error(`${player.name}: invalid or ambiguous Eastern kickoff in the salary file.`);
}

export function buildManualLineupPool(salaries: SalaryPlayer[], picks: ManualPicks, now = Date.now()): ManualSalaryCandidate[] {
  const selected = salaries.filter(p => picks[p.id]?.selected);
  if (!selected.length) throw new Error('Select players from the imported DraftKings salary list first.');
  return selected.map(player => {
    if (player.position === 'K' || player.rosterPosition.toUpperCase().includes('CPT')) throw new Error('Use NFL Classic salaries, not Captain/Showdown salaries.');
    const game = manualSalaryGame(player);
    if (Date.parse(game.kickoff) <= now) throw new Error(`${player.name}: kickoff has passed. This section creates pregame lineups only.`);
    return { ...player, ...game };
  });
}

interface StoredManualPicks { version: 1; signature: string; picks: ManualPicks }
export function readManualPicks(storage: Pick<Storage, 'getItem'>, signature: string): ManualPicks {
  const raw = storage.getItem(MANUAL_PICKS_KEY);
  if (!raw) return {};
  let parsed: StoredManualPicks;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Your manual picks could not be read. Existing storage is unchanged.'); }
  if (!parsed || parsed.version !== 1 || typeof parsed.signature !== 'string' || !parsed.picks
    || typeof parsed.picks !== 'object' || Array.isArray(parsed.picks)
    || Object.values(parsed.picks).some(p => !p || typeof p.selected !== 'boolean' || typeof p.points !== 'string')) {
    throw new Error('Your manual picks could not be read. Existing storage is unchanged.');
  }
  // A different slate must never inherit another contest's numbers or selected players.
  return parsed.signature === signature ? parsed.picks : {};
}
export function saveManualPicks(storage: Pick<Storage, 'setItem'>, signature: string, picks: ManualPicks) {
  storage.setItem(MANUAL_PICKS_KEY, JSON.stringify({ version: 1, signature, picks }));
}
