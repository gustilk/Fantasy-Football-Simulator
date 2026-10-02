import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowRight, Bookmark, ChevronDown, CircleHelp, Cloud, CloudRain, Crosshair, RotateCw, Shield, SlidersHorizontal, Trash2, Trophy, Wind } from 'lucide-react';
import { simulateGame } from '@/lib/simulator';

type Weather = { temperatureF: number; windMph: number; precipitation: 'none' | 'light' | 'moderate' | 'heavy' };
type TeamSetup = {
  name: string; qb: string; rb: string; wr1: string; wr2: string; te: string; kicker: string;
  passRating: number; rushRating: number; defenseRating: number; context: string;
};
type SimulationInput = { away: TeamSetup; home: TeamSetup; weather: Weather; seed?: number };
type SimPlayer = {
  name: string; position: string; team: string; passYards: number; passTD: number; interceptions: number;
  rushYards: number; rushTD: number; receptions: number; receivingYards: number; receivingTD: number;
  fumblesLost: number; halfPpr: number;
};
type Drive = { id: number; quarter: number; team: string; result: string; summary: string; plays: string[] };
type SimulationResult = {
  seed: number; awayScore: number; homeScore: number; totalPlays: { away: number; home: number };
  overview: string[]; drives: Drive[]; players: SimPlayer[];
};
type SavedSimulation = { id: string; savedAt: string; awayName: string; homeName: string; result: SimulationResult };
type StoredSetup = { away: TeamSetup; home: TeamSetup; weather: Weather };

const NFL_TEAMS = [
  'Arizona Cardinals','Atlanta Falcons','Baltimore Ravens','Buffalo Bills','Carolina Panthers','Chicago Bears','Cincinnati Bengals','Cleveland Browns',
  'Dallas Cowboys','Denver Broncos','Detroit Lions','Green Bay Packers','Houston Texans','Indianapolis Colts','Jacksonville Jaguars','Kansas City Chiefs',
  'Las Vegas Raiders','Los Angeles Chargers','Los Angeles Rams','Miami Dolphins','Minnesota Vikings','New England Patriots','New Orleans Saints',
  'New York Giants','New York Jets','Philadelphia Eagles','Pittsburgh Steelers','San Francisco 49ers','Seattle Seahawks','Tampa Bay Buccaneers',
  'Tennessee Titans','Washington Commanders',
];
const defaultAway: TeamSetup = {
  name:'San Francisco 49ers', qb:'Brock Purdy', rb:'Christian McCaffrey', wr1:'Brandon Aiyuk', wr2:'Deebo Samuel', te:'George Kittle', kicker:'Jake Moody',
  passRating:65, rushRating:67, defenseRating:62, context:'Strong play-action offense; keep an eye on red-zone usage.',
};
const defaultHome: TeamSetup = {
  name:'Detroit Lions', qb:'Jared Goff', rb:'Jahmyr Gibbs', wr1:'Amon-Ra St. Brown', wr2:'Jameson Williams', te:'Sam LaPorta', kicker:'Jake Bates',
  passRating:64, rushRating:62, defenseRating:57, context:'High-volume passing environment with a balanced backfield.',
};
const DEFAULT_SETUP: StoredSetup = {
  away: defaultAway, home: defaultHome, weather: { temperatureF:68, windMph:7, precipitation:'none' },
};
const setupStorageKey = 'gridiron-sim-setup-v1';
const resultsStorageKey = 'gridiron-sim-results-v1';

function readSetup(): StoredSetup {
  try {
    const parsed = JSON.parse(localStorage.getItem(setupStorageKey) || 'null') as Partial<StoredSetup> | null;
    return parsed?.away && parsed.home && parsed.weather ? { ...DEFAULT_SETUP, ...parsed } : DEFAULT_SETUP;
  } catch { return DEFAULT_SETUP; }
}
function readSaved(): SavedSimulation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(resultsStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch { return []; }
}
function initials(team: string) {
  const words = team.replace('Los Angeles', 'LA').replace('New York', 'NY').replace('New England', 'NE').split(/\s+/);
  return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase() : team.slice(0, 2).toUpperCase();
}
function formatSavedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved matchup' : date.toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function App() {
  const [setup, setSetup] = useState<StoredSetup>(readSetup);
  const [saved, setSaved] = useState<SavedSimulation[]>(readSaved);
  const [active, setActive] = useState<SimulationResult | null>(null);
  const [activeNames, setActiveNames] = useState<{ away:string; home:string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try { localStorage.setItem(setupStorageKey, JSON.stringify(setup)); } catch { setNotice('Browser storage is unavailable; this setup will not persist.'); }
  }, [setup]);
  useEffect(() => {
    try { localStorage.setItem(resultsStorageKey, JSON.stringify(saved.slice(0, 10))); } catch { setNotice('Browser storage is unavailable; saved simulations may not persist.'); }
  }, [saved]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const patchTeam = (side: 'away' | 'home', field: keyof TeamSetup, value: string | number) => {
    setSetup(current => ({ ...current, [side]: { ...current[side], [field]: value } }));
  };
  const runSimulation = () => {
    setBusy(true);
    setError('');
    window.setTimeout(() => {
      try {
        const input: SimulationInput = {
          ...setup,
          seed: Math.floor(Math.random() * 2_000_000_000) + 1,
        };
        const result = simulateGame(input) as SimulationResult;
        setActive(result);
        setActiveNames({ away: setup.away.name, home: setup.home.name });
        const entry: SavedSimulation = {
          id: `${Date.now()}-${result.seed}`,
          savedAt: new Date().toISOString(),
          awayName: setup.away.name,
          homeName: setup.home.name,
          result,
        };
        setSaved(current => [entry, ...current.filter(item => item.id !== entry.id)].slice(0, 10));
        setNotice('Simulation complete. Result saved to this device.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The simulation could not be completed. Check your setup and try again.');
      } finally { setBusy(false); }
    }, 180);
  };
  const openSaved = (item: SavedSimulation) => {
    setActive(item.result);
    setActiveNames({ away: item.awayName, home: item.homeName });
    setError('');
    setNotice('Saved result reopened.');
  };
  const removeSaved = (id: string) => {
    setSaved(items => items.filter(item => item.id !== id));
    setNotice('Saved simulation removed.');
  };
  const currentAwayName = activeNames?.away || setup.away.name;
  const currentHomeName = activeNames?.home || setup.home.name;
  const isTie = active && active.homeScore === active.awayScore;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Activity size={19} strokeWidth={2.4} /></div>
          <div><div className="brand-name">GRIDIRON SIM</div><div className="brand-sub">Fantasy matchup lab</div></div>
        </div>
        <div className="top-status"><span className="live-dot" /> LOCAL SIMULATION <span aria-hidden="true">·</span> NO FEED REQUIRED</div>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">WEEKEND WORKBENCH / MATCHUP MODEL</div>
            <h1>Run the matchup.</h1>
            <p>Tune the inputs. See how the game could unfold.</p>
          </div>
          <div className="method-pill"><CircleHelp size={14} /><span>Stochastic estimate · not a prediction</span></div>
        </div>

        <div className="main-grid">
          <section className="panel setup-panel" aria-labelledby="setup-title">
            <div className="panel-top">
              <div className="panel-title" id="setup-title">MATCHUP SETUP</div>
              <div className="panel-index">01 / CONFIGURE</div>
            </div>
            <TeamEditor team={setup.away} side="away" patchTeam={patchTeam} />
            <TeamEditor team={setup.home} side="home" patchTeam={patchTeam} />
            <div className="config-bottom">
              <h3 className="section-mini-title">GAME CONDITIONS</h3>
              <div className="weather-grid">
                <Field label="Temperature" htmlFor="temperature"><input id="temperature" type="number" min="0" max="120" value={setup.weather.temperatureF} onChange={e => setSetup(s => ({ ...s, weather:{ ...s.weather, temperatureF:Number(e.target.value) } }))} data-testid="input-temperature" /></Field>
                <Field label="Wind · mph" htmlFor="wind"><input id="wind" type="number" min="0" max="80" value={setup.weather.windMph} onChange={e => setSetup(s => ({ ...s, weather:{ ...s.weather, windMph:Number(e.target.value) } }))} data-testid="input-wind" /></Field>
                <Field label="Precipitation" htmlFor="precipitation">
                  <select id="precipitation" value={setup.weather.precipitation} onChange={e => setSetup(s => ({ ...s, weather:{ ...s.weather, precipitation:e.target.value as Weather['precipitation'] } }))} data-testid="select-precipitation">
                    <option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option>
                  </select>
                </Field>
                <div className="field"><label>Conditions</label><div style={{height:37,display:'flex',alignItems:'center',gap:7,color:'#6d796e',fontSize:11}}>{setup.weather.precipitation === 'none' ? <Wind size={14}/> : <CloudRain size={14}/>} {setup.weather.windMph} mph · {setup.weather.temperatureF}°F</div></div>
              </div>
              <div className="setup-actions">
                <button className="btn-primary" onClick={runSimulation} disabled={busy} data-testid="button-run-simulation">
                  {busy ? <><RotateCw size={15} className="spin-icon" /> Running model…</> : <><Crosshair size={16} /> Run simulation <ArrowRight size={15} /></>}
                </button>
              </div>
              {error && <div role="alert" style={{marginTop:11,color:'#a34435',fontSize:12}}>{error} <button className="text-button" onClick={runSimulation}>Retry</button></div>}
            </div>
          </section>

          <div className="result-column">
            <section className="panel result-panel" aria-labelledby="results-title">
              {!active ? <div className="empty-result">
                <div className="empty-orbit"><SlidersHorizontal size={30} strokeWidth={1.5}/></div>
                <div className="eyebrow">YOUR LAB IS READY</div>
                <h3>Build a game scenario</h3>
                <p>Set each side’s roster, team ratings, and conditions. Your first run will create a drive-by-drive game and a complete Half-PPR projection.</p>
              </div> : <SimulationResults result={active} awayName={currentAwayName} homeName={currentHomeName} onRun={runSimulation} busy={busy}/>}
            </section>
            <section className="panel saved-panel" aria-labelledby="saved-heading">
              <div className="saved-header">
                <div className="saved-title" id="saved-heading"><Bookmark size={15}/> SAVED RUNS</div>
                <div className="saved-count">{saved.length} / 10</div>
              </div>
              {saved.length === 0 ? <div className="saved-empty">Your saved simulations will collect here on this device.</div> :
                <div className="saved-list">{saved.map(item => (
                  <div className="saved-item" key={item.id} data-testid={`saved-run-${item.id}`}>
                    <button className="saved-open" onClick={() => openSaved(item)} data-testid={`button-open-saved-${item.id}`}>
                      <span aria-hidden="true" style={{font: '10px var(--app-font-mono)',color:'#8c927f'}}>↳</span>
                      <span style={{minWidth:0,display:'flex',flexDirection:'column',gap:2}}><strong>{item.awayName} at {item.homeName}</strong><span>{formatSavedDate(item.savedAt)} · seed {item.result.seed}</span></span>
                    </button>
                    <span className="saved-score">{item.result.awayScore} — {item.result.homeScore}</span>
                    <button className="saved-remove" aria-label={`Delete saved result ${item.awayName} at ${item.homeName}`} title="Delete saved result" onClick={() => removeSaved(item.id)} data-testid={`button-delete-saved-${item.id}`}><Trash2 size={14}/></button>
                  </div>
                ))}</div>}
            </section>
            <div className="footnote"><strong>Method note.</strong> Gridiron Sim is a stochastic estimate, not a prediction. It has no live roster, injury, weather, or statistics feed. Player labels and all team ratings are supplied by you; results are stored only in this browser.</div>
          </div>
        </div>
      </main>
      {notice && <div className="notice" role="status">{notice}</div>}
    </div>
  );
}

function Field({ label, htmlFor, children, full = false }: { label:string; htmlFor?:string; children:ReactNode; full?:boolean }) {
  return <div className={`field${full ? ' full' : ''}`}><label htmlFor={htmlFor}>{label}</label>{children}</div>;
}
function TeamEditor({ team, side, patchTeam }: { team:TeamSetup; side:'away'|'home'; patchTeam:(side:'away'|'home',field:keyof TeamSetup,value:string|number)=>void }) {
  const label = side === 'away' ? 'AWAY TEAM' : 'HOME TEAM';
  const fields: {key:'qb'|'rb'|'wr1'|'wr2'|'te'|'kicker'; label:string; placeholder:string}[] = [
    {key:'qb',label:'Quarterback',placeholder:'QB name'}, {key:'rb',label:'Running back',placeholder:'RB name'},
    {key:'wr1',label:'Wide receiver 1',placeholder:'WR1 name'}, {key:'wr2',label:'Wide receiver 2',placeholder:'WR2 name'},
    {key:'te',label:'Tight end',placeholder:'TE name'}, {key:'kicker',label:'Kicker',placeholder:'K name'},
  ];
  const ratings: {key:'passRating'|'rushRating'|'defenseRating';label:string}[] = [
    {key:'passRating',label:'Pass offense'}, {key:'rushRating',label:'Rush offense'}, {key:'defenseRating',label:'Defense'},
  ];
  return <div className="team-block">
    <div className="team-heading"><div className="team-label"><span className={`team-crest ${side === 'home' ? 'orange' : ''}`} style={{width:29,height:29,borderRadius:8,fontSize:11}}>{initials(team.name)}</span>{label}</div><span className="team-chip">{side === 'away' ? 'VISITOR' : 'AT HOME'}</span></div>
    <div className="form-grid">
      <Field label="NFL team" htmlFor={`${side}-team`} full>
        <select id={`${side}-team`} value={team.name} onChange={e => patchTeam(side,'name',e.target.value)} data-testid={`select-${side}-team`}>
          {NFL_TEAMS.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </Field>
      {fields.map(field => <Field label={field.label} htmlFor={`${side}-${field.key}`} key={field.key}>
        <input id={`${side}-${field.key}`} value={team[field.key]} placeholder={field.placeholder} onChange={e => patchTeam(side,field.key,e.target.value)} data-testid={`input-${side}-${field.key}`} />
      </Field>)}
      <Field label="Context / injuries" htmlFor={`${side}-context`} full>
        <textarea id={`${side}-context`} value={team.context} maxLength={220} placeholder="Add player availability, role notes, or matchup context…" onChange={e => patchTeam(side,'context',e.target.value)} data-testid={`input-${side}-context`} />
      </Field>
    </div>
    <div className="ratings" aria-label={`${side} ratings`}>
      {ratings.map(rating => <div className="rating-control" key={rating.key}>
        <label htmlFor={`${side}-${rating.key}`}>{rating.label}</label>
        <input id={`${side}-${rating.key}`} type="range" min="35" max="75" step="1" value={team[rating.key]} onChange={e => patchTeam(side,rating.key,Number(e.target.value))} aria-valuetext={`${team[rating.key]} out of 75`} data-testid={`range-${side}-${rating.key}`} />
        <span className="rating-val">{team[rating.key]}</span>
      </div>)}
    </div>
  </div>;
}

function SimulationResults({ result, awayName, homeName, onRun, busy }: { result:SimulationResult; awayName:string; homeName:string; onRun:()=>void; busy:boolean }) {
  const playersByTeam = useMemo(() => {
    const groups = new Map<string, SimPlayer[]>();
    result.players.forEach(player => groups.set(player.team, [...(groups.get(player.team) || []), player]));
    return [...groups.entries()];
  }, [result.players]);
  const winner = result.awayScore === result.homeScore ? 'Even on the board' : result.awayScore > result.homeScore ? awayName : homeName;
  return <>
    <div className="result-topline">
      <div><div className="result-label"><Trophy size={13}/> MODEL OUTPUT <span>·</span> SEED {result.seed}</div><h2 id="results-title">Final simulation</h2></div>
      <div className="result-actions"><button className="icon-button" aria-label="Run a new simulation" title="Run a new simulation" onClick={onRun} disabled={busy} data-testid="button-rerun"><RotateCw size={15}/></button></div>
    </div>
    <div className="scoreboard" data-testid="simulation-score">
      <div className="score-side">
        <div className="team-crest">{initials(awayName)}</div><div><div className="score-name">{awayName}</div><div className="score-meta">AWAY · {result.totalPlays.away} PLAYS</div></div>
        <div className="score-num">{result.awayScore}</div>
      </div>
      <div className="score-divider">FINAL</div>
      <div className="score-side home">
        <div className="score-num score-home-num">{result.homeScore}</div><div><div className="score-name">{homeName}</div><div className="score-meta">HOME · {result.totalPlays.home} PLAYS</div></div><div className="team-crest orange">{initials(homeName)}</div>
      </div>
    </div>
    <div className="game-stats">
      <div className="game-stat"><Activity size={13}/> TOTAL <strong>{result.totalPlays.away + result.totalPlays.home}</strong> PLAYS</div>
      <div className="game-stat"><Shield size={13}/> OUTCOME <strong>{winner}</strong></div>
      <div className="game-stat"><Cloud size={13}/> QUARTERS <strong>4</strong></div>
    </div>
    <div className="result-content">
      <section aria-labelledby="overview-title">
        <div className="content-heading" id="overview-title"><Crosshair size={15} className="heading-icon"/> MATCHUP READ &amp; X-FACTORS</div>
        {result.overview.length ? <ul className="overview-list" data-testid="simulation-overview">{result.overview.map((line,index) => <li key={`${index}-${line}`}>{line}</li>)}</ul> : <p style={{fontSize:12,color:'#777'}}>No overview notes were returned for this run.</p>}
      </section>
      <div className="result-sections">
        <section className="subsection" aria-labelledby="drives-title">
          <div className="content-heading" id="drives-title"><Activity size={15} className="heading-icon"/> DRIVE TRACKER <span className="panel-index">{result.drives.length} SERIES</span></div>
          <div className="drive-scroll" data-testid="drive-log">
            {result.drives.length === 0 ? <div className="saved-empty" style={{padding:14}}>No drive log was returned.</div> : [...result.drives].sort((a,b)=>a.id-b.id).map((drive,index) =>
              <details className="drive" key={`${drive.id}-${index}`}>
                <summary><span className="quarter-badge">Q{drive.quarter}</span><span>{drive.team}</span><span className="drive-result">{drive.result}</span><ChevronDown size={13}/></summary>
                <div className="drive-summary">{drive.summary}</div>
                {drive.plays.length > 0 && <div className="play-list">{drive.plays.map((play,playIndex)=><span key={`${drive.id}-play-${playIndex}`}>{String(playIndex+1).padStart(2,'0')} &nbsp;{play}</span>)}</div>}
              </details>
            )}
          </div>
        </section>
        <section className="subsection" aria-labelledby="players-title">
          <div className="content-heading" id="players-title"><Trophy size={15} className="heading-icon"/> HALF-PPR PROJECTIONS <span className="panel-index">{result.players.length} PLAYERS</span></div>
          <div className="player-table-wrap">
            <table className="player-table" data-testid="player-projections">
              <thead><tr><th>Player</th><th>Pass<br/>Yds</th><th>Pass<br/>TD / INT</th><th>Rush<br/>Yds / TD</th><th>Rec<br/>REC / YDS / TD</th><th>FUM</th><th>½ PPR</th></tr></thead>
              <tbody>{playersByTeam.map(([team,players]) => <FragmentGroup key={team} team={team} players={players}/>)}</tbody>
            </table>
          </div>
        </section>
      </div>
      <div className="footnote"><strong>Reading the model.</strong> Half-PPR totals are stochastic estimates from this run’s seeded drive simulation. They are not sourced from live player or team data.</div>
    </div>
  </>;
}
function FragmentGroup({ team, players }: { team:string; players:SimPlayer[] }) {
  return <>
    <tr className="team-group-row"><td colSpan={7}>{team}</td></tr>
    {players.map((player,index)=><tr key={`${team}-${player.name}-${index}`} data-testid={`projection-${team}-${index}`}>
      <td className="player-name">{player.name}<span className="player-pos">{player.position}</span></td>
      <td>{player.passYards}</td><td>{player.passTD} / {player.interceptions}</td><td>{player.rushYards} / {player.rushTD}</td>
      <td>{player.receptions} / {player.receivingYards} / {player.receivingTD}</td><td>{player.fumblesLost}</td><td className="fantasy-points">{Number(player.halfPpr).toFixed(1)}</td>
    </tr>)}
  </>;
}

export default App;