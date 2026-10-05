import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, Trash2, Play, Square, RotateCw } from 'lucide-react';
import { useDraftKingsBoard } from '@/hooks/use-draftkings-board';
import {
  buildLineupPool, exportLineups, lineupSlots, parseSalaryCsv,
  matchesGameInfo, type Lineup, type LineupPlayer, type SalaryPlayer, type LineupFormat,
} from '@/lib/lineups';
import DraftKingsAccuracy from './DraftKingsAccuracy';
import './lineups.css';
import './draftkings.css';
import { readSalaryFile } from '@/lib/salary-file';
import type { SimulatorLineupSource } from '@/lib/simulator-lineups';
import { buildShowdownPool } from '@/lib/showdown-lineups';
import { SHOWDOWN_RULES_URL } from '@/lib/showdown-scoring';
import type { SavedSalaries } from '@/lib/salary-storage';
import { useSyncedSalaries } from '@/hooks/use-synced-salaries';

const CAP = 50000;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const msg = (e: unknown) => e instanceof Error ? e.message : 'The operation failed. Please retry.';

export default function LineupsSection({ season, forecastSource }: { season: number; forecastSource?: SimulatorLineupSource }) {
  const c = useDraftKingsBoard(season);
  const format: LineupFormat = forecastSource ? 'showdown' : 'classic';
  const formatLabel = format === 'showdown' ? 'Captain/Showdown' : 'Classic';
  const [selectedGameId, setSelectedGameId] = useState('');
  const [selectedSimulatorSlate, setSelectedSimulatorSlate] = useState('');
  const slates = forecastSource ? forecastSource.slates : c.slates;
  const slate = forecastSource
    ? slates.find(s => s.id === selectedSimulatorSlate) ??
      slates.find(s => s.forecasts[0]?.week === forecastSource.preferredWeek) ?? slates[0] ?? null
    : c.activeSlate;
  const selectSlate = (id: string) => forecastSource ? setSelectedSimulatorSlate(id) : c.selectSlate(id);
  const storageError = forecastSource ? forecastSource.error : c.storageError;
  const forecastInstructions = forecastSource ? 'select, run and save the upcoming matchup in Game Simulator' : 'run and save the matching Sunday on the DraftKings tab';
  const salarySync = useSyncedSalaries(season, format);
  const saved = salarySync.saved;
  const [fileError, setFileError] = useState('');
  const [importing, setImporting] = useState(false);
  const importAttempt = useRef(0);
  const [count, setCount] = useState(3);
  const [mode, setMode] = useState<'tournament' | 'average'>('tournament');
  const [running, setRunning] = useState(false);
  const [genError, setGenError] = useState('');
  const [result, setResult] = useState<{ key: string; lineups: Lineup[] } | null>(null);
  const [clock, setClock] = useState(Date.now);
  const worker = useRef<Worker | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    importAttempt.current++;
    setSelectedSimulatorSlate('');
    setSelectedGameId('');
    setImporting(false); setFileError('');
    return () => { importAttempt.current++; };
  }, [season, format]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => { window.clearInterval(timer); };
  }, [season, format]);

  const record = saved.status === 'ok' ? saved.record : null;
  const salaryRows = useMemo(() => record ? parseSalaryCsv(record.csv, record.format ?? 'classic') : [], [record]);
  const game = slate?.forecasts.find(g => g.gameId === selectedGameId) ??
    slate?.forecasts.find(g => g.gameId === record?.gameId) ?? slate?.forecasts[0];
  const sameFormat = !!record && (record.format ?? 'classic') === format;
  const linked = sameFormat && !!slate && record!.slateId === slate.id && (format !== 'showdown' || record!.gameId === game?.gameId);
  const pool = useMemo(() => {
    if (!record || !slate || !linked) return null;
    try { return { ...(format === 'showdown' ? buildShowdownPool(salaryRows, slate, game?.gameId ?? '', c.historyQuery.data, clock) : buildLineupPool(salaryRows, slate, c.historyQuery.data, clock)), error: '' }; }
    catch (e) { return { players: [] as LineupPlayer[], issues: [] as { player: SalaryPlayer; reason: string }[], warnings: [] as string[], error: msg(e) }; }
  }, [record, salaryRows, slate, linked, c.historyQuery.data, clock, format, game?.gameId]);
  const key = record && slate ? `${record.importedAt}|${format}|${game?.gameId}|${slate.id}|${count}|${mode}|${c.historyQuery.data?.map(t => `${t.team}:${t.version}`).join(',')}|${(format === 'showdown' && game ? [game] : slate.forecasts).map(f => Date.parse(f.kickoff) <= clock).join(',')}` : '';

  const stop = () => { worker.current?.terminate(); worker.current = null; setRunning(false); };
  useEffect(() => { stop(); setResult(null); setGenError(''); }, [key]);
  useEffect(() => () => { worker.current?.terminate(); }, []);

  const importFile = async (file: File) => {
    setFileError('');
    if (saved.status === 'corrupt') { setFileError('Saved salary data is unreadable. Discard it first; it is never overwritten silently.'); return; }
    const attempt = ++importAttempt.current;
    setImporting(true);
    try {
      const { csv, players } = await readSalaryFile(file, undefined, format);
      if (attempt !== importAttempt.current) return;
      const matches = format === 'showdown' ? slate?.forecasts.filter(f => players.every(p => matchesGameInfo(p, f))) ?? [] : [];
      const importGame = matches.length === 1 ? matches[0] : undefined;
      if (importGame) setSelectedGameId(importGame.gameId);
      const next: SavedSalaries = { version: 1, season, filename: file.name, importedAt: new Date().toISOString(),
        slateId: format === 'showdown' && !importGame ? '' : slate?.id ?? '', sunday: slate?.sunday ?? '', csv, format,
        ...(format === 'showdown' ? { gameId: importGame?.gameId ?? '' } : {}) };
      await salarySync.save(next);
    } catch (e) {
      if (attempt === importAttempt.current) setFileError(`Salary file was not imported: ${msg(e)}`);
    } finally {
      if (attempt === importAttempt.current) setImporting(false);
    }
  };
  const discard = async () => {
    importAttempt.current++; setImporting(false);
    try { await salarySync.remove(); setFileError(''); }
    catch (e) { setFileError(msg(e)); }
  };
  const relink = () => {
    if (!record || !slate || !sameFormat) return;
    if (format === 'showdown' && (!game || !salaryRows.every(p => matchesGameInfo(p, game)))) {
      setFileError('This salary CSV is for a different matchup or kickoff. Select its matching game and forecast first.'); return;
    }
    try {
      const next = { ...record, slateId: slate.id, sunday: slate.sunday, importedAt: new Date().toISOString(),
        ...(format === 'showdown' ? { gameId: game!.gameId } : {}) };
      salarySync.pair(next);
    } catch (e) { setFileError(msg(e)); }
  };

  const generate = () => {
    if (!pool || !pool.players.length) return;
    stop(); setGenError(''); setResult(null);
    let fresh: ReturnType<typeof buildLineupPool>;
    try { fresh = format === 'showdown'
      ? buildShowdownPool(parseSalaryCsv(record!.csv, format), slate!, game!.gameId, c.historyQuery.data, Date.now())
      : buildLineupPool(parseSalaryCsv(record!.csv), slate!, c.historyQuery.data, Date.now()); }
    catch (e) { setGenError(msg(e)); return; }
    const runKey = key;
    let w: Worker;
    try { w = new Worker(new URL('../lib/lineup-worker.ts', import.meta.url), { type: 'module' }); }
    catch (e) { setGenError(`Optimizer could not start: ${msg(e)}`); return; }
    worker.current = w; setRunning(true);
    w.onmessage = (ev: MessageEvent<{ lineups?: Lineup[]; error?: string }>) => {
      if (worker.current !== w) return;
      w.terminate(); worker.current = null; setRunning(false);
      if (ev.data.error || !ev.data.lineups) setGenError(ev.data.error ?? 'Optimizer returned no result.');
      else if (!ev.data.lineups.length) setGenError('No legal lineup exists under the $50,000 cap with these players.');
      else setResult({ key: runKey, lineups: ev.data.lineups });
    };
    w.onerror = e => {
      if (worker.current !== w) return;
      w.terminate(); worker.current = null; setRunning(false); setGenError(`Optimizer failed: ${e.message || 'worker error'}`);
    };
    w.postMessage(mode === 'tournament' ? { players: fresh.players, count, mode, format, slate: slate! } : { players: fresh.players, count, mode, format });
  };

  const download = (lineups: Lineup[]) => {
    try {
      const url = URL.createObjectURL(new Blob([exportLineups(lineups)], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `gridiron-dk-${format === 'showdown' ? 'captain-' : ''}lineups-${season}.csv`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setGenError(msg(error)); }
  };

  const shown = result && result.key === key ? result.lineups : null;
   const blocked = importing || salarySync.loading || !!salarySync.error || !!storageError || saved.status === 'corrupt' || c.historyQuery.isLoading || c.historyQuery.isError;

  return <section className="dk lu" aria-label="Lineups">
    {c.historyQuery.isError && <div className="dk-err" role="alert">Current saved roster availability could not be checked. <button className="btn-secondary" onClick={c.refresh}>Retry roster check</button></div>}
    <div className="dk-head">
      <h1>{forecastSource ? 'DraftKings Captain lineups' : 'Lineups'}</h1>
      <p>DraftKings {format === 'showdown' ? 'Showdown Captain' : 'Classic'} lineups, {season}.{forecastSource && ' Choose your saved single-game forecast.'}</p>
    </div>
    <div className="dk-note lu-warn" role="note"><strong>Import salaries for every contest.</strong> Upload the official DraftKings NFL {format === 'showdown' ? 'Showdown CSV with separate CPT and FLEX rows' : 'Classic CSV'}, then pair it with the forecast for the same matchup{format === 'classic' ? 's' : ''}. {format === 'classic' && 'Use Game Simulator for Captain contests.'}</div>
    {storageError && <div className="dk-err" role="alert">{storageError}{!forecastSource && <button className="btn-secondary" onClick={c.reloadArchive}>Retry</button>}</div>}
    {forecastSource && <details className="panel dk-panel lu-panel"><summary>Official Captain rules &amp; scoring</summary>
      <p className="dk-muted">1 CPT + 5 FLEX, six different players from both teams in one game. $50,000 cap. Captain costs 1.5× FLEX salary and scores 1.5× all points, bonuses and penalties. QB/RB/WR/TE/K/DST are eligible.</p>
      <p className="dk-muted">K: made extra point +1; 0–39 yard FG +3; 40–49 +4; 50+ +5. DST: sack +1; interception/recovered fumble +2; defensive or return TD +6; safety/blocked kick/conversion return +2.</p>
      <p className="dk-muted">DST points allowed: 0 → +10; 1–6 → +7; 7–13 → +4; 14–20 → +1; 21–27 → 0; 28–34 → −1; 35+ → −4. Offense retains full PPR, yardage/TD scoring and yardage bonuses; fumbles lost −1.</p>
      <a href={SHOWDOWN_RULES_URL} target="_blank" rel="noreferrer">DraftKings official rules</a>
    </details>}
    {forecastSource?.warnings.map((warning, i) => <div className="dk-note" key={i}>{warning}</div>)}

    <div className="panel dk-panel lu-panel">
      <h2 className="lu-h">1. Forecast</h2>
      {slates.length === 0
        ? <p className="dk-muted">No eligible saved forecasts for {season}. You can upload salaries now. To generate lineups, {forecastInstructions}, then select it here.</p>
        : <div className="field"><label htmlFor="lu-slate">Saved forecast slate</label>
          <select id="lu-slate" value={slate?.id ?? ''} onChange={e => selectSlate(e.target.value)}>
            {slates.map(s => <option key={s.id} value={s.id}>{s.sunday} · {s.forecasts.length} games · saved {new Date(s.savedAt ?? s.createdAt).toLocaleString()}</option>)}
          </select></div>}
      {format === 'showdown' && slate && <div className="field lu-gap"><label htmlFor="lu-game">Single game</label>
        <select id="lu-game" data-testid="showdown-game" value={game?.gameId ?? ''} onChange={e => setSelectedGameId(e.target.value)}>
          {slate.forecasts.map(g => <option key={g.gameId} value={g.gameId}>{g.awayTeam} at {g.homeTeam} · {new Date(g.kickoff).toLocaleString()}</option>)}
        </select></div>}
    </div>

    <div className="panel dk-panel lu-panel">
      <h2 className="lu-h">2. {formatLabel} salaries</h2>
      <p className="dk-muted">Salary uploads are shared across devices. Classic and Captain remain separate. Forecast pairing is specific to this device.</p>
      {salarySync.loading && <p className="dk-muted" role="status">Syncing salary data…</p>}
      {salarySync.error && <div className="dk-err" role="alert">{salarySync.error} <button className="btn-secondary" onClick={salarySync.refresh}>Retry salary sync</button></div>}
      {salarySync.warning && <p className="dk-note" role="status">{salarySync.warning}</p>}
      {saved.status === 'none' && <p className="dk-note" role="status">No {formatLabel} salary CSV uploaded. {format === 'showdown' ? 'Upload the official single-game Showdown CSV with CPT and FLEX rows; your Classic CSV stays in Lineups.' : 'Upload your NFL Classic contest CSV; Captain files stay in Game Simulator.'}</p>}
      {saved.status === 'corrupt' && <div className="dk-err" role="alert">Saved salary data could not be read: {saved.reason}
        <button className="btn-secondary" onClick={discard}><Trash2 size={14} /> Discard saved data</button></div>}
      {saved.status === 'other-season' && <div className="dk-note">A salary file from season {saved.record.season} ({saved.record.filename}) is stored but is not used for {season}. Import this season's file to replace it.</div>}
      {record && <div className="lu-file">
        <div><strong>{record.filename}</strong>
          <span className="dk-muted">Imported {new Date(record.importedAt).toLocaleString()}{record.slateId && <> · forecast {record.sunday} <span className="lu-mono">({record.slateId.slice(0, 8)})</span></>}</span>
          <span className="dk-muted" role="status" data-testid="lineups-import-status">{salaryRows.length} salary rows imported successfully.{!record.slateId && ' Not yet paired with a forecast.'}</span></div>
        <button className="btn-secondary" disabled={salarySync.loading || !!salarySync.error} aria-label={`Remove ${formatLabel} salary CSV`} onClick={() => void discard()}><Trash2 size={14} /> Remove</button>
      </div>}
      <div className="lu-actions">
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden data-testid="lineups-file"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        <button className="btn-secondary" data-testid="lineups-upload" disabled={saved.status === 'corrupt' || importing || salarySync.loading || !!salarySync.error} onClick={() => fileRef.current?.click()}>{importing ? <><RotateCw size={14} className="spin-icon" /> Uploading {formatLabel} salary CSV…</> : <><Upload size={14} /> {record ? `Replace ${formatLabel} salary CSV` : `Upload ${formatLabel} salary CSV`}</>}</button>
      </div>
      {importing && <p className="dk-muted lu-gap" role="status">Reading and validating your salary file…</p>}
      {fileError && <div className="dk-err" role="alert">{fileError}</div>}
      {record && !slate && <p className="dk-muted lu-gap">Your salary data is saved across devices. To continue, {forecastInstructions}; no need to upload this file again.</p>}
      {record && !sameFormat && <div className="dk-note lu-gap" role="status">The saved salary CSV is for {(record.format ?? 'classic') === 'showdown' ? 'Captain/Showdown' : 'Classic'}, not this {format === 'showdown' ? 'Captain' : 'Classic'} builder. It has not been changed. Upload the correct contest CSV to replace it.</div>}
      {record && slate && sameFormat && !linked && <div className="dk-err lu-mismatch" role="alert">
        {record.slateId ? format === 'showdown'
          ? <>This salary file is paired to a different game or weekly forecast. Results are paused. Select its matching matchup and kickoff.</>
          : <>This salary file was imported against forecast {record.sunday}, not the selected {slate.sunday}. Results are paused.</>
          : <>Your salary file is ready. Confirm that the selected forecast ({slate.sunday}) covers the same contest games.</>}
        {slates.some(s => s.id === record.slateId) && <button className="btn-secondary" onClick={() => { selectSlate(record.slateId); if (format === 'showdown' && record.gameId) setSelectedGameId(record.gameId); }}>Switch back</button>}
        <button className="btn-secondary" disabled={importing || salarySync.loading || !!salarySync.error} onClick={relink}>{record.slateId ? 'Confirm same contest' : 'Use selected forecast'}</button></div>}
    </div>

    {pool && <div className="panel dk-panel lu-panel">
      <h2 className="lu-h">3. Pool</h2>
      {pool.error ? <div className="dk-err" role="alert">{pool.error}</div> : <>
        <div className="lu-stats">
          <div><span>{format === 'showdown' ? 'Matched salary rows' : 'Matched players'}</span><strong>{pool.players.length}</strong></div>
          <div><span>Excluded rows</span><strong>{pool.issues.length}</strong></div>
          <div><span>Games</span><strong>{new Set(pool.players.map(p => p.gameId)).size}</strong></div>
        </div>
        {pool.warnings.map((w, i) => <div className="dk-note lu-gap" key={i}>{w}</div>)}
        {pool.issues.length > 0 && <details><summary>Unmatched, started and excluded rows ({pool.issues.length})</summary>
          <div className="player-table-wrap lu-issues"><table className="player-table"><thead><tr><th>Player</th><th>Salary</th><th>Reason</th></tr></thead><tbody>
            {pool.issues.map((it, i) => <tr key={`${it.player.id}-${i}`}>
              <td><span className="player-name">{it.player.name}</span><span className="player-pos">{it.player.position} {it.player.team}</span></td>
              <td className="lu-mono">{money(it.player.salary)}</td><td>{it.reason}</td></tr>)}
          </tbody></table></div></details>}
      </>}
    </div>}

    <div className="panel dk-panel lu-panel">
      <h2 className="lu-h">4. Generate</h2>
      <div className="dk-row">
        <div className="field"><label htmlFor="lu-count">Lineups</label>
          <select id="lu-count" value={count} onChange={e => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Top {n}</option>)}</select></div>
        {!running
          ? <button className="btn-primary" disabled={blocked || !pool || !!pool.error || pool.players.length === 0} onClick={generate} data-testid="lineups-generate"><Play size={15} /> Generate</button>
          : <button className="btn-secondary" onClick={stop} data-testid="lineups-cancel"><Square size={14} /> Cancel</button>}
        {shown && shown.length > 0 && <button className="btn-secondary" onClick={() => download(shown)}><Download size={14} /> DK upload CSV</button>}
      </div>
      <fieldset className="lu-mode" disabled={running}><legend>Strategy</legend>
        {([['tournament', 'Tournament upside', 'Looks for QB and receiver pairings with the best simulated high-end outcomes.'], ['average', 'Highest average', 'Maximizes the sum of saved mean projections.']] as const).map(([v, t, d]) =>
          <label key={v} className={`lu-mode-opt${mode === v ? ' on' : ''}`}><input type="radio" name="lu-mode" checked={mode === v} onChange={() => setMode(v)} /><strong>{t}</strong><span>{format === 'showdown' && v === 'tournament' ? 'Compares Captain choices and jointly simulated single-game outcomes.' : d}</span></label>)}
      </fieldset>
      <p className="dk-muted lu-gap">{money(CAP)} {format === 'showdown' ? 'Captain rules: 1 CPT + 5 FLEX, six different players from both teams in one game. Captain points shown already include 1.5×; do not multiply them again.' : 'Classic rules: QB, 2 RB, 3 WR, TE, FLEX, DST, players from at least 2 games.'} Salaries and eligibility come only from your salary file.</p>
      <div className="dk-note lu-gap" role="note">{mode === 'tournament'
        ? format === 'showdown'
          ? <>Tournament mode compares jointly simulated outcomes for up to 20 high-average FLEX combinations per Captain. Captain/FLEX assignments can differ with the same six players. This bounded search is not a guaranteed global upside optimum; no ownership data or guarantee of winning.</>
          : <>Tournament mode searches for QB and receiver combinations with jointly simulated upside. Returned lineups differ by at least two players. It is a bounded candidate search, not a guaranteed global optimum. There is no ownership data and no guarantee of winning. Rare defense and special teams events are not fully modeled.</>
        : <>Highest average finds the best total of saved mean projections under the cap. It does not consider upside or correlation.</>}</div>
      {running && <div role="status"><span className="dk-muted"><RotateCw size={12} className="spin-icon" /> {mode === 'tournament' ? 'Simulating candidate lineups' : 'Searching all legal lineups'}</span><div className="dk-bar"><i className="lu-indeterminate" /></div></div>}
      {genError && <div className="dk-err" role="alert">{genError} <button className="btn-secondary" onClick={generate}>Retry</button></div>}
    </div>

    {!forecastSource && <DraftKingsAccuracy report={c.accuracy} season={season} loading={c.historyQuery.isLoading} failed={c.historyQuery.isError || !!c.storageError} refresh={c.storageError ? c.reloadArchive : c.refresh} />}

    {shown && mode === 'tournament' && shown.length < count && <div className="dk-note">Found {shown.length} lineup(s){format === 'classic' ? ' with the required two-player variation' : ''}. The search did not find {count}; it will not fill the list with duplicates.</div>}
    {shown && shown.map((l, i) => <article className="panel lu-card" key={i} data-testid={`lineup-${i + 1}`}>
      <header className="lu-card-head">
        <h3>Lineup {i + 1}</h3>
        <div className="lu-card-stats">
          <div><span>Mean projected total</span><strong className="lu-pts">{l.points.toFixed(2)}</strong></div>
          <div><span>Salary</span><strong>{money(l.salary)}</strong></div>
          <div><span>Remaining</span><strong>{money(CAP - l.salary)}</strong></div>
        </div>
      </header>
      {l.tournament && <div className="lu-tour" data-testid={`lineup-${i + 1}-upside`}>
        <div><span>High-end modeled score</span><strong>{l.tournament.p90.toFixed(1)}</strong></div>
          <div><span>Simulated {l.tournament.targetScore ?? 220}+ frequency</span><strong>{(l.tournament.chanceTarget ?? l.tournament.chance220).toFixed(1)}%</strong></div>
        <div><span>Simulated mean</span><strong>{l.tournament.simulatedMean.toFixed(1)}</strong></div>
        <p>High-end score means the upper end of simulated outcomes, not the average or a guarantee. Modeled range {l.tournament.p10.toFixed(1)} to {l.tournament.p90.toFixed(1)}. {l.tournament.stackNames.length > 0 && <>Stack: {l.tournament.stackNames.join(', ')}. </>}{l.tournament.scenarios.toLocaleString('en-US')} scenarios, {l.tournament.candidates.toLocaleString('en-US')} candidates. Frequency from the model, not a chance of winning.</p>
      </div>}
      <div className="player-table-wrap"><table className="player-table"><thead><tr><th>Slot</th><th>Player</th><th>Salary</th><th>Proj</th></tr></thead><tbody>
        {lineupSlots(l).map(({ slot, player }) => <tr key={`${slot}-${player.id}`}>
          <td className="lu-slot">{slot}</td>
          <td><span className="player-name">{player.name}</span><span className="player-pos">{player.position} {player.team}</span></td>
          <td className="lu-mono">{money(player.salary)}</td>
          <td className="dk-mean lu-proj">{player.mean.toFixed(2)}</td></tr>)}
      </tbody></table></div>
    </article>)}
  </section>;
}
