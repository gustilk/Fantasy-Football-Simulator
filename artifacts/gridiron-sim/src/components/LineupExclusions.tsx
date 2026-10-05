import { useMemo, useState } from 'react';
import type { SalaryPlayer } from '@/lib/lineups';
import { exclusionKey } from '@/lib/lineup-exclusions';

export default function LineupExclusions({ players, excluded, toggle, clear, warning }: {
  players: SalaryPlayer[]; excluded: ReadonlySet<string>; toggle: (key: string) => void;
  clear: () => void; warning: string;
}) {
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('');
  const choices = useMemo(() => [...new Map(players.map(p => [exclusionKey(p), p])).values()]
    .sort((a, b) => a.name.localeCompare(b.name)), [players]);
  const visible = choices.filter(p => (!position || p.position === position)
    && `${p.name} ${p.team}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="panel dk-panel lu-panel" data-testid="lineups-exclusions">
    <h2 className="lu-h">Player exclusions</h2>
    <p className="dk-muted lu-gap">Check players you don’t want in any generated lineup. Both strategies respect exclusions. Saved on this browser for this contest.</p>
    <div className="lu-actions lu-exclusion-filters">
      <div className="field"><label htmlFor="lu-player-search">Find a player or team</label>
        <input id="lu-player-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or team…" /></div>
      <div className="field"><label htmlFor="lu-player-position">Position</label>
        <select id="lu-player-position" value={position} onChange={e => setPosition(e.target.value)}>
          <option value="">All positions</option>
          {[...new Set(choices.map(p => p.position))].sort().map(p => <option key={p} value={p}>{p}</option>)}
        </select></div>
    </div>
    <div className="lu-actions">
      <span className="dk-muted" role="status" data-testid="lineups-exclusion-count">{excluded.size} player{excluded.size === 1 ? '' : 's'} excluded · {visible.length} shown</span>
      <button className="btn-secondary" onClick={clear} disabled={!excluded.size}>Clear exclusions</button>
    </div>
    {warning && <p className="dk-note lu-gap" role="alert">{warning}</p>}
    <div className="lu-exclusion-list" role="group" aria-label="Players to exclude">
      {visible.map(p => {
        const key = exclusionKey(p), checked = excluded.has(key);
        return <label key={key} className={`lu-exclusion-row${checked ? ' excluded' : ''}`}>
          <input type="checkbox" checked={checked} onChange={() => toggle(key)} aria-label={`Exclude ${p.name} (${p.team})`} />
          <span><strong>{p.name}</strong><span className="dk-muted">{p.position} · {p.team} · ${p.salary.toLocaleString('en-US')}{checked && ' · Excluded'}</span></span>
        </label>;
      })}
      {!visible.length && <p className="dk-muted">No players match your search.</p>}
    </div>
  </div>;
}
