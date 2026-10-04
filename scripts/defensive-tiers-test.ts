import assert from 'node:assert/strict';
import { DEFENDER_ASSIGNMENTS, TEAM_DEFENSE_ASSIGNMENTS, getDefenderTier, getTeamDefenseTier, defensiveEventPriorities, type SimulationDefender } from '../artifacts/gridiron-sim/src/lib/defensive-tiers';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { simulateGame, type SimulationInput } from '../artifacts/gridiron-sim/src/lib/simulator';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { gameForecast } from '../artifacts/gridiron-sim/src/lib/draftkings-board';
import { readDKArchive, writeDKArchive } from '../artifacts/gridiron-sim/src/lib/draftkings-archive';
import { mergeNflImport } from '../artifacts/gridiron-sim/src/lib/nfl-import-merge';
import { SaveSeasonTeamBody, SaveSeasonTeamResponse } from '../lib/api-zod/src/generated/api';
import type { TeamSeasonRecord, NflImportPreview } from '../lib/api-client-react/src/generated/api';

assert.equal(DEFENDER_ASSIGNMENTS.filter(([,t])=>t===2).length,7);
assert.equal(DEFENDER_ASSIGNMENTS.filter(([,t])=>t===1).length,5);
for(const [name,tier] of DEFENDER_ASSIGNMENTS)assert.equal(getDefenderTier({name,position:name==='T.J. Watt'||name==='Fred Warner'?'LB':/Surtain|Witherspoon/.test(name)?'CB':name==='Kyle Hamilton'?'S':'EDGE',side:'defense'}),tier);
assert.equal(getDefenderTier({name:'Will Anderson',position:'EDGE'}),2);
assert.equal(getDefenderTier({name:'T. J. Watt',position:'LB'}),2);
assert.equal(getDefenderTier({name:'Myles Garrett',position:'EDGE',defensiveTier:0}),0);
assert.equal(getDefenderTier({name:'Myles Garrett',position:'WR',side:'offense'}),0);
for(const team of TEAM_DEFENSE_ASSIGNMENTS){assert.equal(getTeamDefenseTier({team}),1);assert.equal(getTeamDefenseTier({team,defenseTier:0}),0);}
assert.equal(getTeamDefenseTier({team:'Detroit Lions'}),0);
const edge:SimulationDefender={id:'edge',name:'Myles Garrett',position:'EDGE',defensiveTier:2};
const cb:SimulationDefender={id:'cb',name:'Pat Surtain II',position:'CB',defensiveTier:1};
assert.equal(defensiveEventPriorities({defenders:[edge]}).sacks,1.4);
assert.equal(defensiveEventPriorities({defenders:[{...edge,defensiveTier:1}]}).sacks,1.2);
assert.equal(defensiveEventPriorities({defenseTier:1,defenders:[edge]}).sacks,1.6);
assert.equal(defensiveEventPriorities({defenders:[edge]}).interceptions,1,'Edge tags never boost secondary interception priority');
assert.equal(defensiveEventPriorities({defenders:[edge]}).passesDefended,1);
assert.equal(defensiveEventPriorities({defenders:[cb]}).sacks,1,'CB tag never boosts pass-rush priority');
assert.equal(defensiveEventPriorities({defenders:[cb]}).interceptions,1.2);
assert.equal(defensiveEventPriorities({defenders:[{...edge,active:false}]}).sacks,1);
assert.equal(defensiveEventPriorities({defenders:[{...edge,recentStats:{sacks:0}}]}).sacks,1,'Known zero is not treated as missing');
assert.equal(defensiveEventPriorities({defenders:[{...edge,recentStats:{sacks:3}},{...edge,id:'normal',defensiveTier:0,recentStats:{sacks:1}}]}).sacks,1.3,'History-weighted contribution, not flat bonus for every named player');
assert.throws(()=>defensiveEventPriorities({defenders:[edge,edge]}));
assert.throws(()=>defensiveEventPriorities({defenseTier:2 as never}));
assert.throws(()=>defensiveEventPriorities({defenders:[{...edge,defensiveTier:3 as never}]}));
const record:TeamSeasonRecord={team:'Houston Texans',season:2026,version:1,defenseTier:1,players:[
  {id:'qb',name:'QB',side:'offense',position:'QB',active:true,eliteTier:3},
  {id:'edge',name:'Will Anderson Jr.',side:'defense',position:'EDGE',active:true,defensiveTier:2},
  {id:'out',name:'Danielle Hunter',side:'defense',position:'EDGE',active:true,defensiveTier:2,availabilityOverride:{week:4,status:'out',updatedAt:'2026-10-03T12:00:00Z'}},
  {id:'inactive',name:'Myles Garrett',side:'defense',position:'EDGE',active:false,defensiveTier:2},
],weeks:[]};
const frozen=structuredClone(record);
const setup=setupFromHistory(record,4,'home','Arizona Cardinals');
assert.deepEqual(record,frozen);
assert.equal(setup.defenseTier,1);
assert.deepEqual(setup.defenders!.map(p=>p.id),['edge']);
assert.deepEqual(setup.roster!.map(p=>p.id),['qb'],'Defenders never enter offensive NFL Classic projection pool');
assert.equal(setup.roster![0]!.eliteTier,3);
const merged=mergeNflImport(record,{players:record.players.map(p=>({...p,defensiveTier:undefined})),weeks:[]} as NflImportPreview,{updateRoster:true,replaceStats:false}).draft;
assert.equal(merged.players.find(p=>p.id==='edge')!.defensiveTier,2);
const none=mergeNflImport({...record,players:record.players.map(p=>({...p,defensiveTier:p.side==='defense'?0:undefined}))},{players:record.players,weeks:[]} as NflImportPreview,{updateRoster:true,replaceStats:false}).draft;
assert.equal(none.players.find(p=>p.id==='edge')!.defensiveTier,0,'Refresh never silently reinstates a disabled player tier');
assert.equal(SaveSeasonTeamBody.parse({...record,expectedVersion:1}).defenseTier,1);
assert.equal(SaveSeasonTeamResponse.parse(record).players[1]!.defensiveTier,2);
for(const invalid of [-1,3,'2'])assert.equal(SaveSeasonTeamBody.safeParse({...record,expectedVersion:1,players:[{...record.players[1]!,defensiveTier:invalid}]}).success,false);
assert.equal(SaveSeasonTeamBody.safeParse({...record,expectedVersion:1,defenseTier:2}).success,false);
const base:SimulationInput={away:{name:'Away',qb:'QB',rb:'RB',wr1:'WR1',wr2:'WR2',wr3:'WR3',te:'TE',kicker:'K',passRating:60,rushRating:60,defenseRating:60,context:''},home:{name:'Houston Texans',qb:'HQB',rb:'HRB',wr1:'HWR1',wr2:'HWR2',wr3:'HWR3',te:'HTE',kicker:'HK',passRating:60,rushRating:60,defenseRating:60,context:''},weather:{temperatureF:68,windMph:5,precipitation:'none'},seed:123};
for(const team of [base.away,base.home]){
  team.roster=([['qb','QB'],['rb','RB'],['wr1','WR'],['wr2','WR'],['wr3','WR'],['te','TE']] as const)
    .map(([key,position])=>({id:`${team.name}-${key}`,name:team[key],position}));
}
const neutral={...base,home:{...base.home,defenseTier:0 as const,defenders:[{...edge,defensiveTier:0 as const}]}};
assert.deepEqual(simulateGame(base),simulateGame(neutral),'Legacy snapshots are neutral and fixed-seed behavior is preserved');
const boosted={...base,home:{...base.home,defenseTier:1 as const,defenders:[edge,cb]}};
const result=simulateEnsemble(boosted,50);
assert.ok(result.overview.some(s=>s.includes('uncalibrated')));
assert.ok(result.overview.some(s=>s.includes('Myles Garrett 2x')));
const saved=gameForecast({id:'x',date:'2035-10-04T17:00:00Z',week:4,awayTeam:'Away',homeTeam:'Houston Texans'} as never,boosted,result);
const storage={value:'',getItem(){return this.value},setItem(_k:string,v:string){this.value=v}};
writeDKArchive(storage,{version:1,official:[],slates:[{id:'s',season:2035,sunday:'2035-10-04',createdAt:'2035-10-03T17:00:00Z',timezone:'America/Chicago',forecasts:[saved],failures:[]}]});
const loaded=readDKArchive(storage).slates[0]!.forecasts[0]!;
assert.deepEqual(loaded.input.home.defenders,boosted.home.defenders);
assert.equal(loaded.input.home.defenseTier,1);
assert.deepEqual(simulateEnsemble(loaded.input,50).ensemble!.defenseFantasy,result.ensemble!.defenseFantasy,'Saved defensive inputs replay exactly');
let sacksBase=0,sacksBoost=0,scoreBase=0,scoreBoost=0;
for(let i=1;i<=800;i++){
  const a=simulateGame({...base,seed:i}),b=simulateGame({...boosted,seed:i});
  sacksBase+=a.defenses![1]!.sacks;sacksBoost+=b.defenses![1]!.sacks;scoreBase+=a.awayScore;scoreBoost+=b.awayScore;
}
assert.ok(sacksBoost>sacksBase,'Defensive priority changes actual sack events');
assert.ok(scoreBoost<scoreBase,'Pass-breakup/run-stop priorities reduce opponent scoring across an ensemble');
console.log('Seven 2x/five 1x players, five 1x teams, overrides, role weights, additive stacking, injuries, imports, API contracts and frozen archive replay passed.',{sacksBase,sacksBoost,scoreBase,scoreBoost});