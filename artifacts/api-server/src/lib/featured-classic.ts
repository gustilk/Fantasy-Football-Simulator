type DraftGroup = {
  DraftGroupId: number; Sport: string; GameTypeId: number;
  DraftGroupTag: string; StartDate: string; GameCount: number;
};
export class FeaturedClassicUnavailable extends Error {}

export function selectFeaturedClassic(lobby: unknown, season: number, now = Date.now()): DraftGroup {
  const data = lobby as { SelectedSport?: string; DraftGroups?: DraftGroup[] } | null;
  if (data?.SelectedSport !== 'NFL' || !Array.isArray(data.DraftGroups)) {
    throw new Error('DraftKings returned an invalid NFL lobby.');
  }
  const groups = data.DraftGroups.filter(g => {
    const start = new Date(g.StartDate);
    const footballSeason = start.getUTCFullYear() - (start.getUTCMonth() < 2 ? 1 : 0);
    return g.Sport === 'NFL' && g.GameTypeId === 1 && g.DraftGroupTag === 'Featured'
      && Number.isSafeInteger(g.DraftGroupId) && g.DraftGroupId > 0
      && Number.isInteger(g.GameCount) && g.GameCount >= 2
      && start.getTime() > now && footballSeason === season;
  }).sort((a, b) => Date.parse(a.StartDate) - Date.parse(b.StartDate));
  if (!groups[0]) throw new FeaturedClassicUnavailable('DraftKings has not published an upcoming Featured NFL Classic slate for this season. You can still upload a contest CSV manually.');
  return groups[0];
}

export function csvRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  for (const char of csv.replace(/^\uFEFF/, '') + '\n') {
    if (quoted) {
      if (char === '"') { quoted = false; closed = true; } else cell += char;
    } else if (char === '"' && closed) { cell += '"'; quoted = true; closed = false; }
    else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (char === ',' || char === '\n') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (char === '\n') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (char !== '\r') {
      if (char === '"' || (closed && char.trim())) throw new Error('DraftKings returned malformed CSV.');
      cell += char;
    }
  }
  if (quoted) throw new Error('DraftKings returned malformed CSV.');
  return rows;
}

export function validateFeaturedCsv(csv: string, group: DraftGroup) {
  if (!csv || csv.length > 2_000_000) throw new Error('DraftKings returned an invalid salary CSV size.');
  const rows = csvRows(csv);
  const header = rows.shift() ?? [];
  for (const column of ['Position', 'Name', 'ID', 'Salary', 'Roster Position', 'Game Info', 'TeamAbbrev']) {
    if (!header.includes(column)) throw new Error(`DraftKings salary CSV is missing ${column}.`);
  }
  if (!rows.length || rows.length > 1500) throw new Error('DraftKings returned an invalid salary row count.');
  const get = (row: string[], key: string) => row[header.indexOf(key)] ?? '';
  const start = new Date(group.StartDate);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(start);
  const games = new Set<string>(), ids = new Set<string>();
  for (const row of rows) {
    const position = get(row, 'Position'), roster = get(row, 'Roster Position');
    const id = get(row, 'ID'), salary = get(row, 'Salary'), info = get(row, 'Game Info');
    const game = info.match(/^([A-Z]{2,4})@([A-Z]{2,4})\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}(AM|PM)\s+ET$/);
    if (!['QB', 'RB', 'WR', 'TE', 'DST'].includes(position)
      || !roster.split('/').includes(position) || roster.includes('CPT')
      || !/^\d+$/.test(id) || ids.has(id) || !/^\d+$/.test(salary)
      || Number(salary) < 1 || Number(salary) > 50000 || !get(row, 'Name')
      || !game || game[3] !== date || ![game[1], game[2]].includes(get(row, 'TeamAbbrev'))) {
      throw new Error('DraftKings salary rows do not match the verified Featured NFL Classic slate.');
    }
    ids.add(id); games.add(info);
  }
  if (games.size !== group.GameCount) throw new Error('DraftKings export game count does not match the featured slate.');
}

export async function sourceText(url: string, kind: 'lobby' | 'csv') {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GridironSim/1.0', Accept: kind === 'csv' ? 'text/csv,application/csv' : 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`DraftKings ${kind} returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!(kind === 'csv' ? /csv/i : /json/i).test(contentType)) {
    throw new Error(`DraftKings did not return a ${kind} response.`);
  }
  const text = await response.text();
  if (text.length > (kind === 'csv' ? 2_000_000 : 8_000_000)) throw new Error('DraftKings response was too large.');
  return text;
}

export async function fetchFeaturedClassic(season: number) {
  const lobby = JSON.parse(await sourceText('https://www.draftkings.com/lobby/getcontests?sport=NFL', 'lobby'));
  const group = selectFeaturedClassic(lobby, season);
  const sourceUrl = `https://www.draftkings.com/lineup/getavailableplayerscsv?draftgroupid=${group.DraftGroupId}`;
  const csv = await sourceText(sourceUrl, 'csv');
  validateFeaturedCsv(csv, group);
  if (Date.parse(group.StartDate) <= Date.now()) throw new FeaturedClassicUnavailable('The featured slate has already started. Refresh to find an upcoming slate.');
  return { draftGroupId: group.DraftGroupId, startTime: new Date(group.StartDate).toISOString(),
    gameCount: group.GameCount, filename: `DKSalaries-NFL-Featured-Classic-${group.StartDate.slice(0, 10)}-${group.DraftGroupId}.csv`,
    csv, sourceUrl };
}
