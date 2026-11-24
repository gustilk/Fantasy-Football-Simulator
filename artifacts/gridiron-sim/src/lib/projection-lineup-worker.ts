import { generateProjectionLineups, type ProjectionLineupOptions } from './projection-lineups';
import type { LineupPlayer } from './lineups';
import type { DKSlate } from './draftkings-board';

self.onmessage = (event: MessageEvent<{ players: LineupPlayer[]; slate: DKSlate; options: ProjectionLineupOptions }>) => {
  try {
    const { players, slate, options } = event.data;
    if (players.some(player => Date.parse(player.kickoff) <= Date.now() || !Number.isFinite(Date.parse(player.kickoff)))) {
      throw new Error('A game has started. Refresh the pool before generating pregame lineups.');
    }
    const portfolio = generateProjectionLineups(players, slate, options);
    if (players.some(player => Date.parse(player.kickoff) <= Date.now())) {
      throw new Error('A game started during generation. These lineups were not returned.');
    }
    self.postMessage({ portfolio });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Lineup generation failed.' });
  }
};
