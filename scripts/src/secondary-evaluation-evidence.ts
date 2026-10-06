import type { SimulationInput } from '../../artifacts/gridiron-sim/src/lib/simulator';
import { newPassingCounters, recordPassingDepth, passingDepthReport } from '../../artifacts/api-server/src/lib/nfl-passing-depth';
import { secondaryMatchup } from '../../artifacts/gridiron-sim/src/lib/secondary-matchup';
import { object, number, text, timestamp, readArchive, requirePregame, parseInput, playerKey } from './market-evaluation-evidence';
import { passCounters, passMetrics } from './secondary-evaluation-metrics';
import { scoringFields } from './market-evaluation';
import { calculateDraftKings } from '../../artifacts/gridiron-sim/src/lib/draftkings';
import { NFL_TEAM_CODES } from '../../artifacts/api-server/src/lib/nfl-advanced-data';

/** Retained nflverse rows use their native string/NA encoding. */
function passingRows(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Missing archived passing rows.');
  return value.map(raw => {
    const row = object(raw);
    if (Object.values(row).some(v => typeof v !== 'string')) throw new Error('Passing source fields must be strings.');
    return row as Record<string, string>;
  }).filter(row => !['play_deleted', 'qb_spike', 'qb_kneel', 'two_point_attempt'].some(k => row[k] === '1'));
}
function aggregate(rows: Record<string, string>[]) {
  const counter = newPassingCounters();
  rows.forEach(row => recordPassingDepth(row, counter));
  return { counter, report: passingDepthReport([counter]) };
}
function sourceIdentity(rows: Record<string, string>[], id: string, season: number, week: number, team: string, side: 'offense' | 'defense') {
  const code = (s: string) => ({ LA: 'LAR', JAC: 'JAX', WSH: 'WAS', OAK: 'LV', SD: 'LAC', STL: 'LAR' } as Record<string, string>)[s] ?? s;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.game_id !== id || Number(row.season) !== season || Number(row.week) !== week ||
      row.season_type !== 'REG' || NFL_TEAM_CODES[code(row[side === 'offense' ? 'posteam' : 'defteam'] ?? '')] !== team ||
      !NFL_TEAM_CODES[code(row.posteam ?? '')] || !NFL_TEAM_CODES[code(row.defteam ?? '')] || row.posteam === row.defteam ||
      !row.play_id || seen.has(row.play_id)) throw new Error('Duplicate or mismatched passing source identity.');
    seen.add(row.play_id);
  }
}
function priorReport(value: unknown, season: number, team: string, side: 'offense' | 'defense') {
  const rows = passingRows(value), groups = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    if (Number(row.season) !== season || !row.game_id || !Number.isInteger(Number(row.week)) ||
      Number(row.week) < 1 || Number(row.week) > 18) throw new Error('Prior-season rows include wrong season/week.');
    const gameRows = groups.get(row.game_id) ?? [];
    gameRows.push(row); groups.set(row.game_id, gameRows);
  }
  for (const [id, gameRows] of groups) sourceIdentity(gameRows, id, season, Number(gameRows[0]!.week), team, side);
  return aggregate(rows).report;
}
export function observedPassing(value: unknown, identity?: { id: string; season: number; week: number; team: string }) {
  const payload = object(value);
  if (payload.complete !== true) throw new Error('Passing play ledger is not reviewed complete.');
  const rows = passingRows(payload.plays), { counter } = aggregate(rows), c = passCounters();
  if (identity) sourceIdentity(rows, identity.id, identity.season, identity.week, identity.team, 'offense');
  c.attempts = counter.unknownDepthAttempts + Object.values(counter.bands).reduce((n, b) => n + b.attempts, 0);
  c.completions = rows.filter(r => r.play_type === 'pass' && r.pass_attempt === '1' && r.sack !== '1' &&
    r.rush_attempt !== '1' && r.qb_scramble !== '1' && r.complete_pass === '1').length;
  c.depthKnown = Object.values(counter.bands).reduce((n, b) => n + b.attempts, 0);
  c.intermediateAttempts = counter.bands.intermediate.attempts; c.intermediateCompletions = counter.bands.intermediate.completions;
  c.deepAttempts = counter.bands.deep.attempts; c.deepCompletions = counter.bands.deep.completions;
  c.explosiveSamples = counter.explosiveSamples; c.explosives = counter.explosives; c.yacSamples = counter.yacSamples; c.yac = counter.yac;
  for (const row of rows) {
    const single = newPassingCounters(); recordPassingDepth(row, single);
    if (single.yacSamples) { c.yac5Plus += Number(single.yac >= 5); c.yac10Plus += Number(single.yac >= 10); }
  }
  const metrics = passMetrics(c);
  const completeKnown = rows.filter(r => r.play_type === 'pass' && r.pass_attempt === '1' && r.sack !== '1' &&
    r.rush_attempt !== '1' && r.qb_scramble !== '1').every(r => r.complete_pass === '0' || r.complete_pass === '1');
  if (!completeKnown) metrics.completions = null;
  // Full game counts/rates need full field coverage; never treat missing values as zero.
  if (c.depthKnown !== c.attempts) {
    metrics.intermediateAttempts = metrics.intermediateCompletions = metrics.deepAttempts = metrics.deepCompletions = null;
  }
  if (c.explosiveSamples !== c.attempts) metrics.passing15PlusRate = null;
  if (!completeKnown || c.yacSamples !== c.completions) metrics.yacMean = metrics.yac5PlusFrequency = metrics.yac10PlusFrequency = null;
  return metrics;
}

export function observedFantasy(value: unknown) {
  const target = object(value);
  if (target.observed !== true) throw new Error('Player scoring ledger is not independently observed.');
  const stats = object(target.stats);
  for (const field of scoringFields) {
    const n = number(stats[field]);
    if (!['passYards', 'rushYards', 'receivingYards'].includes(field) && (n < 0 || !Number.isInteger(n))) {
      throw new Error('Invalid scoring event count.');
    }
  }
  return calculateDraftKings(stats as Record<string, number>);
}

function equalEvidence(a: unknown, b: unknown) {
  const first = object(a), second = object(b);
  return [...new Set([...Object.keys(first), ...Object.keys(second)])].every(key => first[key] === second[key]);
}

/** Validate the complete pre-freeze game inventory, then reconstruct only its latest four.
 * Completeness and receipt authenticity still require independent human source review. */
function validateHistory(input: SimulationInput, payload: Record<string, unknown>, frozen: number, heldOutId: string) {
  if (!Array.isArray(payload.secondaryHistory) || payload.secondaryHistory.length !== 2) throw new Error('Missing both-team last-four source inventories.');
  const teams = new Set<string>();
  for (const raw of payload.secondaryHistory) {
    const history = object(raw), teamName = text(history.team);
    if (teams.has(teamName)) throw new Error('Duplicate history team.');
    teams.add(teamName);
    const team = [input.away, input.home].find(t => t.name === teamName);
    if (!team) throw new Error('History team mismatch.');
    const season = number(history.season), week = number(history.matchupWeek);
    if (!Number.isInteger(season) || season < 2000 || season > 2100 || !Number.isInteger(week) || week < 1 || week > 19 || history.complete !== true ||
      !Array.isArray(history.completedGames)) throw new Error('Incomplete historical game inventory.');
    const weeks = new Set<number>(), ids = new Set<string>();
    const games = history.completedGames.map(rawGame => {
      const game = object(rawGame), gameWeek = number(game.week), id = text(game.id), completedAt = timestamp(game.completedAt);
      if (!Number.isInteger(gameWeek) || gameWeek < 1 || gameWeek >= week || weeks.has(gameWeek) ||
        ids.has(id) || id === heldOutId || completedAt > frozen || completedAt > timestamp(payload.historyThrough)) throw new Error('Duplicate, future or held-out history game.');
      weeks.add(gameWeek); ids.add(id);
      const offense = passingRows(game.offensePlays), defense = passingRows(game.defensePlays);
      sourceIdentity(offense, id, season, gameWeek, teamName, 'offense');
      sourceIdentity(defense, id, season, gameWeek, teamName, 'defense');
      return { week: gameWeek, completedAt, offense, defense };
    }).sort((a, b) => a.week - b.week);
    if (games.some((g, i) => i > 0 && g.completedAt <= games[i - 1]!.completedAt)) throw new Error('History game chronology disagrees with weeks.');
    const last = games.slice(-4);
    if (!last.length) throw new Error('No pregame passing history.');
    for (const side of ['Offense', 'Defense'] as const) {
      const evidence = team.footballEvidence?.[`secondary${side}`];
      if (!evidence || evidence.season !== season || JSON.stringify(evidence.weeks) !== JSON.stringify(last.map(g => g.week))) {
        throw new Error('Secondary evidence is not the point-in-time last-four window.');
      }
      const reconstructed = aggregate(last.flatMap(g => side === 'Offense' ? g.offense : g.defense)).report;
      if (!equalEvidence(evidence.current, reconstructed)) throw new Error('Secondary evidence differs from archived source plays.');
      if (evidence.prior !== undefined) {
        const prior = object(history.prior);
        if (prior.complete !== true || prior.season !== season - 1 || evidence.priorSeason !== season - 1 ||
          !equalEvidence(evidence.prior, priorReport(prior[side === 'Offense' ? 'offensePlays' : 'defensePlays'], season - 1, teamName, side === 'Offense' ? 'offense' : 'defense'))) {
          throw new Error('Prior-season support is not separately substantiated.');
        }
      }
    }
  }
}

export function loadSecondaryGame(root: string, game: Record<string, unknown>, registered: number) {
  const id = text(game.id), kickoff = timestamp(game.kickoff);
  if (registered >= kickoff) throw new Error('Study registration is not pregame.');
  if (game.sourceReview !== 'approved') throw new Error('Independent schedule, input, roster and outcome source review is missing.');
  const inputArchive = readArchive(root, game.input, id, 'input');
  requirePregame(inputArchive, kickoff);
  const frozen = timestamp(inputArchive.capturedAt), payload = object(inputArchive.payload);
  if (timestamp(payload.historyThrough) > frozen) throw new Error('History extends beyond input freeze.');
  const input = parseInput(payload.input);
  if (input.driveModel !== 'possession-v1' || input.secondaryModel !== 'secondary-v1') throw new Error('Require frozen possession-v1 / secondary-v1 input.');
  validateHistory(input, payload, frozen, id);
  const history = (payload.secondaryHistory as Record<string, unknown>[]);
  const season = number(history[0]!.season), week = number(history[0]!.matchupWeek);
  if (history.some(h => h.season !== season || h.matchupWeek !== week)) throw new Error('Both-team season/week disagree.');
  const eligibility = readArchive(root, game.eligibility, id, 'eligibility');
  requirePregame(eligibility, kickoff, frozen);
  const rosterPayload = object(eligibility.payload);
  if (rosterPayload.complete !== true || !Array.isArray(rosterPayload.players)) throw new Error('Incomplete pregame roster eligibility.');
  const roster = new Map<string, string>(), ids = new Set<string>();
  for (const raw of rosterPayload.players) {
    const p = object(raw), key = playerKey({ team: text(p.team), name: text(p.name), position: text(p.position) }), playerId = text(p.playerId);
    if (roster.has(key) || ids.has(playerId)) throw new Error('Duplicate eligibility identity.');
    roster.set(key, playerId); ids.add(playerId);
  }
  for (const team of [input.away, input.home]) {
    if (!team.roster) throw new Error('Missing explicit frozen input roster.');
    for (const p of team.roster) if (roster.get(playerKey({ team: team.name, ...p })) !== p.id) throw new Error('Input differs from pregame eligibility.');
  }
  if (roster.size !== input.away.roster!.length + input.home.roster!.length) throw new Error('Roster coverage differs.');
  const outcomeArchive = readArchive(root, game.outcome, id, 'outcome');
  if (timestamp(outcomeArchive.capturedAt) <= kickoff) throw new Error('Outcome is not post-kickoff.');
  const outcome = object(outcomeArchive.payload);
  if (outcome.final !== true || outcome.awayTeam !== input.away.name || outcome.homeTeam !== input.home.name) throw new Error('Nonfinal or mismatched scoring target.');
  const actual = { away: number(outcome.awayScore), home: number(outcome.homeScore) };
  if (Object.values(actual).some(n => n < 0 || !Number.isInteger(n))) throw new Error('Invalid final scoring target.');
  const targets = new Map<string, unknown>();
  if (outcome.players !== undefined && !Array.isArray(outcome.players)) throw new Error('Invalid player targets.');
  for (const raw of (outcome.players ?? []) as unknown[]) {
    const p = object(raw), playerId = text(p.playerId);
    if (targets.has(playerId)) throw new Error('Duplicate observed player.');
    targets.set(playerId, p);
  }
  const active = secondaryMatchup(input.away.footballEvidence?.secondaryOffense, input.home.footballEvidence?.secondaryDefense).active ||
    secondaryMatchup(input.home.footballEvidence?.secondaryOffense, input.away.footballEvidence?.secondaryDefense).active;
  return { input, actual, outcome, roster, targets, active, season, week,
    archives: [inputArchive.archiveUrl, eligibility.archiveUrl, outcomeArchive.archiveUrl] };
}
