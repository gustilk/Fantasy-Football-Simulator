import { useEffect, useMemo, useRef, useState } from 'react';
import { getNflDepthChart, getGetNflScheduleQueryKey, getListSeasonTeamsQueryKey, useGetNflSchedule, useListSeasonTeams, type NflScheduledGame, type TeamSeasonRecord } from '@workspace/api-client-react';
import { withDepthChart } from '@/lib/depth-chart';
import { setupFromHistory } from '@/lib/season-model';
import { simulateEnsemble } from '@/lib/ensemble';
import {
  availableSundayOptions, daytimeSundaySlate, dkHistory, gameForecast, slateBoard, sundayGames, validateOfficialScore,
  type DKMarketDraft, type DKOfficialScore, type DKSlate,
} from '@/lib/draftkings-board';
import {
  addDKSlate, DK_ARCHIVE_KEY, emptyDKArchive, readDKArchive, setOfficialScore, writeDKArchive, type DKArchive,
} from '@/lib/draftkings-archive';
import type { SimulationInput } from '@/lib/simulator';
import { draftKingsAccuracy } from '@/lib/draftkings-accuracy';

const message = (error: unknown) => error instanceof Error ? error.message : 'The operation failed. Please retry.';
function initialArchive(): { archive: DKArchive; storageError: string } {
  try { return { archive: readDKArchive(localStorage), storageError: '' }; }
  catch (error) { return { archive: emptyDKArchive(), storageError: message(error) }; }
}
export function useDraftKingsBoard(season: number) {
  const schedule = useGetNflSchedule(season, undefined, { query: { queryKey: getGetNflScheduleQueryKey(season), staleTime: 300_000, retry: false } });
  const historyQuery = useListSeasonTeams({ season }, { query: { queryKey: getListSeasonTeamsQueryKey({ season }), staleTime: 60_000, retry: false } });
  const [stored, setStored] = useState(initialArchive);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedSunday, setSelectedSunday] = useState('');
  const [selectedSlateId, setSelectedSlateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, matchup: '' });
  const running = useRef(false);
  useEffect(() => { setSelectedSunday(''); setSelectedSlateId(''); }, [season]);
  const teams = historyQuery.data ?? [];
  const sundayOptions = useMemo(() => availableSundayOptions(schedule.data?.games ?? []), [schedule.data]);
  const sundays = useMemo(() => sundayOptions.map(option => option.value), [sundayOptions]);
  const sunday = selectedSunday || sundays[0] || '';
  const games = useMemo(() => sunday ? sundayGames(schedule.data?.games ?? [], sunday) : [], [schedule.data, sunday]);
  const slates = stored.archive.slates.filter(slate => slate.season === season);
  const savedSlate = slates.find(slate => slate.id === selectedSlateId) ?? slates[0] ?? null;
  const activeSlate = useMemo(() => savedSlate ? daytimeSundaySlate(savedSlate, schedule.data?.games ?? []) : null, [savedSlate, schedule.data]);
  const actualHistory = useMemo(() => dkHistory(teams, season, stored.archive.official), [teams, season, stored.archive.official]);
  const projections = useMemo(() => activeSlate ? slateBoard(activeSlate, actualHistory) : [], [activeSlate, actualHistory]);
  const accuracy = useMemo(() => draftKingsAccuracy(stored.archive.slates.map(slate => daytimeSundaySlate(slate, schedule.data?.games ?? [])), teams, stored.archive.official, season), [stored.archive, teams, season, schedule.data]);

  const reloadArchive = () => setStored(initialArchive());
  useEffect(() => {
    const listener = (event: StorageEvent) => { if (event.key === DK_ARCHIVE_KEY) reloadArchive(); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, []);
  const commit = (change: (archive: DKArchive) => DKArchive) => {
    // Read immediately before writing to retain edits made in another tab.
    const next = change(readDKArchive(localStorage));
    writeDKArchive(localStorage, next);
    setStored({ archive: next, storageError: '' });
  };
  const getMarket = (game: NflScheduledGame): DKMarketDraft => stored.archive.marketDrafts?.[`${season}:${game.id}`] ?? {
    enabled: false, manual: false, homeSpread: game.odds ? String(game.odds.homeSpread) : '',
    total: game.odds ? String(game.odds.total) : '', recordedAt: schedule.data?.fetchedAt ?? new Date().toISOString(),
  };
  const updateMarket = (game: NflScheduledGame, patch: Partial<DKMarketDraft>) => {
    setError('');
    const changesLine = patch.homeSpread !== undefined || patch.total !== undefined;
    const value = { ...getMarket(game), ...patch, ...(changesLine ? { manual: true, recordedAt: new Date().toISOString() } : {}) };
    try { commit(archive => ({ ...archive, marketDrafts: { ...archive.marketDrafts, [`${season}:${game.id}`]: value } })); }
    catch (error) { setError(`Odds were not saved: ${message(error)}`); }
  };
  const usePublicMarket = (game: NflScheduledGame) => {
    try {
      commit(archive => {
        const drafts = { ...archive.marketDrafts };
        delete drafts[`${season}:${game.id}`];
        return { ...archive, marketDrafts: drafts };
      });
      setError('');
    } catch (error) { setError(message(error)); }
  };
  const loadTeam = async (name: string, week: number, savedTeams: TeamSeasonRecord[]) => {
    const team = savedTeams.find(team => team.team === name);
    if (!team) throw new Error(`${name} is missing from Team Library.`);
    if (team.weeks.some(game => game.week === week && game.status === 'bye')) throw new Error(`${name} has a saved bye in week ${week}.`);
    try { return withDepthChart(team, await getNflDepthChart(season, name)); }
    catch (error) {
      const ranked = ['QB', 'RB', 'WR', 'TE'].every(position =>
        team.players.some(player => player.active && player.side === 'offense' && player.position === position && player.depthRank !== undefined));
      if (!ranked) throw new Error(`${name}: depth chart unavailable and saved offensive ranks are incomplete. ${message(error)}`);
      return team;
    }
  };
  const runSlate = async () => {
    if (running.current) return;
    setError(''); setNotice('');
    if (schedule.isError || historyQuery.isError || schedule.isLoading || historyQuery.isLoading) {
      setError('Load the schedule and Team Library successfully before running.'); return;
    }
    if (!games.length) { setError('No upcoming games on this Sunday.'); return; }
    if (stored.storageError) { setError('Resolve the saved-data error before running a new slate.'); return; }
    running.current = true; setBusy(true);
    const frozenGames = structuredClone(games);
    const frozenTeams = structuredClone(teams);
    const frozenMarkets = new Map(frozenGames.map(game => [game.id, structuredClone(getMarket(game))]));
    const slate: DKSlate = {
      id: crypto.randomUUID(), season, sunday, createdAt: new Date().toISOString(), timezone: 'America/Chicago',
      forecasts: [], failures: [],
    };
    setProgress({ completed: 0, total: frozenGames.length, matchup: '' });
    try {
      for (const [index, game] of frozenGames.entries()) {
        const matchup = `${game.awayTeam} at ${game.homeTeam}`;
        setProgress({ completed: index, total: frozenGames.length, matchup });
        await new Promise(resolve => window.setTimeout(resolve, 0));
        try {
          if (!game.timeConfirmed) throw new Error('Kickoff time is unconfirmed. This game was not simulated.');
          if (Date.parse(game.date) <= Date.now()) throw new Error('Kickoff has passed. This game was not simulated.');
          const [awayTeam, homeTeam] = await Promise.all([
            loadTeam(game.awayTeam, game.week, frozenTeams), loadTeam(game.homeTeam, game.week, frozenTeams),
          ]);
          const draft = frozenMarkets.get(game.id)!;
          const input: SimulationInput = {
            away: setupFromHistory(awayTeam, game.week, 'away', game.homeTeam),
            home: setupFromHistory(homeTeam, game.week, 'home', game.awayTeam),
            // No game-day weather feed exists. These assumptions are explicit in the UI and snapshot.
            weather: { temperatureF: 68, windMph: 5, precipitation: 'none' },
            importance: game.seasonType === 'postseason' ? 'playoff' : 'regular',
            seed: crypto.getRandomValues(new Uint32Array(1))[0],
            market: draft.enabled ? {
              enabled: true, homeSpread: draft.homeSpread.trim() ? Number(draft.homeSpread) : undefined,
              total: draft.total.trim() ? Number(draft.total) : undefined, recordedAt: draft.recordedAt,
              source: draft.manual ? 'manual' : game.odds ? 'ESPN' : 'manual',
              provider: draft.manual ? 'Manual entry' : game.odds?.provider,
              awayTeam: game.awayTeam, homeTeam: game.homeTeam, gameId: game.id, season, week: game.week, kickoff: game.date,
            } : undefined,
          };
          const forecast = gameForecast(game, input, simulateEnsemble(input, 200));
          forecast.generatedAt = new Date().toISOString();
          if (Date.parse(game.date) <= Date.now()) throw new Error('Kickoff passed while preparing this forecast. It was not saved.');
          slate.forecasts.push(forecast);
        } catch (error) { slate.failures.push({ gameId: game.id, matchup, reason: message(error) }); }
        setProgress({ completed: index + 1, total: frozenGames.length, matchup });
      }
      if (!slate.forecasts.length) throw new Error(`No games completed. ${slate.failures.map(item => `${item.matchup}: ${item.reason}`).join(' ')}`);
      // Quota/corruption errors leave earlier archive entries untouched.
      commit(archive => addDKSlate(archive, { ...slate, savedAt: new Date().toISOString() }));
      setSelectedSlateId(slate.id);
      setNotice(`${slate.forecasts.length} game(s) saved on this browser.${slate.failures.length ? ` ${slate.failures.length} failed; see the exclusion list.` : ''}`);
    } catch (error) { setError(`Slate was not saved: ${message(error)}`); }
    finally { running.current = false; setBusy(false); }
  };
  const saveOfficial = (score: Omit<DKOfficialScore, 'enteredAt' | 'season'>) => {
    setError('');
    try {
      const entry = { ...score, season, enteredAt: new Date().toISOString() };
      validateOfficialScore(entry, teams);
      commit(archive => setOfficialScore(archive, entry));
      setNotice('Official DK points saved separately from forecasts and Team Library statistics.');
      return true;
    } catch (error) { setError(`Actual points were not saved: ${message(error)}`); return false; }
  };
  const removeOfficial = (team: string, playerId: string, week: number) => {
    try {
      commit(archive => ({ ...archive, official: archive.official.filter(score =>
        !(score.season === season && score.team === team && score.playerId === playerId && score.week === week)) }));
      setNotice('Manual official score removed; recorded-stat subtotal is shown again.');
    } catch (error) { setError(message(error)); }
  };
  const deleteSlate = (id: string) => {
    try {
      commit(archive => ({ ...archive, slates: archive.slates.filter(slate => slate.id !== id) }));
      setSelectedSlateId(''); setNotice('Saved slate removed.');
    } catch (error) { setError(message(error)); }
  };
  const exportArchive = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(stored.archive, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `gridiron-draftkings-${season}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return {
    season, schedule, historyQuery, sundays, sundayOptions, sunday, setSunday: setSelectedSunday, games, slates,
    activeSlate, selectSlate: setSelectedSlateId, actualHistory, projections, accuracy, busy, progress,
    error, notice, storageError: stored.storageError, runSlate, getMarket, updateMarket, usePublicMarket,
    saveOfficial, removeOfficial, deleteSlate, exportArchive, reloadArchive,
    refresh: () => { void schedule.refetch(); void historyQuery.refetch(); },
  };
}
export type DraftKingsBoardController = ReturnType<typeof useDraftKingsBoard>;