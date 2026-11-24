import type { DKSlate, DKGameForecast } from './draftkings-board';
import type { TeamSeasonRecord } from '@workspace/api-client-react';
import { lineupEligibility } from './availability';
import { simulateEnsemble } from './ensemble';
import { DST_MODEL_WARNING } from './draftkings-defense';

export type LineupPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';
export type LineupFormat = 'classic' | 'showdown';
export interface SalaryPlayer { id: string; name: string; position: LineupPosition; team: string; salary: number; gameInfo: string; rosterPosition: string }
export interface LineupPlayer extends SalaryPlayer { mean: number; gameId: string; kickoff: string; projectionSource: string }
export interface Lineup {
  players: LineupPlayer[]; salary: number; points: number;
  format?: LineupFormat;
  tournament?: { p10: number; p90: number; simulatedMean: number; chance220: number; targetScore?: number; chanceTarget?: number; scenarios: number; candidates: number; stackNames: string[] };
}
const POSITIONS: LineupPosition[] = ['QB', 'RB', 'WR', 'TE', 'DST'];
export const TEAM_CODES: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};
const aliases: Record<string, string> = { JAC: 'JAX', LA: 'LAR', WSH: 'WAS' };
const teamCode = (code: string) => aliases[code.toUpperCase()] ?? code.toUpperCase();
export const playerNameKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

/** RFC-style CSV quoting, including BOM, CRLF, escaped quotes and embedded newlines. */
function csvRows(text: string): string[][] {
  if (text.length > 2_000_000) throw new Error('Salary CSV is too large (maximum 2 MB).');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  for (const char of text.replace(/^\uFEFF/, '') + '\n') {
    if (quoted) {
      if (char === '"') { quoted = false; closed = true; } else cell += char;
    } else if (char === '"' && closed) { cell += '"'; quoted = true; closed = false; }
    else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (char === ',' || char === '\n') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (char === '\n') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (char !== '\r') {
      if (char === '"') throw new Error('Malformed CSV quoting.');
      if (closed && char.trim()) throw new Error('Malformed CSV quoting.');
      cell += char;
    }
  }
  if (quoted) throw new Error('Salary CSV has an unclosed quoted field.');
  return rows;
}

export function parseSalaryCsv(text: string, format: LineupFormat = 'classic'): SalaryPlayer[] {
  const rows = csvRows(text);
  const header = rows.shift()?.map(h => h.toLowerCase().replace(/\s+/g, '')) ?? [];
  const index = (name: string) => header.indexOf(name);
  for (const column of ['name', 'position', 'salary', 'gameinfo', 'teamabbrev']) {
    if (index(column) < 0) throw new Error(`Missing DraftKings column: ${column}. Upload an NFL Classic salary CSV.`);
  }
  if (index('id') < 0 && index('name+id') < 0) throw new Error('DraftKings player IDs are required for matching and lineup export.');
  if (!rows.length || rows.length > 1500) throw new Error('Upload a salary file containing 1–1500 player rows.');
  const ids = new Set<string>(), identities = new Set<string>();
  const players = rows.map((row, i) => {
    const get = (key: string) => row[index(key)] ?? '';
    const position = get('position') as LineupPosition;
    const rosterPosition = get('rosterposition') || position;
    if (format === 'classic' && rosterPosition.toUpperCase().includes('CPT')) throw new Error('This is a Captain/Showdown file. Use Game Simulator → DraftKings Captain lineups.');
    const id = get('id') || get('name+id').match(/\((\d+)\)\s*$/)?.[1] || '';
    const team = teamCode(get('teamabbrev'));
    const name = get('name'), salary = Number(get('salary'));
    if (!/^\d+$/.test(id) || !name || !(format === 'showdown' ? [...POSITIONS, 'K'] : POSITIONS).includes(position) || !TEAM_CODES[team]
      || !/^\d+$/.test(get('salary')) || !Number.isSafeInteger(salary) || salary < 1 || salary > 50000) {
      throw new Error(`Invalid player, position, ID, team or salary on CSV row ${i + 2}.`);
    }
    if (format === 'showdown' ? !['CPT', 'FLEX'].includes(rosterPosition) : !rosterPosition.split('/').includes(position)) {
      throw new Error(`Invalid roster eligibility on CSV row ${i + 2}. ${format === 'showdown' ? 'Upload the full Showdown CSV with separate CPT and FLEX rows and IDs.' : ''}`);
    }
    const identity = `${team}:${playerNameKey(name)}${format === 'showdown' ? `:${rosterPosition}` : ''}`;
    if (ids.has(id) || identities.has(identity)) throw new Error(`Duplicate player on CSV row ${i + 2}: ${name}.`);
    ids.add(id); identities.add(identity);
    return { id, name, position, team, salary, gameInfo: get('gameinfo'), rosterPosition };
  });
  if (format === 'showdown') {
    if (new Set(players.map(p => p.team)).size !== 2 || new Set(players.map(p => p.gameInfo.trim().replace(/\s+/g, ' ').toUpperCase())).size !== 1 || !players[0]?.gameInfo.trim()) {
      throw new Error('Showdown salaries must cover exactly one confirmed matchup and both teams.');
    }
    for (const flex of players.filter(p => p.rosterPosition === 'FLEX')) {
      const captain = players.find(p => p.rosterPosition === 'CPT' && p.team === flex.team && playerNameKey(p.name) === playerNameKey(flex.name));
      if (!captain || captain.position !== flex.position || captain.salary !== flex.salary * 1.5) {
        throw new Error(`Missing or inconsistent Captain row for ${flex.name}. Upload the complete contest CSV; Captain salary must be 1.5× FLEX.`);
      }
    }
    if (players.filter(p => p.rosterPosition === 'FLEX').length !== players.filter(p => p.rosterPosition === 'CPT').length) throw new Error('Every Captain must have a matching FLEX row.');
  }
  return players;
}

const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
export function matchesGameInfo(player: SalaryPlayer, game: DKGameForecast): boolean {
  const match = player.gameInfo.match(/^([A-Z]{2,4})@([A-Z]{2,4})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+(?:ET|EST|EDT)$/i);
  if (!match || TEAM_CODES[teamCode(match[1]!)] !== game.awayTeam || TEAM_CODES[teamCode(match[2]!)] !== game.homeTeam) return false;
  if (![match[1], match[2]].some(team => teamCode(team!) === player.team)) return false;
  if (!Number.isFinite(Date.parse(game.kickoff))) return false;
  const parts = eastern.formatToParts(new Date(game.kickoff));
  const part = (key: string) => parts.find(p => p.type === key)?.value;
  return Number(part('month')) === Number(match[3]) && Number(part('day')) === Number(match[4])
    && Number(part('year')) === Number(match[5]) && Number(part('hour')) === Number(match[6])
    && Number(part('minute')) === Number(match[7]) && part('dayPeriod') === match[8]!.toUpperCase();
}
const legacyDefenseCache = new WeakMap<DKGameForecast, NonNullable<DKGameForecast['defenses']>>();
export function defenseForecasts(game: DKGameForecast) {
  if (game.defenses) return game.defenses;
  const cached = legacyDefenseCache.get(game);
  if (cached) return cached;
  // Replay frozen inputs/seeds, not today's rosters; never rewrite historical offensive forecasts.
  const defenses = simulateEnsemble({ ...game.input, seed: game.seed }, game.runs).ensemble!.defenseFantasy!;
  legacyDefenseCache.set(game, defenses);
  return defenses;
}

export function buildLineupPool(salaries: SalaryPlayer[], slate: DKSlate, teams?: TeamSeasonRecord[], now = Date.now()) {
  const players: LineupPlayer[] = [], issues: { player: SalaryPlayer; reason: string }[] = [];
  const warnings = [DST_MODEL_WARNING, 'Projections are estimates, not guaranteed winnings. Salaries and eligibility come only from this imported contest file.'];
  if (slate.failures.length) warnings.push('This forecast slate is incomplete. Players from failed games cannot be optimized without projections.');
  for (const player of salaries) {
    const games = slate.forecasts.filter(game => matchesGameInfo(player, game));
    let reason = '';
    if (games.length !== 1) reason = 'No unique forecast matching this contest matchup, date and kickoff. Choose the correct salary file and forecast slate.';
    const game = games[0];
    if (game && Date.parse(game.kickoff) <= now) reason = 'Game has started. This builder creates pregame lineups only, not late swaps.';
    let mean: number | undefined, projectionSource = 'Saved offensive ensemble';
    if (game && !reason) {
      if (player.position === 'DST') {
        try {
          const defenses = defenseForecasts(game).filter(d => d.team === TEAM_CODES[player.team]);
          if (defenses.length === 1) mean = defenses[0]!.mean;
          projectionSource = game.defenses ? 'Saved DST ensemble' : 'DST replay of frozen forecast inputs';
        } catch { reason = 'DST could not be computed from this forecast. Run and save a new forecast slate.'; }
      } else {
        const matches = game.players.filter(p => p.team === TEAM_CODES[player.team] && p.position === player.position && playerNameKey(p.name) === playerNameKey(player.name));
        if (matches.length === 1) {
          mean = matches[0]!.mean;
          const currentTeam = teams?.find(t => t.team === TEAM_CODES[player.team] && t.season === slate.season);
          const currentPlayer = currentTeam?.players.find(p => p.id === matches[0]!.playerId);
          if (teams) {
            const eligibility = currentPlayer ? lineupEligibility(currentPlayer, game.week) : undefined;
            if (!currentPlayer) reason = 'Excluded by the current saved roster or weekly availability. Rerun projections after roster changes.';
            else if (!eligibility!.eligible) reason = `Excluded: ${eligibility!.reason} Rerun projections after roster changes.`;
          }
        }
      }
      if (!reason && !Number.isFinite(mean)) reason = 'No unique eligible player projection. This row is not treated as zero points.';
    }
    if (reason || !game || mean === undefined) issues.push({ player, reason });
    else players.push({ ...player, mean, gameId: game.gameId, kickoff: game.kickoff, projectionSource });
  }
  return { players, issues, warnings };
}

type LineupSlotPlayer = Pick<LineupPlayer, 'id' | 'name' | 'position' | 'team' | 'salary' | 'gameId' | 'kickoff' | 'rosterPosition'>;
type LineupRoster<T extends LineupSlotPlayer> = { players: T[]; salary: number; format?: LineupFormat };
export function lineupSlots<T extends LineupSlotPlayer>(lineup: LineupRoster<T>): { slot: string; player: T }[] {
  if (lineup.format === 'showdown') {
    const captain = lineup.players.filter(p => p.rosterPosition === 'CPT');
    const flex = lineup.players.filter(p => p.rosterPosition === 'FLEX');
    if (captain.length !== 1 || flex.length !== 5 || lineup.players.length !== 6 ||
      new Set(lineup.players.map(p => `${p.team}:${playerNameKey(p.name)}`)).size !== 6 ||
      new Set(lineup.players.map(p => p.team)).size !== 2 || new Set(lineup.players.map(p => p.gameId)).size !== 1 ||
      lineup.salary !== lineup.players.reduce((n, p) => n + p.salary, 0) || lineup.salary > 50000) throw new Error('Invalid NFL Showdown lineup.');
    return [{ slot: 'CPT', player: captain[0]! }, ...flex.map(player => ({ slot: 'FLEX', player }))];
  }
  const used = new Set<string>(), slots: { slot: string; player: T }[] = [];
  for (const slot of ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE']) {
    const player = lineup.players.find(p => p.position === slot && !used.has(p.id));
    if (!player) throw new Error('Invalid lineup roster slots.');
    used.add(player.id); slots.push({ slot, player });
  }
  const flex = lineup.players.find(p => ['RB', 'WR', 'TE'].includes(p.position) && !used.has(p.id));
  const defense = lineup.players.find(p => p.position === 'DST');
  if (!flex || !defense || lineup.players.length !== 9 || new Set(lineup.players.map(p => p.id)).size !== 9
    || lineup.salary !== lineup.players.reduce((n, p) => n + p.salary, 0)
    || lineup.salary > 50000 || new Set(lineup.players.map(p => p.gameId)).size < 2) throw new Error('Invalid NFL Classic lineup.');
  return [...slots, { slot: 'FLEX', player: flex }, { slot: 'DST', player: defense }];
}
export function exportLineups<T extends LineupSlotPlayer>(lineups: LineupRoster<T>[]): string {
  if (!lineups.length || lineups.some(l => (l.format ?? 'classic') !== (lineups[0]!.format ?? 'classic'))) throw new Error('Export one contest format at a time.');
  if (lineups.some(lineup => lineup.players.some(p => Date.parse(p.kickoff) <= Date.now() || !Number.isFinite(Date.parse(p.kickoff))))) {
    throw new Error('A game has started. Generate a new pregame lineup; late swaps are not supported.');
  }
  return (lineups[0]!.format === 'showdown' ? 'CPT,FLEX,FLEX,FLEX,FLEX,FLEX' : 'QB,RB,RB,WR,WR,WR,TE,FLEX,DST') + '\r\n' + lineups.map(lineup => lineupSlots(lineup).map(({ player }) => player.id).join(',')).join('\r\n') + '\r\n';
}