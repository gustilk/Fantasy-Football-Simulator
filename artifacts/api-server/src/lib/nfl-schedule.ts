import type { NflSchedule, NflScheduledGame } from '@workspace/api-zod';

export type ScheduleEvent = {
  id: string;
  date: string;
  season?: { year: number; type: number };
  week?: { number: number };
  status?: { type?: { state?: string; name?: string } };
  competitions?: {
    timeValid?: boolean;
    status?: { type?: { state?: string; name?: string } };
    competitors?: { homeAway: string; team?: { id: string; displayName?: string } }[];
  }[];
};

export function parseUpcomingSchedule(
  events: ScheduleEvent[], season: number, teamNames: Map<string, string>, now = Date.now(),
): Pick<NflSchedule, 'games' | 'unannouncedGames'> {
  const games = new Map<string, NflScheduledGame>();
  const unannounced = new Set<string>();
  for (const event of events) {
    if (event.season?.year !== season || ![2, 3].includes(event.season.type)) continue;
    const competition = event.competitions?.[0];
    const status = competition?.status?.type ?? event.status?.type;
    if (status?.state !== 'pre' || ['STATUS_CANCELED', 'STATUS_CANCELLED'].includes(status.name ?? '')) continue;
    const timestamp = Date.parse(event.date);
    if (!Number.isFinite(timestamp) || timestamp <= now) continue;
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
    });
  }
  return {
    games: [...games.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id)),
    unannouncedGames: unannounced.size,
  };
}