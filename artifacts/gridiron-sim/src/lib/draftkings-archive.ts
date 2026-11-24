import { z } from 'zod';
import type { DKOfficialScore, DKSlate, DKMarketDraft } from './draftkings-board';

export const DK_ARCHIVE_KEY = 'gridiron-draftkings-archive-v1';
export interface DKArchive { version: 1; slates: DKSlate[]; official: DKOfficialScore[]; marketDrafts?: Record<string, DKMarketDraft> }
export const emptyDKArchive = (): DKArchive => ({ version: 1, slates: [], official: [], marketDrafts: {} });
const scoreSchema = z.object({
  season: z.number().int().min(2000).max(2100), team: z.string(), playerId: z.string(),
  week: z.number().int().min(1).max(22), points: z.number().min(-100).max(200), enteredAt: z.string(),
});
const forecastSchema = z.object({
  gameId: z.string(), generatedAt: z.string().optional(), week: z.number().int(), kickoff: z.string(), awayTeam: z.string(), homeTeam: z.string(),
  seed: z.number(), runs: z.number().int().positive(), input: z.object({ highScoring: z.boolean().optional() }).passthrough(),
  players: z.array(z.object({
    playerId: z.string(), name: z.string(), team: z.string(), position: z.enum(['QB', 'RB', 'WR', 'TE']),
    mean: z.number(), p10: z.number(), p90: z.number(), elite1x: z.boolean().optional(),
    median: z.number().finite().optional(), p75: z.number().finite().optional(), p95: z.number().finite().optional(),
    bustThreshold: z.number().finite().optional(), bustProbability: z.number().min(0).max(1).optional(),
    availability: z.object({
      status: z.string(), statusBasis: z.enum(['weekly override', 'saved roster']), checkedAt: z.string().optional(),
      playProbability: z.number().min(0).max(1), adjustedMean: z.number().finite(), adjustedBustProbability: z.number().min(0).max(1).optional(),
      sample: z.object({ n: z.number(), played: z.number() }), rateSource: z.string(),
    }).optional(),
    eliteTier: z.union([z.literal(0), z.literal(1), z.literal(1.5), z.literal(2), z.literal(3)]).optional(),
  })),
  warnings: z.array(z.string()),
  defenses: z.array(z.object({ team: z.string(), mean: z.number().finite(), p10: z.number().finite(), p90: z.number().finite() })).optional(),
}).passthrough();
const archiveSchema = z.object({
  version: z.literal(1), official: z.array(scoreSchema),
  marketDrafts: z.record(z.string(), z.object({
    enabled: z.boolean(), homeSpread: z.string(), total: z.string(), recordedAt: z.string(), manual: z.boolean(), highScoring: z.boolean().optional(),
  })).optional(),
  slates: z.array(z.object({
    id: z.string(), season: z.number().int(), sunday: z.string(), createdAt: z.string(), savedAt: z.string().optional(),
    timezone: z.literal('America/Chicago'), forecasts: z.array(forecastSchema),
    failures: z.array(z.object({ gameId: z.string(), matchup: z.string(), reason: z.string() })),
  })),
});
export interface DKStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function validateDKArchive(value: unknown): DKArchive {
  const result = archiveSchema.safeParse(value);
  if (!result.success) throw new Error('Saved DraftKings data could not be read. Existing storage has not been changed.');
  return result.data as unknown as DKArchive;
}

/** Corrupt or inaccessible storage is an error, never a silent reset/overwrite. */
export function readDKArchive(storage: DKStorage): DKArchive {
  const raw = storage.getItem(DK_ARCHIVE_KEY);
  if (!raw) return emptyDKArchive();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Saved DraftKings data is invalid JSON. Existing storage has not been changed.'); }
  return validateDKArchive(parsed);
}
export function writeDKArchive(storage: DKStorage, archive: DKArchive) {
  archiveSchema.parse(archive);
  storage.setItem(DK_ARCHIVE_KEY, JSON.stringify(archive));
}
export function addDKSlate(archive: DKArchive, slate: DKSlate): DKArchive {
  if (archive.slates.some(item => item.id === slate.id)) throw new Error('This slate is already saved.');
  return { ...archive, slates: [slate, ...archive.slates] };
}
export function setOfficialScore(archive: DKArchive, score: DKOfficialScore): DKArchive {
  return { ...archive, official: [...archive.official.filter(item => !(
    item.season === score.season && item.team === score.team && item.playerId === score.playerId && item.week === score.week
  )), score] };
}