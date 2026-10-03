import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, RotateCw, X } from 'lucide-react';
import { usePreviewNflTeam, type NflImportPreview, type RosterPlayer, type TeamWeek } from '@workspace/api-client-react';
import { mergeNflImport, type ImportDraft } from '@/lib/nfl-import-merge';
import PlayerStatsTable, { type StatRow } from './PlayerStatsTable';
import './nfl-import.css';

type Props = {
  season: number; team: string; draft: ImportDraft; disabled: boolean;
  onApply: (draft: ImportDraft) => void; onBusyChange: (busy: boolean) => void;
};

const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : '');

export default function NflImportPanel({ season, team, draft, disabled, onApply, onBusyChange }: Props) {
  const preview = usePreviewNflTeam();
  const mutateRef = useRef(preview.mutateAsync); mutateRef.current = preview.mutateAsync;
  const busyRef = useRef(onBusyChange); busyRef.current = onBusyChange;
  const token = useRef(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<NflImportPreview | null>(null);
  const [error, setError] = useState('');
  const [replaceStats, setReplaceStats] = useState(false);
  const [updateRoster, setUpdateRoster] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [gameLimit, setGameLimit] = useState(17);

  const reset = () => { token.current++; setLoading(false); setData(null); setError(''); setReplaceStats(false); setUpdateRoster(false); busyRef.current(false); };

  useEffect(() => { reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [season, team]);
  useEffect(() => () => { token.current++; busyRef.current(false); }, []);

  const refresh = async () => {
    const my = ++token.current;
    setLoading(true); setError(''); setData(null); busyRef.current(true);
    try {
      const res = await mutateRef.current({ season, team: encodeURIComponent(team), params: { gameLimit } });
      if (my !== token.current) return;
      setData(res); setLoading(false);
    } catch (e) {
      if (my !== token.current) return;
      const err = e as { message?: string; data?: { error?: string } };
      setError(err?.data?.error || err?.message || 'The NFL source could not be reached.');
      setLoading(false); busyRef.current(false);
    }
  };
  const cancel = () => reset();

  const stale = !!data && (data.season !== season || data.team !== team);
  const result = useMemo(() => {
    if (!data || stale) return null;
    try { return mergeNflImport(draft, data, { replaceStats, updateRoster }); } catch { return null; }
  }, [data, stale, draft, replaceStats, updateRoster]);

  const apply = () => {
    if (!result || disabled) return;
    onApply(result.draft);
    reset();
  };

  const saved = useMemo(() => {
    const items: { at: string; url: string }[] = [];
    draft.players.forEach(p => { if (p.source) items.push({ at: p.source.fetchedAt, url: p.source.url }); });
    draft.weeks.forEach(w => { if (w.source) items.push({ at: w.source.fetchedAt, url: w.source.url }); });
    if (!items.length) return null;
    return items.reduce((a, b) => (new Date(b.at).getTime() > new Date(a.at).getTime() ? b : a));
  }, [draft]);

  const games = data ? data.weeks.filter((w: TeamWeek) => w.status === 'played') : [];
  const count = (side: RosterPlayer['side']) => data ? data.players.filter(p => p.side === side).length : 0;
  const nameOf = (id: string) => data?.players.find(p => p.id === id)?.name ?? id;
  const warnReplace = replaceStats || updateRoster;

  return (
    <section className="nfl" aria-labelledby="nfl-title" aria-busy={loading}>
      <div className="nfl-head">
        <div>
          <h3 id="nfl-title">Import NFL game history</h3>
          <p className="nfl-hint">Reads the {team} roster and {gameLimit === 17 ? 'all available completed regular-season games' : 'latest 3 completed games'} for {season} from ESPN. No older season is substituted. Nothing is changed until you apply, and applying stays unsaved until you press Save team.</p>
          <p className="nfl-src" data-testid="text-nfl-saved-source">
            {saved ? <>Latest source in this draft: {fmt(saved.at)}{safeUrl(saved.url) && <> / <a href={safeUrl(saved.url)} target="_blank" rel="noopener noreferrer" data-testid="link-nfl-latest-source">ESPN link</a></>}</> : 'No imported source in this draft yet.'}
          </p>
        </div>
        <div className="nfl-actions">
          <label className="nfl-hint">History range <select aria-label="History import range" value={gameLimit} disabled={disabled || loading || !!data} onChange={e => setGameLimit(Number(e.target.value))} data-testid="select-history-range"><option value={17}>All completed games</option><option value={3}>Latest 3 games</option></select></label>
          <button type="button" className="btn-secondary" onClick={refresh} disabled={disabled || loading || !!data} data-testid="button-nfl-refresh">
            {loading ? <><RotateCw size={14} className="spin-icon" /> Fetching</> : <><Download size={14} /> Fetch game history</>}
          </button>
          {(loading || data) && <button type="button" className="btn-secondary" onClick={cancel} data-testid="button-nfl-cancel"><X size={14} /> Cancel</button>}
        </div>
      </div>

      {loading && <div className="nfl-skel" aria-hidden="true"><i /><i /><i /></div>}
      <div role="status" data-testid="status-nfl-preview" className={data || error || loading ? undefined : 'sr-only'}>
        {loading && 'Fetching from ESPN...'}
        {data && !stale && `Preview ready. Fetched ${fmt(data.fetchedAt)}. Not applied yet.`}
      </div>
      {error && <div className="nfl-banner err" role="alert"><AlertTriangle size={14} /> {error} The import did not change your draft. Press Refresh to try again.</div>}

      {data && !stale && <>
        <p className="nfl-src">Fetched {fmt(data.fetchedAt)} / {safeUrl(data.rosterUrl) ? <a href={safeUrl(data.rosterUrl)} target="_blank" rel="noopener noreferrer">Source roster page</a> : 'roster link unavailable'}</p>
        {data.warnings.length > 0 && <div className="nfl-banner warn" role="status">{data.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}

        {games.length === 0 ? <p className="nfl-hint">No completed games were returned.</p> :
          <ul className="nfl-games" aria-label="Completed games">
            {games.map(w => (
              <li key={w.week} className={w.venue}>
                <b>Week {w.week}</b>
                <span>{w.venue === 'home' ? 'vs' : 'at'} {w.opponent || 'Unknown'}</span>
                <span className="score">{w.result !== 'none' ? w.result : ''} {w.teamScore ?? '?'}-{w.opponentScore ?? '?'}</span>
                <span className="score">{Object.keys(w.playerStats).length} players with stats</span>
                {safeUrl(w.source?.url) && <a href={safeUrl(w.source?.url)} target="_blank" rel="noopener noreferrer">Boxscore</a>}
              </li>
            ))}
          </ul>}

        <div className="nfl-stats">
          <div className="nfl-stat"><span>Offense roster</span><strong>{count('offense')}</strong></div>
          <div className="nfl-stat"><span>Defense roster</span><strong>{count('defense')}</strong></div>
          <div className="nfl-stat"><span>Players to add</span><strong data-testid="text-nfl-added">{result?.addedPlayers ?? 0}</strong></div>
           <div className="nfl-stat"><span>{replaceStats ? 'Existing value conflicts' : 'Kept / skipped value conflicts'}</span><strong data-testid="text-nfl-conflicts">{result?.statConflicts ?? 0}</strong></div>
          <div className="nfl-stat"><span>Roster changes</span><strong>{result?.rosterChanges ?? 0}</strong></div>
          <div className="nfl-stat"><span>Skipped weeks</span><strong data-testid="text-nfl-skipped">{result?.skippedWeeks.length ? result.skippedWeeks.join(', ') : 'none'}</strong></div>
        </div>

        <details>
          <summary>Game stats from source ({games.length})</summary>
          <div className="nfl-detail">
            {games.map(w => (
              <div key={w.week}>
                <p className="nfl-hint">Week {w.week} team defense: {Object.keys(w.teamDefense).length ? Object.entries(w.teamDefense).map(([k, v]) => `${k} ${v}`).join(', ') : 'unknown'}</p>
                <PlayerStatsTable label={`Week ${w.week} source player stats`} emptyText="The source reported no players for this game."
                  rows={Object.keys(w.playerStats).map((id): StatRow => { const p = data?.players.find(x => x.id === id); return { id, name: nameOf(id), position: p?.position ?? 'OTHER', side: p?.side ?? 'offense', stats: w.playerStats[id] }; })} />
              </div>
            ))}
          </div>
        </details>

        <details onToggle={e => setShowRoster((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>Source roster ({data.players.length})</summary>
          {showRoster && <div className="nfl-detail">
            <table>
              <thead><tr><th>Name</th><th>Pos</th><th>Side</th><th>Active</th><th>Availability</th></tr></thead>
              <tbody>{data.players.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.position}{p.sourcePosition && p.sourcePosition !== p.position ? ` (${p.sourcePosition})` : ''}</td><td>{p.side}</td><td>{p.active ? 'yes' : 'no'}</td><td>{p.availability || 'unknown'}</td></tr>)}</tbody>
            </table>
          </div>}
        </details>

        <fieldset className="nfl-opts">
          <legend>Merge options</legend>
          <p className="nfl-hint">By default your entered values are kept, and anything the source does not report stays unknown (never zero).</p>
          <label className="nfl-opt">
            <input type="checkbox" checked={replaceStats} onChange={e => setReplaceStats(e.target.checked)} data-testid="checkbox-nfl-replace-stats" />
            <span>Replace existing values in these game weeks only<small>Custom fields are retained for the same game. If your week is a different game, the whole week is replaced.</small></span>
          </label>
          <label className="nfl-opt">
            <input type="checkbox" checked={updateRoster} onChange={e => setUpdateRoster(e.target.checked)} data-testid="checkbox-nfl-update-roster" />
            <span>Update existing roster details and activity from source<small>Former source players are marked inactive, never deleted. Manually added players are kept.</small></span>
          </label>
          {warnReplace && <div className="nfl-banner warn" role="alert">Existing values you chose to replace will be overwritten in the draft{result ? ` (${result.changedValues} value${result.changedValues === 1 ? '' : 's'} change)` : ''}. You can still discard by not saving.</div>}
        </fieldset>

        <div className="nfl-actions">
          <button type="button" className="btn-primary" onClick={apply} disabled={disabled || !result} data-testid="button-nfl-apply">Apply to draft</button>
          <span className="nfl-hint">Unsaved until Save team.</span>
        </div>
      </>}
      {stale && <div className="nfl-banner warn" role="status">This preview belongs to a different team or season. Cancel and refresh.</div>}
    </section>
  );
}
