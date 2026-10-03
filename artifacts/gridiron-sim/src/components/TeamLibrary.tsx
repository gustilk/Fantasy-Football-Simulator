import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, RotateCw, Save, Trash2, ClipboardPaste, Database } from 'lucide-react';
import { useSaveSeasonTeam, useGetNflDepthChart, getGetNflDepthChartQueryKey, type NflDepthChart, type TeamSeasonRecord, type RosterPlayer, type TeamWeek } from '@workspace/api-client-react';
import { offenseFields, defenseFields, teamDefenseFields, positions, type StatField } from '@/lib/stat-fields';
import NflImportPanel from './NflImportPanel';
import DivisionMatchup from './DivisionMatchup';
import { getDivision } from '@/lib/nfl-divisions';
import { rolesForRoster } from '@/lib/depth-chart';
import PlayerStatsTable, { type StatRow } from './PlayerStatsTable';
import PlayerAvailabilityEditor from './PlayerAvailabilityEditor';
import './team-library.css';

type Position = (typeof positions)[number];
type Side = 'offense' | 'defense';
type Player = RosterPlayer;
type Week = TeamWeek;
type Draft = { players: Player[]; weeks: Week[] };
type Props = {
  season: number; onSeasonChange: (n: number) => void; teams: TeamSeasonRecord[]; loading: boolean; error: string;
  onReload: () => void; onSaved: (team: TeamSeasonRecord) => void; teamNames: string[];
};

const DEFENSE_POS: Position[] = ['DL', 'EDGE', 'LB', 'CB', 'S'];
const sideFor = (p: Position): Side => (DEFENSE_POS.includes(p) ? 'defense' : 'offense');
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const blankWeek = (week: number): Week => ({ week, status: 'upcoming', opponent: '', venue: 'home', result: 'none', teamScore: null, opponentScore: null, teamDefense: {}, playerStats: {} });

function normalize(rec: TeamSeasonRecord | undefined): Draft {
  const weeks: Week[] = [];
  for (let w = 1; w <= 18; w++) {
    const found = rec?.weeks.find(x => x.week === w);
    weeks.push(found ? structuredClone(found) as Week : blankWeek(w));
  }
  return { players: rec ? (structuredClone(rec.players) as Player[]) : [], weeks };
}
const snap = (d: Draft) => JSON.stringify(d);

export default function TeamLibrary({ season, onSeasonChange, teams, loading, error, onReload, onSaved, teamNames }: Props) {
  const [team, setTeam] = useState(teamNames[0] ?? '');
  const [ctx, setCtx] = useState<{ season: number; team: string } | null>(null);
  const [draft, setDraft] = useState<Draft>({ players: [], weeks: normalize(undefined).weeks });
  const [base, setBase] = useState<{ version: number; snap: string }>({ version: 0, snap: snap(normalize(undefined)) });
  const [view, setView] = useState<'roster' | 'weeks'>(() =>
    new URLSearchParams(window.location.search).get('section') === 'roster' ? 'roster' : 'weeks');
  const [weekNo, setWeekNo] = useState(1);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'conflict'; text: string } | null>(null);
  const [pendingAdopt, setPendingAdopt] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const save = useSaveSeasonTeam();
  const depth = useGetNflDepthChart(season, team, { query: { queryKey: getGetNflDepthChartQueryKey(season, team), enabled: view === 'roster', staleTime: 300_000, retry: false } });

  const record = useMemo(() => teams.find(t => t.team === team && t.season === season), [teams, team, season]);
  const dirty = snap(draft) !== base.snap;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;

  const adopt = (rec: TeamSeasonRecord | undefined) => {
    const d = normalize(rec);
    setWeekNo(d.weeks.filter(w => w.status === 'played').at(-1)?.week ?? 1);
    setDraft(d); setBase({ version: rec?.version ?? 0, snap: snap(d) }); setCtx({ season, team });
  };
  const adoptRef = useRef(adopt); adoptRef.current = adopt;

  useEffect(() => {
    if (!team && teamNames[0]) { setTeam(teamNames[0]); return; }
    if (loading || !team) return;
    const same = ctx && ctx.season === season && ctx.team === team;
    if (!same) { if (!dirtyRef.current) adoptRef.current(record); return; }
    if (pendingAdopt && (record?.version ?? 0) !== base.version) { adoptRef.current(record); setPendingAdopt(false); setStatus({ kind: 'ok', text: 'Loaded the latest saved version.' }); return; }
    if (!dirtyRef.current && (record?.version ?? 0) !== base.version) adoptRef.current(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, loading, season, team, teamNames, pendingAdopt]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const guard = () => !dirtyRef.current || window.confirm('You have unsaved roster or weekly changes. Discard them?');
  const resetClean = () => {
    const blank = normalize(undefined);
    setDraft(blank); setBase({ version: 0, snap: snap(blank) }); setCtx(null); setPendingAdopt(false); setStatus(null); setWeekNo(1);
  };
  const changeTeam = (t: string) => { if (save.isPending || importBusy || t === team || !guard()) return; resetClean(); setTeam(t); };
  const changeSeason = (n: number) => { if (save.isPending || importBusy || !Number.isInteger(n) || n < 2000 || n > 2100 || n === season || !guard()) return; resetClean(); onSeasonChange(n); };

  const ctxMismatch = ctx && (ctx.season !== season || ctx.team !== team);
  const names = draft.players.map(p => p.name.trim());
  const invalid = names.some(n => !n) || draft.players.length > 200 || draft.players.some(p => p.name.length > 100);

  const doSave = async () => {
    if (!ctx || save.isPending || importBusy || invalid) return;
    setStatus(null);
    try {
      const res = await save.mutateAsync({
        season: ctx.season, team: encodeURIComponent(ctx.team),
        data: { expectedVersion: base.version || 0, players: draft.players.map(p => ({ ...p, name: p.name.trim() })), weeks: draft.weeks },
      });
      const d = normalize(res);
      setDraft(d); setBase({ version: res.version, snap: snap(d) });
      onSaved(res);
      setStatus({ kind: 'ok', text: `Saved version ${res.version}.` });
    } catch (e) {
      const err = e as { status?: number; message?: string; data?: { error?: string } };
      if (err?.status === 409) setStatus({ kind: 'conflict', text: 'Someone else saved this team and season since you loaded it. Your edits are still here and were not saved.' });
      else setStatus({ kind: 'err', text: err?.data?.error || err?.message || 'The save failed. Your edits are kept; try again.' });
    }
  };
  const reloadLatest = () => {
    if (!window.confirm('Replace your unsaved edits with the latest saved version?')) return;
    setPendingAdopt(true); onReload();
  };

  const patchPlayers = (fn: (p: Player[]) => Player[]) => setDraft(d => ({ ...d, players: fn(d.players) }));
  const patchWeek = (n: number, fn: (w: Week) => Week) => setDraft(d => ({ ...d, weeks: d.weeks.map(w => (w.week === n ? fn(w) : w)) }));

  const played = draft.weeks.filter(w => w.status === 'played');
  const rec = { w: played.filter(w => w.result === 'W').length, l: played.filter(w => w.result === 'L').length, t: played.filter(w => w.result === 'T').length };
  const games = 17;

  return (
    <section className="tl" aria-labelledby="tl-title">
      <div className="tl-head">
        <div>
          <div className="eyebrow">TEAM LIBRARY / SHARED PROJECT DATA</div>
          <h2 id="tl-title">Rosters &amp; weekly history</h2>
          <p className="tl-note" data-testid="division-library">Current division: <strong>{getDivision(team) ?? 'Unknown'}</strong></p>
          <p className="tl-note">There is no sign-in yet. Everything saved here is shared by anyone who opens this project.</p>
        </div>
        <div className="tl-pickers">
          <label>Team
            <select value={team} disabled={save.isPending || importBusy} onChange={e => changeTeam(e.target.value)} data-testid="select-library-team">
              {teamNames.map(n => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label>Season
            <input key={season} type="number" min={2000} max={2100} defaultValue={season} disabled={save.isPending || importBusy}
              onBlur={e => { changeSeason(Number(e.target.value)); e.currentTarget.value = String(season); }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} data-testid="input-library-season" />
          </label>
        </div>
      </div>

      {error && <div className="tl-banner err" role="alert"><AlertTriangle size={15} /> {error}<button className="btn-secondary" onClick={onReload} data-testid="button-library-retry">Retry</button></div>}
      {ctxMismatch && <div className="tl-banner warn" role="status">Unsaved draft belongs to {ctx.team}, {ctx.season}. Saving writes to that team and season.</div>}

      <div className="tl-bar">
        <div className="tl-summary" data-testid="text-library-summary">
          <strong>{rec.w}-{rec.l}{rec.t ? `-${rec.t}` : ''}</strong>
          <span>{played.length} of {games || 17} games recorded</span>
          <span>{draft.players.filter(p => p.active).length} active / {draft.players.length} players</span>
          <span>{base.version ? `Version ${base.version}` : 'Not yet saved'}</span>
        </div>
        <div className="tl-actions">
          {dirty && <span className="tl-dirty">Unsaved changes</span>}
          <button className="btn-primary tl-save" onClick={doSave} disabled={!dirty || save.isPending || importBusy || invalid || !ctx} data-testid="button-library-save">
            {save.isPending ? <><RotateCw size={14} className="spin-icon" /> Saving</> : <><Save size={15} /> Save team</>}
          </button>
        </div>
      </div>
      <NflImportPanel season={season} team={team} draft={draft}
        disabled={save.isPending || loading || !ctx || !!ctxMismatch}
        onBusyChange={setImportBusy}
        onApply={next => {
          setDraft(next); setStatus({ kind: 'ok', text: 'Imported data is in your draft. Press Save team to store it and use it in the simulator.' });
        }} />
      {invalid && dirty && <div className="tl-banner warn" role="status">Every player needs a name before saving.</div>}
      {status && (
        <div className={`tl-banner ${status.kind === 'ok' ? 'ok' : 'err'}`} role={status.kind === 'ok' ? 'status' : 'alert'} data-testid="status-library-save">
          {status.text}
          {status.kind === 'conflict' && <button className="btn-secondary" onClick={reloadLatest} data-testid="button-library-reload-latest">Reload latest, discard my edits</button>}
          {status.kind === 'err' && <button className="btn-secondary" onClick={doSave}>Retry save</button>}
        </div>
      )}

      {loading && !ctx ? <div className="tl-skel" aria-busy="true"><i /><i /><i /></div> : <fieldset className="tl-fs" disabled={save.isPending}>
        <div className="tl-tabs" role="tablist">
          {(['roster', 'weeks'] as const).map(v => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)} data-testid={`tab-library-${v}`}>
              {v === 'roster' ? `Roster (${draft.players.length})` : 'Weekly games'}
            </button>
          ))}
        </div>
        {view === 'roster'
          ? <><p className="tl-hint">{depth.isLoading ? 'Loading source-listed depth roles…' : depth.isError ? 'Depth chart unavailable for this season. Set roles manually below.' : 'Automatic roles follow the current ESPN chart; manual choices override it. Rank 1 is the primary option, not guaranteed fantasy points. Save team to persist manual changes.'}</p><Roster key={`${season}:${team}`} players={draft.players} patch={patchPlayers} setDraft={setDraft} depth={depth.data} nextWeek={Math.min(18, Math.max(0, ...draft.weeks.filter(w => w.status === 'played').map(w => w.week)) + 1)} /></>
          : <Weeks key={`${season}:${team}`} draft={draft} weekNo={weekNo} setWeekNo={setWeekNo} patchWeek={patchWeek} teamNames={teamNames} team={team} />}
      </fieldset>}
    </section>
  );
}

function Roster({ players, patch, setDraft, depth, nextWeek }: { players: Player[]; patch: (fn: (p: Player[]) => Player[]) => void; setDraft: React.Dispatch<React.SetStateAction<Draft>>; depth?: NflDepthChart; nextWeek: number }) {
  const [bulk, setBulk] = useState('');
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');
  const [pos, setPos] = useState<Position>('QB');
  const [filter, setFilter] = useState<'all' | 'offense' | 'defense'>('all');
  const [availabilityWeek, setAvailabilityWeek] = useState(nextWeek);

  const add = () => {
    if (!name.trim()) return;
    patch(p => [...p, { id: uid(), name: name.trim(), position: pos, side: sideFor(pos), active: true }]);
    setName('');
  };
  const importBulk = () => {
    const bad: string[] = []; const fresh: Player[] = []; let dup = 0;
    bulk.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      const parts = line.split(/[,\t]/).map(s => s.trim());
      const p = (parts[1] || '').toUpperCase() as Position;
      if (!parts[0] || !positions.includes(p)) { bad.push(line); return; }
      const side = parts[2]?.toLowerCase() === 'defense' ? 'defense' : parts[2]?.toLowerCase() === 'offense' ? 'offense' : sideFor(p);
      const key = `${parts[0].toLowerCase()}|${p}`;
      if (players.some(x => `${x.name.toLowerCase()}|${x.position}` === key) || fresh.some(x => `${x.name.toLowerCase()}|${x.position}` === key)) { dup++; return; }
      fresh.push({ id: uid(), name: parts[0], position: p, side, active: true });
    });
    if (fresh.length) patch(ps => [...ps, ...fresh]);
    setMsg(`Added ${fresh.length}. Skipped ${dup} duplicate${dup === 1 ? '' : 's'}.${bad.length ? ` Could not read: ${bad.join(' | ')}` : ''}`);
    if (!bad.length) setBulk('');
    else setBulk(bad.join('\n'));
  };
  const remove = (pl: Player) => {
    if (!window.confirm(`Delete ${pl.name}? Their saved stats in every week are removed too. Mark inactive instead to keep history.`)) return;
    setDraft(d => ({ players: d.players.filter(x => x.id !== pl.id), weeks: d.weeks.map(w => { const { [pl.id]: _gone, ...rest } = w.playerStats; return { ...w, playerStats: rest }; }) }));
  };
  const upd = (id: string, ch: Partial<Player>) => patch(ps => ps.map(p => (p.id === id ? { ...p, ...ch } : p)));
  const shown = players.filter(p => filter === 'all' || p.side === filter);
  const automaticPlayers = rolesForRoster(players, depth);

  return (
    <div className="tl-roster">
      <div className="tl-tools">
        <div className="tl-card">
          <h3>Add player</h3>
          <div className="tl-row">
            <input aria-label="Player name" placeholder="Player name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} data-testid="input-player-name" />
            <select aria-label="Position" value={pos} onChange={e => setPos(e.target.value as Position)} data-testid="select-player-position">{positions.map(p => <option key={p}>{p}</option>)}</select>
            <button className="btn-secondary" onClick={add} data-testid="button-add-player"><Plus size={14} /> Add</button>
          </div>
        </div>
        <div className="tl-card">
          <h3><ClipboardPaste size={14} /> Bulk paste</h3>
          <textarea aria-label="Bulk roster paste" rows={4} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={'Name, Position (one per line)\nPatrick Mahomes, QB\nChris Jones, DL\nOptional third column: offense or defense (for OTHER)'} data-testid="input-bulk-roster" />
          <div className="tl-row"><button className="btn-secondary" onClick={importBulk} disabled={!bulk.trim()} data-testid="button-bulk-import">Add lines to roster</button><span className="tl-hint" role="status">{msg}</span></div>
        </div>
      </div>

      <div className="tl-filter">
        {(['all', 'offense', 'defense'] as const).map(f => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}
      </div>
      <label className="tl-row tl-hint">Availability override week
        <select aria-label="Availability override week" data-testid="select-availability-week" value={availabilityWeek} onChange={e => setAvailabilityWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }, (_, i) => <option key={i + 1} value={i + 1}>Week {i + 1}</option>)}
        </select>
      </label>
      <p className="tl-hint">QB/RB/WR/TE overrides apply only to the selected week and take precedence over the saved Active flag. Out/Doubtful excludes; Questionable/Limited includes without modeling missed-game probability or a workload reduction. One weekly override per player is retained. Save team to persist it. Roster reports are not confirmed game-day participation.</p>
      {players.length === 0 ? (
        <div className="tl-empty"><Database size={26} /><strong>No roster saved for this team and season</strong><span>Refresh recent NFL data above, add players, or paste a list. Nothing is stored until you save.</span></div>
      ) : (
        <div className="tl-table" role="table" aria-label="Roster">
          <div className="tl-tr th" role="row"><span>Name</span><span>Position / role</span><span>Side</span><span>Active</span><span /></div>
          {shown.map(p => {
            const automatic = automaticPlayers.find(player => player.id === p.id)?.depthRank;
            return (
            <div className={`tl-tr${p.active ? '' : ' off'}`} role="row" key={p.id} data-testid={`row-player-${p.id}`}>
              <input aria-label="Name" value={p.name} title={p.source ? `ESPN: ${p.sourcePosition || p.position} · ${p.availability || 'availability unknown'}` : undefined} onChange={e => upd(p.id, { name: e.target.value })} />
               <div className="tl-role-cell"><select aria-label="Position" value={p.position} onChange={e => upd(p.id, { position: e.target.value as Position, depthRank: undefined, depthSource: undefined })}>{positions.map(x => <option key={x}>{x}</option>)}</select>
                 {p.side === 'offense' && ['QB', 'RB', 'WR', 'TE'].includes(p.position) && <select aria-label={`Depth role for ${p.name}`} data-testid={`depth-role-${p.id}`} value={p.depthSource ? '' : p.depthRank ?? ''} onChange={e => upd(p.id, { depthRank: e.target.value ? Number(e.target.value) : undefined, depthSource: undefined })}>
                   <option value="">Auto{automatic ? ` · ${p.position}${automatic}` : ' · unranked'}</option>
                   {Array.from({ length: 50 }, (_, i) => <option key={i + 1} value={i + 1}>{p.position}{i + 1}</option>)}
                 </select>}
               </div>
               <select aria-label="Side" value={p.side} onChange={e => upd(p.id, { side: e.target.value as Side, depthRank: undefined, depthSource: undefined })}><option value="offense">Offense</option><option value="defense">Defense</option></select>
              <div className="tl-availability-cell"><label className="tl-check"><input type="checkbox" checked={p.active} onChange={e => upd(p.id, { active: e.target.checked })} /> {p.active ? 'Active' : 'Inactive'}</label>
                {p.side === 'offense' && ['QB', 'RB', 'WR', 'TE'].includes(p.position) && <PlayerAvailabilityEditor player={p} week={availabilityWeek} onChange={ch => upd(p.id, ch)} />}
              </div>
              <button className="saved-remove" aria-label={`Delete ${p.name || 'player'}`} onClick={() => remove(p)}><Trash2 size={14} /></button>
            </div>
          );})}
        </div>
      )}
      <p className="tl-hint">Excluded players keep their history and depth rank. A weekly override does not permanently demote or deactivate a returning starter.</p>
    </div>
  );
}

function NumInput({ field, value, onChange, id }: { field: StatField; value: number | undefined; onChange: (v: number | undefined) => void; id: string }) {
  return (
    <label className="tl-stat" htmlFor={id}>
      <span>{field.label}</span>
      <input id={id} type="number" inputMode="decimal" step="any" min={field.signed ? undefined : 0} value={value ?? ''} placeholder="?"
        onChange={e => { const v = e.target.value; if (v === '') return onChange(undefined); const n = Number(v); if (!Number.isNaN(n)) onChange(n); }} />
    </label>
  );
}

function Weeks({ draft, weekNo, setWeekNo, patchWeek, teamNames, team }: { draft: Draft; weekNo: number; setWeekNo: (n: number) => void; patchWeek: (n: number, fn: (w: Week) => Week) => void; teamNames: string[]; team: string }) {
  const wk = draft.weeks.find(w => w.week === weekNo)!;
  const set = (ch: Partial<Week>) => patchWeek(weekNo, w => ({ ...w, ...ch }));
  const hasData = wk.result !== 'none' || wk.teamScore !== null || wk.opponentScore !== null || Object.keys(wk.teamDefense).length > 0 || Object.keys(wk.playerStats).length > 0;
  const changeStatus = (status: Week['status']) => {
    if (status === 'played' || wk.status !== 'played') { set({ status }); return; }
    if (hasData && !window.confirm(`Changing week ${wk.week} to ${status} clears its result, scores, team defense totals and every player's played flag and stats. Continue?`)) return;
    set({ status, result: 'none', teamScore: null, opponentScore: null, teamDefense: {}, playerStats: {} });
  };
  const score = (v: string) => (v === '' ? null : Math.max(0, Math.min(100, Math.round(Number(v)))));
  const setDef = (k: string, v: number | undefined) => patchWeek(weekNo, w => { const t = { ...w.teamDefense }; if (v === undefined) delete t[k]; else t[k] = v; return { ...w, teamDefense: t }; });
  const setPlayed = (id: string, on: boolean) => patchWeek(weekNo, w => {
    const ps = { ...w.playerStats };
    if (on) ps[id] = ps[id] ?? {};
    else { if (Object.keys(ps[id] ?? {}).length && !window.confirm('Remove this player from the game? Their entered stats for this week are deleted.')) return w; delete ps[id]; }
    return { ...w, playerStats: ps };
  });
  const setStat = (id: string, k: string, v: number | undefined) => patchWeek(weekNo, w => {
    const row = { ...(w.playerStats[id] ?? {}) };
    if (v === undefined) delete row[k]; else row[k] = v;
    return { ...w, playerStats: { ...w.playerStats, [id]: row } };
  });
  const byId = new Map(draft.players.map(p => [p.id, p]));
  const ids = Object.keys(wk.playerStats);
  const rows: StatRow[] = ids.map(id => { const p = byId.get(id); return { id, name: p?.name ?? `Unknown player (${id})`, position: p?.position ?? 'OTHER', side: p?.side ?? 'offense', stats: wk.playerStats[id], inactive: p ? !p.active : false }; });
  const absent = draft.players.filter(p => !(p.id in wk.playerStats));
  const [addId, setAddId] = useState('');
  useEffect(() => setAddId(''), [weekNo]);
  const chip = (w: Week) => (w.status === 'bye' ? 'BYE' : w.status === 'played' ? (w.result === 'none' ? 'PLAYED' : w.result) : '');

  return (
    <div className="tl-weeks">
      <div className="tl-chips" role="group" aria-label="Weeks">
        {draft.weeks.map(w => (
          <button key={w.week} className={`${w.week === weekNo ? 'on ' : ''}${w.status}`} aria-pressed={w.week === weekNo} onClick={() => setWeekNo(w.week)} data-testid={`button-week-${w.week}`}>
            <b>{w.week}</b><small>{chip(w)}</small>
          </button>
        ))}
      </div>

      <div className="tl-card">
        <h3>Week {wk.week}</h3>
        <div className="tl-grid">
          <label>Status<select value={wk.status} onChange={e => changeStatus(e.target.value as Week['status'])} data-testid="select-week-status"><option value="upcoming">Upcoming</option><option value="played">Played</option><option value="bye">Bye</option></select></label>
          {wk.status !== 'bye' && <>
            <label>Opponent<select value={wk.opponent} onChange={e => set({ opponent: e.target.value })} data-testid="select-week-opponent">
              <option value="">Select opponent</option>
              {wk.opponent && (!teamNames.includes(wk.opponent) || wk.opponent === team) && <option value={wk.opponent}>{wk.opponent} (saved value)</option>}
              {teamNames.filter(name => name !== team).map(name => <option key={name} value={name}>{name}</option>)}
            </select></label>
            <label>Venue<select value={wk.venue} onChange={e => set({ venue: e.target.value as Week['venue'] })}><option value="home">Home</option><option value="away">Away</option></select></label>
            {wk.status === 'played' && <><label>Result<select value={wk.result} onChange={e => set({ result: e.target.value as Week['result'] })}><option value="none">None</option><option value="W">Win</option><option value="L">Loss</option><option value="T">Tie</option></select></label>
            <label>Team score<input type="number" min={0} max={100} value={wk.teamScore ?? ''} onChange={e => set({ teamScore: score(e.target.value) })} /></label>
            <label>Opponent score<input type="number" min={0} max={100} value={wk.opponentScore ?? ''} onChange={e => set({ opponentScore: score(e.target.value) })} /></label></>}
          </>}
        </div>
        {wk.status !== 'bye' && <DivisionMatchup team={team} opponent={wk.opponent} />}
        {wk.status === 'bye' && <p className="tl-hint">Bye week. Any stats entered earlier are kept in the draft but not shown.</p>}
        {wk.status === 'upcoming' && <p className="tl-hint">Set status to Played to enter team defense and player stats.</p>}
      </div>

      {wk.status === 'played' && <>
        <div className="tl-card">
          <h3>Team defense totals</h3>
          <div className="tl-stats">{teamDefenseFields.map(f => <NumInput key={f.key} id={`td-${f.key}`} field={f} value={wk.teamDefense[f.key]} onChange={v => setDef(f.key, v)} />)}</div>
          <p className="tl-hint">Blank means unknown. A typed 0 is a real zero.</p>
        </div>
        <h3 className="tl-sub">Players who played ({rows.length})</h3>
        <PlayerStatsTable key={`${wk.week}:${rows.length}`} rows={rows} label={`Week ${wk.week} player stats`} testId="table-week-stats" emptyText="Mark roster players as participants below, or import a game from the NFL source above."
          renderEditor={r => {
            const p = byId.get(r.id); const row = wk.playerStats[r.id] ?? {}; const fields = (p?.side ?? r.side) === 'offense' ? offenseFields : defenseFields; const count = Object.keys(row).length;
            return (
              <div className="tl-player on" data-testid={`card-week-player-${r.id}`}>
                <div className="tl-ph">
                  <label className="tl-check"><input type="checkbox" checked onChange={e => setPlayed(r.id, e.target.checked)} data-testid={`check-played-${r.id}`} /> Played</label>
                  <span className="tl-count">{count ? `${count} stat${count === 1 ? '' : 's'}` : 'played, no stats'}</span>
                </div>
                <div className="tl-stats">{fields.map(f => <NumInput key={f.key} id={`ps-${r.id}-${f.key}`} field={f} value={row[f.key]} onChange={v => setStat(r.id, f.key, v)} />)}
                  {Object.keys(row).filter(k => !fields.some(f => f.key === k)).map(k => <NumInput key={k} id={`ps-${r.id}-${k}`} field={{ key: k, label: `${k} (custom)`, signed: /yards/i.test(k) }} value={row[k]} onChange={v => setStat(r.id, k, v)} />)}
                </div>
                <CustomStat count={count} onAdd={(k, v) => setStat(r.id, k, v)} existing={row} pid={r.id} />
              </div>
            );
          }} />
        <details className="pst-add">
          <summary>Add game participant</summary>
          <p className="tl-hint">Mark a roster player who took part but is not listed above. Players who did not play are never listed.</p>
          <div className="tl-row">
            <select aria-label="Roster player to mark as played" value={addId} onChange={e => setAddId(e.target.value)} data-testid="select-add-participant">
              <option value="">Choose roster player</option>{absent.map(p => <option key={p.id} value={p.id}>{p.name || 'Unnamed'} ({p.position}){p.active ? '' : ' - inactive'}</option>)}
            </select>
            <button type="button" className="btn-secondary" disabled={!addId} onClick={() => { setPlayed(addId, true); setAddId(''); }} data-testid="button-add-participant"><Plus size={14} /> Mark played</button>
          </div>
        </details>
      </>}
    </div>
  );
}

function CustomStat({ count, onAdd, existing, pid }: { count: number; onAdd: (k: string, v: number) => void; existing: Record<string, number>; pid: string }) {
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    const key = k.trim(); const n = Number(v);
    if (!key || key.length > 60) return setErr('Name must be 1 to 60 characters.');
    if (v === '' || Number.isNaN(n)) return setErr('Enter a number.');
    if (n < 0 && !/yards/i.test(key)) return setErr('Only stat names containing "yards" may be negative.');
    if (!(key in existing) && count >= 64) return setErr('A player can have at most 64 stat fields.');
    onAdd(key, n); setK(''); setV(''); setErr('');
  };
  return (
    <div className="tl-custom">
      <input aria-label="Custom stat name" placeholder="Custom stat, e.g. pressuresAllowed" maxLength={60} value={k} onChange={e => setK(e.target.value)} data-testid={`input-custom-key-${pid}`} />
      <input aria-label="Custom stat value" type="number" step="any" placeholder="Value" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} data-testid={`input-custom-value-${pid}`} />
      <button type="button" className="btn-secondary" onClick={submit} data-testid={`button-custom-add-${pid}`}><Plus size={14} /> Add stat</button>
      {err && <span className="tl-hint" role="alert">{err}</span>}
    </div>
  );
}
