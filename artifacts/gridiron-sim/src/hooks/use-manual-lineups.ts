import { useEffect, useMemo, useRef, useState } from 'react';
import { getFeaturedClassicSalary } from '@workspace/api-client-react';
import { useSyncedSalaries } from './use-synced-salaries';
import { useSyncedManualPicks } from './use-synced-manual-picks';
import { parseSalaryCsv, lineupSlots, exportLineups } from '@/lib/lineups';
import { readSalaryFile } from '@/lib/salary-file';
import { buildManualLineupPool, manualContestSignature, manualSalaryGame, MANUAL_LINEUP_COUNT, type ManualPick, type ManualSalaryLineup } from '@/lib/manual-lineups';
import { manualLineupIssue, manualRosterReadiness } from '@/lib/manual-lineup-readiness';

const message = (e: unknown) => e instanceof Error ? e.message : 'The operation failed. Please retry.';
export function useManualLineups(season: number) {
  const salarySync = useSyncedSalaries(season, 'classic');
  const record = salarySync.saved.status === 'ok' ? salarySync.saved.record : null;
  const parsed = useMemo(() => {
    try { return { players: record ? parseSalaryCsv(record.csv, 'classic') : [], error: '' }; }
    catch (e) { return { players: [], error: message(e) }; }
  }, [record?.csv]);
  const signature = useMemo(() => manualContestSignature(parsed.players), [parsed.players]);
  const pickSync = useSyncedManualPicks(season, signature, !!record && !!parsed.players.length && !salarySync.loading && !salarySync.error);
  const picks = pickSync.picks;
  const [error, setError] = useState('');
  const storageError = pickSync.error;
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ key: string; lineups: ManualSalaryLineup[] } | null>(null);
  const worker = useRef<Worker | null>(null);
  const key = JSON.stringify([season, signature, picks]);
  const keyRef = useRef(key); keyRef.current = key;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; worker.current?.terminate(); }; }, []);
  const stop = () => { worker.current?.terminate(); worker.current = null; setRunning(false); };
  useEffect(() => {
    stop(); setResult(null); setError(''); setNotice('');
  }, [key]);
  const updatePick = (id: string, patch: Partial<ManualPick>) => {
    if (!pickSync.ready || !parsed.players.some(p => p.id === id)) return;
    stop(); setResult(null); setError(''); setNotice('');
    pickSync.edit({ ...pickSync.picks, [id]: { ...(pickSync.picks[id] ?? { selected: false, points: '' }), ...patch } });
  };
  const clearPicks = () => {
    if (!window.confirm('Clear your selected players and any previously saved point entries? Salaries and simulator forecasts will not change.')) return;
    pickSync.edit({}); stop(); setResult(null); setError('');
  };
  const importCsv = async (file: File) => {
    setImporting(true); setError(''); setNotice(''); stop(); setResult(null);
    try {
      if (record && !window.confirm(`Replace "${record.filename}" with this Classic salary file? These salaries are also used in Lineups. Manual picks for a different contest will not carry over.`)) return;
      const { csv } = await readSalaryFile(file, undefined, 'classic');
      await salarySync.save({ version: 1, season, filename: file.name, importedAt: new Date().toISOString(), csv, format: 'classic', slateId: '', sunday: '' });
      if (mounted.current) setNotice('DraftKings salaries imported. Select players to generate salary-only lineups.');
    } catch (e) { if (mounted.current) setError(`Salaries were not imported: ${message(e)}`); }
    finally { if (mounted.current) setImporting(false); }
  };
  const importFeatured = async () => {
    setImporting(true); setError(''); setNotice(''); stop(); setResult(null);
    try {
      const file = await getFeaturedClassicSalary(season, { signal: AbortSignal.timeout(45000) });
      if (!mounted.current) return;
      if (record && !window.confirm(`Replace "${record.filename}" with Featured NFL Classic salaries? These salaries are also used in Lineups; picks for another contest will not carry over.`)) return;
      parseSalaryCsv(file.csv, 'classic');
      await salarySync.save({ version: 1, season, filename: file.filename, importedAt: new Date().toISOString(), csv: file.csv, format: 'classic', slateId: '', sunday: '' });
      if (mounted.current) setNotice('Featured NFL Classic salaries imported. Select players to generate salary-only lineups.');
    } catch (e) { if (mounted.current) setError(`Featured salaries were not imported: ${message(e)}`); }
    finally { if (mounted.current) setImporting(false); }
  };
  const generate = () => {
    stop(); setResult(null); setError(''); setNotice('');
    if (salarySync.loading || pickSync.loading || !pickSync.ready || pickSync.dirty || importing || salarySync.error || parsed.error || storageError || !record) {
      setError('Load valid Classic salaries and resolve save errors before generating.'); return;
    }
    try {
      const pool = buildManualLineupPool(parsed.players, picks);
      const readiness = manualRosterReadiness(parsed.players, picks);
      if (readiness.issues.length) { setError(readiness.issues.join(' ')); return; }
      const runKey = keyRef.current;
      const w = new Worker(new URL('../lib/manual-lineup-worker.ts', import.meta.url), { type: 'module' });
      worker.current = w; setRunning(true);
      w.onmessage = (event: MessageEvent<{ lineups?: ManualSalaryLineup[]; error?: string }>) => {
        if (worker.current !== w) return;
        stop();
        if (keyRef.current !== runKey) return;
        if (event.data.error) { setError(event.data.error); return; }
        const lineups = event.data.lineups ?? [];
        if (!lineups.length) { setError(manualLineupIssue(pool) || 'No lineup was returned despite a feasible selected pool. Please retry generation. Your picks have not changed.'); return; }
        try {
          for (const lineup of lineups) {
            lineupSlots(lineup);
            if (lineup.players.some(p => Date.parse(p.kickoff) <= Date.now())) throw new Error('Kickoff passed while generating. Refresh your picks before generating again.');
          }
          setResult({ key: runKey, lineups });
        if (lineups.length < MANUAL_LINEUP_COUNT) setNotice(`Generated ${lineups.length} distinct legal ${lineups.length === 1 ? 'lineup' : 'lineups'}. Your selected pool may not allow 150 unique combinations under $50,000; add candidates or generate again for another random sample.`);
        } catch (e) { setError(message(e)); }
      };
      w.onerror = event => { if (worker.current === w) { stop(); setError(`Lineup generation failed: ${event.message}`); } };
      w.postMessage({ players: pool, count: MANUAL_LINEUP_COUNT });
    } catch (e) { stop(); setError(message(e)); }
  };
  const lineups = result?.key === key ? result.lineups : [];
  const exportResults = () => {
    if (!lineups.length) return;
    try {
      const url = URL.createObjectURL(new Blob([exportLineups(lineups)], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `manual-classic-${lineups.length}-random-lineups-${season}.csv`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(message(e)); }
  };
  const players = useMemo(() => parsed.players.map(player => {
    let unavailable = '';
    try { if (Date.parse(manualSalaryGame(player).kickoff) <= Date.now()) unavailable = 'Kickoff has passed'; }
    catch (e) { unavailable = message(e); }
    return { ...player, unavailable };
  }), [parsed.players]);
  return { season, record, players, picks, updatePick, lineups,
    running, stop, importing, loading: salarySync.loading || pickSync.loading, selectedCount: players.filter(p => picks[p.id]?.selected).length,
    error: error || parsed.error || salarySync.error, salaryError: salarySync.error, warning: salarySync.warning || pickSync.warning, notice, storageError,
    pickSync, generate, importCsv, importFeatured, retrySave: pickSync.save, clearPicks, exportResults, refreshSalaries: salarySync.refresh };
}
export type ManualLineupsController = ReturnType<typeof useManualLineups>;
