import { useEffect, useMemo, useState } from 'react';
import type { SalaryPlayer, LineupFormat } from '@/lib/lineups';
import { exclusionKey, exclusionScope } from '@/lib/lineup-exclusions';

export function useLineupExclusions(season: number, format: LineupFormat, players: SalaryPlayer[]) {
  const scope = useMemo(() => exclusionScope(season, format, players), [season, format, players]);
  const [state, setState] = useState<{ scope: string; keys: string[] }>({ scope: '', keys: [] });
  const [warning, setWarning] = useState('');
  useEffect(() => {
    let keys: string[] = [];
    setWarning('');
    try {
      const stored = localStorage.getItem(scope);
      if (stored !== null) {
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed) || !parsed.every(key => typeof key === 'string')) throw new Error('Invalid saved exclusions.');
        keys = parsed;
      }
    } catch {
      setWarning('Saved exclusions could not be read. Re-select players to exclude before generating.');
    }
    setState({ scope, keys });
  }, [scope]);
  const validKeys = useMemo(() => new Set(players.map(exclusionKey)), [players]);
  const excluded = useMemo(() => new Set(state.scope === scope
    ? state.keys.filter(key => validKeys.has(key)) : []), [state, scope, validKeys]);
  function save(keys: string[]) {
    setState({ scope, keys });
    try { localStorage.setItem(scope, JSON.stringify(keys)); setWarning(''); }
    catch { setWarning('Exclusions apply now, but could not be saved on this browser. Re-select them after a reload.'); }
  }
  return { excluded, warning, toggle(key: string) {
    const keys = new Set(excluded);
    if (keys.has(key)) keys.delete(key); else if (validKeys.has(key)) keys.add(key);
    save([...keys]);
  }, clear() { save([]); } };
}
