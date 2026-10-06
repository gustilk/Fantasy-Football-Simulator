import { useEffect, useRef, useState } from 'react';
import { listSeasonTeams, previewNflTeam, saveSeasonTeam, type TeamSeasonRecord } from '@workspace/api-client-react';
import { mergeNflImport } from '@/lib/nfl-import-merge';
import { NFL_TEAM_NAMES } from '@/lib/nfl-divisions';

export default function LeagueStatsRefresh({ season, disabled, onSaved, onBusyChange }: {
  season: number; disabled: boolean; onSaved: (team: TeamSeasonRecord) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, saved: 0, conflicts: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const cancelled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelled.current = true; }; }, []);
  useEffect(() => { setNotice(''); setErrors([]); setProgress({ completed: 0, saved: 0, conflicts: 0 }); }, [season]);
  const refresh = async () => {
    if (busy || disabled) return;
    if (!window.confirm(`Import completed ${season} games and team/player stats for all 32 NFL teams from ESPN? This adds missing stats while preserving existing values, roster choices, strategy tags, other seasons, and saved forecasts.`)) return;
    cancelled.current = false;
    setBusy(true); onBusyChange(true); setErrors([]); setNotice('');
    let completed = 0, saved = 0, conflicts = 0, index = 0;
    const failures: string[] = [];
    setProgress({ completed, saved, conflicts });
    try {
      const current = await listSeasonTeams({ season });
      const run = async () => {
        while (!cancelled.current) {
          const name = NFL_TEAM_NAMES[index++];
          if (!name) break;
          try {
            const preview = await previewNflTeam(season, name, { gameLimit: 17 });
            if (cancelled.current) break;
            if (preview.season !== season || preview.team !== name) throw new Error('ESPN returned a different team or season.');
            const old = current.find(team => team.team === name);
            const merged = mergeNflImport({ players: old?.players ?? [], weeks: old?.weeks ?? [] }, preview,
              { replaceStats: false, updateRoster: false });
            const record = await saveSeasonTeam(season, name, {
              expectedVersion: old?.version ?? 0, ...merged.draft, defenseTier: old?.defenseTier ?? null,
            });
            saved++; conflicts += merged.statConflicts;
            if (merged.skippedWeeks.length) failures.push(`${name}: saved missing stats, but kept conflicting game entries for week(s) ${merged.skippedWeeks.join(', ')}. Review this team's ESPN import preview before replacing those entries.`);
            if (mounted.current) onSaved(record);
          } catch (error) {
            failures.push(`${name}: ${error instanceof Error ? error.message : 'Import failed; saved team is unchanged.'}`);
          } finally {
            completed++;
            if (mounted.current) { setProgress({ completed, saved, conflicts }); setErrors([...failures]); }
          }
        }
      };
      // Bound ESPN summary fan-out; each preview already fetches several game box scores.
      await Promise.all([run(), run()]);
      if (mounted.current) setNotice(`${cancelled.current ? 'Stopped' : 'Finished'}: ${saved} of 32 teams saved with completed ${season} team/player stats. ${conflicts ? `${conflicts} differing existing values were preserved. ` : ''}Other seasons and saved forecasts are unchanged.`);
    } catch (error) {
      if (mounted.current) setErrors([error instanceof Error ? error.message : 'Saved team data could not be read.']);
    } finally {
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  };
  return <div className="tl-banner" data-testid="league-stats-refresh">
    <strong>Full-league ESPN stats</strong>
    <p>Import all 32 teams’ completed regular-season game scores, player box scores, and defense stats. Existing values and manual roster choices are kept; missing data is not invented.</p>
    <button className="btn-secondary" disabled={disabled || busy} onClick={() => void refresh()} data-testid="button-refresh-league-stats">Refresh all {season} team/player stats</button>
    {busy && <><p role="status">{progress.completed}/32 checked · {progress.saved} saved</p><button className="btn-secondary" onClick={() => { cancelled.current = true; }}>Stop after current saves</button></>}
    {notice && <p role="status" data-testid="league-stats-result">{notice}</p>}
    {errors.length > 0 && <div role="alert"><p>{errors.length} team(s) need attention. Successfully saved stats remain saved; review the issues below and retry.</p><details><summary>Import issues</summary><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></details></div>}
  </div>;
}
