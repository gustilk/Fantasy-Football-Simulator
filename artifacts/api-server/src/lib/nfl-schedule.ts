import type { NflSchedule, NflScheduledGame } from '@workspace/api-zod';

export type ScheduleEvent = {
  id: string;
  date: string;
  season?: { year: number; type: number };
  week?: { number: number };
  status?: { type?: { state?: string; name?: string } };
  competitions?: {
    timeValid?: boolean;
    odds?: {
      overUnder?: number;
      spread?: number;
      provider?: { name?: string; displayName?: string };
      pointSpread?: { home?: { close?: { line?: string } } };
      homeTeamOdds?: { favorite?: boolean };
      awayTeamOdds?: { favorite?: boolean };
    }[];
    status?: { type?: { state?: string; name?: string } };
    competitors?: { homeAway: string; team?: { id: string; displayName?: string } }[];
  }[];
};

export function parseUpcomingSchedule(
  events: ScheduleEvent[], season: number, teamNames: Map<string, string>, now = Date.now(), scope: 'upcoming' | 'all' = 'upcoming',
): Pick<NflSchedule, 'games' | 'unannouncedGames'> {
  const games = new Map<string, NflScheduledGame>();
  const unannounced = new Set<string>();
  for (const event of events) {
    if (event.season?.year !== season || ![2, 3].includes(event.season.type)) continue;
    const competition = event.competitions?.[0];
    const status = competition?.status?.type ?? event.status?.type;
    if (!['pre', 'in', 'post'].includes(status?.state ?? '') || ['STATUS_CANCELED', 'STATUS_CANCELLED'].includes(status?.name ?? '')) continue;
    if (scope === 'upcoming' && status?.state !== 'pre') continue;
    const timestamp = Date.parse(event.date);
    if (!Number.isFinite(timestamp) || (scope === 'upcoming' && timestamp <= now)) continue;
    const rawWeek = event.week?.number;
    if (!rawWeek || !Number.isInteger(rawWeek) || rawWeek < 1 || rawWeek > (event.season.type === 2 ? 18 : 4)) continue;
    const away = competition?.competitors?.find(team => team.homeAway === 'away')?.team;
    const home = competition?.competitors?.find(team => team.homeAway === 'home')?.team;
    const awayTeam = away && teamNames.get(away.id);
    const homeTeam = home && teamNames.get(home.id);
    if (!awayTeam || !homeTeam || awayTeam === homeTeam) {
      unannounced.add(event.id);
      continue;
    }
    games.set(event.id, {
      id: event.id, date: event.date, awayTeam, homeTeam,
      timeConfirmed: competition?.timeValid === true,
      week: event.season.type === 2 ? rawWeek : 18 + rawWeek,
      seasonType: event.season.type === 2 ? 'regular' : 'postseason',
      odds: parseScheduleOdds(competition?.odds),
    });
  }
  return {
    games: [...games.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id)),
    unannouncedGames: unannounced.size,
  };
}

export function parseScheduleOdds(odds: NonNullable<ScheduleEvent['competitions']>[number]['odds']) {
  for (const quote of odds ?? []) {
    const total = quote.overUnder;
    const line = quote.pointSpread?.home?.close?.line?.trim();
    let homeSpread = line && /^[+-]?\d+(\.\d+)?$/.test(line) ? Number(line) : undefined;
    if (homeSpread === undefined && typeof quote.spread === 'number' && Number.isFinite(quote.spread)) {
      const magnitude = Math.abs(quote.spread);
      if (magnitude === 0) homeSpread = 0;
      else if (quote.homeTeamOdds?.favorite === true && quote.awayTeamOdds?.favorite === false) homeSpread = -magnitude;
      else if (quote.awayTeamOdds?.favorite === true && quote.homeTeamOdds?.favorite === false) homeSpread = magnitude;
    }
    if (typeof total === 'number' && Number.isFinite(total) && total >= 10 && total <= 100 &&
        homeSpread !== undefined && Number.isFinite(homeSpread) && Math.abs(homeSpread) <= 40 && total > Math.abs(homeSpread)) {
      return { homeSpread, total, provider: quote.provider?.displayName ?? quote.provider?.name ?? 'ESPN public odds' };
    }
  }
  // Missing or ambiguous lines must not become a pick'em game or a zero total.
  return undefined;
}