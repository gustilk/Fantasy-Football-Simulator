import { optimizeLineups } from './lineup-optimizer';
import type { LineupPlayer } from './lineups';
self.onmessage = (event: MessageEvent<{ players: LineupPlayer[]; count: number }>) => {
  try {
    if (event.data.players.some(p => Date.parse(p.kickoff) <= Date.now() || !Number.isFinite(Date.parse(p.kickoff)))) {
      throw new Error('A game has started. Refresh the pool before generating pregame lineups.');
    }
    self.postMessage({ lineups: optimizeLineups(event.data.players, event.data.count) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Lineup optimization failed.' }); }
};