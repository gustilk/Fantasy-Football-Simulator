import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowRight, ChevronDown, CloudRain, Crosshair, RotateCw, SlidersHorizontal, Trash2, Wind } from 'lucide-react';
import { type WeatherSetup as Weather, type TeamSetup, type SimulationInput, type SimulationResult, type PlayerRecentStats, type DefenseRecentStats } from '@/lib/simulator';
import { useListSeasonTeams, useGetNflDepthChart, getNflDepthChart, getGetNflDepthChartQueryKey, getListSeasonTeamsQueryKey, type TeamSeasonRecord, type NflScheduledGame } from '@workspace/api-client-react';
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
import LineupsSection from '@/components/LineupsSection';
import './season.css';
import './components/game-simulator.css';
import { getEliteTier, ELITE_TIER_OPTIONS, type EliteTier } from '@/lib/elite-players';
import { readSavedSimulations, saveSimulation, deleteSavedSimulation, type SavedSimulation, type StoredSetup } from '@/lib/saved-simulations';
import { runSingleGameSimulation, type WeeklyProgress, type WeeklyRun } from '@/lib/weekly-simulations';
import { readStandings, findStandings } from '@/lib/standings';
import StandingsEditor from '@/components/StandingsEditor';
import { simulatorLineupSource } from '@/lib/simulator-lineups';

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
  try { return readSavedSimulations(localStorage); } catch { return []; }
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
  const [tab, setTab] = useState<'library' | 'simulator' | 'draftkings' | 'lineups' | 'standings'>(() => { const v = new URLSearchParams(window.location.search).get('view'); return v === 'library' || v === 'simulator' || v === 'lineups' || v === 'standings' ? v : 'draftkings'; });
  const [season, setSeason] = useState(() => readSetup().market?.season ?? new Date().getFullYear());
  const [week, setWeek] = useState(() => readSetup().market?.week ?? 2);
  const queryClient = useQueryClient();
  const history = useListSeasonTeams({ season });
  const storedTeams = history.data ?? [];
  const [setup, setSetup] = useState<StoredSetup>(readSetup);
  const [saved, setSaved] = useState<SavedSimulation[]>(readSaved);
  const [active, setActive] = useState<SimulationResult | null>(null);
  const [activeNames, setActiveNames] = useState<{ away:string; home:string } | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [weeklyProgress, setWeeklyProgress] = useState<WeeklyProgress | null>(null);
  const [weeklyRun, setWeeklyRun] = useState<WeeklyRun | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [standingsDirty, setStandingsDirty] = useState(false);
  const [simulatorView, setSimulatorView] = useState<'projections' | 'lineups'>('projections');
  const simulatorLineups = useMemo(() => {
    try { return { ...simulatorLineupSource(readSavedSimulations(localStorage), season), preferredWeek: week }; }
    catch { return { slates: [], warnings: [], error: 'Saved simulator projections could not be prepared for lineups. Existing results have not been changed.', preferredWeek: week }; }
  }, [saved, season, week]);
  const changeTab = (value: typeof tab) => {
    if (tab === 'standings' && standingsDirty && !window.confirm('You have unsaved standings. Discard them and leave this section?')) return;
    setTab(value);
  };

  useEffect(() => {
    try { localStorage.setItem(setupStorageKey, JSON.stringify(setup)); } catch { setNotice('Browser storage is unavailable; this setup will not persist.'); }
  }, [setup]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const changeSeason = (value: number) => {
    setSeason(value);
    if (value !== season) setSetup(current => ({ ...current, market: undefined }));
  };
  const runGame = async (selectedWeek: number, game: NflScheduledGame, fetchedAt: string) => {
    if (running.current) return;
    setError('');
    if (history.isLoading || history.isError) {
      setError('Load Team Library successfully before running the selected game.'); return;
    }
    running.current = true;
    setBusy(true);
    setWeeklyRun(null);
    setActive(null);
    setActiveNames(null);
    setWeeklyProgress({ completed: 0, total: 1, matchup: `${game.awayTeam} at ${game.homeTeam}` });
    try {
      const report = await runSingleGameSimulation({
        season, week: selectedWeek, gameId: game.id, games: [game], teams: storedTeams, fetchedAt,
        standings: findStandings(readStandings(localStorage), season, selectedWeek),
        loadDepth: (year, name) => queryClient.fetchQuery({
          queryKey: getGetNflDepthChartQueryKey(year, name),
          queryFn: () => getNflDepthChart(year, name), staleTime: 300_000, retry: false,
        }),
        save: entry => setSaved(saveSimulation(localStorage, entry)),
        onProgress: setWeeklyProgress,
        yieldUI: () => new Promise(resolve => window.setTimeout(resolve, 0)),
      });
      setWeeklyRun(report);
      const first = report.saved[0];
      if (first) {
        setActive(first.result);
        setActiveNames({ away: first.awayName, home: first.homeName });
        setSetup(normalizeSetup(first.setup!));
        setWeek(selectedWeek);
      }
      setNotice(first ? `${game.awayTeam} at ${game.homeTeam}: simulated and saved.` : 'The selected game could not be saved. See the issue below.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected game could not be simulated.');
    } finally { running.current = false; setBusy(false); }
  };
  const openSaved = (item: SavedSimulation) => {
    if (running.current) return;
    setActive(item.result);
    setActiveNames({ away: item.awayName, home: item.homeName });
    if (item.setup) {
      setSetup(normalizeSetup(item.setup));
      if (item.setup.market?.season !== undefined) setSeason(item.setup.market.season);
      if (item.setup.market?.week !== undefined) setWeek(item.setup.market.week);
    }
    setError('');
    setNotice('Saved result reopened.');
  };
  const removeSaved = (id: string) => {
    if (running.current) return;
    try {
      setSaved(deleteSavedSimulation(localStorage, id));
      setWeeklyRun(current => current ? { ...current, saved: current.saved.filter(item => item.id !== id) } : null);
      setNotice('Saved simulation removed.');
    } catch { setError('Could not delete this saved projection. Browser storage is unavailable.'); }
  };
  const currentAwayName = activeNames?.away || setup.away.name;
  const currentHomeName = activeNames?.home || setup.home.name;
  const onTeamSaved = (savedTeam: TeamSeasonRecord) => {
    queryClient.setQueryData<TeamSeasonRecord[]>(getListSeasonTeamsQueryKey({ season }), current =>
      [...(current ?? []).filter(team => team.team !== savedTeam.team), savedTeam].sort((a, b) => a.team.localeCompare(b.team)));
    void history.refetch();
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
          <button disabled={busy} className={tab === 'draftkings' ? 'selected' : ''} onClick={() => changeTab('draftkings')} data-testid="tab-draftkings">DraftKings</button>
          <button disabled={busy} className={tab === 'lineups' ? 'selected' : ''} onClick={() => changeTab('lineups')} data-testid="tab-lineups">Lineups</button>
          <button disabled={busy} className={tab === 'library' ? 'selected' : ''} onClick={() => changeTab('library')} data-testid="tab-library">Team Library</button>
          <button disabled={busy} className={tab === 'standings' ? 'selected' : ''} onClick={() => changeTab('standings')} data-testid="tab-standings">Standings</button>
          <button disabled={busy} className={tab === 'simulator' ? 'selected' : ''} onClick={() => changeTab('simulator')} data-testid="tab-simulator">Game Simulator</button>
        </nav>
        {season === 2026 && <p className="stats-help" data-testid="baseline-active-notice">2025 baseline active for new Team Library-based simulations. Its influence decreases as 2026 evidence grows.
          {' '}<a href="?view=library">Review imported sources and player coverage</a>. Saved forecasts are unchanged.</p>}
        <div style={{ display: tab === 'library' ? undefined : 'none' }}>
          <TeamLibrary season={season} onSeasonChange={changeSeason} teams={storedTeams} loading={history.isLoading}
            error={history.isError ? 'Could not load saved team history. Please retry.' : ''} onReload={() => { void history.refetch(); }} onSaved={onTeamSaved} teamNames={NFL_TEAMS} />
        </div>
        <div style={{ display: tab === 'draftkings' ? undefined : 'none' }}><DraftKingsBoard season={season} /></div>
        {tab === 'lineups' && <LineupsSection season={season} />}
        {tab === 'standings' && <StandingsEditor season={season} onSeasonChange={changeSeason} onDirtyChange={setStandingsDirty} />}
        <div className="game-simulator" style={{ display: tab === 'simulator' ? undefined : 'none' }}>
        <div className="page-heading">
          <div>
            <h1>Game Simulator</h1>
             <p>Select a specific matchup and generate its projected fantasy points.</p>
          </div>
        </div>

        <nav className="sim-position-tabs" aria-label="Game Simulator tools" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
          <button className={simulatorView === 'projections' ? 'on' : ''} disabled={busy} onClick={() => setSimulatorView('projections')} aria-pressed={simulatorView === 'projections'} data-testid="sim-view-projections">Game projections</button>
          <button className={simulatorView === 'lineups' ? 'on' : ''} disabled={busy} onClick={() => setSimulatorView('lineups')} aria-pressed={simulatorView === 'lineups'} data-testid="sim-view-lineups">DraftKings Captain lineups</button>
        </nav>
        {tab === 'simulator' && simulatorView === 'lineups' && <LineupsSection season={season} forecastSource={simulatorLineups} />}
        <div className="main-grid" style={{ display: simulatorView === 'lineups' ? 'none' : undefined }}>
          <section className="panel setup-panel" aria-labelledby="setup-title">
            <div className="panel-top">
               <div className="panel-title" id="setup-title">Choose your game</div>
            </div>
              <UpcomingGames key={season} season={season} enabled={tab === 'simulator'} busy={busy} teams={storedTeams.map(team => team.team)}
               onRunGame={(selectedWeek, game, fetchedAt) => void runGame(selectedWeek, game, fetchedAt)} progress={weeklyProgress} />
             {active && <div className="sim-matchup">
               <strong>Viewing: {currentAwayName} at {currentHomeName}</strong>
               <span>{season} · Week {week} · Saved result</span>
            </div>}
            <div className="config-bottom">
               <p className="stats-help"><button className="text-button" onClick={() => setTab('library')}>Manage season, rosters and history in Team Library</button>. Only your selected game is simulated and saved.</p>
               {error && <div role="alert" style={{marginTop:11,color:'var(--app-danger)',fontSize:12}}>{error} Select the matchup and use Run selected game to retry.</div>}
            </div>
          </section>

          <div className="result-column">
            <section className="panel result-panel" aria-labelledby="results-title">
              {!active ? <div className="empty-result">
                <div className="empty-orbit"><SlidersHorizontal size={30} strokeWidth={1.5}/></div>
                <h3 id="results-title">Your projections appear here</h3>
                 <p>Select a game, then use Run selected game to see its average DraftKings points.</p>
               </div> : <GameProjections result={active} awayName={currentAwayName} homeName={currentHomeName}/>}
            </section>
            {weeklyRun && <section className="panel saved-panel" aria-labelledby="weekly-results-title" data-testid="weekly-results">
              <div className="panel-top"><h3 id="weekly-results-title">{weeklyRun.season} · Week {weeklyRun.week} · Selected game result</h3></div>
              <div style={{ padding: 16 }}>
                <p role="status">{weeklyRun.saved.length ? 'Selected game simulated and saved.' : 'Selected game was not saved.'}</p>
                <div className="saved-list">{weeklyRun.saved.map(item => <button key={item.id} className="saved-open"
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 0' }} disabled={busy}
                  onClick={() => openSaved(item)} data-testid={`weekly-game-${item.setup?.market?.gameId}`}>
                  <strong>{item.awayName} at {item.homeName}</strong><span> · View projections</span>
                </button>)}</div>
                {weeklyRun.failures.length > 0 && <div role="alert">
                  <p>This game was not saved. Correct the issues in <button className="text-button" onClick={() => setTab('library')}>Team Library</button> and run the selected game again.</p>
                  <ul>{weeklyRun.failures.map(failure => <li key={failure.gameId}><strong>{failure.matchup}:</strong> {failure.reason}</li>)}</ul>
                </div>}
              </div>
            </section>}
            <details className="panel saved-panel sim-disclosure">
              <summary>Saved projections ({saved.length})</summary>
              {saved.length === 0 ? <div className="saved-empty">Your saved simulations will collect here on this device.</div> :
                <div className="saved-list">{saved.map(item => (
                  <div className="saved-item" key={item.id} data-testid={`saved-run-${item.id}`}>
                    <button className="saved-open" onClick={() => openSaved(item)} data-testid={`button-open-saved-${item.id}`}>
                      <span style={{minWidth:0,display:'flex',flexDirection:'column',gap:2}}><strong>{item.awayName} at {item.homeName}</strong><span>{item.setup?.market?.week ? `Week ${item.setup.market.week} · ` : ''}{formatSavedDate(item.savedAt)}</span></span>
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