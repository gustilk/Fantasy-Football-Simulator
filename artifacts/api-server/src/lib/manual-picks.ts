import { createHash } from 'node:crypto';
import { GetSharedManualPicksResponse } from '@workspace/api-zod';
import type { StoredManualPicks } from '@workspace/db';

type Salary = { id: string; name: string; team: string; position: string; salary: number; rosterPosition: string; gameInfo: string };
// Must match the browser's existing v1 fingerprint, including its sort order.
export function contestSignature(players: Salary[]): string {
  return JSON.stringify([...players].sort((a, b) => a.id.localeCompare(b.id))
    .map(p => [p.id, p.name, p.team, p.position, p.salary, p.rosterPosition, p.gameInfo]));
}
export function contestKey(signature: string) {
  const value: unknown = JSON.parse(signature);
  if (!Array.isArray(value) || !value.length || value.length > 5000 || value.some(p =>
    !Array.isArray(p) || p.length !== 7 || [0, 1, 2, 3, 5, 6].some(i => typeof p[i] !== 'string')
    || !p[0].length || p[0].length > 50 || !Number.isInteger(p[4]) || p[4] <= 0 || p[4] > 50000)) {
    throw new Error('Invalid contest fingerprint.');
  }
  const rows = value as [string, string, string, string, number, string, string][];
  const ids = new Set(rows.map(p => p[0]));
  if (ids.size !== rows.length || JSON.stringify([...rows].sort((a, b) => a[0].localeCompare(b[0]))) !== signature) {
    throw new Error('Invalid contest fingerprint.');
  }
  return { contestHash: createHash('sha256').update(signature).digest('hex'), ids };
}
export function picksState(signature: string, row?: StoredManualPicks) {
  if (row && row.signature !== signature) throw new Error('Stored contest fingerprint does not match.');
  const state = GetSharedManualPicksResponse.parse({ signature, revision: row?.revision ?? 0, picks: row?.picks ?? [] });
  const { ids } = contestKey(signature);
  const seen = new Set<string>();
  for (const p of state.picks) {
    if (!ids.has(p.id) || seen.has(p.id)) throw new Error('Stored picks do not match this contest.');
    seen.add(p.id);
  }
  return state;
}
