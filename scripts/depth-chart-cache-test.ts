import assert from 'node:assert/strict';
import { getNflDepthChart } from '../artifacts/api-server/src/lib/nfl-source';

const originalFetch = globalThis.fetch;
const valid = (season: number) => ({
  season: { year: season }, team: { id: '14' },
  depthchart: [{ positions: Object.fromEntries(['QB', 'RB', 'WR', 'TE'].map((position, index) =>
    [position.toLowerCase(), { position: { abbreviation: position }, athletes: [{ id: String(index + 1) }] }])) }],
});
const calls = new Map<number, number>();
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/teams')) return Response.json({ sports: [{ leagues: [{ teams: [
    { team: { id: '14', displayName: 'Los Angeles Rams', abbreviation: 'LAR' } },
  ] }] }] });
  assert.ok(url.pathname.endsWith('/teams/14/depthcharts'));
  const year = Number(url.searchParams.get('season'));
  const count = (calls.get(year) ?? 0) + 1;
  calls.set(year, count);
  // A transient, HTTP-successful, defense-only response must not stay cached.
  if (year === 2026 && count === 1) return Response.json({ season: { year }, team: { id: '14' }, depthchart: [] });
  if (year === 2027 && count <= 2) return Response.json(valid(2025));
  return Response.json(valid(year));
}) as typeof fetch;
try {
  const recovered = await getNflDepthChart(2026, 'Los Angeles Rams');
  assert.equal(recovered.season, 2026);
  assert.equal(recovered.roles.length, 4);
  assert.equal(calls.get(2026), 2, 'One fresh retry recovers the transient incomplete chart');
  await getNflDepthChart(2026, 'Los Angeles Rams');
  assert.equal(calls.get(2026), 2, 'Validated successes still use the cache');
  await assert.rejects(() => getNflDepthChart(2027, 'Los Angeles Rams'), /after a fresh retry/);
  assert.equal(calls.get(2027), 2, 'Retries are bounded and never switch season');
  const later = await getNflDepthChart(2027, 'Los Angeles Rams');
  assert.equal(later.season, 2027);
  assert.equal(calls.get(2027), 3, 'Rejected wrong-year payload is not retained for the next request');
  console.log('Depth-chart cache: transient offense recovery, validated success caching, strict season validation, bounded retry and rejected-payload eviction passed.');
} finally {
  globalThis.fetch = originalFetch;
}