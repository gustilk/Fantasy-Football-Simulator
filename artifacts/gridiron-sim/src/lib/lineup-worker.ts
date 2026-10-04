import { optimizeLineups } from './lineup-optimizer';
import { optimizeTournamentLineups } from './tournament-lineups';
import type { DKSlate } from './draftkings-board';
import type { LineupPlayer } from './lineups';
self.onmessage = (event: MessageEvent<{ players: LineupPlayer[]; count: number; mode?: 'average' | 'tournament'; slate?: DKSlate }>) => {
  try {
    if (event.data.players.some(p => Date.parse(p.kickoff) <= Date.now() || !Number.isFinite(Date.parse(p.kickoff)))) {
      throw new Error('A game has started. Refresh the pool before generating pregame lineups.');
    }
    if (event.data.mode === 'tournament' && !event.data.slate) throw new Error('Select a saved forecast slate for tournament mode.');
    const lineups = event.data.mode === 'tournament'
      ? optimizeTournamentLineups(event.data.players, event.data.slate!, event.data.count)
      : optimizeLineups(event.data.players, event.data.count);
    if (event.data.players.some(p => Date.parse(p.kickoff) <= Date.now())) throw new Error('A game started during generation. These lineups were not returned.');
    self.postMessage({ lineups });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Lineup optimization failed.' }); }
};