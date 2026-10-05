import { getNflMatchupEvidence } from '@workspace/api-client-react';
import type { NflAdvancedReport } from '@workspace/api-client-react';
import type { FootballReports } from './football-evidence';

const cache = new Map<string, { expires: number; request: Promise<NflAdvancedReport> }>();
async function load(season: number, team: string, week: number, window: 4 | 18) {
  const key = JSON.stringify([season, team, week, window]);
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.request;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const request = getNflMatchupEvidence(season, team, week, window, { signal: controller.signal }).finally(() => clearTimeout(timer));
  cache.set(key, { expires: Date.now() + 300000, request });
  void request.catch(() => cache.delete(key));
  return request;
}
export async function loadFootballReports(season: number, team: string, week: number): Promise<FootballReports> {
  const reports = await Promise.allSettled([load(season, team, week, 4), load(season - 1, team, 19, 18)]);
  return { current: reports[0].status === 'fulfilled' ? reports[0].value : undefined,
    prior: reports[1].status === 'fulfilled' ? reports[1].value : undefined,
    issues: reports.flatMap((r, i) => r.status === 'rejected'
      ? [`${season - i} play-by-play fetch failed: ${r.reason instanceof Error ? r.reason.message : 'source unavailable'}`] : []) };
}
