import { useEffect, useState, type ReactNode } from 'react';
import { Activity, ArrowRight, ChevronDown, CloudRain, Crosshair, RotateCw, SlidersHorizontal, Trash2, Wind } from 'lucide-react';
import { type WeatherSetup as Weather, type TeamSetup, type SimulationInput, type SimulationResult, type PlayerRecentStats, type DefenseRecentStats } from '@/lib/simulator';
import { useListSeasonTeams, useGetNflDepthChart, getGetNflDepthChartQueryKey, getListSeasonTeamsQueryKey, type TeamSeasonRecord, type NflScheduledGame } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import TeamLibrary from '@/components/TeamLibrary';
import HistoryTeamPicker from '@/components/HistoryTeamPicker';
import { setupFromHistory } from '@/lib/season-model';
import { simulateEnsemble } from '@/lib/ensemble';
import { NFL_TEAM_NAMES } from '@/lib/nfl-divisions';
import DivisionMatchup from '@/components/DivisionMatchup';
import GameProjections from '@/components/GameProjections';
import UpcomingGames from '@/components/UpcomingGames';
import MarketOddsInputs from '@/components/MarketOddsInputs';
import { withDepthChart } from '@/lib/depth-chart';
import DraftKingsBoard from '@/components/DraftKingsBoard';
import './season.css';
import './components/game-simulator.css';
import { getEliteTier, ELITE_TIER_OPTIONS, type EliteTier } from '@/lib/elite-players';

type SavedSimulation = { id: string; savedAt: string; awayName: string; homeName: string; result: SimulationResult; setup?: StoredSetup };
type StoredSetup = { away: TeamSetup; home: TeamSetup; weather: Weather; importance?: SimulationInput['importance']; market?: SimulationInput['market'] };
type PatchTeam = (side: 'away' | 'home', field: keyof TeamSetup, value: TeamSetup[keyof TeamSetup]) => void;

const NFL_TEAMS = NFL_TEAM_NAMES;
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
const matchupStorageKey = 'gridiron-sim-matchup-chosen-v1';

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
  const [tab, setTab] = useState<'library' | 'simulator' | 'draftkings'>(() => { const v = new URLSearchParams(window.location.search).get('view'); return v === 'library' || v === 'simulator' ? v : 'draftkings'; });
  const [season, setSeason] = useState(() => readSetup().market?.season ?? new Date().getFullYear());
  const [week, setWeek] = useState(() => readSetup().market?.week ?? 2);
  const [source, setSource] = useState<'library' | 'manual' | 'snapshot'>('library');
  const queryClient = useQueryClient();
  const history = useListSeasonTeams({ season });
  const storedTeams = history.data ?? [];
  const [setup, setSetup] = useState<StoredSetup>(readSetup);
  const [matchupChosen, setMatchupChosen] = useState(() => {
    try {
      const stored = localStorage.getItem(matchupStorageKey);
      if (stored !== null) return stored === 'true';
    } catch { /* Selection remains available for this session. */ }
    return !!setup.market?.gameId || !!setup.away.roster || !!setup.home.roster ||
      setup.away.name !== defaultAway.name || setup.home.name !== defaultHome.name;
  });
  const [saved, setSaved] = useState<SavedSimulation[]>(readSaved);
  const [active, setActive] = useState<SimulationResult | null>(null);
  const [activeNames, setActiveNames] = useState<{ away:string; home:string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const awayDepth = useGetNflDepthChart(season, setup.away.name, { query: { queryKey: getGetNflDepthChartQueryKey(season, setup.away.name), enabled: matchupChosen && source === 'library' && tab === 'simulator', staleTime: 300_000, retry: false } });
  const homeDepth = useGetNflDepthChart(season, setup.home.name, { query: { queryKey: getGetNflDepthChartQueryKey(season, setup.home.name), enabled: matchupChosen && source === 'library' && tab === 'simulator', staleTime: 300_000, retry: false } });
  const teams = storedTeams.map(team => withDepthChart(team, team.team === setup.away.name ? awayDepth.data : team.team === setup.home.name ? homeDepth.data : undefined));

  useEffect(() => {
    try { localStorage.setItem(setupStorageKey, JSON.stringify(setup)); } catch { setNotice('Browser storage is unavailable; this setup will not persist.'); }
  }, [setup]);
  useEffect(() => {
    try { localStorage.setItem(matchupStorageKey, String(matchupChosen)); } catch { setNotice('Browser storage is unavailable; matchup selection will not persist.'); }
  }, [matchupChosen]);
  useEffect(() => {
    try { localStorage.setItem(resultsStorageKey, JSON.stringify(saved.slice(0, 10))); } catch { setNotice('Browser storage is unavailable; saved simulations may not persist.'); }
  }, [saved]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const patchTeam: PatchTeam = (side, field, value) => {
    setMatchupChosen(true);
    setSetup(current => ({ ...current, [side]: { ...current[side], [field]: value }, market: field === 'name' && value !== current[side].name ? undefined : current.market }));
  };
  const changeSeason = (value: number) => {
    setSeason(value);
    if (value !== season) setSetup(current => ({ ...current, market: undefined }));
  };
  const changeWeek = (value: number) => {
    setMatchupChosen(true);
    setWeek(value);
    if (value !== week) setSetup(current => ({ ...current, market: undefined }));
  };
  const selectScheduledGame = (game: NflScheduledGame, fetchedAt: string) => {
    setMatchupChosen(true);
    setSource('library');
    setWeek(game.week);
    setSetup(current => ({
      ...current,
      away: { ...current.away, name: game.awayTeam },
      home: { ...current.home, name: game.homeTeam },
      importance: game.seasonType === 'postseason' ? 'playoff' : 'regular',
      market: current.market?.source === 'manual' && current.market.gameId === game.id &&
        current.market.season === season && current.market.week === game.week &&
        current.market.awayTeam === game.awayTeam && current.market.homeTeam === game.homeTeam &&
        (current.market.homeSpread !== undefined || current.market.total !== undefined) ? current.market : {
        enabled: false, source: game.odds ? 'ESPN' : 'manual',
        awayTeam: game.awayTeam, homeTeam: game.homeTeam, season, week: game.week,
        gameId: game.id, kickoff: game.timeConfirmed ? game.date : undefined,
        ...game.odds, recordedAt: game.odds ? fetchedAt : undefined,
      },
    }));
    setError('');
    setNotice(`${game.awayTeam} at ${game.homeTeam} selected. Saved roster and history will be used.`);
  };
  const runSimulation = () => {
    if (!matchupChosen) { setError('Choose a game first.'); return; }
    setBusy(true);
    setError('');
    window.setTimeout(() => {
      try {
        if (setup.market?.enabled && (setup.market.season !== season || setup.market.week !== week)) {
          throw new Error('These odds belong to another season or week. Clear them and enter lines for this matchup.');
        }
        let away = setup.away, home = setup.home;
        if (source === 'library') {
          if (history.isError || history.isLoading) throw new Error('Team history is not available yet. Retry loading the library.');
          const awayTeam = teams.find(team => team.team === setup.away.name);
          const homeTeam = teams.find(team => team.team === setup.home.name);
          if (!awayTeam || !homeTeam) throw new Error('Save both teams in Team Library before running from saved history.');
          if (awayDepth.isLoading || homeDepth.isLoading) throw new Error('Offensive depth charts are loading. Wait briefly before running.');
          for (const [team, depth] of [[awayTeam, awayDepth], [homeTeam, homeDepth]] as const) {
            if (depth.isError && !['QB', 'RB', 'WR', 'TE'].every(position => team.players.some(p => p.active && p.position === position && p.depthRank !== undefined))) {
              throw new Error(`${team.team}: live depth chart unavailable. Set saved QB/RB/WR/TE ranks in Team Library before simulating; official roles will not be guessed.`);
            }
          }
          for (const team of [awayTeam, homeTeam]) {
            if (team.weeks.find(game => game.week === week)?.status === 'bye') throw new Error(`${team.team} has a bye in week ${week}. Choose a game week.`);
          }
          away = setupFromHistory(awayTeam, week, 'away', homeTeam.team);
          home = setupFromHistory(homeTeam, week, 'home', awayTeam.team);
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
        setNotice('DraftKings projections ready and saved on this device.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The simulation could not be completed. Check your setup and try again.');
      } finally { setBusy(false); }
    }, 180);
  };
  const openSaved = (item: SavedSimulation) => {
    setMatchupChosen(true);
    setActive(item.result);
    setActiveNames({ away: item.awayName, home: item.homeName });
    if (item.setup) {
      setSetup(normalizeSetup(item.setup));
      if (item.setup.market?.season !== undefined) setSeason(item.setup.market.season);
      if (item.setup.market?.week !== undefined) setWeek(item.setup.market.week);
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
    setMatchupChosen(true);
    setSource(value);
    if (value === 'manual') setSetup(current => {
      const clearHistory = (team: TeamSetup): TeamSetup => ({ ...team, roster: undefined, record: undefined, historyGames: undefined, headToHead: undefined, depthChartSource: undefined, availabilityChecks: undefined, modelEvidence: undefined });
      return { ...current, away: clearHistory(current.away), home: clearHistory(current.home) };
    });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Activity size={19} strokeWidth={2.4} /></div>
          <div><div className="brand-name">Gridiron Sim</div></div>
        </div>
      </header>
      <main className="workspace">
        <nav className="section-tabs" aria-label="App sections">
          <button className={tab === 'draftkings' ? 'selected' : ''} onClick={() => setTab('draftkings')} data-testid="tab-draftkings">DraftKings</button>
          <button className={tab === 'library' ? 'selected' : ''} onClick={() => setTab('library')} data-testid="tab-library">Team Library</button>
          <button className={tab === 'simulator' ? 'selected' : ''} onClick={() => setTab('simulator')} data-testid="tab-simulator">Game Simulator</button>
        </nav>
        <div style={{ display: tab === 'library' ? undefined : 'none' }}>
          <TeamLibrary season={season} onSeasonChange={changeSeason} teams={storedTeams} loading={history.isLoading}
            error={history.isError ? 'Could not load saved team history. Please retry.' : ''} onReload={() => { void history.refetch(); }} onSaved={onTeamSaved} teamNames={NFL_TEAMS} />
        </div>
        <div style={{ display: tab === 'draftkings' ? undefined : 'none' }}><DraftKingsBoard season={season} /></div>
        <div className="game-simulator" style={{ display: tab === 'simulator' ? undefined : 'none' }}>
        <div className="page-heading">
          <div>
            <h1>Game Simulator</h1>
            <p>Choose a game. Compare projected fantasy points.</p>
          </div>
        </div>

        <div className="main-grid">
          <section className="panel setup-panel" aria-labelledby="setup-title">
            <div className="panel-top">
              <div className="panel-title" id="setup-title">Choose your matchup</div>
            </div>
            <UpcomingGames season={season} enabled={tab === 'simulator'} busy={busy} teams={storedTeams.map(team => team.team)} selectedMatchup={matchupChosen && source === 'library' ? { away: setup.away.name, home: setup.home.name, week } : null} onSelect={selectScheduledGame} />
            {matchupChosen && <div className="sim-matchup">
              <strong>{setup.away.name} at {setup.home.name}</strong>
              <span>{season} · Week {week} · {source === 'library' ? 'Saved Team Library' : source === 'snapshot' ? 'Saved input snapshot' : 'Manual inputs'}</span>
              {source === 'library' && (awayDepth.isLoading || homeDepth.isLoading) && <span role="status">Loading depth charts…</span>}
              {source === 'library' && (awayDepth.isError || homeDepth.isError) && <p className="history-warning" role="status">Depth chart unavailable. Check saved roles in Team Library.</p>}
            </div>}
            <details className="sim-disclosure">
            <summary>Advanced settings</summary>
            <div className="team-block">
              <Field label="Player data source" htmlFor="data-source"><select id="data-source" value={source} onChange={e => changeSource(e.target.value as typeof source)}>
                <option value="library">Saved Team Library</option><option value="manual">Manual one-game setup</option>
                {source === 'snapshot' && <option value="snapshot">Reopened saved input snapshot</option>}
              </select></Field>
              {source === 'library' && <>
                <p className="stats-help"><button className="text-button" onClick={() => setTab('library')}>Change season or roster in Team Library</button>. Uses history before the matchup week.</p>
                <Field label="Matchup week" htmlFor="matchup-week"><select id="matchup-week" value={week} onChange={e => changeWeek(Number(e.target.value))}>
                  {Array.from({length:22}, (_, i) => <option key={i} value={i+1}>{i < 18 ? `Week ${i+1}` : ['Wild Card', 'Divisional', 'Conference Championships', 'Super Bowl'][i-18]}</option>)}
                </select></Field>
              </>}
              {source === 'snapshot' && <p className="stats-help">Uses the original saved inputs, not newer weekly entries. Choose Saved Team Library to use updated history.</p>}
            </div>
            {source === 'manual' ? <>
              <TeamEditor team={setup.away} side="away" patchTeam={patchTeam} />
              <TeamEditor team={setup.home} side="home" patchTeam={patchTeam} />
            </> : (['away', 'home'] as const).map(side => <HistoryTeamPicker key={side} name={setup[side].name} opponent={setup[side === 'away' ? 'home' : 'away'].name} teams={teams} week={week} venue={side}
              onChange={name => patchTeam(side, 'name', name)} onLibrary={() => setTab('library')} snapshot={source === 'snapshot' ? setup[side] : undefined} />)}
            <DivisionMatchup team={setup.away.name} opponent={setup.home.name} />
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
              <MarketOddsInputs market={setup.market} away={setup.away.name} home={setup.home.name} season={season} week={week} busy={busy}
                onChange={market => setSetup(current => ({ ...current, market }))} />
            </div>
            </details>
            <div className="config-bottom">
              <div className="setup-actions">
                <button className="btn-primary" onClick={runSimulation} disabled={busy || !matchupChosen} data-testid="button-run-simulation">
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
                <h3 id="results-title">Your projections appear here</h3>
                <p>Choose a matchup and run it to see average DraftKings points for both teams.</p>
              </div> : <GameProjections result={active} awayName={currentAwayName} homeName={currentHomeName} onRun={runSimulation} busy={busy}/>}
            </section>
            <details className="panel saved-panel sim-disclosure">
              <summary>Saved projections ({saved.length})</summary>
              {saved.length === 0 ? <div className="saved-empty">Your saved simulations will collect here on this device.</div> :
                <div className="saved-list">{saved.map(item => (
                  <div className="saved-item" key={item.id} data-testid={`saved-run-${item.id}`}>
                    <button className="saved-open" onClick={() => openSaved(item)} data-testid={`button-open-saved-${item.id}`}>
                      <span style={{minWidth:0,display:'flex',flexDirection:'column',gap:2}}><strong>{item.awayName} at {item.homeName}</strong><span>{formatSavedDate(item.savedAt)}</span></span>
                    </button>
                    <button className="saved-remove" aria-label={`Delete saved result ${item.awayName} at ${item.homeName}`} title="Delete saved result" onClick={() => removeSaved(item.id)} data-testid={`button-delete-saved-${item.id}`}><Trash2 size={14}/></button>
                  </div>
                ))}</div>}
            </details>
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
        <span className="input-help">Enter player names below. Manual inputs do not load saved rosters.</span>
      </Field>
      {fields.map(field => <Field label={field.label} htmlFor={`${side}-${field.key}`} key={field.key}>
        <input id={`${side}-${field.key}`} value={team[field.key]} placeholder={field.placeholder} onChange={e => patchTeam(side,field.key,e.target.value)} data-testid={`input-${side}-${field.key}`} />
         {field.key !== 'kicker' && <label className="elite-1x-toggle">
           Elite priority
           <select aria-label={`Elite priority for ${side} ${field.label}`} value={getEliteTier({ name: team[field.key], position: field.key === 'qb' ? 'QB' : field.key === 'rb' ? 'RB' : field.key === 'te' ? 'TE' : 'WR', elite1x: team.elite1x?.[field.key], eliteTier: team.eliteTiers?.[field.key] })}
             onChange={e => patchTeam(side, 'eliteTiers', { ...team.eliteTiers, [field.key]: Number(e.target.value) as EliteTier })}>{ELITE_TIER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
         </label>}
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

export default App;