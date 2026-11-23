import { generateRandomManualLineups } from './random-manual-lineups';
import type { ManualSalaryCandidate } from './manual-lineups';

self.onmessage = (event: MessageEvent<{ players: ManualSalaryCandidate[]; count: number }>) => {
  try {
    if (event.data.players.some(player => Date.parse(player.kickoff) <= Date.now() || !Number.isFinite(Date.parse(player.kickoff)))) {
      throw new Error('A game has started. Refresh the pool before generating pregame lineups.');
    }
    const lineups = generateRandomManualLineups(event.data.players, event.data.count);
    if (event.data.players.some(player => Date.parse(player.kickoff) <= Date.now())) {
      throw new Error('A game started during generation. These lineups were not returned.');
    }
    self.postMessage({ lineups });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Lineup generation failed.' });
  }
};
