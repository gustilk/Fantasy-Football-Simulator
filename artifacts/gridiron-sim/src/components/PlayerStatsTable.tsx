import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { getDraftKingsDetails, DRAFTKINGS_RULES_URL } from '@/lib/draftkings';
import './player-stats-table.css';

export type StatRow = { id: string; name: string; position: string; side: string; stats: Record<string, number>; inactive?: boolean };
type Col = { key: string; label: string; title: string };
const GROUPS: { name: string; cols: Col[] }[] = [
  { name: 'Passing', cols: [{ key: 'passCompletions', label: 'CMP', title: 'Completions' }, { key: 'passAttempts', label: 'ATT', title: 'Pass attempts' }, { key: 'passYards', label: 'YDS', title: 'Passing yards' }, { key: 'passTD', label: 'TD', title: 'Passing TDs' }, { key: 'interceptions', label: 'INT', title: 'Interceptions (thrown for offense, made for defense)' }] },
  { name: 'Rushing', cols: [{ key: 'rushAttempts', label: 'CAR', title: 'Carries' }, { key: 'rushYards', label: 'YDS', title: 'Rushing yards' }, { key: 'rushTD', label: 'TD', title: 'Rushing TDs' }] },
  { name: 'Receiving', cols: [{ key: 'targets', label: 'TGT', title: 'Targets' }, { key: 'receptions', label: 'REC', title: 'Receptions' }, { key: 'receivingYards', label: 'YDS', title: 'Receiving yards' }, { key: 'receivingTD', label: 'TD', title: 'Receiving TDs' }, { key: 'fumblesLost', label: 'FL', title: 'Fumbles lost' }] },
  { name: 'Defense', cols: [{ key: 'soloTackles', label: 'SOLO', title: 'Solo tackles' }, { key: 'assistedTackles', label: 'AST', title: 'Assisted tackles' }, { key: 'sacks', label: 'SCK', title: 'Sacks' }, { key: 'interceptions', label: 'INT', title: 'Interceptions made' }, { key: 'passesDefended', label: 'PD', title: 'Passes defended' }, { key: 'fumblesForced', label: 'FF', title: 'Forced fumbles' }, { key: 'fumblesRecovered', label: 'FR', title: 'Fumble recoveries' }, { key: 'defensiveTD', label: 'TD', title: 'Defensive TDs' }] },
  { name: 'Special teams', cols: [{ key: 'fieldGoalsMade', label: 'FGM', title: 'Field goals made' }, { key: 'fieldGoalAttempts', label: 'FGA', title: 'Field goal attempts' }, { key: 'extraPointsMade', label: 'XPM', title: 'Extra points made' }, { key: 'kickReturnYards', label: 'KR YDS', title: 'Kick return yards' }, { key: 'kickReturnTD', label: 'KR TD', title: 'Kick return touchdowns' }, { key: 'puntReturnYards', label: 'PR YDS', title: 'Punt return yards' }, { key: 'puntReturnTD', label: 'PR TD', title: 'Punt return touchdowns' }, { key: 'punts', label: 'PUNTS', title: 'Punts' }, { key: 'puntYards', label: 'PUNT YDS', title: 'Punting yards' }] },
];
const num = (n: number | undefined) => (n === undefined ? '' : Number.isInteger(n) ? String(n) : n.toFixed(1));

export function dkLabel(row: StatRow) {
  const d = getDraftKingsDetails({ position: row.position, side: row.side }, row.stats);
  return { d, text: d.points === null ? '\u2014' : `${d.points.toFixed(2)}${d.partial ? '*' : ''}` };
}

export function DraftKingsRules() {
  return (
    <details className="pst-rules">
      <summary><Info size={13} /> How DK PTS are scored</summary>
      <div>
        <p>DraftKings NFL Classic scoring, calculated only from stats recorded here. Unreported scoring plays are not inferred, so a total marked * may differ from the official score.</p>
        <p>Passing: 0.04 per yard, 4 per TD, -1 per INT, +3 at 300 yards. Rushing and receiving: 0.1 per yard, 6 per TD, +3 at 100 yards. Receptions: 1 each. Fumbles lost: -1. Return TDs and offensive fumble recovery TDs: 6. Two-point conversions: 2.</p>
        <p>Individual defenders, kickers and offensive linemen show a dash because Classic scores team DST, not individuals. Team DST points are not estimated from the final score.</p>
        <a href={DRAFTKINGS_RULES_URL} target="_blank" rel="noopener noreferrer">Official DraftKings rules</a>
      </div>
    </details>
  );
}

export default function PlayerStatsTable({ rows, renderEditor, label, emptyText, testId }: { rows: StatRow[]; renderEditor?: (row: StatRow) => ReactNode; label: string; emptyText: string; testId?: string }) {
  const [pos, setPos] = useState('ALL');
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<'desc' | 'asc' | 'none'>('desc');
  const [open, setOpen] = useState<string | null>(null);
  const positions = useMemo(() => Array.from(new Set(rows.map(r => r.position))).sort(), [rows]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = rows.filter(r => (pos === 'ALL' || r.position === pos) && (!t || r.name.toLowerCase().includes(t))).map(r => ({ r, l: dkLabel(r) }));
    if (dir !== 'none') list.sort((a, b) => {
      if (a.l.d.points === null && b.l.d.points !== null) return 1;
      if (b.l.d.points === null && a.l.d.points !== null) return -1;
      return ((b.l.d.points ?? 0) - (a.l.d.points ?? 0)) * (dir === 'desc' ? 1 : -1) || a.r.name.localeCompare(b.r.name);
    });
    return list;
  }, [rows, pos, q, dir]);
  const hasOff = shown.some(({ r }) => r.side === 'offense' && ['QB', 'RB', 'WR', 'TE'].includes(r.position));
  const hasDef = shown.some(({ r }) => r.side === 'defense');
  const hasSpecial = shown.some(({ r }) => ['K', 'OTHER'].includes(r.position) || GROUPS[4].cols.some(c => r.stats[c.key] !== undefined));
  const groups = GROUPS.filter(g => g.name === 'Defense' ? hasDef : g.name === 'Special teams' ? hasSpecial : hasOff);
  const span = 3 + groups.reduce((n, g) => n + g.cols.length, 0);

  if (rows.length === 0) return <div className="tl-empty" data-testid={testId ? `${testId}-empty` : undefined}><strong>No players in this game</strong><span>{emptyText}</span></div>;
  return (
    <div className="pst" data-testid={testId}>
      <div className="pst-tools">
        <label>Search<input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Player name" /></label>
        <label>Position<select value={pos} onChange={e => setPos(e.target.value)}><option value="ALL">All positions</option>{positions.map(p => <option key={p}>{p}</option>)}</select></label>
        <span className="pst-count" role="status">{shown.length} of {rows.length} players</span>
      </div>
      <div className="pst-scroll" tabIndex={0} role="region" aria-label={`${label}, scrollable`}>
        <table className="pst-table">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="pst-g"><th colSpan={2} /><th />{groups.map(g => <th key={g.name} colSpan={g.cols.length} scope="colgroup">{g.name}</th>)}</tr>
            <tr>
              <th scope="col" className="pst-name">Player</th><th scope="col">Pos</th>
              <th scope="col" className="pst-dk" aria-sort={dir === 'none' ? 'none' : dir === 'desc' ? 'descending' : 'ascending'}>
                <button type="button" onClick={() => setDir(d => (d === 'desc' ? 'asc' : 'desc'))} title="Sort by DK points">DK PTS {dir === 'asc' ? '\u25B2' : '\u25BC'}</button>
              </th>
              {groups.flatMap(g => g.cols.map((c, i) => <th key={g.name + c.key} scope="col" title={c.title} className={i === 0 ? 'pst-gs' : undefined}>{c.label}</th>))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={span} className="pst-none">No players match this filter.</td></tr>}
            {shown.map(({ r, l }) => {
              const isOpen = open === r.id; const empty = Object.keys(r.stats).length === 0;
              return (
                <Fragment key={r.id}>
                  <tr className={`pst-row${r.inactive ? ' off' : ''}`} data-testid={`row-stats-${r.id}`}>
                    <th scope="row" className="pst-name">
                      {renderEditor ? <button type="button" className="pst-edit" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)} data-testid={`button-edit-stats-${r.id}`}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>{r.name || 'Unnamed'}</span><small>Edit stats</small></button> : <span>{r.name || 'Unnamed'}</span>}
                      {empty && <em>played, no stats</em>}
                    </th>
                    <td><span className="pst-pos">{r.position}</span></td>
                    <td className="pst-dk" title={[l.d.note, ...l.d.breakdown.map(b => `${b.label}: ${b.points > 0 ? '+' : ''}${b.points.toFixed(2)}`)].join('\n')}><b>{l.text}</b></td>
                    {groups.flatMap(g => g.cols.map((c, i) => <td key={g.name + c.key} className={i === 0 ? 'pst-gs' : undefined}>{num((g.name === 'Passing' && r.side === 'defense') || (g.name === 'Defense' && r.side !== 'defense') ? undefined : r.stats[c.key]) || <i aria-label="not reported">&middot;</i>}</td>))}
                  </tr>
                  {isOpen && renderEditor && <tr className="pst-ed"><td colSpan={span}>
                    {l.d.breakdown.length > 0 && <p className="pst-bd">{l.d.breakdown.map(b => `${b.label} ${b.points > 0 ? '+' : ''}${b.points}`).join(' / ')}</p>}
                    {renderEditor(r)}
                  </td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pst-foot">* Partial: based on reported stats only. A dash means no individual DK scoring (team DST).</p>
      <DraftKingsRules />
    </div>
  );
}
