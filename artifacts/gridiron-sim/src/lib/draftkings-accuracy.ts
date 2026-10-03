import type { TeamSeasonRecord } from '@workspace/api-client-react';
import { DK_POSITIONS, dkHistory, dkPlayerKey, type DKGameForecast, type DKOfficialScore, type DKPosition, type DKSlate } from './draftkings-board';

export interface AccuracySample {
  gameId: string;
  team: string;
  playerId: string;
  position: DKPosition;
  projected: number;
  actual: number;
}
export interface AccuracyMetrics {
  count: number;
  games: number;
  meanAbsoluteError: number | null;
  /** Positive means projections run high, unlike the board's actual-minus-projected Diff. */
  bias: number | null;
}
function metrics(samples: AccuracySample[]): AccuracyMetrics {
  return {
    count: samples.length,
    games: new Set(samples.map(s => s.gameId)).size,
    meanAbsoluteError: samples.length ? samples.reduce((sum, s) => sum + Math.abs(s.projected - s.actual), 0) / samples.length : null,
    bias: samples.length ? samples.reduce((sum, s) => sum + s.projected - s.actual, 0) / samples.length : null,
  };
}

/** Descriptive, locally timestamped comparisons; not independently audited backtesting. */
export function draftKingsAccuracy(slates: DKSlate[], teams: TeamSeasonRecord[], official: DKOfficialScore[], season: number, now = Date.now()) {
  const skipped = { timing: 0, duplicateForecasts: 0, unavailable: 0, partial: 0, mismatch: 0 };
  const chosen = new Map<string, { forecast: DKGameForecast; saved: number; slateId: string }>();
  for (const slate of slates.filter(s => s.season === season)) {
    for (const forecast of slate.forecasts) {
      const started = Date.parse(slate.createdAt);
      const generated = Date.parse(forecast.generatedAt ?? '');
      const saved = Date.parse(slate.savedAt ?? '');
      const kickoff = Date.parse(forecast.kickoff);
      if (![started, generated, saved, kickoff].every(Number.isFinite) ||
          started > generated || generated > saved || saved >= kickoff || saved > now) {
        skipped.timing++;
        continue;
      }
      // One entire, latest saved pregame snapshot per game, not a cherry-picked
      // forecast per player. Injured players removed in the last run stay removed.
      const existing = chosen.get(forecast.gameId);
      if (existing) skipped.duplicateForecasts++;
      if (!existing || saved > existing.saved || (saved === existing.saved && slate.id > existing.slateId)) {
        chosen.set(forecast.gameId, { forecast, saved, slateId: slate.id });
      }
    }
  }
  const history = new Map(dkHistory(teams, season, official).map(p => [dkPlayerKey(p.team, p.playerId), p]));
  const samples: AccuracySample[] = [];
  for (const { forecast } of chosen.values()) {
    const seen = new Set<string>();
    for (const player of forecast.players) {
      const key = dkPlayerKey(player.team, player.playerId);
      const team = teams.find(t => t.season === season && t.team === player.team);
      const week = team?.weeks.find(w => w.week === forecast.week);
      const home = player.team === forecast.homeTeam;
      const opponent = home ? forecast.awayTeam : forecast.homeTeam;
      const roster = home ? forecast.input?.home?.roster : forecast.input?.away?.roster;
      const identity = Array.isArray(roster) ? roster.filter(p => p && p.id === player.playerId && p.position === player.position) : [];
      if (seen.has(key) || !DK_POSITIONS.includes(player.position) || !Number.isFinite(player.mean) ||
          ![forecast.awayTeam, forecast.homeTeam].includes(player.team) || identity?.length !== 1) {
        skipped.mismatch++;
        continue;
      }
      seen.add(key);
      if (Date.parse(forecast.kickoff) > now || !week || week.status !== 'played') {
        skipped.unavailable++;
        continue;
      }
      if (week.opponent !== opponent || week.venue !== (home ? 'home' : 'away') ||
          (week.source?.eventId && week.source.eventId !== forecast.gameId)) {
        skipped.mismatch++;
        continue;
      }
      const actual = history.get(key)?.weeks.find(w => w.week === forecast.week);
      if (!actual || actual.points === null || !Number.isFinite(actual.points)) {
        skipped.unavailable++;
        continue;
      }
      if (actual.partial) {
        skipped.partial++;
        continue;
      }
      const entered = official.find(s => s.season === season && s.team === player.team && s.playerId === player.playerId && s.week === forecast.week);
      if (actual.source === 'user-entered-official' &&
          (!entered || !Number.isFinite(Date.parse(entered.enteredAt)) ||
           Date.parse(entered.enteredAt) <= Date.parse(forecast.kickoff) || Date.parse(entered.enteredAt) > now)) {
        skipped.mismatch++;
        continue;
      }
      samples.push({ gameId: forecast.gameId, team: player.team, playerId: player.playerId, position: player.position, projected: player.mean, actual: actual.points });
    }
  }
  return {
    samples, overall: metrics(samples), skipped,
    positions: DK_POSITIONS.map(position => ({ position, ...metrics(samples.filter(s => s.position === position)) })),
  };
}
export type DraftKingsAccuracyReport = ReturnType<typeof draftKingsAccuracy>;