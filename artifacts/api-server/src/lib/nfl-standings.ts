type RecordLine = { wins: number; losses: number; ties: number };
type Entry = { team: string; record: RecordLine; needsWin: boolean; tableStats: {
  pointsFor: number; pointsAgainst: number; home: string; away: string; streak?: string;
} };
type Event = {
  id: string; date: string; season?: { year: number; type: number }; week?: { number: number };
  competitions: { status?: { type?: { completed?: boolean } }; competitors: {
    homeAway: string; team: { displayName: string }; score: string;
  }[] }[];
};
type Division = {
  children?: Division[];
  standings?: { season: number; seasonType: number; entries: { team: { displayName: string } }[] };
};

/** Records entering a week, using only verified final regular-season scores.
 * The official standings tree supplies the complete league membership and season. */
export function parseNflStandings(tree: unknown, events: Event[], season: number, requestedWeek?: number, now = Date.now()) {
  const root = tree as Division & { season?: { year: number } };
  if (root?.season?.year !== season) throw new Error('ESPN standings do not match the requested season.');
  const names: string[] = [];
  const walk = (group: Division) => {
    if (group.standings) {
      if (group.standings.season !== season || group.standings.seasonType !== 2) {
        throw new Error('ESPN returned standings from a different season or season type.');
      }
      for (const entry of group.standings.entries) names.push(entry.team.displayName);
    }
    for (const child of group.children ?? []) walk(child);
  };
  walk(root);
  if (names.length !== 32 || new Set(names).size !== 32) throw new Error('ESPN did not supply standings for all 32 NFL teams.');
  const regular = events.filter(e => e.season?.year === season && e.season.type === 2);
  if (!regular.length) throw new Error('ESPN has not supplied a matching regular-season schedule.');
  const completed = regular.filter(e => e.competitions[0]?.status?.type?.completed);
  const currentWeek = Math.min(18, Math.max(0, ...completed.map(e => e.week?.number ?? 0)) + 1);
  const week = requestedWeek ?? currentWeek;
  if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error('Choose an entering week from 1 to 18.');
  const entries = new Map<string, Entry>(names.map(team => [team, {
    team, needsWin: false, record: { wins: 0, losses: 0, ties: 0 },
    tableStats: { pointsFor: 0, pointsAgainst: 0, home: '0-0-0', away: '0-0-0' },
  }]));
  const splits = new Map<string, { home: RecordLine; away: RecordLine }>();
  const seen = new Set<string>();
  let games = 0;
  for (const event of completed.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id))) {
    if (!Number.isInteger(event.week?.number) || event.week!.number < 1 || event.week!.number > 18
      || !Number.isFinite(Date.parse(event.date)) || Date.parse(event.date) > now || seen.has(event.id)) {
      throw new Error('ESPN returned invalid or duplicate final game timing.');
    }
    seen.add(event.id);
    if (event.week!.number >= week) continue;
    const competitors = event.competitions[0]!.competitors;
    if (competitors.length !== 2 || new Set(competitors.map(c => c.homeAway)).size !== 2
      || competitors.some(c => !['home', 'away'].includes(c.homeAway) || !entries.has(c.team.displayName)
        || !/^\d+$/.test(c.score)) || competitors[0]!.team.displayName === competitors[1]!.team.displayName) {
      throw new Error('ESPN returned incomplete final scores or unknown NFL teams.');
    }
    games++;
    for (const [i, competitor] of competitors.entries()) {
      const score = Number(competitor.score), against = Number(competitors[1 - i]!.score);
      const entry = entries.get(competitor.team.displayName)!;
      const result = score === against ? 'ties' : score > against ? 'wins' : 'losses';
      entry.record[result]++;
      if (entry.record.wins + entry.record.losses + entry.record.ties > Math.min(17, week - 1)) {
        throw new Error('ESPN final games exceed the selected entering-week limit.');
      }
      const split = splits.get(entry.team) ?? { home: { wins: 0, losses: 0, ties: 0 }, away: { wins: 0, losses: 0, ties: 0 } };
      split[competitor.homeAway as 'home' | 'away'][result]++; splits.set(entry.team, split);
      entry.tableStats.pointsFor += score; entry.tableStats.pointsAgainst += against;
      const letter = result === 'wins' ? 'W' : result === 'losses' ? 'L' : 'T';
      const previous = entry.tableStats.streak;
      entry.tableStats.streak = `${letter}${previous?.startsWith(letter) ? Number(previous.slice(1)) + 1 : 1}`;
    }
  }
  const recordText = (r: RecordLine) => `${r.wins}-${r.losses}-${r.ties}`;
  for (const entry of entries.values()) {
    const split = splits.get(entry.team);
    if (split) { entry.tableStats.home = recordText(split.home); entry.tableStats.away = recordText(split.away); }
  }
  const pending = regular.filter(e => (e.week?.number ?? 99) < week && !e.competitions[0]?.status?.type?.completed).length;
  return { season, week, currentWeek, fetchedAt: new Date(now).toISOString(), sourceUrl: `https://www.espn.com/nfl/standings/_/season/${season}`,
    entries: [...entries.values()], completedGames: games,
    warnings: [
      ...(pending ? [`${pending} game(s) before week ${week} are not final yet. Their scores and results are excluded; refresh after they finish.`] : []),
      ...(week > currentWeek ? ['This is a future entering week. Only currently completed games are included; refresh nearer kickoff.'] : []),
    ],
  };
}

const cache = new Map<number, { expires: number; value: Promise<{ tree: unknown; events: Event[] }> }>();
export async function getNflStandings(season: number, week?: number) {
  let cached = cache.get(season);
  if (!cached || cached.expires <= Date.now()) {
    const json = async (url: string) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`ESPN standings source returned HTTP ${response.status}.`);
      return response.json();
    };
    const value = Promise.all([
      json(`https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?season=${season}&seasontype=2&level=3`),
      json(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&limit=1000`),
      json(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season + 1}&limit=1000`),
    ]).then(([tree, current, next]) => {
      const currentYear = current as { events?: Event[] } | null;
      const nextYear = next as { events?: Event[] } | null;
      if (!Array.isArray(currentYear?.events) || !Array.isArray(nextYear?.events)) throw new Error('ESPN final-game history is incomplete.');
      return { tree, events: [...currentYear.events, ...nextYear.events] };
    }).catch(error => { cache.delete(season); throw error; });
    cached = { expires: Date.now() + 60000, value }; cache.set(season, cached);
  }
  const source = await cached.value;
  return parseNflStandings(source.tree, source.events, season, week);
}
