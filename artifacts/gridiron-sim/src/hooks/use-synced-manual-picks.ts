import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSharedManualPicks, saveSharedManualPicks, type SharedManualPicks } from '@workspace/api-client-react';
import type { ManualPicks } from '@/lib/manual-lineups';
import { legacyDraft, pickEntries, picksRecord, readRecovery, removeRecovery, samePicks, validateSharedPicks, writeRecovery } from '@/lib/manual-picks-sync';

const message = (e: unknown) => e instanceof Error ? e.message : 'Sync failed.';
interface Session {
  picks: ManualPicks; revision: number; remote?: SharedManualPicks;
  dirty: boolean; saving: boolean; conflict: boolean; initialized: boolean;
  error: string; warning: string; legacy?: ManualPicks; migrationTried: boolean;
}
// In-memory fallback is only for unavailable browser storage; disk drafts also
// survive reloads. Sessions are scoped to season plus the full contest signature.
const sessions = new Map<string, Session>();
function sessionFor(season: number, signature: string) {
  const key = `${season}:${signature}`;
  const found = sessions.get(key);
  if (found) return found;
  const s: Session = { picks: {}, revision: 0, dirty: false, saving: false, conflict: false,
    initialized: false, error: '', warning: '', migrationTried: false };
  try {
    const recovery = readRecovery(localStorage, season, signature);
    if (recovery) { s.picks = recovery.picks; s.revision = recovery.expectedRevision; s.dirty = true; }
  } catch (e) { s.warning = `${message(e)} Edits remain in memory if browser recovery is unavailable.`; }
  try { s.legacy = legacyDraft(localStorage, signature); }
  catch (e) { s.warning = message(e); }
  sessions.set(key, s);
  return s;
}
export function useSyncedManualPicks(season: number, signature: string, enabled: boolean) {
  const client = useQueryClient();
  const [, render] = useReducer(v => v + 1, 0);
  const session = useMemo(() => sessionFor(season, signature), [season, signature]);
  const current = useRef(session); current.current = session;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const notify = (s: Session) => { if (mounted.current && current.current === s) render(); };
  const queryKey = ['manual-picks', season, signature];
  const query = useQuery({ queryKey, enabled, queryFn: async () =>
    validateSharedPicks(await getSharedManualPicks(season, { signature }, { signal: AbortSignal.timeout(15000) }), signature),
    staleTime: 0, refetchInterval: 15000, refetchOnWindowFocus: true, retry: false });

  function persist(s: Session) {
    try { writeRecovery(localStorage, season, { signature, picks: s.picks, expectedRevision: s.revision }); }
    catch (e) { s.warning = `Browser recovery failed: ${message(e)}. Keep this page open until a shared save succeeds.`; }
  }
  function accept(s: Session, response: SharedManualPicks) {
    if (s.remote && response.revision < s.remote.revision) return;
    s.remote = response; s.initialized = true;
    if (s.dirty) {
      // Polling and refresh never replace typing, even if another device writes.
      s.conflict = response.revision !== s.revision;
      if (s.conflict) s.error = 'Shared picks changed on another device. Your unsaved draft is retained. Export it or use the latest shared picks before editing again.';
    } else {
      s.picks = picksRecord(response); s.revision = response.revision; s.conflict = false; s.error = '';
    }
    notify(s);
  }
  async function save(s = session) {
    if (s.saving || !s.dirty || !s.initialized || s.conflict || !enabled) return;
    const snapshot = s.picks, expectedRevision = s.revision;
    s.saving = true; s.error = ''; persist(s); notify(s);
    try {
      const response = validateSharedPicks(await saveSharedManualPicks(season, {
        signature, expectedRevision, picks: pickEntries(snapshot),
      }, { signal: AbortSignal.timeout(15000) }), signature);
      if (response.revision !== expectedRevision + 1 || !samePicks(picksRecord(response), snapshot)) {
        throw new Error('Save could not be verified. The browser draft is retained.');
      }
      const newest = s.remote && s.remote.revision > response.revision ? s.remote : response;
      s.revision = response.revision; s.remote = response; s.conflict = false; s.error = '';
      if (samePicks(s.picks, snapshot)) {
        s.dirty = false;
        try { removeRecovery(localStorage, season, signature); }
        catch (e) { s.warning = `Saved across devices. Browser recovery could not be cleared: ${message(e)}`; }
      } else persist(s); // Edits typed during the request remain unsaved.
      accept(s, newest);
      client.setQueryData(queryKey, newest);
    } catch (e) {
      s.error = `Not saved across devices: ${message(e)} Your draft is retained.`;
      // An ambiguous failed response might have committed. Reading is safe;
      // do not retry a stale write or replace newer remote edits.
      try {
        const fresh = validateSharedPicks(await getSharedManualPicks(season, { signature }, { signal: AbortSignal.timeout(15000) }), signature);
        if (fresh.revision === expectedRevision + 1 && samePicks(picksRecord(fresh), snapshot)) {
          s.revision = fresh.revision; s.remote = fresh; s.error = ''; s.conflict = false;
          if (samePicks(s.picks, snapshot)) {
            s.dirty = false;
            try { removeRecovery(localStorage, season, signature); } catch { /* Original recovery stays intact. */ }
          } else persist(s);
        } else accept(s, fresh);
        client.setQueryData(queryKey, fresh);
      } catch { /* Leave both the draft and the failed-save message intact. */ }
    } finally { s.saving = false; notify(s); }
  }
  useEffect(() => {
    if (!enabled || !query.data) return;
    const s = session;
    accept(s, query.data);
    if (!s.migrationTried && s.legacy) {
      s.migrationTried = true;
      if (query.data.revision === 0 && !s.dirty) {
        s.picks = s.legacy; s.revision = 0; s.dirty = true; persist(s); notify(s);
        void save(s);
      } else if (query.data.revision > 0) {
        s.warning = 'Shared picks take priority over the old browser list. The original browser list is unchanged and can be exported.';
        notify(s);
      }
    }
  }, [query.data, session, enabled]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ([...sessions.values()].some(s => s.dirty)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  // Do not replace a dirty session when another tab updates recovery storage.
  // The server revision, not a local storage event, is authoritative.
  function edit(picks: ManualPicks) {
    if (!enabled || !session.initialized) return;
    session.picks = picks; session.dirty = true; persist(session); notify(session);
  }
  function useShared() {
    if (!session.remote || session.saving) return;
    if (session.dirty && !window.confirm('Use the latest shared picks instead of this unsaved draft? Export the browser draft first if you want to keep it.')) return;
    // Keep a separate backup before discarding anything; never erase unreadable storage.
    if (session.dirty) {
      try {
        const backup = localStorage.getItem('gridiron-manual-picks-backups-v1');
        const backups = backup ? JSON.parse(backup) : [];
        if (!Array.isArray(backups)) throw new Error('Unreadable draft backups.');
        localStorage.setItem('gridiron-manual-picks-backups-v1', JSON.stringify([...backups, { season, signature, picks: session.picks, expectedRevision: session.revision }]));
        removeRecovery(localStorage, season, signature);
      } catch (e) { session.error = `Draft could not be backed up: ${message(e)} Export it before leaving.`; notify(session); return; }
    }
    session.dirty = false; accept(session, session.remote);
  }
  function exportDraft() {
    const blob = new Blob([JSON.stringify({ season, signature, picks: session.dirty ? session.picks : session.legacy ?? session.picks }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `my-picks-draft-${season}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { picks: session.picks, edit, save: () => void save(), refresh: () => void query.refetch(), useShared, exportDraft,
    dirty: session.dirty, saving: session.saving, conflict: session.conflict, ready: session.initialized,
    loading: enabled && !session.initialized && query.isPending,
    warning: session.warning, error: session.error || (query.isError ? `Shared picks could not be refreshed: ${message(query.error)}. Browser edits are retained.` : ''),
    status: session.saving ? 'Saving picks…' : session.dirty ? 'Unsaved changes — save picks to sync across devices.'
      : session.initialized ? `Saved across devices · revision ${session.revision}` : 'Loading shared picks…',
  };
}
