import type { ManualPickEntry, SharedManualPicks } from '@workspace/api-client-react';
import { MANUAL_PICKS_KEY, readManualPicks, type ManualPicks } from './manual-lineups';

const key = (season: number) => `gridiron-manual-picks-recovery-v2:${season}`;
export interface RecoveryDraft { signature: string; expectedRevision: number; picks: ManualPicks }
const isPicks = (picks: unknown): picks is ManualPicks => !!picks && typeof picks === 'object' && !Array.isArray(picks)
  && Object.values(picks).every(p => p && typeof p.selected === 'boolean' && typeof p.points === 'string' && p.points.length <= 100);
function readDrafts(storage: Pick<Storage, 'getItem'>, season: number): RecoveryDraft[] {
  const raw = storage.getItem(key(season));
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (value?.version !== 2 || !Array.isArray(value.drafts)
    || value.drafts.some((d: RecoveryDraft) => !d || typeof d.signature !== 'string'
      || !Number.isInteger(d.expectedRevision) || d.expectedRevision < 0 || !isPicks(d.picks))
    || new Set(value.drafts.map((d: RecoveryDraft) => d.signature)).size !== value.drafts.length) {
    throw new Error('Browser recovery data is unreadable and has been left unchanged.');
  }
  return value.drafts;
}
export function readRecovery(storage: Pick<Storage, 'getItem'>, season: number, signature: string) {
  return readDrafts(storage, season).find(d => d.signature === signature);
}
export function writeRecovery(storage: Pick<Storage, 'getItem' | 'setItem'>, season: number, draft: RecoveryDraft) {
  const drafts = readDrafts(storage, season).filter(d => d.signature !== draft.signature);
  storage.setItem(key(season), JSON.stringify({ version: 2, drafts: [...drafts, draft] }));
}
export function removeRecovery(storage: Pick<Storage, 'getItem' | 'setItem'>, season: number, signature: string) {
  const drafts = readDrafts(storage, season).filter(d => d.signature !== signature);
  storage.setItem(key(season), JSON.stringify({ version: 2, drafts }));
}
export function legacyDraft(storage: Pick<Storage, 'getItem'>, signature: string): ManualPicks | undefined {
  // Validate even nonmatching legacy data, and never write or remove the v1 key.
  const picks = readManualPicks(storage, signature);
  const raw = storage.getItem(MANUAL_PICKS_KEY);
  return raw && JSON.parse(raw).signature === signature ? picks : undefined;
}
export function pickEntries(picks: ManualPicks): ManualPickEntry[] {
  return Object.entries(picks).sort(([a], [b]) => a.localeCompare(b)).map(([id, p]) => ({ id, ...p }));
}
export const samePicks = (a: ManualPicks, b: ManualPicks) => JSON.stringify(pickEntries(a)) === JSON.stringify(pickEntries(b));
export function validateSharedPicks(value: SharedManualPicks, signature: string): SharedManualPicks {
  const ids = new Set((JSON.parse(signature) as unknown[][]).map(p => p[0]));
  if (!value || value.signature !== signature || !Number.isInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.picks) || value.picks.length > 5000
    || value.picks.some(p => !p || !ids.has(p.id) || typeof p.selected !== 'boolean'
      || typeof p.points !== 'string' || p.points.length > 100)
    || new Set(value.picks.map(p => p.id)).size !== value.picks.length) throw new Error('Shared picks are unreadable; no data was replaced.');
  return value;
}
export function picksRecord(value: SharedManualPicks): ManualPicks {
  return Object.fromEntries(value.picks.map(({ id, selected, points }) => [id, { selected, points }]));
}
