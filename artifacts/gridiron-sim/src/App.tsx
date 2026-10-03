import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowRight, Bookmark, ChevronDown, CircleHelp, Cloud, CloudRain, Crosshair, RotateCw, Shield, SlidersHorizontal, Trash2, Trophy, Wind } from 'lucide-react';
import { type WeatherSetup as Weather, type TeamSetup, type SimulationInput, type SimulationResult, type PlayerProjection as SimPlayer, type PlayerRecentStats, type DefenseRecentStats } from '@/lib/simulator';
import { useListSeasonTeams, getListSeasonTeamsQueryKey, type TeamSeasonRecord } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import TeamLibrary from '@/components/TeamLibrary';
import HistoryTeamPicker from '@/components/HistoryTeamPicker';
import { setupFromHistory } from '@/lib/season-model';
import { simulateEnsemble } from '@/lib/ensemble';
import './season.css';

type SavedSimulation = { id: string; savedAt: string; awayName: string; homeName: string; result: SimulationResult; setup?: StoredSetup };
type StoredSetup = { away: TeamSetup; home: TeamSetup; weather: Weather; importance?: SimulationInput['importance'] };
type PatchTeam = (side: 'away' | 'home', field: keyof TeamSetup, value: TeamSetup[keyof TeamSetup]) => void;
type ProjectedPlayer = SimPlayer & { estimate?: { mean: number; p10: number; p90: number } };

const NFL_TEAMS = [
  'Arizona Cardinals','Atlanta Falcons','Baltimore Ravens','Buffalo Bills','Carolina Panthers','Chicago Bears','Cincinnati Bengals','Cleveland Browns',
  'Dallas Cowboys','Denver Broncos','Detroit Lions','Green Bay Packers','Houston Texans','Indianapolis Colts','Jacksonville Jaguars','Kansas City Chiefs',
  'Las Vegas Raiders','Los Angeles Chargers','Los Angeles Rams','Miami Dolphins','Minnesota Vikings','New England Patriots','New Orleans Saints',
  'New York Giants','New York Jets','Philadelphia Eagles','Pittsburgh Steelers','San Francisco 49ers','Seattle Seahawks','Tampa Bay Buccaneers',
  'Tennessee Titans','Washington Commanders',
];
const defaultAway: TeamSetup = {
  name:'San Francisco 49ers', qb:'Brock Purdy', rb:'Christian McCaffrey', wr1:'Brandon Aiyuk', wr2:'Deebo Samuel', wr3:'', te:'George Kittle', kicker:'Jake Moody',
  passRating:65, rushRating:67, defenseRating:62, context:'Strong play-action offense; keep an eye on red-zone usage.',
};
const defaultHome: TeamSetup = {
  name:'Detroit Lions', qb:'Jared Goff', rb:'Jahmyr Gibbs', wr1:'Amon-Ra St. Brown', wr2:'Jameson Williams', wr3:'', te:'Sam LaPorta', kicker:'Jake Bates',
  passRating:64, rushRating:62, defenseRating:57, context:'High-volume passing environment with a balanced backfield.',
};
const DEFAULT_SETUP: StoredSetup = {
  away: defaultAway, home: defaultHome, weather: { temperatureF:68, windMph:7, precipitation:'none' },
};
const setupStorageKey = 'gridiron-sim-setup-v1';
const resultsStorageKey = 'gridiron-sim-results-v1';

function normalizeSetup(setup: StoredSetup): StoredSetup {
  return {
    ...setup,
    away: { ...defaultAway, ...setup.away },
    home: { ...defaultHome, ...setup.home },
  };
}

function readSetup(): StoredSetup {
  try {
    const parsed = JSON.parse(localStorage.getItem(setupStorageKey) || 'null') as Partial<StoredSetup> | null;
    return parsed?.away && parsed.home && parsed.weather ? normalizeSetup({ ...DEFAULT_SETUP, ...parsed }) : DEFAULT_SETUP;
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
  const [tab, setTab] = useState<'library' | 'simulator'>('library');
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(2);
  const [source, setSource] = useState<'library' | 'manual' | 'snapshot'>('library');
  const queryClient = useQueryClient();
  const history = useListSeasonTeams({ season });
  const teams = history.data ?? [];
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

  const patchTeam: PatchTeam = (side, field, value) => {
    setSetup(current => ({ ...current, [side]: { ...current[side], [field]: value } }));
  };
  const runSimulation = () => {
    setBusy(true);
    setError('');
    window.setTimeout(() => {
      try {
        let away = setup.away, home = setup.home;
        if (source === 'library') {
          if (history.isError || history.isLoading) throw new Error('Team history is not available yet. Retry loading the library.');
          const awayTeam = teams.find(team => team.team === setup.away.name);
          const homeTeam = teams.find(team => team.team === setup.home.name);
          if (!awayTeam || !homeTeam) throw new Error('Save both teams in Team Library before running from saved history.');
          for (const team of [awayTeam, homeTeam]) {
            if (team.weeks.find(game => game.week === week)?.status === 'bye') throw new Error(`${team.team} has a bye in week ${week}. Choose a game week.`);
          }
          away = setupFromHistory(awayTeam, week, 'away');
          home = setupFromHistory(homeTeam, week, 'home');
        }
        const input: SimulationInput = {
          ...setup,
          away, home,
          seed: Math.floor(Math.random() * 2_000_000_000) + 1,
        };
        const result = simulateEnsemble(input, 200);
        setActive(result);
        setActiveNames({ away: setup.away.name, home: setup.home.name });
        const entry: SavedSimulation = {
          id: `${Date.now()}-${result.seed}`,
          savedAt: new Date().toISOString(),
          awayName: setup.away.name,
          homeName: setup.home.name,
          result,
          setup: structuredClone({ ...setup, away, home }),
        };
        setSaved(current => [entry, ...current.filter(item => item.id !== entry.id)].slice(0, 10));
        setNotice('200 simulations complete. Fantasy averages and example game saved to this device.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The simulation could not be completed. Check your setup and try again.');
      } finally { setBusy(false); }
    }, 180);
  };
  const openSaved = (item: SavedSimulation) => {
    setActive(item.result);
    setActiveNames({ away: item.awayName, home: item.homeName });
    if (item.setup) {
      setSetup(normalizeSetup(item.setup));
      setSource(item.setup.away.roster ? 'snapshot' : 'manual');
    }
    setError('');
    setNotice('Saved result reopened.');
  };
  const removeSaved = (id: string) => {
    setSaved(items => items.filter(item => item.id !== id));
    setNotice('Saved simulation removed.');
  };
  const currentAwayName = activeNames?.away || setup.away.name;
  const currentHomeName = activeNames?.home || setup.home.name;
  const onTeamSaved = (savedTeam: TeamSeasonRecord) => {
    queryClient.setQueryData<TeamSeasonRecord[]>(getListSeasonTeamsQueryKey({ season }), current =>
      [...(current ?? []).filter(team => team.team !== savedTeam.team), savedTeam].sort((a, b) => a.team.localeCompare(b.team)));
    void history.refetch();
  };
  const changeSource = (value: typeof source) => {
    setSource(value);
    if (value === 'manual') setSetup(current => {
      const clearHistory = (team: TeamSetup): TeamSetup => ({ ...team, roster: undefined, record: undefined, historyGames: undefined });
      return { ...current, away: clearHistory(current.away), home: clearHistory(current.home) };
    });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Activity size={19} strokeWidth={2.4} /></div>
          <div><div className="brand-name">GRIDIRON SIM</div><div className="brand-sub">Fantasy matchup lab</div></div>
        </div>
        <div className="top-status"><span className="live-dot" /> SAVED SEASON HISTORY <span aria-hidden="true">·</span> NO LIVE FEED</div>
      </header>
      <main className="workspace">
        <nav className="section-tabs" aria-label="App sections">
          <button className={tab === 'library' ? 'selected' : ''} onClick={() => setTab('library')} data-testid="tab-library">Team Library</button>
          <button className={tab === 'simulator' ? 'selected' : ''} onClick={() => setTab('simulator')} data-testid="tab-simulator">Game Simulator</button>
        </nav>
        <div style={{ display: tab === 'library' ? undefined : 'none' }}>
          <TeamLibrary season={season} onSeasonChange={setSeason} teams={teams} loading={history.isLoading}
            error={history.isError ? 'Could not load saved team history. Please retry.' : ''} onReload={() => { void history.refetch(); }} onSaved={onTeamSaved} teamNames={NFL_TEAMS} />
        </div>
        <div style={{ display: tab === 'simulator' ? undefined : 'none' }}>
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
            <div className="team-block">
              <Field label="Player data source" htmlFor="data-source"><select id="data-source" value={source} onChange={e => changeSource(e.target.value as typeof source)}>
                <option value="library">Saved Team Library</option><option value="manual">Manual one-game setup</option>
                {source === 'snapshot' && <option value="snapshot">Reopened saved input snapshot</option>}
              </select></Field>
              {source === 'library' && <>
                <p className="stats-help">Season {season}. <button className="text-button" onClick={() => setTab('library')}>Change season in Team Library</button>. Only games before the selected week are used.</p>
                <Field label="Matchup week" htmlFor="matchup-week"><select id="matchup-week" value={week} onChange={e => setWeek(Number(e.target.value))}>
                  {Array.from({length:18}, (_, i) => <option key={i} value={i+1}>Week {i+1}</option>)}
                </select></Field>
              </>}
              {source === 'snapshot' && <p className="stats-help">Uses the original saved inputs, not newer weekly entries. Choose Saved Team Library to use updated history.</p>}
            </div>
            {source === 'manual' ? <>
              <TeamEditor team={setup.away} side="away" patchTeam={patchTeam} />
              <TeamEditor team={setup.home} side="home" patchTeam={patchTeam} />
            </> : (['away', 'home'] as const).map(side => <HistoryTeamPicker key={side} name={setup[side].name} teams={teams} week={week} venue={side}
              onChange={name => patchTeam(side, 'name', name)} onLibrary={() => setTab('library')} snapshot={source === 'snapshot' ? setup[side] : undefined} />)}
            <div className="config-bottom">
              <h3 className="section-mini-title">GAME CONDITIONS</h3>
              <Field label="Game importance" htmlFor="importance"><select id="importance" value={setup.importance ?? 'regular'} onChange={e => setSetup(s => ({...s, importance:e.target.value as SimulationInput['importance']}))}>
                <option value="regular">Regular season</option><option value="must-win">Must-win / playoff race</option><option value="playoff">Playoff-level stakes</option>
              </select></Field>
              <div className="weather-grid">
                 <Field label="Temperature · °F" htmlFor="temperature"><input id="temperature" type="number" min="-30" max="120" value={setup.weather.temperatureF} onChange={e => setSetup(s => ({ ...s, weather:{ ...s.weather, temperatureF:Number(e.target.value) } }))} data-testid="input-temperature" /></Field>
                <Field label="Wind · mph" htmlFor="wind"><input id="wind" type="number" min="0" max="80" value={setup.weather.windMph} onChange={e => setSetup(s => ({ ...s, weather:{ ...s.weather, windMph:Number(e.target.value) } }))} data-testid="input-wind" /></Field>
                <Field label="Precipitation" htmlFor="precipitation">
                  <select id="precipitation" value={setup.weather.precipitation} onChange={e => setSetup(s => ({ ...s, weather:{ ...s.weather, precipitation:e.target.value as Weather['precipitation'] } }))} data-testid="select-precipitation">
                    <option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option>
                  </select>
                </Field>
                <div className="field"><label>Conditions</label><div style={{height:37,display:'flex',alignItems:'center',gap:7,color:'var(--app-muted)',fontSize:11}}>{setup.weather.precipitation === 'none' ? <Wind size={14}/> : <CloudRain size={14}/>} {setup.weather.windMph} mph · {setup.weather.temperatureF}°F</div></div>
              </div>
              <div className="setup-actions">
                <button className="btn-primary" onClick={runSimulation} disabled={busy} data-testid="button-run-simulation">
                  {busy ? <><RotateCw size={15} className="spin-icon" /> Running model…</> : <><Crosshair size={16} /> Run simulation <ArrowRight size={15} /></>}
                </button>
              </div>
              {error && <div role="alert" style={{marginTop:11,color:'var(--app-danger)',fontSize:12}}>{error} <button className="text-button" onClick={runSimulation}>Retry</button></div>}
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
                      <span aria-hidden="true" style={{font: '10px var(--app-font-mono)',color:'var(--app-muted)'}}>↳</span>
                      <span style={{minWidth:0,display:'flex',flexDirection:'column',gap:2}}><strong>{item.awayName} at {item.homeName}</strong><span>{formatSavedDate(item.savedAt)} · seed {item.result.seed}</span></span>
                    </button>
                    <span className="saved-score">{item.result.awayScore} — {item.result.homeScore}</span>
                    <button className="saved-remove" aria-label={`Delete saved result ${item.awayName} at ${item.homeName}`} title="Delete saved result" onClick={() => removeSaved(item.id)} data-testid={`button-delete-saved-${item.id}`}><Trash2 size={14}/></button>
                  </div>
                ))}</div>}
            </section>
             <div className="footnote"><strong>Method note.</strong> The Team Library is saved in the project database and shared by this app’s users; it is not a private signed-in account. Simulation settings and saved runs remain browser-local. History mode blends season and recent-five averages, with home/away splits when available. Home field, recorded W–L–T, opposing defense, weather, and game importance make bounded adjustments. Each run averages 200 simulated games; its score and drive log show one example. This is experimental and not backtested. Missing stats use baseline assumptions. OL, kicker, and individual-defense stats can be saved, but fantasy points here are QB/RB/WR/TE Half-PPR—not IDP or kicker scoring.</div>
          </div>
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
function TeamEditor({ team, side, patchTeam }: { team:TeamSetup; side:'away'|'home'; patchTeam:PatchTeam }) {
  const label = side === 'away' ? 'AWAY TEAM' : 'HOME TEAM';
  const fields: {key:'qb'|'rb'|'wr1'|'wr2'|'wr3'|'te'|'kicker'; label:string; placeholder:string}[] = [
    {key:'qb',label:'Quarterback',placeholder:'QB name'}, {key:'rb',label:'Running back',placeholder:'RB name'},
    {key:'wr1',label:'Wide receiver 1',placeholder:'WR1 name'}, {key:'wr2',label:'Wide receiver 2',placeholder:'WR2 name'},
    {key:'wr3',label:'Wide receiver 3',placeholder:'WR3 name'},
    {key:'te',label:'Tight end',placeholder:'TE name'}, {key:'kicker',label:'Kicker',placeholder:'K name'},
  ];
  const ratings: {key:'passRating'|'rushRating'|'defenseRating';label:string}[] = [
    {key:'passRating',label:'Pass offense'}, {key:'rushRating',label:'Rush offense'}, {key:'defenseRating',label:'Defense'},
  ];
  return <div className={`team-block team-${side}`}>
    <div className="team-heading"><div className="team-label"><span className={`team-crest ${side === 'home' ? 'orange' : ''}`} style={{width:29,height:29,borderRadius:8,fontSize:11}}>{initials(team.name)}</span>{label}</div><span className="team-chip">{side === 'away' ? 'VISITOR' : 'AT HOME'}</span></div>
    <div className="form-grid">
      <Field label="NFL team" htmlFor={`${side}-team`} full>
        <select id={`${side}-team`} value={team.name} onChange={e => patchTeam(side,'name',e.target.value)} data-testid={`select-${side}-team`}>
          {NFL_TEAMS.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <span className="input-help">Team selection does not load a roster. Update the example player names below.</span>
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
    <RecentStatsEditor team={team} side={side} patchTeam={patchTeam} />
  </div>;
}

type PlayerSlot = 'qb' | 'rb' | 'wr1' | 'wr2' | 'wr3' | 'te';
const playerStatFields: Record<PlayerSlot, { key: keyof PlayerRecentStats; label: string }[]> = {
  qb: [
    { key: 'passAttempts', label: 'Pass attempts' }, { key: 'passCompletions', label: 'Completions' },
    { key: 'passYards', label: 'Passing yards' }, { key: 'passTD', label: 'Passing TDs' },
    { key: 'interceptions', label: 'INTs thrown' }, { key: 'rushAttempts', label: 'Carries' },
    { key: 'rushYards', label: 'Rushing yards' }, { key: 'rushTD', label: 'Rushing TDs' },
  ],
  rb: [
    { key: 'rushAttempts', label: 'Carries' }, { key: 'rushYards', label: 'Rushing yards' },
    { key: 'rushTD', label: 'Rushing TDs' }, { key: 'targets', label: 'Targets' },
    { key: 'receptions', label: 'Receptions' }, { key: 'receivingYards', label: 'Receiving yards' },
    { key: 'receivingTD', label: 'Receiving TDs' },
  ],
  wr1: [], wr2: [], wr3: [], te: [],
};
const receivingFields: { key: keyof PlayerRecentStats; label: string }[] = [
  { key: 'targets', label: 'Targets' }, { key: 'receptions', label: 'Receptions' },
  { key: 'receivingYards', label: 'Receiving yards' }, { key: 'receivingTD', label: 'Receiving TDs' },
];
const defenseStatFields: { key: keyof DefenseRecentStats; label: string }[] = [
  { key: 'passYardsAllowed', label: 'Pass yards allowed' },
  { key: 'passTDAllowed', label: 'Pass TDs allowed' },
  { key: 'rushYardsAllowed', label: 'Rush yards allowed' },
  { key: 'rushTDAllowed', label: 'Rush TDs allowed' },
  { key: 'interceptions', label: 'INTs made' },
  { key: 'fumblesForced', label: 'Fumbles forced' },
];

function RecentStatsEditor({ team, side, patchTeam }: { team: TeamSetup; side: 'away' | 'home'; patchTeam: PatchTeam }) {
  const slots: PlayerSlot[] = ['qb', 'rb', 'wr1', 'wr2', 'wr3', 'te'];
  const count = Object.values(team.recentStats ?? {}).reduce((total, stats) => total + Object.values(stats).filter(value => value !== undefined).length, 0) +
    Object.values(team.defenseRecent ?? {}).filter(value => value !== undefined).length;
  const patchPlayer = (slot: PlayerSlot, field: keyof PlayerRecentStats, value: string) => {
    patchTeam(side, 'recentStats', {
      ...team.recentStats,
      [slot]: { ...team.recentStats?.[slot], [field]: value === '' ? undefined : Number(value) },
    });
  };
  return <details className="recent-stats">
    <summary><SlidersHorizontal size={13} /> Recent stats <span>{count ? `${count} VALUES` : 'OPTIONAL'}</span><ChevronDown size={13} /></summary>
    <p className="stats-help">Enter <strong>averages per game</strong>, preferably from the last 3–5 games. Add the game totals, divide by games played, and use decimals. Leave unknown values blank—not zero.</p>
    {slots.map(slot => {
      const fields = playerStatFields[slot].length ? playerStatFields[slot] : receivingFields;
      return <details className="stat-player" key={slot}>
        <summary>{slot.toUpperCase()} <strong>{team[slot] || 'Player'}</strong><ChevronDown size={12} /></summary>
        <div className="stat-inputs">
          {fields.map(field => <Field key={field.key} label={field.label} htmlFor={`${side}-${slot}-${field.key}`}>
            <input id={`${side}-${slot}-${field.key}`} type="number" min="0" max="1000" step="0.1" placeholder="Avg / game"
              value={team.recentStats?.[slot]?.[field.key] ?? ''}
              onChange={event => patchPlayer(slot, field.key, event.target.value)}
              data-testid={`stat-${side}-${slot}-${field.key}`} />
          </Field>)}
        </div>
      </details>;
    })}
    <details className="stat-player">
      <summary>DEF <strong>Team defense</strong><ChevronDown size={12} /></summary>
      <p className="stats-help">Yards and TDs <strong>allowed to opponents</strong>; interceptions and fumbles <strong>created by this defense</strong>. All per game.</p>
      <div className="stat-inputs">
        {defenseStatFields.map(field => <Field key={field.key} label={field.label} htmlFor={`${side}-defense-${field.key}`}>
          <input id={`${side}-defense-${field.key}`} type="number" min="0" max="1000" step="0.1" placeholder="Avg / game"
            value={team.defenseRecent?.[field.key] ?? ''}
            onChange={event => patchTeam(side, 'defenseRecent', { ...team.defenseRecent, [field.key]: event.target.value === '' ? undefined : Number(event.target.value) })}
            data-testid={`stat-${side}-defense-${field.key}`} />
        </Field>)}
      </div>
    </details>
  </details>;
}

function SimulationResults({ result, awayName, homeName, onRun, busy }: { result:SimulationResult; awayName:string; homeName:string; onRun:()=>void; busy:boolean }) {
  const drives = useMemo(() => [...result.drives].sort((a, b) => a.id - b.id), [result.drives]);
  const playersByTeam = useMemo(() => {
    const groups = new Map<string, ProjectedPlayer[]>();
    result.players.forEach((player, index) => groups.set(player.team, [...(groups.get(player.team) || []), { ...player, estimate: result.ensemble?.fantasy[index] }]));
    return [...groups.entries()];
  }, [result.players]);
  const winner = result.awayScore === result.homeScore ? 'Even on the board' : result.awayScore > result.homeScore ? awayName : homeName;
  return <>
    <div className="result-topline">
      <div><div className="result-label"><Trophy size={13}/> MODEL OUTPUT <span>·</span> SEED {result.seed}</div><h2 id="results-title">{result.ensemble ? 'One example game' : 'Final simulation'}</h2></div>
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
        {result.ensemble && <p className="ensemble-note"><strong>{result.ensemble.runs} simulated games.</strong> Model outcomes: {awayName} wins {result.ensemble.awayWinPct}%, {homeName} wins {result.ensemble.homeWinPct}%, ties {result.ensemble.tiePct}%. Fantasy means and ranges below use all runs; this score and drive log show just one example.</p>}
        <div className="content-heading" id="overview-title"><Crosshair size={15} className="heading-icon"/> MATCHUP READ &amp; X-FACTORS</div>
        {result.overview.length ? <ul className="overview-list" data-testid="simulation-overview">{result.overview.map((line,index) => <li key={`${index}-${line}`}>{line}</li>)}</ul> : <p style={{fontSize:12,color:'var(--app-muted)'}}>No overview notes were returned for this run.</p>}
      </section>
      <div className="result-sections">
        <section className="subsection" aria-labelledby="drives-title">
          <div className="content-heading" id="drives-title"><Activity size={15} className="heading-icon"/> DRIVE TRACKER <span className="panel-index">{result.drives.length} SERIES</span></div>
          <div className="drive-scroll" data-testid="drive-log">
            {drives.length === 0 ? <div className="saved-empty" style={{padding:14}}>No drive log was returned.</div> : drives.map((drive,index) =>
              <Fragment key={`${drive.id}-${index}`}>
              {index > 0 && drive.quarter >= 3 && drives[index - 1].quarter <= 2 && <div className="halftime-marker" data-testid="halftime-marker">HALFTIME</div>}
              <details className={`drive team-${drive.team === awayName ? 'away' : 'home'}`}>
                <summary><span className="quarter-badge">Q{drive.quarter}</span><span>{drive.team}</span><span className="drive-result">{drive.result}</span><ChevronDown size={13}/></summary>
                <div className="drive-summary">{drive.summary}</div>
                {drive.plays.length > 0 && <div className="play-list">{drive.plays.map((play,playIndex)=><span key={`${drive.id}-play-${playIndex}`}>{String(playIndex+1).padStart(2,'0')} &nbsp;{play}</span>)}</div>}
              </details>
              </Fragment>
            )}
          </div>
        </section>
        <section className="subsection" aria-labelledby="players-title">
          <div className="content-heading" id="players-title"><Trophy size={15} className="heading-icon"/> HALF-PPR PROJECTIONS <span className="panel-index">{result.players.length} PLAYERS</span></div>
          <div className="player-table-wrap">
            <table className="player-table" data-testid="player-projections">
               <thead><tr><th>Player</th><th>Pass<br/>Yds</th><th>Pass<br/>TD / INT</th><th>Rush<br/>Yds / TD</th><th>Rec<br/>REC / YDS / TD</th><th>FUM<br/>LOST</th><th>{result.ensemble ? 'Mean ½ PPR' : '½ PPR'}</th></tr></thead>
              <tbody>{playersByTeam.map(([team,players]) => <FragmentGroup key={team} team={team} players={players} side={team === awayName ? 'away' : 'home'}/>)}</tbody>
            </table>
          </div>
           {result.ensemble && <p className="ensemble-note">Mean Half-PPR across {result.ensemble.runs} runs. The range is the 10th–90th percentile of simulated outcomes, not a calibrated forecast interval. Stat columns show the example game. Backups with no modeled playing time can have zero projections.</p>}
        </section>
      </div>
       <div className="footnote"><strong>Scoring.</strong> 0.5/catch, 1/10 rush or receiving yards, 1/25 passing yards, 4/passing TD, 6/rush or receiving TD. Turnovers are shown without point deductions, following your supplied rules. Kicking points are not included.</div>
    </div>
  </>;
}
function FragmentGroup({ team, players, side }: { team:string; players:ProjectedPlayer[]; side:'away'|'home' }) {
  return <>
    <tr className={`team-group-row team-${side}`}><td colSpan={7}>{team}</td></tr>
    {players.map((player,index)=><tr className={`team-${side}`} key={`${team}-${player.name}-${index}`} data-testid={`projection-${team}-${index}`}>
      <td className="player-name">{player.name}<span className="player-pos">{player.position}</span></td>
      <td>{player.passYards}</td><td>{player.passTD} / {player.interceptions}</td><td>{player.rushYards} / {player.rushTD}</td>
      <td>{player.receptions} / {player.receivingYards} / {player.receivingTD}</td><td>{player.fumblesLost}</td><td className="fantasy-points">{Number(player.estimate?.mean ?? player.halfPpr).toFixed(1)}{player.estimate && <span className="fantasy-range">{player.estimate.p10.toFixed(1)}–{player.estimate.p90.toFixed(1)}</span>}</td>
    </tr>)}
  </>;
}

export default App;