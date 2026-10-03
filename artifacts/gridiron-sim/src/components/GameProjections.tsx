import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { SimulationResult } from '@/lib/simulator';
import { gameProjections } from '@/lib/game-projections';

export default function GameProjections({ result, awayName, homeName, onRun, busy }: {
  result: SimulationResult; awayName: string; homeName: string; onRun: () => void; busy: boolean;
}) {
  const [position, setPosition] = useState('QB');
  const [expanded, setExpanded] = useState(false);
  const projections = gameProjections(result);
  const shown = projections?.filter(player => player.position === position) ?? [];
  return <>
    <div className="result-topline">
      <div>
        <h2 id="results-title">Projected fantasy points</h2>
        <p className="sim-caption">{awayName} at {homeName}</p>
      </div>
      <button className="icon-button" aria-label="Run again" onClick={onRun} disabled={busy} data-testid="button-rerun"><RotateCw size={16} /></button>
    </div>
    <div className="sim-projections">
      {!projections ? <p className="history-warning" role="status">This older saved run has no compatible DraftKings averages. Run again to generate projections.</p> : <>
        <p className="sim-caption">Average of {result.ensemble!.runs} simulations{result.ensemble!.market ? ' · odds-adjusted' : ''}. Estimates, not guaranteed points.</p>
        <div className="sim-position-tabs" role="group" aria-label="Player position">
          {['QB', 'RB', 'WR', 'TE'].map(value => <button key={value} className={position === value ? 'on' : ''} aria-pressed={position === value} onClick={() => { setPosition(value); setExpanded(false); }}>{value}</button>)}
        </div>
        <div className="sim-list-heading"><span>Player</span><span>Projected DK</span></div>
        <ol className="sim-player-list" data-testid="player-projections">
          {(expanded ? shown : shown.slice(0, 10)).map((player, index) => <li key={player.id} data-testid={`projection-${player.id}`}>
            <span className="sim-player-rank">{index + 1}</span>
            <div><strong>{player.name}</strong><span>{player.team}</span></div>
            <strong className="sim-player-points">{player.mean.toFixed(2)}</strong>
          </li>)}
        </ol>
        {shown.length > 10 && <button className="btn-secondary" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show top 10' : `Show all ${shown.length} players`}</button>}
        {!shown.length && <p className="sim-caption">No {position} players were included in this run.</p>}
      </>}
    </div>
  </>;
}