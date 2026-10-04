// Apply only the user's requested 2026 tags. Uses versioned API saves and preserves all other fields.
import assert from 'node:assert/strict';
import type { TeamSeasonRecord } from '../lib/api-client-react/src/generated/api';
import { DEFENDER_ASSIGNMENTS, TEAM_DEFENSE_ASSIGNMENTS, getDefenderTier, isDefensivePosition } from '../artifacts/gridiron-sim/src/lib/defensive-tiers';
const base=`https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const response=await fetch(`${base}/season-teams?season=2026`);assert.ok(response.ok);
const records:TeamSeasonRecord[]=await response.json();
const assignments=DEFENDER_ASSIGNMENTS.map(([name,tier])=>{
  const normalized=name.toLowerCase().replace(/[^a-z0-9]/g,'');
  const matches=records.flatMap(team=>team.players.filter(p=>p.side==='defense'&&isDefensivePosition(p.position)&&p.name.toLowerCase().replace(/[^a-z0-9]/g,'')===normalized).map(player=>({team,player})));
  assert.equal(matches.length,1,`Unique saved-roster match required for ${name}; no roster relocation or invented player.`);
  return {...matches[0]!,tier};
});
for(const team of TEAM_DEFENSE_ASSIGNMENTS)assert.ok(records.some(r=>r.team===team),`Saved team missing: ${team}`);
for(const team of records){
  const tags=assignments.filter(a=>a.team.team===team.team),teamTag=(TEAM_DEFENSE_ASSIGNMENTS as readonly string[]).includes(team.team);
  if(!tags.length&&!teamTag)continue;
  const players=team.players.map(p=>{const tag=tags.find(t=>t.player.id===p.id);return tag?{...p,defensiveTier:tag.tier}:p;});
  const r=await fetch(`${base}/season-teams/2026/${encodeURIComponent(team.team)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:team.version,players,weeks:team.weeks,defenseTier:teamTag?1:team.defenseTier})});
  const saved:TeamSeasonRecord=await r.json();assert.ok(r.ok,`Versioned save failed for ${team.team}: ${JSON.stringify(saved)}`);
  assert.deepEqual(saved.weeks,team.weeks,`Existing game history must not change for ${team.team}`);
  for(const old of team.players){
    const next=saved.players.find(p=>p.id===old.id)!;assert.ok(next);
    assert.deepEqual({...next,defensiveTier:undefined},{...old,defensiveTier:undefined},`Only the defensive tier may change for ${old.name}`);
  }
  for(const tag of tags)assert.equal(getDefenderTier(saved.players.find(p=>p.id===tag.player.id)!),tag.tier);
  assert.equal(saved.defenseTier,teamTag?1:team.defenseTier);
  console.log(team.team,teamTag?'team 1x':'team unchanged',tags.map(t=>`${t.player.name} ${t.tier}x (${t.player.active?'active':'inactive; not reactivated'})`).join('; '));
}
console.log('All 12 player assignments and five team assignments saved; rosters, injuries, offense tags and histories preserved.');