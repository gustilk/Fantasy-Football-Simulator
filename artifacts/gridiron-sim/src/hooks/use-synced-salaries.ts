import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSharedSalaryFile, getGetSharedSalaryFileQueryKey, saveSharedSalaryFile, deleteSharedSalaryFile,
  type SharedSalaryState } from '@workspace/api-client-react';
import { parseSalaryCsv, type LineupFormat } from '@/lib/lineups';
import { loadSalaryFile, saveSalaryFile, removeSalaryFile, type SavedSalaries, type SavedSalaryState } from '@/lib/salary-storage';
import { sharedSalaryRecord } from '@/lib/salary-sync';

const message = (e: unknown) => e instanceof Error ? e.message : 'Salary sync failed.';
function localFile(season: number, format: LineupFormat): SavedSalaryState {
  try { return loadSalaryFile(localStorage, season, format); }
  catch (e) { return { status: 'corrupt', reason: message(e) }; }
}
export function useSyncedSalaries(season: number, format: LineupFormat) {
  const client = useQueryClient();
  const queryKey = getGetSharedSalaryFileQueryKey(season, format);
  const query = useQuery({ queryKey, queryFn: () => getSharedSalaryFile(season, format),
    staleTime: 5000, refetchInterval: 15000, refetchOnWindowFocus: true, retry: false });
  const [saved, setSaved] = useState<SavedSalaryState>(() => localFile(season, format));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [retry, setRetry] = useState(0);
  const migrated = useRef('');

  function cache(record: SavedSalaries) {
    if (localFile(season, format).status === 'corrupt') {
      setWarning('Shared salaries are available. An unreadable local cache was left unchanged.');
      return;
    }
    try { saveSalaryFile(localStorage, record, format); }
    catch { setWarning('Saved across devices. Browser storage is unavailable, so this device’s forecast pairing may not persist.'); }
  }
  function accept(response: SharedSalaryState, preferred?: SavedSalaries) {
    if (response.file) {
      const local = localFile(season, format);
      const record = sharedSalaryRecord(response.file, preferred ?? (local.status === 'ok' ? local.record : undefined));
      cache(record);
      setSaved({ status: 'ok', record });
    } else {
      if (response.revision > 0) {
        try { removeSalaryFile(localStorage, format); }
        catch { setWarning('Removed from shared storage. A local browser cache could not be cleared, but will not be restored automatically.'); }
      }
      setSaved({ status: 'none' });
    }
    client.setQueryData(queryKey, response);
  }
  useEffect(() => {
    migrated.current = '';
    setSaved(localFile(season, format)); setError(''); setWarning(''); setPending(false);
  }, [season, format]);

  useEffect(() => {
    if (!query.data) return undefined;
    const local = localFile(season, format);
    if (query.data.revision === 0 && !query.data.file && local.status === 'ok') {
      const attempt = `${season}:${format}:${retry}`;
      if (migrated.current === attempt) return undefined;
      migrated.current = attempt;
      let cancelled = false;
      void saveSharedSalaryFile(season, format, { expectedRevision: 0, filename: local.record.filename,
        players: parseSalaryCsv(local.record.csv, format) }).then(response => {
        if (!cancelled) accept(response, local.record);
        else client.setQueryData(queryKey, response);
      }).catch(async e => {
        // A simultaneous first upload must never overwrite the winning device.
        const fresh = await query.refetch();
        if (cancelled) return;
        if (fresh.data && fresh.data.revision > 0) accept(fresh.data);
        else setError(`Your browser CSV is still intact but could not be shared: ${message(e)}`);
      });
      return () => { cancelled = true; };
    }
    if (query.data.revision === 0 && !query.data.file && local.status === 'corrupt') {
      setSaved(local);
      return undefined;
    }
    accept(query.data);
    return undefined;
  }, [query.data, season, format, retry]);

  async function save(record: SavedSalaries) {
    if (!query.data || query.isError) throw new Error('Refresh salary sync before uploading.');
    setPending(true); setError('');
    try {
      const response = await saveSharedSalaryFile(season, format, { expectedRevision: query.data.revision,
        filename: record.filename, players: parseSalaryCsv(record.csv, format) });
      accept(response, record);
    } catch (e) { setError(message(e)); void query.refetch(); throw e; }
    finally { setPending(false); }
  }
  async function remove() {
    if (!query.data || query.isError) throw new Error('Refresh salary sync before removing.');
    setPending(true); setError('');
    try { accept(await deleteSharedSalaryFile(season, format, { expectedRevision: query.data.revision })); }
    catch (e) { setError(message(e)); void query.refetch(); throw e; }
    finally { setPending(false); }
  }
  function pair(record: SavedSalaries) {
    if (localFile(season, format).status === 'corrupt') throw new Error('The local salary cache is unreadable; it has not been overwritten. Shared salary data remains safe.');
    saveSalaryFile(localStorage, record, format);
    setSaved({ status: 'ok', record });
  }
  const needsMigration = query.data?.revision === 0 && !query.data.file && localFile(season, format).status === 'ok';
  return { saved, save, remove, pair, warning,
    loading: query.isPending || pending || (needsMigration && !error),
    error: error || (query.isError ? `Shared salaries could not be loaded: ${message(query.error)}` : ''),
    refresh: () => { setError(''); migrated.current = ''; setRetry(v => v + 1); void query.refetch(); },
  };
}
