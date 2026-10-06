import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RotateCw, Save, Trash2 } from 'lucide-react';
import { NFL_DIVISIONS, NFL_TEAM_NAMES } from '@/lib/nfl-divisions';
import {
  readStandings, findStandings, saveStandings, deleteStandings, standingPercentage, parseStandingTableStats,
  type StandingsSnapshot, type StandingEntry,
} from '@/lib/standings';
import './standings-editor.css';
import { useQuery } from '@tanstack/react-query';
import { getNflStandings, type NflStandings } from '@workspace/api-client-react';

type Props = { season: number; onSeasonChange: (year: number) => void; onDirtyChange?: (dirty: boolean) => void };
type Row = { w: string; l: string; t: string; pf: string; pa: string; home: string; away: string; streak: string; needsWin: boolean; backupQb: boolean };
type TextKey = 'w' | 'l' | 't' | 'pf' | 'pa' | 'home' | 'away' | 'streak';
const ABBR: Record<string, string> = {
  'Arizona Cardinals': 'ari', 'Atlanta Falcons': 'atl', 'Baltimore Ravens': 'bal', 'Buffalo Bills': 'buf', 'Carolina Panthers': 'car', 'Chicago Bears': 'chi',
  'Cincinnati Bengals': 'cin', 'Cleveland Browns': 'cle', 'Dallas Cowboys': 'dal', 'Denver Broncos': 'den', 'Detroit Lions': 'det', 'Green Bay Packers': 'gb',
  'Houston Texans': 'hou', 'Indianapolis Colts': 'ind', 'Jacksonville Jaguars': 'jax', 'Kansas City Chiefs': 'kc', 'Las Vegas Raiders': 'lv', 'Los Angeles Chargers': 'lac',
  'Los Angeles Rams': 'lar', 'Miami Dolphins': 'mia', 'Minnesota Vikings': 'min', 'New England Patriots': 'ne', 'New Orleans Saints': 'no', 'New York Giants': 'nyg',
  'New York Jets': 'nyj', 'Philadelphia Eagles': 'phi', 'Pittsburgh Steelers': 'pit', 'San Francisco 49ers': 'sf', 'Seattle Seahawks': 'sea', 'Tampa Bay Buccaneers': 'tb',
  'Tennessee Titans': 'ten', 'Washington Commanders': 'wsh',
};
const nick = (team: string) => team.split(' ').slice(-1)[0];
function Logo({ team }: { team: string }) {
  const [bad, setBad] = useState(false);
  const abbr = ABBR[team];
  if (bad || !abbr) return <span className="se-logo se-logo-fb" aria-hidden>{(ABBR[team] ?? nick(team).slice(0, 3)).toUpperCase()}</span>;
  return <img className="se-logo" src={`https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png`} alt="" loading="lazy" onError={() => setBad(true)} />;
}
const draftPct = (r: Row): string => {
  if (![r.w, r.l, r.t].every(isCount)) return '';
  const w = Number(r.w), l = Number(r.l), t = Number(r.t), g = w + l + t;
  return g ? ((w + t / 2) / g).toFixed(3).replace(/^0(?=\.)/, '') : '\u2014';
};
const COLS: { k: TextKey; label: string; name: string; num: boolean }[] = [
  { k: 'w', label: 'W', name: 'wins', num: true }, { k: 'l', label: 'L', name: 'losses', num: true }, { k: 't', label: 'T', name: 'ties', num: true },
  { k: 'pf', label: 'PF', name: 'points for', num: true }, { k: 'pa', label: 'PA', name: 'points against', num: true },
  { k: 'home', label: 'Home', name: 'home record', num: false }, { k: 'away', label: 'Away', name: 'away record', num: false }, { k: 'streak', label: 'Strk', name: 'streak', num: false },
];
type Draft = Record<string, Row>;
type Status = { kind: 'ok' | 'err'; text: string } | null;

const blankRow = (): Row => ({ w: '', l: '', t: '', pf: '', pa: '', home: '', away: '', streak: '', needsWin: false, backupQb: false });
const toDraft = (snap: StandingsSnapshot | undefined): Draft => {
  const d: Draft = {};
  for (const team of NFL_TEAM_NAMES) {
    const e = snap?.entries.find(x => x.team === team);
    d[team] = e ? { w: e.record ? String(e.record.wins) : '', l: e.record ? String(e.record.losses) : '', t: e.record ? String(e.record.ties) : '', pf: e.tableStats?.pointsFor !== undefined ? String(e.tableStats.pointsFor) : '', pa: e.tableStats?.pointsAgainst !== undefined ? String(e.tableStats.pointsAgainst) : '', home: e.tableStats?.home ?? '', away: e.tableStats?.away ?? '', streak: e.tableStats?.streak ?? '', needsWin: e.needsWin, backupQb: e.backupQb === true } : blankRow();
  }
  return d;
};
const store = (): Storage => window.localStorage;
const initialWeek = () => {
  const n = Number(new URLSearchParams(window.location.search).get('week'));
  return Number.isInteger(n) && n >= 1 && n <= 18 ? n : 0;
};
const isCount = (s: string) => /^\d+$/.test(s.trim());

export default function StandingsEditor({ season, onSeasonChange, onDirtyChange }: Props) {
  const [week, setWeek] = useState(initialWeek);
  const [snaps, setSnaps] = useState<StandingsSnapshot[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft>(() => toDraft(undefined));
  const [base, setBase] = useState(() => JSON.stringify(toDraft(undefined)));
  const [status, setStatus] = useState<Status>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [conf, setConf] = useState<'AFC' | 'NFC'>('AFC');
  const [refreshing, setRefreshing] = useState(false);
  const official = useQuery({ queryKey: ['espn-standings', season, week],
    queryFn: () => getNflStandings(season, week ? { week } : undefined),
    staleTime: 60000, retry: false });
  const autoImported = useRef(new Set<string>());
  const scopeRef = useRef(''); scopeRef.current = `${season}:${week}`;
  const draftRef = useRef(draft); draftRef.current = draft;

  const dirty = JSON.stringify(draft) !== base;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);

  const load = () => {
    try { setSnaps(readStandings(store())); setLoadError(''); }
    catch (e) { setSnaps(null); setLoadError(e instanceof Error ? e.message : 'Saved standings could not be read. Existing data has not been replaced.'); }
  };
  useEffect(load, []);

  const saved = useMemo(() => (snaps ? findStandings(snaps, season, week) : undefined), [snaps, season, week]);
  const adopt = (snap: StandingsSnapshot | undefined) => { const d = toDraft(snap); setDraft(d); setBase(JSON.stringify(d)); setProblems({}); };
  // Re-adopt when the scope or the stored snapshot changes (guards already confirmed discards).
  useEffect(() => { adopt(saved); }, [season, week, saved]);
  const importOfficial = (data: NflStandings) => {
    if (data.season !== season || data.week !== week || scopeRef.current !== `${data.season}:${data.week}`) return;
    const entries: StandingEntry[] = data.entries.map(entry => ({ ...entry,
      needsWin: draftRef.current[entry.team]?.needsWin ?? false,
      backupQb: draftRef.current[entry.team]?.backupQb ?? false }));
    const next = saveStandings(store(), { season, week, savedAt: new Date().toISOString(), entries });
    setSnaps(next);
    setStatus({ kind: 'ok', text: `Loaded all 32 teams from ESPN, entering week ${week}, using ${data.completedGames} final games. Manual strategy flags and saved forecasts are unchanged.` });
  };
  useEffect(() => {
    if (!official.data || !snaps || loadError) return;
    if (!week) { setWeek(official.data.week); return; }
    const key = `${season}:${week}`;
    if (official.data.season !== season || official.data.week !== week || dirtyRef.current
      || autoImported.current.has(key) || saved?.entries.some(e => e.record)) return;
    autoImported.current.add(key);
    try { importOfficial(official.data); }
    catch (error) { setStatus({ kind: 'err', text: error instanceof Error ? error.message : 'ESPN standings could not be saved.' }); }
  }, [official.data, snaps, loadError, season, week, saved]);
  const refreshOfficial = async () => {
    if (!snaps || loadError || !week || refreshing) return;
    if ((dirty || saved?.entries.some(e => e.record)) && !window.confirm('Refresh W/L/T and table statistics from ESPN? Your needs-win and backup-QB flags will be kept. Saved forecasts will not change.')) return;
    const scope = `${season}:${week}`;
    autoImported.current.add(scope); setRefreshing(true);
    try {
      const fresh = await official.refetch();
      if (scopeRef.current !== scope) return;
      if (fresh.error || !fresh.data) throw fresh.error ?? new Error('ESPN did not return standings.');
      importOfficial(fresh.data);
    } catch (error) {
      if (scopeRef.current === scope) setStatus({ kind: 'err', text: error instanceof Error ? error.message : 'Saved standings are unchanged.' });
    } finally { setRefreshing(false); }
  };

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const guard = () => !dirtyRef.current || window.confirm('You have unsaved standings. Discard them?');
  const changeWeek = (n: number) => { if (!refreshing && n !== week && guard()) { setStatus(null); setWeek(n); } };
  const changeSeason = (n: number) => { if (!refreshing && n !== season && guard()) { setStatus(null); onSeasonChange(n); } };

  const maxGames = Math.max(0, Math.min(week - 1, season >= 2021 ? 17 : 16));
  const set = (team: string, patch: Partial<Row>) => setDraft(d => ({ ...d, [team]: { ...d[team], ...patch } }));
  const clearTeam = (team: string) => set(team, { w: '', l: '', t: '', pf: '', pa: '', home: '', away: '', streak: '' });

  const doSave = () => {
    if (loadError || !snaps) return;
    const bad: Record<string, string> = {};
    const entries: StandingEntry[] = NFL_TEAM_NAMES.map(team => {
      const r = draft[team];
      const vals = [r.w, r.l, r.t];
      const filled = vals.filter(v => v.trim() !== '').length;
      let record: StandingEntry['record'];
      if (filled > 0) {
        if (filled < 3) bad[team] = 'Enter wins, losses and ties (ties may be 0), or clear all three.';
        else if (!vals.every(isCount)) bad[team] = 'Use whole, nonnegative numbers.';
        else if (Number(r.w) + Number(r.l) + Number(r.t) > maxGames) bad[team] = `Total games must be at most ${maxGames} before week ${week}.`;
        else record = { wins: Number(r.w), losses: Number(r.l), ties: Number(r.t) };
      }
      let tableStats: StandingEntry['tableStats'];
      try { tableStats = parseStandingTableStats({ pointsFor: r.pf, pointsAgainst: r.pa, home: r.home, away: r.away, streak: r.streak }, maxGames, record); }
      catch (e) { bad[team] = bad[team] ?? (e instanceof Error ? e.message : 'Invalid table stats.'); }
      return { team, needsWin: r.needsWin, backupQb: r.backupQb, ...(record ? { record } : {}), ...(tableStats ? { tableStats } : {}) };
    });
    setProblems(bad);
    if (Object.keys(bad).length) { setStatus({ kind: 'err', text: 'Nothing was saved. Fix the highlighted teams.' }); return; }
    try {
      const next = saveStandings(store(), { season, week, savedAt: new Date().toISOString(), entries });
      setSnaps(next);
      setStatus({ kind: 'ok', text: `Saved ${season} week ${week} standings in this browser. Forecasts already saved are unchanged until you rerun them.` });
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Could not save standings. Your inputs are kept.' });
    }
  };

  const doDelete = () => {
    if (!saved || !window.confirm(`Remove the saved ${season} week ${week} standings snapshot from this browser? Saved forecasts are unchanged. Other weeks are not affected.`)) return;
    try {
      const next = deleteStandings(store(), season, week);
      autoImported.current.add(`${season}:${week}`);
      setSnaps(next);
      setStatus({ kind: 'ok', text: `Removed the ${season} week ${week} snapshot.` });
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Could not remove standings.' });
    }
  };

  const input = (team: string, r: Row, c: (typeof COLS)[number], invalid: boolean) => (
    <input className={c.num ? 'n' : 't'} type={c.k === 'w' || c.k === 'l' || c.k === 't' ? 'number' : 'text'} inputMode={c.num ? 'numeric' : 'text'}
      {...(c.k === 'w' || c.k === 'l' || c.k === 't' ? { min: 0, max: 17, step: 1 } : {})} placeholder={c.num ? '' : '-'} value={r[c.k]}
      aria-label={`${team} ${c.name} entering week ${week}`} aria-invalid={invalid}
      onChange={ev => set(team, { [c.k]: ev.target.value } as Partial<Row>)} data-testid={`input-${c.k}-${team}`} />
  );

  const years = useMemo(() => {
    const top = new Date().getFullYear() + 1;
    return Array.from({ length: top - 2002 + 1 }, (_, i) => top - i);
  }, []);
  const ready = !!snaps && !loadError && week > 0 && !refreshing;
  const savedEntry = (team: string) => saved?.entries.find(e => e.team === team);
  const savedAtText = saved ? new Date(saved.savedAt).toLocaleString() : '';

  return (
    <section className="se" aria-labelledby="se-title">
      <div className="se-head">
        <div>
          <div className="eyebrow">Standings / this browser only</div>
          <h2 id="se-title">NFL standings</h2>
          <p>ESPN records and statistics entering the selected week. You control the strategy flags and can edit records manually.</p>
        </div>
        <div className="se-pickers">
          <label>Season
            <select value={season} onChange={e => changeSeason(Number(e.target.value))} data-testid="select-standings-season">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label>Records entering week
            <select value={week} onChange={e => changeWeek(Number(e.target.value))} data-testid="select-standings-week">
              {!week && <option value={0}>Loading current week…</option>}
              {Array.from({ length: 18 }, (_, i) => <option key={i + 1} value={i + 1}>Week {i + 1}</option>)}
            </select>
          </label>
        </div>
      </div>

      {official.isPending && <p role="status">Loading verified ESPN standings…</p>}
      {official.isError && <div className="se-banner err" role="alert">ESPN standings could not be loaded: {official.error.message} Saved standings are unchanged. <button className="btn-secondary" onClick={() => void official.refetch()}>Retry ESPN</button></div>}
      {official.data && <p className="tl-note"><a href={official.data.sourceUrl} target="_blank" rel="noreferrer">ESPN source</a> · Final games only · As of {new Date(official.data.fetchedAt).toLocaleString()}</p>}
      {official.data?.warnings.map(warning => <p className="se-banner warn" role="note" key={warning}>{warning}</p>)}
      <details className="se-explain">
        <summary data-testid="toggle-standings-help">How the simulator uses this</summary>
        <ul>
          <li>Each snapshot belongs to one season and week only. ESPN records use final regular-season games before that week, not later results. Week 1 starts at 0–0–0.</li>
          <li>Records exclude the target week&apos;s result. A complete record replaces the model&apos;s existing small record-strength prior. A blank row stays unknown and the prior is kept.</li>
          <li>Pct is calculated from W/L/T (ties count as half a win). Rows sort by saved win percentage, then alphabetically, not official NFL tiebreakers. PF, PA, Home, Away and Strk are optional display-only entries, not extra simulation boosts. Home/Away use W-L or W-L-T; Strk uses W1, L3 or T1. Leave unknown values blank.</li>
          <li>Needs win affects only the marked team, only in division games, raising baseline pass share by up to 1.2 percentage points. It is an unvalidated strategy assumption, not an effort, efficiency, scoring or fantasy-point boost.</li>
          <li>Backup QB marks a replacement starting this week, even if the depth chart lists him as QB1. Set the usual starter&apos;s weekly availability to Out in Team Library so the replacement is selected; this checkbox does not swap players. Available QB2 or deeper starters with known depth roles are also detected automatically. Unknown roles are not guessed. New simulations favor 58–72% rushing calls, including the red zone; the run-heavy rule takes priority over needs-win passing pressure. Unchecked means automatic detection, not a forced starter designation. Save and rerun to apply.</li>
          <li>There is no automatic playoff determination. Saved forecasts stay unchanged until you rerun them. Unsaved inputs never affect a simulation.</li>
        </ul>
      </details>

      {loadError && (
        <div className="se-banner err" role="alert" data-testid="status-standings-corrupt">
          <span><AlertTriangle size={15} aria-hidden /> {loadError} Editing is paused so the stored data is not overwritten.</span>
          <button className="btn-secondary" onClick={load} data-testid="button-standings-retry"><RotateCw size={14} /> Retry</button>
        </div>
      )}
      {status && (
        <div className={`se-banner ${status.kind}`} role={status.kind === 'ok' ? 'status' : 'alert'} data-testid="status-standings">
          <span>{status.text}</span>
          {Object.keys(problems).length > 0 && (
            <ul>{Object.entries(problems).map(([t, m]) => <li key={t}>{t}: {m}</li>)}</ul>
          )}
        </div>
      )}

      <div className="panel se-bar">
        <div className="se-state" data-testid="text-standings-state">
          {!ready ? <span className="se-badge none">{loadError ? 'Unavailable' : 'Loading'}</span>
            : saved ? <span className="se-badge saved">Snapshot exists for {season} week {week}</span>
            : <span className="se-badge none">No snapshot for {season} week {week}</span>}
          {dirty && <span className="se-badge dirty">Unsaved changes</span>}
          {saved && <span>Saved {savedAtText}</span>}
        </div>
        <div className="se-actions">
          <button className="btn-primary" onClick={doSave} disabled={!ready || (!dirty && !!saved)} data-testid="button-standings-save">
            <Save size={15} /> {saved ? 'Save changes' : 'Save snapshot'}
          </button>
          <button className="btn-secondary" onClick={() => void refreshOfficial()} disabled={!ready || official.isFetching} data-testid="button-standings-espn"><RotateCw size={14} /> Refresh from ESPN</button>
          <button className="btn-secondary" onClick={() => { adopt(saved); setStatus(null); }} disabled={!dirty} data-testid="button-standings-revert">Discard edits</button>
          <button className="btn-secondary btn-danger" onClick={doDelete} disabled={!ready || !saved} data-testid="button-standings-delete">
            <Trash2 size={14} /> Remove this week
          </button>
        </div>
      </div>

      <div className="se-tabs" role="tablist" aria-label="Conference">
        {([['AFC', 'American Football Conference'], ['NFC', 'National Football Conference']] as const).map(([c, label]) => (
          <button key={c} type="button" role="tab" id={`se-tab-${c}`} aria-selected={conf === c} aria-controls="se-panel" className={conf === c ? 'on' : ''} tabIndex={conf === c ? 0 : -1}
            onKeyDown={ev => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
              ev.preventDefault();
              const next = ev.key === 'Home' ? 'AFC' : ev.key === 'End' ? 'NFC' : conf === 'AFC' ? 'NFC' : 'AFC';
              setConf(next);
              document.getElementById(`se-tab-${next}`)?.focus();
            }}
            onClick={() => setConf(c)} data-testid={`tab-standings-${c}`}>{label}</button>
        ))}
      </div>
      {!snaps && !loadError ? <div className="se-skel" aria-busy="true" /> : (
        <fieldset className="se-grid" id="se-panel" role="tabpanel" aria-labelledby={`se-tab-${conf}`} disabled={!ready}>
          <legend className="sr-only">Records entering week {week} of {season}</legend>
          {(Object.entries(NFL_DIVISIONS) as [string, readonly string[]][]).map(([division, teams]) => {
            const order = [...teams].sort((a, b) => {
              const pa = savedEntry(a) ? standingPercentage(savedEntry(a)!) : null;
              const pb = savedEntry(b) ? standingPercentage(savedEntry(b)!) : null;
              if (pa === null && pb === null) return a.localeCompare(b);
              if (pa === null) return 1;
              if (pb === null) return -1;
              return pb - pa || a.localeCompare(b);
            });
            return (
              <section className="se-div" key={division} hidden={!division.startsWith(conf)} aria-labelledby={`se-d-${division}`} data-testid={`group-division-${division}`}>
                <h3 id={`se-d-${division}`}>{division}</h3>
                <div className="se-scroll">
                   <table className="se-table" aria-label={`${division} standings`}>
                    <thead><tr>
                      <th scope="col" className="se-tc">Team</th>
                      {COLS.slice(0, 3).map(c => <th scope="col" key={c.k}>{c.label}</th>)}
                      <th scope="col" className="se-pct">Pct</th>
                      {COLS.slice(3).map(c => <th scope="col" key={c.k}>{c.label}</th>)}
                      <th scope="col" className="se-fl">Needs win</th><th scope="col" className="se-fl">Backup QB</th>
                    </tr></thead>
                    <tbody>
                      {order.map(team => {
                        const r = draft[team];
                        const err = problems[team];
                        return (
                          <tr className={`se-row${r.needsWin ? ' need' : ''}`} key={team} data-testid={`row-standing-${team}`}>
                            <th scope="row" className="se-tc">
                              <span className="se-teamcell"><Logo team={team} /><span><span className="se-team" title={team}>{nick(team)}</span>
                                {err && <span className="se-err" role="alert">{err}</span>}</span></span>
                            </th>
                            {COLS.slice(0, 3).map(c => <td key={c.k}>{input(team, r, c, !!err)}</td>)}
                            <td className="se-pct" data-testid={`text-pct-${team}`}>{draftPct(r) || <span className="se-dim" aria-label="unknown">&nbsp;</span>}</td>
                            {COLS.slice(3).map(c => <td key={c.k}>{input(team, r, c, !!err)}</td>)}
                            <td className="se-fl"><label className="se-chk">
                              <input type="checkbox" checked={r.needsWin} onChange={ev => set(team, { needsWin: ev.target.checked })}
                                aria-label={`${team} needs a win in division games`} data-testid={`check-needs-win-${team}`} /></label></td>
                            <td className="se-fl"><label className="se-chk">
                              <input type="checkbox" checked={r.backupQb} onChange={ev => set(team, { backupQb: ev.target.checked })}
                                aria-label={`${team} starting backup QB this week`} data-testid={`check-backup-qb-${team}`} /></label>
                              {(r.w || r.l || r.t || r.pf || r.pa || r.home || r.away || r.streak) ? <button type="button" className="text-button se-clear" onClick={() => clearTeam(team)} aria-label={`Clear ${team} record`}>clear</button> : null}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </fieldset>
      )}
      <p className="input-help">Storage is this browser and device only; clearing site data deletes it. Total games per team cannot exceed {maxGames} before week {week}.</p>
    </section>
  );
}
