import { csvRows, sourceText } from './featured-classic.ts';

export type CaptainMatchup = { season: number; awayTeam: string; homeTeam: string; kickoff: string };
type CaptainGroup = {
  DraftGroupId: number; Sport: string; GameTypeId: number; GameCount: number;
  StartDate: string; DraftGroupTag: string; GameSetKey: string;
  awayAbbrev: string; homeAbbrev: string;
};
type Competition = {
  Sport: string; Status: string; StartDate: string; Description: string;
  AwayTeamCity: string; AwayTeamName: string; HomeTeamCity: string; HomeTeamName: string;
};
export class CaptainUnavailable extends Error {}

export function validateCaptainMatchup(matchup: CaptainMatchup, now = Date.now()) {
  const kickoff = new Date(matchup.kickoff);
  const season = kickoff.getUTCFullYear() - (kickoff.getUTCMonth() < 2 ? 1 : 0);
  if (!Number.isInteger(matchup.season) || matchup.season < 2000 || matchup.season > 2100
    || !Number.isFinite(kickoff.getTime()) || kickoff.getTime() <= now || season !== matchup.season
    || !matchup.awayTeam.trim() || !matchup.homeTeam.trim() || matchup.awayTeam === matchup.homeTeam
    || matchup.awayTeam.length > 80 || matchup.homeTeam.length > 80) {
    throw new Error('Select an upcoming NFL matchup with a confirmed kickoff in this season.');
  }
}

export function selectCaptainGroup(lobby: unknown, matchup: CaptainMatchup, now = Date.now()): CaptainGroup {
  validateCaptainMatchup(matchup, now);
  const data = lobby as {
    SelectedSport?: string; DraftGroups?: CaptainGroup[];
    GameSets?: { GameSetKey: string; Competitions: Competition[] }[];
  } | null;
  if (data?.SelectedSport !== 'NFL' || !Array.isArray(data.DraftGroups) || !Array.isArray(data.GameSets)) {
    throw new Error('DraftKings returned an invalid NFL lobby.');
  }
  const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  const candidates: CaptainGroup[] = [];
  for (const group of data.DraftGroups) {
    // 96 is full-game Showdown Captain. Never accept Madden, partial-game, or other single-game formats.
    if (group.Sport !== 'NFL' || group.GameTypeId !== 96 || group.GameCount !== 1
      || !Number.isSafeInteger(group.DraftGroupId) || group.DraftGroupId <= 0
      || Date.parse(group.StartDate) !== Date.parse(matchup.kickoff)) continue;
    const games = data.GameSets.find(s => s.GameSetKey === group.GameSetKey)?.Competitions;
    if (!Array.isArray(games) || games.length !== 1) continue;
    const game = games[0]!;
    const abbreviations = game.Description?.match(/^([A-Z]{2,4})\s*@\s*([A-Z]{2,4})$/);
    if (game.Sport !== 'NFL' || game.Status !== 'Pre-Game' || !abbreviations
      || Date.parse(game.StartDate) !== Date.parse(matchup.kickoff)
      || normalize(`${game.AwayTeamCity} ${game.AwayTeamName}`) !== normalize(matchup.awayTeam)
      || normalize(`${game.HomeTeamCity} ${game.HomeTeamName}`) !== normalize(matchup.homeTeam)) continue;
    candidates.push({ ...group, awayAbbrev: abbreviations[1]!, homeAbbrev: abbreviations[2]! });
  }
  candidates.sort((a, b) => Number(b.DraftGroupTag === 'Featured') - Number(a.DraftGroupTag === 'Featured')
    || a.DraftGroupId - b.DraftGroupId);
  if (!candidates[0]) {
    throw new CaptainUnavailable(`DraftKings has not published an upcoming full-game Captain slate for ${matchup.awayTeam} at ${matchup.homeTeam} at this kickoff. No other matchup was substituted. You can still upload the official contest CSV manually.`);
  }
  return candidates[0];
}

export function validateCaptainCsv(csv: string, group: CaptainGroup) {
  if (!csv || csv.length > 2_000_000) throw new Error('DraftKings returned an invalid salary CSV size.');
  const rows = csvRows(csv);
  const header = rows.shift() ?? [];
  for (const column of ['Position', 'Name', 'ID', 'Salary', 'Roster Position', 'Game Info', 'TeamAbbrev']) {
    if (!header.includes(column)) throw new Error(`DraftKings salary CSV is missing ${column}.`);
  }
  if (!rows.length || rows.length > 1500 || new Set(header).size !== header.length) {
    throw new Error('DraftKings returned invalid Captain salary rows.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(group.StartDate));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
  const info = `${group.awayAbbrev}@${group.homeAbbrev} ${part('month')}/${part('day')}/${part('year')} ${part('hour')}:${part('minute')}${part('dayPeriod')} ET`;
  const get = (row: string[], key: string) => row[header.indexOf(key)] ?? '';
  const ids = new Set<string>(), teams = new Set<string>();
  const pairs = new Map<string, Map<string, { salary: number; position: string }>>();
  for (const row of rows) {
    const id = get(row, 'ID'), name = get(row, 'Name'), team = get(row, 'TeamAbbrev');
    const role = get(row, 'Roster Position'), position = get(row, 'Position'), salary = get(row, 'Salary');
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(position) || !['CPT', 'FLEX'].includes(role)
      || !/^\d+$/.test(id) || ids.has(id) || !name || !/^\d+$/.test(salary)
      || Number(salary) < 1 || Number(salary) > 50000 || get(row, 'Game Info') !== info
      || ![group.awayAbbrev, group.homeAbbrev].includes(team)) {
      throw new Error('DraftKings Captain salaries do not match the selected matchup and kickoff.');
    }
    ids.add(id); teams.add(team);
    const identity = `${team}:${name.toLowerCase().trim()}`;
    const pair = pairs.get(identity) ?? new Map();
    if (pair.has(role)) throw new Error('DraftKings returned duplicate Captain player rows.');
    pair.set(role, { salary: Number(salary), position }); pairs.set(identity, pair);
  }
  if (teams.size !== 2 || pairs.size < 6) throw new Error('Captain salaries must include both teams and at least six players.');
  for (const pair of pairs.values()) {
    const flex = pair.get('FLEX'), captain = pair.get('CPT');
    if (!flex || !captain || captain.salary !== flex.salary * 1.5 || captain.position !== flex.position) {
      throw new Error('Captain salaries require separate CPT/FLEX IDs with matching positions and 1.5× Captain salaries.');
    }
  }
}

export async function fetchCaptainSalaries(matchup: CaptainMatchup) {
  const lobby = JSON.parse(await sourceText('https://www.draftkings.com/lobby/getcontests?sport=NFL', 'lobby'));
  const group = selectCaptainGroup(lobby, matchup);
  const sourceUrl = `https://www.draftkings.com/lineup/getavailableplayerscsv?draftgroupid=${group.DraftGroupId}`;
  const csv = await sourceText(sourceUrl, 'csv');
  validateCaptainCsv(csv, group);
  if (Date.parse(group.StartDate) <= Date.now()) throw new CaptainUnavailable('This game has started. Captain salaries were not imported.');
  return {
    draftGroupId: group.DraftGroupId, startTime: new Date(group.StartDate).toISOString(),
    awayTeam: matchup.awayTeam, homeTeam: matchup.homeTeam,
    filename: `DKSalaries-NFL-Captain-${group.awayAbbrev}-${group.homeAbbrev}-${group.StartDate.slice(0, 10)}-${group.DraftGroupId}.csv`,
    csv, sourceUrl,
  };
}
