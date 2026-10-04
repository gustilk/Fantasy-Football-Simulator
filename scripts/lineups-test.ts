import assert from 'node:assert/strict';
import { parseSalaryCsv, buildLineupPool, lineupSlots, exportLineups, type LineupPlayer, type Lineup } from '../artifacts/gridiron-sim/src/lib/lineups';
import { optimizeLineups } from '../artifacts/gridiron-sim/src/lib/lineup-optimizer';
import { calculateDefenseDraftKings, defensePointsAllowed } from '../artifacts/gridiron-sim/src/lib/draftkings-defense';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { simulateGame, type SimulationInput } from '../artifacts/gridiron-sim/src/lib/simulator';
import { gameForecast, type DKSlate } from '../artifacts/gridiron-sim/src/lib/draftkings-board';
import { readDKArchive, writeDKArchive } from '../artifacts/gridiron-sim/src/lib/draftkings-archive';

const csv = '\uFEFFPosition,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\r\nQB,"Test ""QB"" (100)","Test ""QB""",100,QB,5000,BUF@DET 10/04/2035 01:00PM ET,BUF,99\r\n';
const salaries = parseSalaryCsv(csv);
assert.equal(salaries[0]!.name, 'Test "QB"');
for (const bad of [csv.replace('5000', '0'), csv.replace('5000', '5000.1'), csv.replace(',QB,5000', ',CPT,5000'), csv + csv.split('\r\n')[1] + '\r\n', csv.replace('TeamAbbrev', 'Wrong'), csv.replace('"Test ""QB""",100', '"Unclosed,100')]) {
  assert.throws(() => parseSalaryCsv(bad));
}
assert.equal(defensePointsAllowed(0), 10);
assert.deepEqual([6,7,13,14,20,21,27,28,34,35].map(defensePointsAllowed), [7,4,4,1,1,0,0,-1,-1,-4]);
assert.equal(calculateDefenseDraftKings({ sacks:3, interceptions:2, fumblesRecovered:1, pointsAllowed:17, defensiveTD:1, returnTD:1, safeties:1, blockedKicks:1, conversionReturns:1 }), 28);
assert.throws(() => calculateDefenseDraftKings({ sacks:NaN,interceptions:0,fumblesRecovered:0,pointsAllowed:0 }));

const kickoff = '2035-10-04T17:00:00Z';
const input: SimulationInput = {
  away: { name:'Buffalo Bills',qb:'Test "QB"',rb:'RB',wr1:'WR1',wr2:'WR2',wr3:'WR3',te:'TE',kicker:'K',passRating:60,rushRating:60,defenseRating:60,context:'',
    roster:[{id:'a-qb',name:'Test "QB"',position:'QB'},{id:'a-rb',name:'RB',position:'RB'},{id:'a-wr1',name:'WR1',position:'WR'},{id:'a-wr2',name:'WR2',position:'WR'},{id:'a-te',name:'TE',position:'TE'}] },
  home: { name:'Detroit Lions',qb:'Other QB',rb:'RB',wr1:'WR1',wr2:'WR2',te:'TE',kicker:'K',passRating:60,rushRating:60,defenseRating:60,context:'',
    roster:[{id:'h-qb',name:'Other QB',position:'QB'},{id:'h-rb',name:'RB',position:'RB'},{id:'h-wr1',name:'WR1',position:'WR'},{id:'h-te',name:'TE',position:'TE'}] },
  weather:{temperatureF:68,windMph:5,precipitation:'none'}, seed:7,
};
const simulated = simulateEnsemble(input, 50);
assert.equal(simulated.ensemble!.defenseFantasy!.length, 2);
const raw = simulateGame(input);
assert.equal(raw.defenses![0]!.interceptions, raw.players.filter(p=>p.team===input.home.name).reduce((n,p)=>n+p.interceptions,0));
assert.equal(raw.defenses![0]!.pointsAllowed, raw.homeScore);
const game = {id:'game1',week:4,date:kickoff,awayTeam:input.away.name,homeTeam:input.home.name} as Parameters<typeof gameForecast>[0];
const forecast = gameForecast(game,input,simulated);
const slate: DKSlate = {id:'slate',season:2035,sunday:'2035-10-04',createdAt:'2035-10-03T12:00:00Z',timezone:'America/Chicago',forecasts:[forecast],failures:[]};
const rows = [...salaries, {...salaries[0]!,id:'101',name:'Bills',position:'DST' as const,rosterPosition:'DST',salary:3000}];
const now = Date.parse('2035-10-03T12:00:00Z');
assert.equal(buildLineupPool(rows,slate,undefined,now).players.length, 2);
assert.equal(buildLineupPool(rows,slate,undefined,Date.parse(kickoff)).players.length, 0, 'Started games excluded');
assert.equal(buildLineupPool(rows.map(p=>({...p,gameInfo:p.gameInfo.replace('2035','2034')})),slate,undefined,now).players.length, 0, 'Wrong-week/year salaries never reused');
const legacy = structuredClone(slate); delete legacy.forecasts[0]!.defenses;
assert.deepEqual(buildLineupPool(rows,legacy,undefined,now).players.map(p=>p.mean),buildLineupPool(rows,slate,undefined,now).players.map(p=>p.mean));
assert.equal(legacy.forecasts[0]!.defenses,undefined,'Legacy archive is never mutated by DST replay');
const current = [{team:input.away.name,season:2035,players:[{id:'a-qb',name:'Test "QB"',active:true,position:'QB',side:'offense',availabilityOverride:{week:4,status:'out',updatedAt:'2035-10-03T12:00:00Z'}}]}] as Parameters<typeof buildLineupPool>[2];
assert.equal(buildLineupPool(salaries,slate,current,now).players.length,0,'Current weekly Out override excludes an archived projection');
const storage={raw:'',getItem(){return this.raw;},setItem(_key:string,value:string){this.raw=value;}};
writeDKArchive(storage,{version:1,official:[],slates:[slate]});
assert.deepEqual(readDKArchive(storage).slates[0]!.forecasts[0]!.defenses,forecast.defenses);

const compare = (a:Lineup,b:Lineup)=>(Math.abs(b.points-a.points)>1e-9?b.points-a.points:0)||a.salary-b.salary||a.players.map(p=>p.id).sort().join(',').localeCompare(b.players.map(p=>p.id).sort().join(','));
const make = (position:LineupPlayer['position'],i:number,seed:number):LineupPlayer=>({
  id:String(1000+i),name:`Player ${i}`,position,team:i%2?'BUF':'DET',salary:1000+((i*13+seed*17)%80)*100,
  mean:((i*31+seed*11)%350)/10-2,rosterPosition:position,gameInfo:'',gameId:i%3?'game1':'game2',kickoff,projectionSource:'test',
});
for(let seed=1;seed<=24;seed++){
  const positions:LineupPlayer['position'][]=['QB','QB','RB','RB','RB','RB','WR','WR','WR','WR','WR','TE','TE','TE','DST','DST'];
  const pool=positions.map((position,i)=>make(position,i,seed));
  const legal:Lineup[]=[];
  function enumerate(start:number,chosen:LineupPlayer[]){
    if(chosen.length===9){
      const c=(position:string)=>chosen.filter(p=>p.position===position).length;
      const salary=chosen.reduce((n,p)=>n+p.salary,0);
      if(c('QB')===1&&c('DST')===1&&c('RB')>=2&&c('WR')>=3&&c('TE')>=1&&salary<=50000&&new Set(chosen.map(p=>p.gameId)).size>=2)legal.push({players:[...chosen],salary,points:chosen.reduce((n,p)=>n+p.mean,0)});
      return;
    }
    for(let i=start;i<=pool.length-(9-chosen.length);i++)enumerate(i+1,[...chosen,pool[i]!]);
  }
  enumerate(0,[]);legal.sort(compare);
  const optimized=optimizeLineups(pool,5);
  assert.deepEqual(optimized.map(l=>l.players.map(p=>p.id).sort()),legal.slice(0,5).map(l=>l.players.map(p=>p.id).sort()),`Exact top five matches exhaustive search, seed ${seed}`);
  optimized.forEach(l=>{assert.equal(lineupSlots(l).length,9);assert.ok(l.salary<=50000);});
}
const basePositions:LineupPlayer['position'][]=['QB','RB','RB','WR','WR','WR','TE','RB','DST'];
const exact=basePositions.map((pos,i)=>({...make(pos,i,1),salary:i===0?10000:5000,mean: i===8?-1:0}));
assert.equal(optimizeLineups(exact)[0]!.salary,50000,'Exactly $50k legal, including zero and negative projections');
assert.equal(optimizeLineups(exact.map(p=>({...p,salary:p.salary+1}))).length,0,'Over cap rejected');
assert.equal(optimizeLineups(exact.map(p=>({...p,gameId:'only-game'}))).length,0,'At least two different games');
assert.throws(()=>optimizeLineups([...exact,exact[0]!]));
const output=exportLineups(optimizeLineups(exact,1));
assert.equal(output.split('\r\n')[0],'QB,RB,RB,WR,WR,WR,TE,FLEX,DST');
assert.equal(output.split('\r\n')[1]!.split(',').length,9);
const realistic = Array.from({length:230},(_,i)=>make(i<24?'QB':i<75?'RB':i<160?'WR':i<208?'TE':'DST',i,9));
const start=performance.now();const best=optimizeLineups(realistic,3);
assert.equal(best.length,3);
console.log(`CSV validation, exact contest/date matching, injury exclusions, DST rules/replay/archives, top-five exhaustive checks, FLEX/cap/two-game rules and export passed. Full 230-player pool: ${Math.round(performance.now()-start)} ms.`);