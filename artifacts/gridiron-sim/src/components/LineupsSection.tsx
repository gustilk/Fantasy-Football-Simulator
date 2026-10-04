import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, Trash2, Play, Square, RotateCw } from 'lucide-react';
import { useDraftKingsBoard } from '@/hooks/use-draftkings-board';
import {
  buildLineupPool, exportLineups, lineupSlots, parseSalaryCsv,
  type Lineup, type LineupPlayer, type SalaryPlayer,
} from '@/lib/lineups';
import './lineups.css';
import './draftkings.css';

const KEY = 'gridiron-dk-salaries-v1';
const CAP = 50000;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const msg = (e: unknown) => e instanceof Error ? e.message : 'The operation failed. Please retry.';

interface SavedSalaries { version: 1; season: number; filename: string; importedAt: string; slateId: string; sunday: string; csv: string }
type Saved =
  | { status: 'none' }
  | { status: 'corrupt'; reason: string }
  | { status: 'other-season'; record: SavedSalaries }
  | { status: 'ok'; record: SavedSalaries };

function loadSaved(season: number): Saved {
  let raw: string | null;
  try { raw = localStorage.getItem(KEY); } catch (e) { return { status: 'corrupt', reason: `Browser storage is unreadable: ${msg(e)}` }; }
  if (raw === null) return { status: 'none' };
  try {
    const r = JSON.parse(raw) as Partial<SavedSalaries>;
    if (!r || r.version !== 1 || typeof r.season !== 'number' || typeof r.csv !== 'string' || typeof r.filename !== 'string'
      || typeof r.importedAt !== 'string' || typeof r.slateId !== 'string' || typeof r.sunday !== 'string') throw new Error('Unrecognized format or version.');
    parseSalaryCsv(r.csv);
    const record = r as SavedSalaries;
    return record.season === season ? { status: 'ok', record } : { status: 'other-season', record };
  } catch (e) { return { status: 'corrupt', reason: msg(e) }; }
}

export default function LineupsSection({ season }: { season: number }) {
  const c = useDraftKingsBoard(season);
  const slate = c.activeSlate;
  const [saved, setSaved] = useState<Saved>(() => loadSaved(season));
  const [fileError, setFileError] = useState('');
  const [count, setCount] = useState(3);
  const [running, setRunning] = useState(false);
  const [genError, setGenError] = useState('');
  const [result, setResult] = useState<{ key: string; lineups: Lineup[] } | null>(null);
  const [clock, setClock] = useState(Date.now);
  const worker = useRef<Worker | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSaved(loadSaved(season)); setFileError(''); }, [season]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    const listener = (event: StorageEvent) => { if (event.key === KEY) setSaved(loadSaved(season)); };
    window.addEventListener('storage', listener);
    return () => { window.clearInterval(timer); window.removeEventListener('storage', listener); };
  }, [season]);

  const record = saved.status === 'ok' ? saved.record : null;
  const linked = !!record && !!slate && record.slateId === slate.id;
  const pool = useMemo(() => {
    if (!record || !slate || !linked) return null;
    try { return { ...buildLineupPool(parseSalaryCsv(record.csv), slate, c.historyQuery.data, clock), error: '' }; }
    catch (e) { return { players: [] as LineupPlayer[], issues: [] as { player: SalaryPlayer; reason: string }[], warnings: [] as string[], error: msg(e) }; }
  }, [record, slate, linked, c.historyQuery.data, clock]);
  const key = record && slate ? `${record.importedAt}|${slate.id}|${count}|${c.historyQuery.data?.map(t => `${t.team}:${t.version}`).join(',')}|${slate.forecasts.map(f => Date.parse(f.kickoff) <= clock).join(',')}` : '';

  const stop = () => { worker.current?.terminate(); worker.current = null; setRunning(false); };
  useEffect(() => { stop(); setResult(null); setGenError(''); }, [key]);
  useEffect(() => () => { worker.current?.terminate(); }, []);

  const importFile = async (file: File) => {
    setFileError('');
    if (saved.status === 'corrupt') { setFileError('Saved salary data is unreadable. Discard it first; it is never overwritten silently.'); return; }
    if (!slate) { setFileError('Choose a saved forecast slate before importing salaries.'); return; }
    try {
      const csv = await file.text();
      parseSalaryCsv(csv);
      const next: SavedSalaries = { version: 1, season, filename: file.name, importedAt: new Date().toISOString(), slateId: slate.id, sunday: slate.sunday, csv };
      localStorage.setItem(KEY, JSON.stringify(next));
      setSaved({ status: 'ok', record: next });
    } catch (e) { setFileError(`Salary file was not imported: ${msg(e)}`); }
  };
  const discard = () => {
    try { localStorage.removeItem(KEY); setSaved({ status: 'none' }); setFileError(''); }
    catch (e) { setFileError(msg(e)); }
  };
  const relink = () => {
    if (!record || !slate) return;
    try {
      const next = { ...record, slateId: slate.id, sunday: slate.sunday, importedAt: new Date().toISOString() };
      localStorage.setItem(KEY, JSON.stringify(next));
      setSaved({ status: 'ok', record: next });
    } catch (e) { setFileError(msg(e)); }
  };

  const generate = () => {
    if (!pool || !pool.players.length) return;
    stop(); setGenError(''); setResult(null);
    const fresh = buildLineupPool(parseSalaryCsv(record!.csv), slate!, c.historyQuery.data, Date.now());
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
    w.postMessage({ players: fresh.players, count });
  };

  const download = (lineups: Lineup[]) => {
    try {
      const url = URL.createObjectURL(new Blob([exportLineups(lineups)], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `gridiron-dk-lineups-${season}.csv`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setGenError(msg(error)); }
  };

  const shown = result && result.key === key ? result.lineups : null;
  const blocked = !!c.storageError || saved.status === 'corrupt' || c.historyQuery.isLoading || c.historyQuery.isError;

  return <section className="dk lu" aria-label="Lineups">
    {c.historyQuery.isError && <div className="dk-err" role="alert">Current saved roster availability could not be checked. <button className="btn-secondary" onClick={c.refresh}>Retry roster check</button></div>}
    <div className="dk-head">
      <h1>Lineups</h1>
      <p>Highest projected DraftKings Classic lineups, {season}.</p>
    </div>
    <div className="dk-note lu-warn" role="note"><strong>Import salaries for every contest slate.</strong> Upload the official DraftKings NFL Classic CSV for the exact weekly contest you are entering, then pair it with the forecast for the same games. Showdown files are rejected.</div>
    {c.storageError && <div className="dk-err" role="alert">{c.storageError} <button className="btn-secondary" onClick={c.reloadArchive}>Retry</button></div>}

    <div className="panel dk-panel lu-panel">
      <h2 className="lu-h">1. Forecast</h2>
      {c.slates.length === 0
        ? <p className="dk-muted">No saved forecasts for {season}. Run and save a Sunday on the DraftKings tab first.</p>
        : <div className="field"><label htmlFor="lu-slate">Saved forecast slate</label>
          <select id="lu-slate" value={slate?.id ?? ''} onChange={e => c.selectSlate(e.target.value)}>
            {c.slates.map(s => <option key={s.id} value={s.id}>{s.sunday} · {s.forecasts.length} games · saved {new Date(s.createdAt).toLocaleString()}</option>)}
          </select></div>}
    </div>

    <div className="panel dk-panel lu-panel">
      <h2 className="lu-h">2. Salaries</h2>
      {saved.status === 'corrupt' && <div className="dk-err" role="alert">Saved salary data could not be read: {saved.reason}
        <button className="btn-secondary" onClick={discard}><Trash2 size={14} /> Discard saved data</button></div>}
      {saved.status === 'other-season' && <div className="dk-note">A salary file from season {saved.record.season} ({saved.record.filename}) is stored but is not used for {season}. Import this season's file to replace it.</div>}
      {record && <div className="lu-file">
        <div><strong>{record.filename}</strong>
          <span className="dk-muted">Imported {new Date(record.importedAt).toLocaleString()} · forecast {record.sunday} <span className="lu-mono">({record.slateId.slice(0, 8)})</span></span></div>
        <button className="btn-secondary" onClick={discard}><Trash2 size={14} /> Remove</button>
      </div>}
      <div className="lu-actions">
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden data-testid="lineups-file"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        <button className="btn-secondary" disabled={saved.status === 'corrupt' || !slate} onClick={() => fileRef.current?.click()}><Upload size={14} /> {record ? 'Replace salary CSV' : 'Upload salary CSV'}</button>
      </div>
      {fileError && <div className="dk-err" role="alert">{fileError}</div>}
      {record && slate && !linked && <div className="dk-err lu-mismatch" role="alert">
        This salary file was imported against forecast {record.sunday}, not the selected {slate.sunday}. Results are paused.
        {c.slates.some(s => s.id === record.slateId) && <button className="btn-secondary" onClick={() => c.selectSlate(record.slateId)}>Switch back</button>}
        <button className="btn-secondary" onClick={relink}>Confirm same contest</button></div>}
    </div>

    {pool && <div className="panel dk-panel lu-panel">
      <h2 className="lu-h">3. Pool</h2>
      {pool.error ? <div className="dk-err" role="alert">{pool.error}</div> : <>
        <div className="lu-stats">
          <div><span>Matched players</span><strong>{pool.players.length}</strong></div>
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
      <p className="dk-muted lu-gap">Exact optimum under {money(CAP)}: QB, 2 RB, 3 WR, TE, FLEX, DST, players from at least 2 games.</p>
      {running && <div role="status"><span className="dk-muted"><RotateCw size={12} className="spin-icon" /> Searching all legal lineups</span><div className="dk-bar"><i className="lu-indeterminate" /></div></div>}
      {genError && <div className="dk-err" role="alert">{genError} <button className="btn-secondary" onClick={generate}>Retry</button></div>}
    </div>

    {shown && shown.map((l, i) => <article className="panel lu-card" key={i} data-testid={`lineup-${i + 1}`}>
      <header className="lu-card-head">
        <h3>Lineup {i + 1}</h3>
        <div className="lu-card-stats">
          <div><span>Projected</span><strong className="lu-pts">{l.points.toFixed(2)}</strong></div>
          <div><span>Salary</span><strong>{money(l.salary)}</strong></div>
          <div><span>Remaining</span><strong>{money(CAP - l.salary)}</strong></div>
        </div>
      </header>
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
