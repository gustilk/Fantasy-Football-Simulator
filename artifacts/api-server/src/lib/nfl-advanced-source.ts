import { gunzipSync } from 'node:zlib';
import type { NflAdvancedSource } from '@workspace/api-zod';
import { advancedReport, NFL_TEAM_CODES, parseAdvancedSeason, type AdvancedSeason } from './nfl-advanced-data';

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download/';
const TTL = 10 * 60_000;
type Download = { source: NflAdvancedSource; text?: string };
type Cached = { data: AdvancedSeason; sources: NflAdvancedSource[] };
const seasons = new Map<number, { expires: number; promise: Promise<Cached> }>();
let identities: { expires: number; promise: Promise<Download> } | undefined;
let pending = 0;

async function download(kind: NflAdvancedSource['kind'], path: string): Promise<Download> {
  const url = BASE + path;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Public source returned HTTP ${response.status}.`);
    if (!response.body) throw new Error('Public source returned no file.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.length;
        if (size > 30_000_000) throw new Error('Public source exceeded the safe download limit.');
        chunks.push(result.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = gunzipSync(Buffer.concat(chunks), { maxOutputLength: 160_000_000 });
    const modified = Date.parse(response.headers.get('last-modified') ?? '');
    return { text: bytes.toString('utf8'), source: { kind, url, status: 'available', fetchedAt: new Date().toISOString(),
      updatedAt: Number.isFinite(modified) ? new Date(modified).toISOString() : null } };
  } catch (error) {
    return { source: { kind, url, status: 'unavailable', fetchedAt: new Date().toISOString(), updatedAt: null,
      error: error instanceof Error ? error.message : 'Public source unavailable.' } };
  }
}
function playerIdentities() {
  if (identities && identities.expires > Date.now()) return identities.promise;
  const promise = download('player-identities', 'players/players.csv.gz');
  const entry = { expires: Date.now() + TTL, promise };
  identities = entry;
  void promise.then(value => { if (!value.text) entry.expires = Date.now() + 30_000; });
  return promise;
}
async function seasonData(season: number) {
  const cached = seasons.get(season);
  if (cached && cached.expires > Date.now()) return cached.promise;
  if (pending >= 2) throw new Error('Advanced data downloads are busy. Retry shortly.');
  for (const [key, item] of seasons) if (item.expires <= Date.now()) seasons.delete(key);
  if (seasons.size >= 3) seasons.delete(seasons.keys().next().value!);
  pending++;
  const promise = (async () => {
    try {
      const [pbp, snaps, ids] = await Promise.all([
        download('play-by-play', `pbp/play_by_play_${season}.csv.gz`),
        download('snap-counts', `snap_counts/snap_counts_${season}.csv.gz`), playerIdentities(),
      ]);
      const data = parseAdvancedSeason(season, pbp.text, snaps.text, ids.text);
      return { data, sources: [pbp.source, snaps.source, ids.source] };
    } catch (error) { seasons.delete(season); throw error; }
    finally { pending--; }
  })();
  const entry = { expires: Date.now() + TTL, promise };
  seasons.set(season, entry);
  void promise.then(result => { if (result.sources.some(source => source.status === 'unavailable')) entry.expires = Date.now() + 30_000; }, () => {});
  return promise;
}
export async function getAdvancedNflStats(season: number, team: string, beforeWeek: number, window: 4 | 18 = 18) {
  if (!Object.values(NFL_TEAM_CODES).includes(team) || !Number.isInteger(season) || season < 2000 || season > 2100
    || !Number.isInteger(beforeWeek) || beforeWeek < 1 || beforeWeek > 19) throw new Error('Choose a valid NFL team, season and cutoff week.');
  const { data, sources } = await seasonData(season);
  return advancedReport(data, team, beforeWeek, sources, Date.now(), window);
}