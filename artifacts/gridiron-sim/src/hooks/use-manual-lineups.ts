import { useEffect, useMemo, useRef, useState } from 'react';
import { getFeaturedClassicSalary } from '@workspace/api-client-react';
import { useSyncedSalaries } from './use-synced-salaries';
import { parseSalaryCsv, lineupSlots, exportLineups, type Lineup } from '@/lib/lineups';
import { readSalaryFile } from '@/lib/salary-file';
import { buildManualLineupPool, manualContestSignature, manualSalaryGame, readManualPicks, saveManualPicks, MANUAL_PICKS_KEY, type ManualPick, type ManualPicks } from '@/lib/manual-lineups';

const message = (e: unknown) => e instanceof Error ? e.message : 'The operation failed. Please retry.';
// Keep failed-save edits across in-app navigation; never describe them as saved.
const unsavedPicks = new Map<string, ManualPicks>();
export function useManualLineups(season: number) {
  const salarySync = useSyncedSalaries(season, 'classic');
  const record = salarySync.saved.status === 'ok' ? salarySync.saved.record : null;
  const parsed = useMemo(() => {
    try { return { players: record ? parseSalaryCsv(record.csv, 'classic') : [], error: '' }; }
    catch (e) { return { players: [], error: message(e) }; }
  }, [record?.csv]);
  const signature = useMemo(() => manualContestSignature(parsed.players), [parsed.players]);
  const [draft, setDraft] = useState<{ signature: string; picks: ManualPicks }>({ signature: '', picks: {} });
  const picks = draft.signature === signature ? draft.picks : {};
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const unreadableStorage = useRef(false);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ key: string; lineup: Lineup } | null>(null);
  const worker = useRef<Worker | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const key = JSON.stringify([signature, picks]);
  const keyRef = useRef(key); keyRef.current = key;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; worker.current?.terminate(); }, []);
  const stop = () => { worker.current?.terminate(); worker.current = null; setRunning(false); };
  useEffect(() => {
    stop(); setResult(null); setError(''); setNotice('');
    try {
      const saved = readManualPicks(localStorage, signature);
      unreadableStorage.current = false;
      setDraft({ signature, picks: unsavedPicks.get(signature) ?? saved });
      setStorageError(unsavedPicks.has(signature) ? 'Your edits are not saved. Retry saving before leaving.' : '');
    } catch (e) {
      unreadableStorage.current = true;
      setDraft({ signature, picks: unsavedPicks.get(signature) ?? {} }); setStorageError(message(e));
    }
  }, [signature]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsavedPicks.size) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    const reload = (event: StorageEvent) => {
      if (event.key !== MANUAL_PICKS_KEY) return;
      stop(); setResult(null);
      try {
        const saved = readManualPicks(localStorage, signature); unreadableStorage.current = false;
        setDraft({ signature, picks: unsavedPicks.get(signature) ?? saved });
        setStorageError(unsavedPicks.has(signature) ? 'Your edits are not saved. Retry saving before leaving.' : '');
      } catch (e) { unreadableStorage.current = true; setStorageError(message(e)); }
    };
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, [signature]);
  const updatePick = (id: string, patch: Partial<ManualPick>) => {
    if (storageError || !parsed.players.some(p => p.id === id)) return;
    stop(); setResult(null); setError(''); setNotice('');
    const previous = draftRef.current.signature === signature ? draftRef.current.picks : {};
    const next = { ...previous, [id]: { ...(previous[id] ?? { selected: false, points: '' }), ...patch } };
    const value = { signature, picks: next }; draftRef.current = value; setDraft(value);
    try { saveManualPicks(localStorage, signature, next); unsavedPicks.delete(signature); }
    catch (e) {
      unsavedPicks.set(signature, next);
      setStorageError(`Your edits are not saved: ${message(e)}. They remain available during in-app navigation; retry saving before leaving.`);
    }
  };
  const retrySave = () => {
    try {
      if (unreadableStorage.current) {
        const saved = readManualPicks(localStorage, signature);
        unreadableStorage.current = false;
        setDraft({ signature, picks: unsavedPicks.get(signature) ?? saved });
        setStorageError(unsavedPicks.has(signature) ? 'Your edits are not saved. Retry saving to keep them.' : '');
        return;
      }
      saveManualPicks(localStorage, signature, picks); unsavedPicks.delete(signature); setStorageError(''); setNotice('Your manual picks are saved in this browser.');
    }
    catch (e) { setStorageError(`Manual picks were not saved: ${message(e)}`); }
  };
  const clearPicks = () => {
    if (!window.confirm('Clear your manual player selections and point estimates? Salaries and simulator forecasts will not change.')) return;
    try {
      saveManualPicks(localStorage, signature, {}); unsavedPicks.delete(signature); unreadableStorage.current = false;
      stop(); setDraft({ signature, picks: {} }); setResult(null); setStorageError(''); setError('');
    } catch (e) { setStorageError(message(e)); }
  };
  const importCsv = async (file: File) => {
    setImporting(true); setError(''); setNotice(''); stop(); setResult(null);
    try {
      if (record && !window.confirm(`Replace "${record.filename}" with this Classic salary file? These salaries are also used in Lineups. Manual picks for a different contest will not carry over.`)) return;
      const { csv } = await readSalaryFile(file, undefined, 'classic');
      await salarySync.save({ version: 1, season, filename: file.name, importedAt: new Date().toISOString(), csv, format: 'classic', slateId: '', sunday: '' });
      if (mounted.current) setNotice('DraftKings salaries imported. Select players and enter your own projected points.');
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
      if (mounted.current) setNotice('Featured NFL Classic salaries imported. Enter your own projected points.');
    } catch (e) { if (mounted.current) setError(`Featured salaries were not imported: ${message(e)}`); }
    finally { if (mounted.current) setImporting(false); }
  };
  const generate = () => {
    stop(); setResult(null); setError(''); setNotice('');
    if (salarySync.loading || importing || salarySync.error || parsed.error || storageError || !record) {
      setError('Load valid Classic salaries and resolve save errors before generating.'); return;
    }
    try {
      const pool = buildManualLineupPool(parsed.players, picks);
      const runKey = keyRef.current;
      const w = new Worker(new URL('../lib/lineup-worker.ts', import.meta.url), { type: 'module' });
      worker.current = w; setRunning(true);
      w.onmessage = (event: MessageEvent<{ lineups?: Lineup[]; error?: string }>) => {
        if (worker.current !== w) return;
        stop();
        if (keyRef.current !== runKey) return;
        if (event.data.error) { setError(event.data.error); return; }
        const lineup = event.data.lineups?.[0];
        if (!lineup) { setError('No legal lineup fits $50,000 from your selected list. Select at least 1 QB, 2 RB, 3 WR, 1 TE, 1 DST and one extra RB/WR/TE for FLEX, across at least two games. Lower-cost alternatives may be needed.'); return; }
        try {
          lineupSlots(lineup);
          if (lineup.players.some(p => Date.parse(p.kickoff) <= Date.now())) throw new Error('Kickoff passed while generating. Refresh your picks before generating again.');
          setResult({ key: runKey, lineup });
        } catch (e) { setError(message(e)); }
      };
      w.onerror = event => { if (worker.current === w) { stop(); setError(`Lineup generation failed: ${event.message}`); } };
      w.postMessage({ players: pool, count: 1, format: 'classic', mode: 'average' });
    } catch (e) { stop(); setError(message(e)); }
  };
  const lineup = result?.key === key ? result.lineup : null;
  const exportLineup = () => {
    if (!lineup) return;
    try {
      const url = URL.createObjectURL(new Blob([exportLineups([lineup])], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `manual-classic-lineup-${season}.csv`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(message(e)); }
  };
  const players = useMemo(() => parsed.players.map(player => {
    let unavailable = '';
    try { if (Date.parse(manualSalaryGame(player).kickoff) <= Date.now()) unavailable = 'Kickoff has passed'; }
    catch (e) { unavailable = message(e); }
    return { ...player, unavailable };
  }), [parsed.players]);
  return { season, record, players, picks, updatePick, lineup, slots: lineup ? lineupSlots(lineup) : [],
    running, stop, importing, loading: salarySync.loading, selectedCount: players.filter(p => picks[p.id]?.selected).length,
    error: error || parsed.error || salarySync.error, salaryError: salarySync.error, warning: salarySync.warning, notice, storageError,
    generate, importCsv, importFeatured, retrySave, clearPicks, exportLineup, refreshSalaries: salarySync.refresh };
}
export type ManualLineupsController = ReturnType<typeof useManualLineups>;
