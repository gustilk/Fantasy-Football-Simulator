import type { NflAdvancedDefense, NflAdvancedPlayer, NflAdvancedReport, NflAdvancedSource } from '@workspace/api-zod';
import { csvRecords, sourceNumber as number } from './nfl-advanced-csv';

export const NFL_TEAM_CODES: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};
const aliases: Record<string, string> = { LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR', JAC: 'JAX', WSH: 'WAS' };
const code = (value: string) => aliases[value] ?? value;
const position = (value: string): NflAdvancedPlayer['position'] => value === 'FB' ? 'RB' : ['QB', 'RB', 'WR', 'TE'].includes(value) ? value as NflAdvancedPlayer['position'] : 'unknown';
const round = (value: number) => Math.round(value * 10000) / 10000;
interface Identity { key: string; playerId: string | null; name: string; position: NflAdvancedPlayer['position'] }
interface PlayerGame extends Identity { targets: number; carries: number; airYards: number; airTargets: number; redZoneTargets: number; goalLineCarries: number; snaps: number | null; snapShare: number | null; participated: boolean }
interface TeamGame {
  players: Map<string, PlayerGame>; targets: number; carries: number; offensePlays: number;
  passPlays: number; rushPlays: number; passEpaSum: number; rushEpaSum: number; passEpaPlays: number; rushEpaPlays: number; hits: number; hitSamples: number;
  dropbacks: number; offRushes: number; offPassEpaSum: number; offRushEpaSum: number; offPassSamples: number; offRushSamples: number; sacks: number; redZoneTargets: number; goalLineCarries: number;
  rbEpa: number; wrEpa: number; teEpa: number; rbTargets: number; wrTargets: number; teTargets: number;
}
interface Game { week: number; date: string; endedAt: number | null; complete: boolean; teams: Map<string, TeamGame> }
export interface AdvancedSeason { season: number; games: Map<string, Game>; hasPbp: boolean; hasSnaps: boolean; hasIdentities: boolean }
const newTeam = (): TeamGame => ({ players: new Map(), targets: 0, carries: 0, offensePlays: 0, passPlays: 0, rushPlays: 0, passEpaSum: 0, rushEpaSum: 0, passEpaPlays: 0, rushEpaPlays: 0, hits: 0, hitSamples: 0, dropbacks: 0, offRushes: 0, offPassEpaSum: 0, offRushEpaSum: 0, offPassSamples: 0, offRushSamples: 0, sacks: 0, redZoneTargets: 0, goalLineCarries: 0, rbEpa: 0, wrEpa: 0, teEpa: 0, rbTargets: 0, wrTargets: 0, teTargets: 0 });
const newPlayer = (identity: Identity): PlayerGame => ({ ...identity, targets: 0, carries: 0, airYards: 0, airTargets: 0, redZoneTargets: 0, goalLineCarries: 0, snaps: null, snapShare: null, participated: false });

/** Aggregate immutable observed game facts first. Cutoffs are applied to whole
 * completed games later, so repeated team requests don't repeatedly parse PBP. */
export function parseAdvancedSeason(season: number, pbp?: string, snaps?: string, identities?: string): AdvancedSeason {
  const gsis = new Map<string, Identity | null>(), pfr = new Map<string, Identity | null>();
  const addIdentity = (map: Map<string, Identity | null>, id: string, item: Identity) => {
    if (!id || id === 'NA') return;
    if (!map.has(id)) map.set(id, item);
    else if (JSON.stringify(map.get(id)) !== JSON.stringify(item)) map.set(id, null); // Ambiguity is unknown, not a name guess.
  };
  if (identities) for (const row of csvRecords(identities, ['gsis_id', 'pfr_id', 'espn_id', 'display_name', 'position'])) {
    const key = row.gsis_id && row.gsis_id !== 'NA' ? `gsis:${row.gsis_id}` : `pfr:${row.pfr_id}`;
    const item = { key, playerId: /^\d+$/.test(row.espn_id!) ? `espn:${row.espn_id}` : null, name: row.display_name!, position: position(row.position!) };
    addIdentity(gsis, row.gsis_id!, item); addIdentity(pfr, row.pfr_id!, item);
  }
  const games = new Map<string, Game>(), seenPlays = new Set<string>(), seenSnaps = new Set<string>();
  const teamGame = (game: Game, team: string) => {
    team = code(team);
    if (!NFL_TEAM_CODES[team]) throw new Error('Unknown team in advanced NFL source.');
    if (!game.teams.has(team)) game.teams.set(team, newTeam());
    return game.teams.get(team)!;
  };
  const actor = (team: TeamGame, id: string, name: string): PlayerGame => {
    const identity = gsis.get(id) ?? { key: `gsis:${id}`, playerId: null, name: name || id, position: 'unknown' as const };
    if (!team.players.has(identity.key)) team.players.set(identity.key, newPlayer(identity));
    return team.players.get(identity.key)!;
  };
  if (pbp) for (const row of csvRecords(pbp, ['season', 'season_type', 'week', 'game_id', 'play_id', 'game_date', 'home_team', 'away_team', 'posteam', 'defteam', 'play_type', 'qb_dropback', 'rush_attempt', 'pass_attempt', 'epa', 'air_yards', 'qb_hit', 'sack', 'receiver_player_id', 'rusher_player_id', 'desc'])) {
    if (number(row.season) !== season || !row.game_id!.startsWith(`${season}_`)) throw new Error('Wrong-season play-by-play source. No other season was substituted.');
    if (row.season_type !== 'REG') continue;
    const week = number(row.week);
    const parts = row.game_id!.split('_');
    if (week === null || !Number.isInteger(week) || week < 1 || week > 18 || !/^\d{4}-\d{2}-\d{2}$/.test(row.game_date!)
      || !Number.isFinite(Date.parse(row.game_date!)) || number(row.play_id) === null || Number(parts[1]) !== week
      || code(parts[2]!) !== code(row.away_team!) || code(parts[3]!) !== code(row.home_team!) || code(row.home_team!) === code(row.away_team!)) throw new Error('Invalid game metadata in play-by-play.');
    const key = `${row.game_id}:${row.play_id}`;
    if (seenPlays.has(key)) throw new Error('Duplicate play in advanced source.');
    seenPlays.add(key);
    let game = games.get(row.game_id!);
    if (!game) {
      game = { week, date: row.game_date!, endedAt: null, complete: false, teams: new Map() };
      games.set(row.game_id!, game); teamGame(game, row.home_team!); teamGame(game, row.away_team!);
    }
    if (game.week !== week || game.date !== row.game_date || !game.teams.has(code(row.home_team!)) || !game.teams.has(code(row.away_team!))) throw new Error('Inconsistent game metadata in advanced source.');
    if (row.desc!.trim() === 'END GAME') {
      game.complete = true;
      const ended = Date.parse(row.time_of_day ?? '');
      game.endedAt = Number.isFinite(ended) ? ended : null;
    }
    if (!['pass', 'run'].includes(row.play_type!) || row.play_deleted === '1' || row.qb_kneel === '1' || row.qb_spike === '1' || row.two_point_attempt === '1') continue;
    const dropback = row.qb_dropback === '1', rush = row.rush_attempt === '1';
    if (!dropback && !rush) continue;
    if (!game.teams.has(code(row.posteam!)) || !game.teams.has(code(row.defteam!)) || code(row.posteam!) === code(row.defteam!)) throw new Error('Mismatched offense/defense in advanced source.');
    const offense = teamGame(game, row.posteam!), defense = teamGame(game, row.defteam!);
    offense.offensePlays++;
    const epa = number(row.epa);
    if (dropback) {
      offense.dropbacks++;
      if (epa !== null) { offense.offPassEpaSum += epa; offense.offPassSamples++; }
      defense.passPlays++;
      if (epa !== null) { defense.passEpaSum += epa; defense.passEpaPlays++; }
      const hit = number(row.qb_hit), sack = number(row.sack);
      if (hit !== null && sack !== null) { defense.hitSamples++; defense.hits += Number(hit === 1 || sack === 1); defense.sacks += Number(sack === 1); }
    } else {
      offense.offRushes++;
      if (epa !== null) { offense.offRushEpaSum += epa; offense.offRushSamples++; }
      defense.rushPlays++;
      if (epa !== null) { defense.rushEpaSum += epa; defense.rushEpaPlays++; }
    }
    if (row.passer_player_id && row.passer_player_id !== 'NA') actor(offense, row.passer_player_id, row.passer_player_name ?? '').participated = true;
    if (row.pass_attempt === '1' && row.receiver_player_id && row.receiver_player_id !== 'NA') {
      const player = actor(offense, row.receiver_player_id, row.receiver_player_name ?? '');
      offense.targets++; player.targets++; player.participated = true;
      if (epa !== null) {
        if (player.position === 'RB') { defense.rbEpa += epa; defense.rbTargets++; }
        if (player.position === 'WR') { defense.wrEpa += epa; defense.wrTargets++; }
        if (player.position === 'TE') { defense.teEpa += epa; defense.teTargets++; }
      }
      const yardline = number(row.yardline_100);
      if (yardline !== null && yardline <= 20 && yardline >= 0) { player.redZoneTargets++; offense.redZoneTargets++; }
      const air = number(row.air_yards);
      if (air !== null) { player.airYards += air; player.airTargets++; }
    }
    if (rush && row.rusher_player_id && row.rusher_player_id !== 'NA') {
      const player = actor(offense, row.rusher_player_id, row.rusher_player_name ?? '');
      offense.carries++; player.carries++; player.participated = true;
      const yardline = number(row.yardline_100);
      if (yardline !== null && yardline <= 5 && yardline >= 0) { player.goalLineCarries++; offense.goalLineCarries++; }
    }
  }
  if (snaps) for (const row of csvRecords(snaps, ['season', 'game_type', 'week', 'game_id', 'pfr_player_id', 'player', 'position', 'team', 'offense_snaps', 'offense_pct'])) {
    if (number(row.season) !== season || !row.game_id!.startsWith(`${season}_`)) throw new Error('Wrong-season snap source. No other season was substituted.');
    if (row.game_type !== 'REG' || position(row.position!) === 'unknown') continue;
    const game = games.get(row.game_id!);
    if (!game) continue; // Without PBP, completed-game status cannot be verified.
    if (number(row.week) !== game.week || !game.teams.has(code(row.team!))) throw new Error('Snap counts do not match the play-by-play game.');
    const key = `${row.game_id}:${row.pfr_player_id}`;
    if (seenSnaps.has(key)) throw new Error('Duplicate player/game snap count.');
    seenSnaps.add(key);
    const identity = pfr.get(row.pfr_player_id!) ?? { key: `pfr:${row.pfr_player_id}`, playerId: null, name: row.player!, position: position(row.position!) };
    const team = teamGame(game, row.team!);
    if (!team.players.has(identity.key)) team.players.set(identity.key, newPlayer(identity));
    const player = team.players.get(identity.key)!;
    player.position = position(row.position!);
    const count = number(row.offense_snaps), share = number(row.offense_pct);
    if ((count !== null && (!Number.isInteger(count) || count < 0)) || (share !== null && (share < 0 || share > 1))) throw new Error('Invalid snap count/share.');
    player.snaps = count; player.snapShare = share;
    if (count !== null && count > 0) player.participated = true;
  }
  return { season, games, hasPbp: !!pbp, hasSnaps: !!snaps, hasIdentities: !!identities };
}

export function advancedReport(data: AdvancedSeason, teamName: string, beforeWeek: number, sources: NflAdvancedSource[], now = Date.now(), window = 18): NflAdvancedReport {
  const teamCode = Object.keys(NFL_TEAM_CODES).find(key => NFL_TEAM_CODES[key] === teamName);
  if (!teamCode || !Number.isInteger(beforeWeek) || beforeWeek < 1 || beforeWeek > 19) throw new Error('Choose an NFL team and cutoff week 1–19.');
  const today = new Date(now).toISOString().slice(0, 10);
  const selected = [...data.games.values()].filter(g => g.complete && g.week < beforeWeek && g.teams.has(teamCode)
    && (g.endedAt === null || g.endedAt <= now)
    && (g.date < today || (g.date === today && g.endedAt !== null && g.endedAt <= now)))
    .sort((a, b) => a.week - b.week || a.date.localeCompare(b.date)).slice(-window);
  const groups = new Map<string, { player: PlayerGame; rows: { player: PlayerGame; team: TeamGame }[] }>();
  for (const game of selected) {
    const team = game.teams.get(teamCode)!;
    for (const player of team.players.values()) {
      if (!groups.has(player.key)) groups.set(player.key, { player, rows: [] });
      groups.get(player.key)!.rows.push({ player, team });
    }
  }
  const players: NflAdvancedPlayer[] = [...groups.values()].map(({ player, rows }) => {
    const snapRows = rows.filter(r => r.player.snaps !== null), shares = rows.filter(r => r.player.snapShare !== null);
    const participation = rows.filter(r => r.player.participated);
    const targets = participation.reduce((sum, r) => sum + r.player.targets, 0), carries = participation.reduce((sum, r) => sum + r.player.carries, 0);
    const airTargets = participation.reduce((sum, r) => sum + r.player.airTargets, 0), air = participation.reduce((sum, r) => sum + r.player.airYards, 0);
    const targetGames = participation.filter(r => r.team.targets > 0), carryGames = participation.filter(r => r.team.carries > 0);
    return { playerId: player.playerId, sourcePlayerId: player.key, name: player.name, position: player.position,
      games: rows.length, snapGames: snapRows.length, opportunityGames: participation.length,
      offenseSnaps: snapRows.length ? snapRows.reduce((sum, r) => sum + r.player.snaps!, 0) : null,
      snapShare: shares.length ? round(shares.reduce((sum, r) => sum + r.player.snapShare!, 0) / shares.length) : null,
      targets: participation.length ? targets : null, carries: participation.length ? carries : null,
      targetShare: targetGames.length ? round(targetGames.reduce((sum, r) => sum + r.player.targets / r.team.targets, 0) / targetGames.length) : null,
      carryShare: carryGames.length ? round(carryGames.reduce((sum, r) => sum + r.player.carries / r.team.carries, 0) / carryGames.length) : null,
      airYards: airTargets ? air : null, airYardsPerTarget: airTargets ? round(air / airTargets) : null, airYardTargets: airTargets,
      redZoneTargetShare: participation.reduce((sum, r) => sum + r.team.redZoneTargets, 0) > 0
        ? round(participation.reduce((sum, r) => sum + r.player.redZoneTargets, 0) / participation.reduce((sum, r) => sum + r.team.redZoneTargets, 0)) : null,
      goalLineCarryShare: participation.reduce((sum, r) => sum + r.team.goalLineCarries, 0) > 0
        ? round(participation.reduce((sum, r) => sum + r.player.goalLineCarries, 0) / participation.reduce((sum, r) => sum + r.team.goalLineCarries, 0)) : null };
  }).filter(p => p.position !== 'unknown' || (p.targets ?? 0) > 0 || (p.carries ?? 0) > 0)
    .sort((a, b) => (b.offenseSnaps ?? 0) - (a.offenseSnaps ?? 0) || a.name.localeCompare(b.name));
  const teams = selected.map(g => g.teams.get(teamCode)!);
  const sum = (field: keyof Omit<TeamGame, 'players'>) => teams.reduce((total, row) => total + row[field], 0);
  const passEpaPlays = sum('passEpaPlays'), rushEpaPlays = sum('rushEpaPlays'), hitSamples = sum('hitSamples');
  const defense: NflAdvancedDefense = { passPlays: sum('passPlays'), rushPlays: sum('rushPlays'), passEpaPlays, rushEpaPlays,
    passEpaAllowed: passEpaPlays ? round(sum('passEpaSum') / passEpaPlays) : null,
    rushEpaAllowed: rushEpaPlays ? round(sum('rushEpaSum') / rushEpaPlays) : null,
    sackHitPlays: hitSamples, sackHitRate: hitSamples ? round(sum('hits') / hitSamples) : null, pressureRate: null,
    offensePlaysPerGame: teams.length ? round(sum('offensePlays') / teams.length) : null,
    sackRate: hitSamples ? round(sum('sacks') / hitSamples) : null,
    receivingEpaAllowed: sum('rbTargets') + sum('wrTargets') + sum('teTargets')
      ? round((sum('rbEpa') + sum('wrEpa') + sum('teEpa')) / (sum('rbTargets') + sum('wrTargets') + sum('teTargets'))) : null,
    positionEpaAllowed: Object.fromEntries((['RB', 'WR', 'TE'] as const).flatMap(pos => {
      const keys = { RB: ['rbEpa', 'rbTargets'], WR: ['wrEpa', 'wrTargets'], TE: ['teEpa', 'teTargets'] } as const;
      const [epa, count] = keys[pos];
      return sum(count) > 0 ? [[pos, round(sum(epa) / sum(count))]] : [];
    })),
    positionEpaSamples: { RB: sum('rbTargets'), WR: sum('wrTargets'), TE: sum('teTargets') } };
  const unmatchedPlayers = players.filter(p => p.playerId === null).length;
  const warnings = [
    'Observed history, not guaranteed projected shares. New football-evidence forecasts can use verified fields; existing saved forecasts are never rewritten.',
    'Full pressure rate is unavailable. Sack-or-QB-hit rate counts each dropback once and is not a full pressure measure.',
    'Target/carry shares are averages across verified participation games; absent players are not assigned zero. Targets require an identified receiver; carries exclude kneels. Scrambles count as dropbacks for EPA.',
    'Only completed regular-season games before the cutoff are included. Fetch time is not independent proof of historical pregame publication.',
  ];
  if (!data.hasSnaps) warnings.push('Snap counts are unavailable. Without snaps, opportunity shares may miss games where a player had no recorded opportunity.');
  if (unmatchedPlayers) warnings.push(`${unmatchedPlayers} players lack a unique ESPN identity; they are not matched to saved rosters by name.`);
  if (!selected.length) warnings.push('No verified completed games are available for this team before this cutoff. No other season or dummy data was substituted.');
  const missingRows = players.some(p => p.snapGames < p.games || (p.targets ?? 0) > p.airYardTargets)
    || defense.passEpaPlays < defense.passPlays || defense.rushEpaPlays < defense.rushPlays || defense.sackHitPlays < defense.passPlays;
  if (missingRows) warnings.push('Some player/game rows lack snap counts, air yards, EPA or hit/sack observations. Available totals are partial; check their sample counts.');
  const partial = sources.some(s => s.status === 'unavailable') || unmatchedPlayers > 0 || missingRows;
  return { season: data.season, team: teamName, beforeWeek, fetchedAt: new Date(now).toISOString(),
    status: !data.hasPbp ? 'unavailable' : partial ? 'partial' : 'available', games: selected.length,
    dataThroughWeek: selected.length ? Math.max(...selected.map(g => g.week)) : null, unmatchedPlayers, sources, warnings, players, defense,
    sampleWeeks: selected.map(g => g.week),
    offense: { dropbackShare: sum('offensePlays') ? round(sum('dropbacks') / sum('offensePlays')) : null,
      passEpa: sum('offPassSamples') ? round(sum('offPassEpaSum') / sum('offPassSamples')) : null,
      rushEpa: sum('offRushSamples') ? round(sum('offRushEpaSum') / sum('offRushSamples')) : null,
      passSamples: sum('offPassSamples'), rushSamples: sum('offRushSamples'),
      playsPerGame: teams.length ? round(sum('offensePlays') / teams.length) : null } };
}