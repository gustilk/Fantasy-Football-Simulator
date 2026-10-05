import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RotateCw, Save, Trash2 } from 'lucide-react';
import { NFL_DIVISIONS, NFL_TEAM_NAMES } from '@/lib/nfl-divisions';
import {
  readStandings, findStandings, saveStandings, deleteStandings, standingPercentage,
  type StandingsSnapshot, type StandingEntry,
} from '@/lib/standings';
import './standings-editor.css';

type Props = { season: number; onSeasonChange: (year: number) => void; onDirtyChange?: (dirty: boolean) => void };
type Row = { w: string; l: string; t: string; needsWin: boolean };
type Draft = Record<string, Row>;
type Status = { kind: 'ok' | 'err'; text: string } | null;

const blankRow = (): Row => ({ w: '', l: '', t: '', needsWin: false });
const toDraft = (snap: StandingsSnapshot | undefined): Draft => {
  const d: Draft = {};
  for (const team of NFL_TEAM_NAMES) {
    const e = snap?.entries.find(x => x.team === team);
    d[team] = e ? { w: e.record ? String(e.record.wins) : '', l: e.record ? String(e.record.losses) : '', t: e.record ? String(e.record.ties) : '', needsWin: e.needsWin } : blankRow();
  }
  return d;
};
const store = (): Storage => window.localStorage;
const initialWeek = () => {
  const n = Number(new URLSearchParams(window.location.search).get('week'));
  return Number.isInteger(n) && n >= 1 && n <= 18 ? n : 1;
};
const fmtPct = (p: number | null) => (p === null ? 'Unknown' : p.toFixed(3).replace(/^0/, ''));
const isCount = (s: string) => /^\d+$/.test(s.trim());

export default function StandingsEditor({ season, onSeasonChange, onDirtyChange }: Props) {
  const [week, setWeek] = useState(initialWeek);
  const [snaps, setSnaps] = useState<StandingsSnapshot[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft>(() => toDraft(undefined));
  const [base, setBase] = useState(() => JSON.stringify(toDraft(undefined)));
  const [status, setStatus] = useState<Status>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const guard = () => !dirtyRef.current || window.confirm('You have unsaved standings. Discard them?');
  const changeWeek = (n: number) => { if (n !== week && guard()) { setStatus(null); setWeek(n); } };
  const changeSeason = (n: number) => { if (n !== season && guard()) { setStatus(null); onSeasonChange(n); } };

  const maxGames = Math.min(week - 1, season >= 2021 ? 17 : 16);
  const set = (team: string, patch: Partial<Row>) => setDraft(d => ({ ...d, [team]: { ...d[team], ...patch } }));
  const clearTeam = (team: string) => set(team, { w: '', l: '', t: '' });

  const doSave = () => {
    if (loadError || !snaps) return;
    const bad: Record<string, string> = {};
    const entries: StandingEntry[] = NFL_TEAM_NAMES.map(team => {
      const r = draft[team];
      const vals = [r.w, r.l, r.t];
      const filled = vals.filter(v => v.trim() !== '').length;
      if (filled === 0) return { team, needsWin: r.needsWin };
      if (filled < 3) bad[team] = 'Enter wins, losses and ties (ties may be 0), or clear all three.';
      else if (!vals.every(isCount)) bad[team] = 'Use whole, nonnegative numbers.';
      else if (Number(r.w) + Number(r.l) + Number(r.t) > maxGames) bad[team] = `Total games must be at most ${maxGames} before week ${week}.`;
      return { team, needsWin: r.needsWin, ...(bad[team] ? {} : { record: { wins: Number(r.w), losses: Number(r.l), ties: Number(r.t) } }) };
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
      setSnaps(next);
      setStatus({ kind: 'ok', text: `Removed the ${season} week ${week} snapshot.` });
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Could not remove standings.' });
    }
  };

  const years = useMemo(() => {
    const top = new Date().getFullYear() + 1;
    return Array.from({ length: top - 2002 + 1 }, (_, i) => top - i);
  }, []);
  const ready = !!snaps && !loadError;
  const savedEntry = (team: string) => saved?.entries.find(e => e.team === team);
  const savedAtText = saved ? new Date(saved.savedAt).toLocaleString() : '';

  return (
    <section className="se" aria-labelledby="se-title">
      <div className="se-head">
        <div>
          <div className="eyebrow">Standings / this browser only</div>
          <h2 id="se-title">Manual standings</h2>
          <p>Records entering the selected week, typed by you. Nothing is fetched or invented, and nothing leaves this device. Uses current NFL division alignment.</p>
        </div>
        <div className="se-pickers">
          <label>Season
            <select value={season} onChange={e => changeSeason(Number(e.target.value))} data-testid="select-standings-season">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label>Records entering week
            <select value={week} onChange={e => changeWeek(Number(e.target.value))} data-testid="select-standings-week">
              {Array.from({ length: 18 }, (_, i) => <option key={i + 1} value={i + 1}>Week {i + 1}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="panel se-explain">
        <strong>How the simulator uses this</strong>
        <ul>
          <li>Each snapshot belongs to one season and week only. Nothing carries forward or is copied to another week; week 1 records are normally blank.</li>
          <li>Records exclude the target week&apos;s result. A complete record replaces the model&apos;s existing small record-strength prior. A blank row stays unknown and the prior is kept.</li>
          <li>Needs win affects only the marked team, only in division games, raising baseline pass share by up to 1.2 percentage points. It is an unvalidated strategy assumption, not an effort, efficiency, scoring or fantasy-point boost.</li>
          <li>There is no automatic playoff determination. Saved forecasts stay unchanged until you rerun them. Unsaved inputs never affect a simulation.</li>
        </ul>
      </div>

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
          <button className="btn-secondary" onClick={() => { adopt(saved); setStatus(null); }} disabled={!dirty} data-testid="button-standings-revert">Discard edits</button>
          <button className="btn-secondary btn-danger" onClick={doDelete} disabled={!ready || !saved} data-testid="button-standings-delete">
            <Trash2 size={14} /> Remove this week
          </button>
        </div>
      </div>

      {!snaps && !loadError ? <div className="se-skel" aria-busy="true" /> : (
        <fieldset className="se-grid" disabled={!ready} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
              <div className="panel se-div" key={division} role="group" aria-labelledby={`se-d-${division}`} data-testid={`group-division-${division}`}>
                <h3 id={`se-d-${division}`}>{division}<small>Unofficial order: saved win % (ties = half win), then A-Z. No official tiebreakers.</small></h3>
                {order.map(team => {
                  const r = draft[team];
                  const e = savedEntry(team);
                  const pct = e ? standingPercentage(e) : null;
                  const err = problems[team];
                  return (
                    <div className={`se-row${r.needsWin ? ' need' : ''}`} key={team} data-testid={`row-standing-${team}`}>
                      <div>
                        <span className="se-team">{team}</span>
                        <span className={`se-sub${pct === null ? ' unk' : ''}`}>
                          {e?.record ? `Saved ${e.record.wins}-${e.record.losses}-${e.record.ties}, ` : 'Record unknown, '}
                          {e?.record && pct === null ? 'no games yet' : `win % ${fmtPct(pct)}`}
                        </span>
                        {err && <span className="se-sub" role="alert" style={{ color: 'var(--app-danger)' }}>{err}</span>}
                      </div>
                      <div className="se-rec">
                        {([['w', 'W'], ['l', 'L'], ['t', 'T']] as const).map(([k, label]) => (
                          <label key={k}>{label}
                            <input type="number" inputMode="numeric" min={0} max={17} step={1} placeholder="?" value={r[k]}
                              aria-label={`${team} ${k === 'w' ? 'wins' : k === 'l' ? 'losses' : 'ties'} entering week ${week}`}
                              aria-invalid={!!err}
                              onChange={ev => set(team, { [k]: ev.target.value } as Partial<Row>)}
                              data-testid={`input-${k}-${team}`} />
                          </label>
                        ))}
                      </div>
                      <label className="se-need">
                        <input type="checkbox" checked={r.needsWin} onChange={ev => set(team, { needsWin: ev.target.checked })}
                          aria-label={`${team} needs a win in division games`} data-testid={`check-needs-win-${team}`} />
                        Needs win
                        {(r.w || r.l || r.t) ? <button type="button" className="text-button" onClick={ev => { ev.preventDefault(); clearTeam(team); }} aria-label={`Clear ${team} record`}>clear</button> : null}
                      </label>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </fieldset>
      )}
      <p className="input-help">Storage is this browser and device only; clearing site data deletes it. Total games per team cannot exceed {maxGames} before week {week}.</p>
    </section>
  );
}
