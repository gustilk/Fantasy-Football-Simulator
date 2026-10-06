import { useMemo, useRef, useState } from 'react';
import { Download, Upload, Play, Square, Trash2, RotateCw } from 'lucide-react';
import { useManualLineups } from '@/hooks/use-manual-lineups';
import './manual-lineups.css';

const CAP = 50000;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const POS = ['QB', 'RB', 'WR', 'TE', 'DST'];

export default function ManualLineupsSection({ season }: { season: number }) {
  const c = useManualLineups(season);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('');
  const [onlySel, setOnlySel] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const busy = c.importing || c.loading;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return c.players.filter(p => (!pos || p.position === pos)
      && (!onlySel || c.picks[p.id]?.selected)
      && (!t || p.name.toLowerCase().includes(t) || p.team.toLowerCase().includes(t)))
      .sort((a, b) => b.salary - a.salary);
  }, [c.players, c.picks, q, pos, onlySel]);

  return <section className="ml" aria-label="My Picks">
    <div className="page-heading" style={{ marginBottom: 0 }}>
      <div><h1>My Picks</h1>
        <p>Pick players, enter your own fantasy points, and build the best DraftKings Classic lineup from only your list.</p></div>
    </div>

    <div className="panel ml-panel">
      <h2>1. Contest salaries</h2>
      {busy && <p className="ml-muted" role="status">Loading salaries…</p>}
      {c.record
        ? <p className="ml-muted"><strong>{c.record.filename}</strong> · imported {new Date(c.record.importedAt).toLocaleString()} · {c.players.length} players</p>
        : !busy && <div className="ml-note" role="status">No Classic salaries yet. Import Featured Classic or upload a DraftKings Classic CSV.</div>}
      <p className="ml-muted">These salaries are shared with Lineups and synced across devices; replacing them changes both. Your picks are saved only in this browser for this contest.</p>
      {c.warning && <div className="ml-note" role="status">{c.warning}</div>}
      {c.notice && <div className="ml-note" role="status">{c.notice}</div>}
      <div className="ml-actions">
        <input ref={file} type="file" accept=".csv,text/csv" hidden data-testid="manual-upload"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void c.importCsv(f); }} />
        <button className="btn-primary" data-testid="manual-import-featured" disabled={busy} onClick={() => void c.importFeatured()}><Download size={14} /> Import Featured Classic</button>
        <button className="btn-secondary" disabled={busy} onClick={() => file.current?.click()}>{c.importing ? <><RotateCw size={14} className="spin-icon" /> Importing…</> : <><Upload size={14} /> Upload Classic CSV</>}</button>
      </div>
    </div>

    {c.storageError && <div className="ml-err" role="alert">{c.storageError}
      <button className="btn-secondary" data-testid="manual-save-retry" onClick={c.retrySave}>Retry save</button></div>}

    <div className="panel ml-panel">
      <h2>2. Choose players &amp; enter points</h2>
      <p className="ml-muted">Points are your own assumptions, not guaranteed results. They never change actual stats or simulator forecasts. Zero is allowed. Salaries are read only.</p>
      <div className="ml-filters">
        <div className="field"><label htmlFor="ml-q">Search player or team</label>
          <input id="ml-q" type="search" data-testid="manual-search" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Mahomes or KC" /></div>
        <div className="field"><label htmlFor="ml-pos">Position</label>
          <select id="ml-pos" data-testid="manual-position" value={pos} onChange={e => setPos(e.target.value)}>
            <option value="">All</option>{POS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
      </div>
      <label className="ml-check"><input type="checkbox" data-testid="manual-selected-only" checked={onlySel} onChange={e => setOnlySel(e.target.checked)} /> Show selected only ({c.selectedCount})</label>
      {busy && !c.players.length
        ? <div className="ml-list" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="ml-row"><span /><span className="ml-muted">Loading…</span><span /></div>)}</div>
        : rows.length === 0
          ? <p className="ml-note" role="status">{c.players.length ? 'No players match these filters.' : 'Import salaries to see players.'}</p>
          : <ul className="ml-list">{rows.map(p => {
            const pick = c.picks[p.id];
            const sel = !!pick?.selected;
            const blocked = !!p.unavailable && !sel;
            return <li key={p.id} className={`ml-row${sel ? ' on' : ''}${p.unavailable ? ' off' : ''}`}>
              <input type="checkbox" aria-label={`Select ${p.name}`} data-testid={`manual-pick-${p.id}`} checked={sel} disabled={busy || blocked || !!c.storageError}
                onChange={e => c.updatePick(p.id, { selected: e.target.checked })} />
              <div className="ml-who"><strong>{p.name}</strong>
                <span>{p.position} · {p.team} · {money(p.salary)}</span>
                {p.unavailable && <em>{p.unavailable}</em>}</div>
              <input type="text" inputMode="decimal" aria-label={`Your projected points for ${p.name}`} placeholder="Pts"
                data-testid={`manual-points-${p.id}`} value={pick?.points ?? ''} disabled={busy || !!c.storageError || (!!p.unavailable && !sel)}
                onChange={e => c.updatePick(p.id, { points: e.target.value })} />
            </li>;
          })}</ul>}
      <div className="ml-actions"><button className="btn-secondary" disabled={busy || (!c.storageError && !c.selectedCount && !Object.keys(c.picks).length)} onClick={c.clearPicks}><Trash2 size={14} /> Clear selections</button></div>
    </div>

    <div className="panel ml-panel">
      <h2>3. Generate</h2>
      <p className="ml-muted">Cap {money(CAP)}. Roster: QB, 2 RB, 3 WR, TE, FLEX, DST, with players from at least 2 games. Only your selected players are used.</p>
      <div className="ml-stats"><div><span>Selected</span><strong>{c.selectedCount}</strong></div><div><span>Cap</span><strong>{money(CAP)}</strong></div></div>
      {c.error && <div className="ml-err" role="alert" data-testid="manual-error">{c.error}
        {c.salaryError && <button className="btn-secondary" onClick={c.refreshSalaries}>Retry salary sync</button>}</div>}
      <div className="ml-actions">
        {c.running
          ? <button className="btn-secondary" data-testid="manual-stop" onClick={c.stop}><Square size={14} /> Stop</button>
          : <button className="btn-primary" data-testid="manual-generate" disabled={busy || !!c.storageError || !c.selectedCount} onClick={c.generate}><Play size={15} /> Generate best lineup</button>}
        {c.lineup && <button className="btn-secondary" onClick={c.exportLineup}><Download size={14} /> Export CSV</button>}
      </div>
      {c.running && <p className="ml-muted" role="status"><RotateCw size={12} className="spin-icon" /> Searching all legal lineups…</p>}
    </div>

    {c.lineup && <article className="panel ml-panel ml-result" data-testid="manual-result">
      <h2>Best lineup from your list</h2>
      <div className="ml-stats">
        <div><span>Your projected points</span><strong className="ml-total">{c.lineup.points.toFixed(2)}</strong></div>
        <div><span>Salary used</span><strong>{money(c.lineup.salary)}</strong></div>
        <div><span>Remaining</span><strong>{money(CAP - c.lineup.salary)}</strong></div>
      </div>
      <div className="tw"><table><thead><tr><th>Slot</th><th>Player</th><th>Your pts</th><th>Salary</th></tr></thead><tbody>
        {c.slots.map(({ slot, player }) => <tr key={`${slot}-${player.id}`}>
          <td className="ml-slot">{slot}</td><td>{player.name}<br /><small className="ml-muted">{player.position} {player.team}</small></td>
          <td>{player.mean.toFixed(2)}</td><td>{money(player.salary)}</td></tr>)}
      </tbody></table></div>
      <p className="ml-muted">Totals use your own assumptions, not guaranteed results.</p>
    </article>}
  </section>;
}
