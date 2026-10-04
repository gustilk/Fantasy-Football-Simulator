// Synthetic salaries for isolated browser tests only. Never present these as DraftKings prices.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { TeamSeasonRecord, NflSchedule } from '../lib/api-client-react/src/generated/api';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { gameForecast, type DKSlate } from '../artifacts/gridiron-sim/src/lib/draftkings-board';
import { TEAM_CODES } from '../artifacts/gridiron-sim/src/lib/lineups';

const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
async function get<T>(path:string):Promise<T>{const r=await fetch(base+path);assert.ok(r.ok);return r.json() as Promise<T>;}
const teams=await get<TeamSeasonRecord[]>('/season-teams?season=2026');
const schedule=await get<NflSchedule>('/nfl-schedule/2026');
const games=schedule.games.filter(g=>Date.parse(g.date)>Date.now() && g.date.startsWith('2026-10-04')).slice(0,3);
assert.equal(games.length,3);
const forecasts=games.map((game,i)=>{
  const away=teams.find(t=>t.team===game.awayTeam)!,home=teams.find(t=>t.team===game.homeTeam)!;
  const input={away:setupFromHistory(away,game.week,'away',home.team),home:setupFromHistory(home,game.week,'home',away.team),
    weather:{temperatureF:68,windMph:5,precipitation:'none' as const},seed:100+i};
  return gameForecast(game,input,simulateEnsemble(input,50));
});
delete forecasts[0]!.defenses; // Exercise safe replay for older saved offensive forecasts.
const slate:DKSlate={id:'isolated-lineup-browser-test',season:2026,sunday:'2026-10-04',createdAt:new Date().toISOString(),timezone:'America/Chicago',forecasts,failures:[]};
await writeFile('/tmp/lineup-test-archive.json',JSON.stringify({version:1,official:[],slates:[slate]}));
let csv='Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\r\n',id=900000;
const quote=(value:string)=>`"${value.replace(/"/g,'""')}"`;
const code=(team:string)=>Object.entries(TEAM_CODES).find(([,full])=>full===team)![0];
for(const f of forecasts){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).formatToParts(new Date(f.kickoff));
  const p=(type:string)=>parts.find(p=>p.type===type)!.value;
  const gameInfo=`${code(f.awayTeam)}@${code(f.homeTeam)} ${p('month')}/${p('day')}/${p('year')} ${p('hour')}:${p('minute')}${p('dayPeriod')} ET`;
  for(const player of [...f.players,...[f.awayTeam,f.homeTeam].map(team=>({team,name:TEAM_CODES[code(team)]!.split(' ').at(-1)!,position:'DST'}))]){
    const pid=String(id++),pos=player.position,salary=pos==='QB'?6500:pos==='RB'?5000:pos==='WR'?4800:pos==='TE'?3600:2800;
    csv+=[pos,quote(`${player.name} (${pid})`),quote(player.name),pid,['RB','WR','TE'].includes(pos)?`${pos}/FLEX`:pos,String(salary),gameInfo,code(player.team),'999'].join(',')+'\r\n';
  }
}
await writeFile('/tmp/lineup-test-salaries.csv',csv);
await writeFile('/tmp/lineup-test-wrong-week.csv',csv.replaceAll('10/04/2026','10/11/2026'));
console.log(`Isolated fixture: ${games.length} games, ${id-900000} synthetic salary rows; no saved server data changed.`);