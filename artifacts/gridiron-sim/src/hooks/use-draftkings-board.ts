import { useEffect, useMemo, useRef, useState } from 'react';
import { getNflDepthChart, getGetNflScheduleQueryKey, getListSeasonTeamsQueryKey, useGetNflSchedule, useListSeasonTeams, type NflScheduledGame, type TeamSeasonRecord } from '@workspace/api-client-react';
import { withDepthChart } from '@/lib/depth-chart';
import { footballSetup } from '@/lib/football-evidence';
import { loadFootballReports } from '@/lib/load-football-evidence';
import { simulateEnsemble } from '@/lib/ensemble';
import { applyStandings, findStandings, readStandings } from '@/lib/standings';
import {
  availableSundayOptions, daytimeSundaySlate, dkHistory, gameForecast, slateBoard, sundayGames, validateOfficialScore,
  type DKMarketDraft, type DKOfficialScore, type DKSlate,
} from '@/lib/draftkings-board';
import {
  addDKSlate, DK_ARCHIVE_KEY, emptyDKArchive, setOfficialScore, type DKArchive,
} from '@/lib/draftkings-archive';
import { readBrowserDKArchive, updateBrowserDKArchive } from '@/lib/draftkings-storage';
import type { SimulationInput } from '@/lib/simulator';
import { draftKingsAccuracy } from '@/lib/draftkings-accuracy';

const message = (error: unknown) => error instanceof Error ? error.message : 'The operation failed. Please retry.';
// Retain a failed-save run across in-app tab navigation, but never call it saved.
let pendingSlate: DKSlate | null = null;
const warnUnsaved = (event: BeforeUnloadEvent) => { if (pendingSlate) { event.preventDefault(); event.returnValue = ''; } };
function initialArchive(): { archive: DKArchive; storageError: string } {
  return { archive: emptyDKArchive(), storageError: '' };
}
export function useDraftKingsBoard(season: number) {
  const schedule = useGetNflSchedule(season, undefined, { query: { queryKey: getGetNflScheduleQueryKey(season), staleTime: 300_000, retry: false } });
  const historyQuery = useListSeasonTeams({ season }, { query: { queryKey: getListSeasonTeamsQueryKey({ season }), staleTime: 60_000, retry: false } });
  const [stored, setStored] = useState(initialArchive);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [unsavedSlate, setUnsavedSlate] = useState<DKSlate | null>(pendingSlate);
  const rememberUnsaved = (slate: DKSlate | null) => {
    pendingSlate = slate; setUnsavedSlate(slate);
    if (slate) window.addEventListener('beforeunload', warnUnsaved);
    else window.removeEventListener('beforeunload', warnUnsaved);
  };
  const channel = useRef<BroadcastChannel | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedSunday, setSelectedSunday] = useState('');
  const [selectedSlateId, setSelectedSlateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const settingsWrites = useRef(0);
  const [progress, setProgress] = useState({ completed: 0, total: 0, matchup: '' });
  const running = useRef(false);
  useEffect(() => { setSelectedSunday(''); setSelectedSlateId(''); }, [season]);
  const teams = historyQuery.data ?? [];
  const sundayOptions = useMemo(() => availableSundayOptions(schedule.data?.games ?? []), [schedule.data]);
  const sundays = useMemo(() => sundayOptions.map(option => option.value), [sundayOptions]);
  const sunday = selectedSunday || sundays[0] || '';
  const games = useMemo(() => sunday ? sundayGames(schedule.data?.games ?? [], sunday) : [], [schedule.data, sunday]);
  const slates = [...(unsavedSlate ? [unsavedSlate] : []), ...stored.archive.slates].filter(slate => slate.season === season);
  const savedSlate = slates.find(slate => slate.id === selectedSlateId) ?? slates[0] ?? null;
  const activeSlate = useMemo(() => savedSlate ? daytimeSundaySlate(savedSlate, schedule.data?.games ?? []) : null, [savedSlate, schedule.data]);
  const actualHistory = useMemo(() => dkHistory(teams, season, stored.archive.official), [teams, season, stored.archive.official]);
  const projections = useMemo(() => activeSlate ? slateBoard(activeSlate, actualHistory) : [], [activeSlate, actualHistory]);
  const accuracy = useMemo(() => draftKingsAccuracy(stored.archive.slates.map(slate => daytimeSundaySlate(slate, schedule.data?.games ?? [])), teams, stored.archive.official, season), [stored.archive, teams, season, schedule.data]);

  const reloadArchive = async () => {
    setArchiveLoading(true);
    try { setStored({ archive: await readBrowserDKArchive(), storageError: '' }); }
    catch (error) { setStored(previous => ({ ...previous, storageError: message(error) })); }
    finally { setArchiveLoading(false); }
  };
  useEffect(() => {
    void reloadArchive();
    const listener = (event: StorageEvent) => { if (event.key === DK_ARCHIVE_KEY) void reloadArchive(); };
    const focus = () => { void reloadArchive(); };
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(DK_ARCHIVE_KEY);
      channel.current.onmessage = focus;
    }
    window.addEventListener('storage', listener);
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('storage', listener); window.removeEventListener('focus', focus); channel.current?.close(); channel.current = null; };
  }, []);
  const commit = async (change: (archive: DKArchive) => DKArchive) => {
    const next = await updateBrowserDKArchive(change);
    setStored({ archive: next, storageError: '' });
    try { channel.current?.postMessage('updated'); }
    catch (error) { console.warn('DraftKings data saved, but another tab could not be notified.', error); }
  };
  const getMarket = (game: NflScheduledGame): DKMarketDraft => stored.archive.marketDrafts?.[`${season}:${game.id}`] ?? {
    enabled: false, manual: false, homeSpread: game.odds ? String(game.odds.homeSpread) : '',
    total: game.odds ? String(game.odds.total) : '', recordedAt: schedule.data?.fetchedAt ?? new Date().toISOString(),
  };
  const updateMarket = async (game: NflScheduledGame, patch: Partial<DKMarketDraft>) => {
    if (running.current) return;
    settingsWrites.current++; setSavingSettings(true);
    setError('');
    const changesLine = patch.homeSpread !== undefined || patch.total !== undefined;
    const recordedAt = new Date().toISOString();
    try { await commit(archive => {
      const value = { ...(archive.marketDrafts?.[`${season}:${game.id}`] ?? getMarket(game)), ...patch,
        ...(changesLine ? { manual: true, recordedAt } : {}) };
      return { ...archive, marketDrafts: { ...archive.marketDrafts, [`${season}:${game.id}`]: value } };
    }); }
    catch (error) { setError(`Matchup settings were not saved: ${message(error)}`); }
    finally { settingsWrites.current--; setSavingSettings(settingsWrites.current > 0); }
  };
  const usePublicMarket = async (game: NflScheduledGame) => {
    if (running.current) return;
    settingsWrites.current++; setSavingSettings(true);
    try {
      await commit(archive => {
        const drafts = { ...archive.marketDrafts };
        drafts[`${season}:${game.id}`] = {
          enabled: false, manual: false, homeSpread: game.odds ? String(game.odds.homeSpread) : '',
          total: game.odds ? String(game.odds.total) : '', recordedAt: schedule.data?.fetchedAt ?? new Date().toISOString(),
          highScoring: drafts[`${season}:${game.id}`]?.highScoring ?? false,
        };
        return { ...archive, marketDrafts: drafts };
      });
      setError('');
    } catch (error) { setError(message(error)); }
    finally { settingsWrites.current--; setSavingSettings(settingsWrites.current > 0); }
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
    if (settingsWrites.current) { setError('Wait for matchup settings to finish saving before running.'); return; }
    setError(''); setNotice('');
    if (schedule.isError || historyQuery.isError || schedule.isLoading || historyQuery.isLoading) {
      setError('Load the schedule and Team Library successfully before running.'); return;
    }
    if (!games.length) { setError('No upcoming games on this Sunday.'); return; }
    if (archiveLoading || unsavedSlate) { setError('Wait for saved data to load, or save/export the unsaved results before another run.'); return; }
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
      const frozenStandings = readStandings(localStorage);
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
          const [awayEvidence, homeEvidence] = await Promise.all([
            loadFootballReports(season, game.awayTeam, game.week), loadFootballReports(season, game.homeTeam, game.week),
          ]);
          if (Date.parse(game.date) <= Date.now()) throw new Error('Kickoff passed while football evidence was loading. This game was not forecast.');
          const input: SimulationInput = {
            driveModel: 'possession-v1',
            secondaryModel: 'secondary-v1',
            away: applyStandings(footballSetup(awayTeam, game.week, 'away', game.homeTeam, awayEvidence), findStandings(frozenStandings, season, game.week), season, game.week),
            home: applyStandings(footballSetup(homeTeam, game.week, 'home', game.awayTeam, homeEvidence), findStandings(frozenStandings, season, game.week), season, game.week),
            // No game-day weather feed exists. These assumptions are explicit in the UI and snapshot.
            weather: { temperatureF: 68, windMph: 5, precipitation: 'none' },
            importance: game.seasonType === 'postseason' ? 'playoff' : 'regular',
            seed: crypto.getRandomValues(new Uint32Array(1))[0],
            ...(draft.highScoring ? { highScoring: true } : {}),
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
      try {
        await commit(archive => addDKSlate(archive, { ...slate, savedAt: new Date().toISOString() }));
      } catch (error) {
        rememberUnsaved(slate); setSelectedSlateId(slate.id);
        throw error;
      }
      setSelectedSlateId(slate.id);
      setNotice(`${slate.forecasts.length} game(s) saved on this browser.${slate.failures.length ? ` ${slate.failures.length} failed; see the exclusion list.` : ''}`);
    } catch (error) { setError(`Slate was not saved: ${message(error)}`); }
    finally { running.current = false; setBusy(false); }
  };
  const saveOfficial = async (score: Omit<DKOfficialScore, 'enteredAt' | 'season'>) => {
    setError('');
    try {
      const entry = { ...score, season, enteredAt: new Date().toISOString() };
      validateOfficialScore(entry, teams);
      await commit(archive => setOfficialScore(archive, entry));
      setNotice('Official DK points saved separately from forecasts and Team Library statistics.');
      return true;
    } catch (error) { setError(`Actual points were not saved: ${message(error)}`); return false; }
  };
  const removeOfficial = async (team: string, playerId: string, week: number) => {
    try {
      await commit(archive => ({ ...archive, official: archive.official.filter(score =>
        !(score.season === season && score.team === team && score.playerId === playerId && score.week === week)) }));
      setNotice('Manual official score removed; recorded-stat subtotal is shown again.');
    } catch (error) { setError(message(error)); }
  };
  const deleteSlate = async (id: string) => {
    if (id === unsavedSlate?.id) { rememberUnsaved(null); setSelectedSlateId(''); setError(''); setNotice('Unsaved results discarded. Saved archives were not changed.'); return; }
    try {
      await commit(archive => ({ ...archive, slates: archive.slates.filter(slate => slate.id !== id) }));
      setSelectedSlateId(''); setNotice('Saved slate removed.');
    } catch (error) { setError(message(error)); }
  };
  const retrySave = async () => {
    if (!unsavedSlate || running.current) return;
    running.current = true; setBusy(true);
    try {
      await commit(archive => addDKSlate(archive, { ...unsavedSlate, savedAt: new Date().toISOString() }));
      setSelectedSlateId(unsavedSlate.id); rememberUnsaved(null); setError('');
      setNotice('The existing results were saved without rerunning the simulations.');
    } catch (error) { setError(`Slate was not saved: ${message(error)}`); }
    finally { running.current = false; setBusy(false); }
  };
  const exportArchive = () => {
    const archive = unsavedSlate ? addDKSlate(stored.archive, unsavedSlate) : stored.archive;
    const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `gridiron-draftkings-${season}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return {
    season, schedule, historyQuery, sundays, sundayOptions, sunday, setSunday: setSelectedSunday, games, slates,
    activeSlate, selectSlate: setSelectedSlateId, actualHistory, projections, accuracy, busy, progress, archiveLoading, unsavedSlate, retrySave,
    error, notice, storageError: stored.storageError, runSlate, getMarket, updateMarket, usePublicMarket, savingSettings,
    saveOfficial, removeOfficial, deleteSlate, exportArchive, reloadArchive,
    refresh: () => { void schedule.refetch(); void historyQuery.refetch(); },
  };
}
export type DraftKingsBoardController = ReturnType<typeof useDraftKingsBoard>;