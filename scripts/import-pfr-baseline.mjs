// Reproducible import of the user's 19 public 2025 sources, previously fetched
// into .local/data-imports/pfr-2025. No network, roster edits or database writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const directory = '.local/data-imports/pfr-2025';
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.season, 2025);
function tables(text) {
  let headers, heading = '';
  const result = [];
  for (const line of text.split('\n')) {
    if (/^#{1,3} /.test(line)) { heading = line.replace(/^#+\s*/, ''); headers = undefined; }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.includes('Player') || ((cells.includes('Tm') || cells.includes('Team')) && (cells.includes('G') || cells.includes('W')))) {
      headers = cells; result.push({ heading, headers, rows: [] }); continue;
    }
    if (headers && cells.length === headers.length && !cells.every(cell => /^[-: ]*$/.test(cell))) result.at(-1).rows.push(cells);
  }
  return result;
}
const plain = text => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[\\*+]/g, '').trim();
const num = text => {
  const value = plain(text).replace(/,/g, '').replace(/%$/, '');
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : undefined;
};
const value = (headers, row, key, occurrence = 0) => {
  const indexes = headers.flatMap((name, index) => name === key ? [index] : []);
  return indexes[occurrence] === undefined ? undefined : num(row[indexes[occurrence]]);
};
const teamCode = cell => /\/teams\/([^/]+)\/2025\.htm/.exec(cell)?.[1] ?? plain(cell);
const identity = (headers, row) => {
  const cell = row[headers.indexOf('Player')];
  return { id: /\/players\/[^/]+\/([^/.]+)\.htm/.exec(cell)?.[1], name: plain(cell) };
};
const positions = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'K', 'P', 'DE', 'DT', 'NT', 'DL', 'LB', 'ILB', 'OLB', 'MLB', 'CB', 'DB', 'S', 'FS', 'SS', 'OL', 'C', 'T', 'G', 'OT', 'OG']);
const mapping = {
  passing: { passCompletions: ['Cmp'], passAttempts: ['Att'], passYards: ['Yds'], passTD: ['TD'], interceptions: ['Int'] },
  rushing: { rushAttempts: ['Att'], rushYards: ['Yds'], rushTD: ['TD'] },
  receiving: { targets: ['Tgt'], receptions: ['Rec'], receivingYards: ['Yds'], receivingTD: ['TD'] },
  defense: { defensiveInterceptions: ['Int'], interceptionYards: ['Yds'], defensiveTD: ['IntTD'], fumblesForced: ['FF'], fumblesRecovered: ['FR'], sacks: ['Sk'], soloTackles: ['Solo'], assistedTackles: ['Ast'], tacklesForLoss: ['TFL'], qbHits: ['QBHits'], passesDefended: ['PD'], safeties: ['Sfty'] },
  kicking: { fieldGoalAttempts: ['FGA', 5], fieldGoalsMade: ['FGM', 5], extraPointAttempts: ['XPA'], extraPointsMade: ['XPM'] },
  punting: { punts: ['Pnt'], puntYards: ['Yds'], touchbacks: ['TB'], puntsInside20: ['Pnt20'] },
  returns: { puntReturns: ['Ret'], puntReturnYards: ['Yds'], puntReturnTD: ['PRTD'], kickReturns: ['Ret', 1], kickReturnYards: ['Yds', 1], kickReturnTD: ['KRTD'] },
  fantasy: { fumblesLost: ['FL'], twoPointConversions: ['2PM'], twoPointPasses: ['2PP'] },
};
const pages = {};
const sources = [];
const reference = {};
for (const source of manifest.sources) {
  const markdown = await readFile(`${directory}/${source.name}.md`, 'utf8');
  assert.match(markdown, /^# 2025NFL/m, `Wrong season in ${source.name}`);
  const parsed = tables(markdown);
  assert.ok(parsed.length && parsed[0].rows.length, `Missing tables in ${source.name}`);
  // Standard player pages append a postseason table. Fantasy repeats its
  // regular-season headers every 30 rows: keep those continuations, not playoffs.
  const selected = ['index', 'opp', 'fantasy'].includes(source.name) ? parsed : [parsed[0]];
  pages[source.name] = selected;
  sources.push({ ...source, sha256: createHash('sha256').update(markdown).digest('hex'),
    rows: selected.reduce((n, table) => n + table.rows.length, 0),
    use: ['passing', 'rushing', 'receiving', 'defense', 'index', 'opp'].includes(source.name) ? 'model' : 'reference' });
  reference[source.name] = selected.map(table => ({
    heading: table.heading, columns: table.headers,
    rows: table.rows.filter(row => table.headers.includes('Player') || /\/teams\//.test(row[table.headers.indexOf('Tm')] ?? '')).map(row =>
      row.map((cell, index) => ['Player', 'Tm', 'Team', 'Pos', 'FantPos'].includes(table.headers[index]) ? plain(cell) : num(cell) ?? null)),
  }));
}
const players = new Map();
for (const [category, fields] of Object.entries(mapping)) {
  for (const table of pages[category]) for (const row of table.rows) {
    const { headers } = table;
    const { id, name } = identity(headers, row);
    if (!id) continue;
    const code = teamCode(row[headers.indexOf('Team') >= 0 ? headers.indexOf('Team') : headers.indexOf('Tm')]);
    const position = plain(row[headers.indexOf(headers.includes('Pos') ? 'Pos' : 'FantPos')]);
    const games = value(headers, row, 'G');
    if (games === 0) continue; // A zero-game roster row cannot establish a per-game prior.
    assert.ok(games > 0 && games <= 18, `${id} ${category}: invalid regular-season games ${games}`);
    if (!players.has(id)) players.set(id, { id, name, positions: [], teams: {} });
    const player = players.get(id);
    if (positions.has(position) && !player.positions.includes(position)) player.positions.push(position);
    player.teams[code] ??= { stats: {}, samples: {} };
    const record = player.teams[code];
    record.games = Math.max(record.games ?? 0, games);
    const starts = value(headers, row, 'GS');
    if (starts !== undefined) record.starts = Math.max(record.starts ?? 0, starts);
    for (const [key, args] of Object.entries(fields)) {
      const n = value(headers, row, ...args);
      if (n === undefined) continue; // Missing values are unknown, never invented zeros.
      if (record.stats[key] !== undefined) assert.equal(record.stats[key], n, `Duplicate/conflicting ${id} ${code} ${key}`);
      record.stats[key] = n; record.samples[key] = games;
    }
  }
}
const teams = {};
function addTeams(page, heading, fields) {
  const table = pages[page].find(table => table.heading === heading);
  assert.ok(table, `Missing ${heading}`);
  let count = 0;
  for (const row of table.rows) {
    const { headers } = table;
    const cell = row[headers.indexOf('Tm')];
    if (!/\/teams\//.test(cell)) continue;
    const code = teamCode(cell);
    teams[code] ??= { name: plain(cell), offense: {}, defense: {}, defenseVsPosition: {} };
    const record = teams[code][page === 'index' ? 'offense' : 'defense'];
    record.games = value(headers, row, 'G');
    for (const [key, args] of Object.entries(fields)) {
      const n = value(headers, row, ...args);
      if (n !== undefined) record[key] = n;
    }
    count++;
  }
  assert.equal(count, 32, `${page}/${heading} must have all 32 NFL teams`);
}
addTeams('index', 'Team Offense', { passAttempts: ['Att'], passYards: ['Yds', 1], passTD: ['TD'], rushAttempts: ['Att', 1], rushYards: ['Yds', 2], rushTD: ['TD', 1], passCompletions: ['Cmp'] });
addTeams('opp', 'Team Defense', { passYardsAllowed: ['Yds', 1], passTDAllowed: ['TD'], rushYardsAllowed: ['Yds', 2], rushTDAllowed: ['TD', 1], interceptions: ['Int'], fumblesRecovered: ['FL'], pointsAllowed: ['PA'] });
addTeams('opp', 'Passing Defense', { sacks: ['Sk'] });
for (const position of ['QB', 'RB', 'WR', 'TE']) {
  const table = pages[`fantasy-points-against-${position}`][0];
  assert.equal(table.rows.length, 32);
  for (const row of table.rows) {
    const record = teams[teamCode(row[0])];
    assert.ok(record, 'Unknown defense-versus-position team');
    const games = value(table.headers, row, 'G');
    const total = value(table.headers, row, 'DKPt');
    assert.ok(games === 17 && total >= 0);
    record.defenseVsPosition[position] = { games, total, perGame: Number((total / games).toFixed(4)) };
  }
}
assert.equal(Object.keys(teams).length, 32);
for (const [code, team] of Object.entries(teams)) {
  team.offense.targets = [...players.values()].reduce((sum, player) => sum + (player.teams[code]?.stats.targets ?? 0), 0);
}
assert.ok(players.size > 1000 && players.size < 2500);
const output = 'artifacts/gridiron-sim/src/data';
await mkdir(output, { recursive: true });
await writeFile(`${output}/baseline-2025.json`, JSON.stringify({
  season: 2025, seasonType: 'regular', retrievedAt: manifest.retrievedAt,
  sources, players: [...players.values()], teams,
}));
await writeFile(`${output}/baseline-2025-reference.json`, JSON.stringify(reference));
console.log(JSON.stringify({ sources: sources.length, players: players.size, teams: Object.keys(teams).length, referenceCategories: Object.keys(reference).length }));