import assert from 'node:assert/strict';
import { assignedEliteTier } from '../artifacts/gridiron-sim/src/lib/elite-players';
import { ListSeasonTeamsResponse, SaveSeasonTeamResponse } from '../lib/api-zod/src/generated/api';

// Explicit maintenance action only; never run automatically on app startup.
const season = Number(process.argv[2]);
assert.ok(Number.isInteger(season) && season >= 2000 && season <= 2100, 'Provide a season, e.g. 2026');
assert.ok(process.env.REPLIT_DEV_DOMAIN, 'Development domain is required');
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api/season-teams`;
const response = await fetch(`${base}?season=${season}`);
assert.ok(response.ok, `Could not read teams: ${response.status}`);
const teams = ListSeasonTeamsResponse.parse(await response.json());
let updated = 0;
for (const team of teams) {
  const changes: { name: string; tier: number }[] = [];
  const players = team.players.map(player => {
    const tier = player.side === 'offense' ? assignedEliteTier(player) : undefined;
    if (tier === undefined || (player.eliteTier === tier && player.elite1x === true)) return player;
    changes.push({ name: player.name, tier });
    return { ...player, eliteTier: tier, elite1x: true };
  });
  if (!changes.length) continue;
  const saved = await fetch(`${base}/${season}/${encodeURIComponent(team.team)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: team.version, players, weeks: team.weeks }),
  });
  assert.ok(saved.ok, `${team.team}: save failed (${saved.status}); no concurrency override attempted`);
  const actual = SaveSeasonTeamResponse.parse(await saved.json());
  assert.deepEqual(actual.players, players, `${team.team}: saved roster differs`);
  assert.deepEqual(actual.weeks, team.weeks, `${team.team}: weekly history must not change`);
  console.log(`${team.team}: ${changes.map(p => `${p.name} ${p.tier}x`).join(', ')}`);
  updated += changes.length;
}
console.log(`Assigned ${updated} stored player(s) for ${season}. Unlisted players and weekly history were retained.`);