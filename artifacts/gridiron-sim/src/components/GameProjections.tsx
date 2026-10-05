import { useState } from 'react';
import type { SimulationResult } from '@/lib/simulator';
import { gameProjections } from '@/lib/game-projections';
import EliteBadge from './EliteBadge';

export default function GameProjections({ result, awayName, homeName }: {
  result: SimulationResult; awayName: string; homeName: string;
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
    </div>
     {result.overview.some(note => note.includes('manually entered standings')) && <details style={{ margin: '0 20px 16px' }}>
       <summary>Division standings and win-pressure context</summary>
       {result.overview.filter(note => note.includes('manually entered standings') || note.includes('manually marked needs') || note.includes('needs-win mark')).map(note => <p className="sim-caption" key={note}>{note}</p>)}
     </details>}
    <div className="sim-projections">
      {!projections ? <p className="history-warning" role="status">This older saved run has no compatible DraftKings averages. Run its week again to generate new projections.</p> : <>
        <p className="sim-caption">Average of {result.ensemble!.runs} simulations{result.ensemble!.market ? ' · odds-adjusted' : ''}. Estimates, not guaranteed points.</p>
        <div className="sim-position-tabs" role="group" aria-label="Player position">
          {['QB', 'RB', 'WR', 'TE'].map(value => <button key={value} className={position === value ? 'on' : ''} aria-pressed={position === value} onClick={() => { setPosition(value); setExpanded(false); }}>{value}</button>)}
        </div>
        <div className="sim-list-heading"><span>Player</span><span>Projected DK</span></div>
        <ol className="sim-player-list" data-testid="player-projections">
          {(expanded ? shown : shown.slice(0, 20)).map((player, index) => <li key={player.id} data-testid={`projection-${player.id}`}>
            <span className="sim-player-rank">{index + 1}</span>
             <div><strong>{player.name}</strong><EliteBadge player={player} /><span>{player.team}</span></div>
            <strong className="sim-player-points">{player.mean.toFixed(2)}</strong>
          </li>)}
        </ol>
        {shown.length > 20 && <button className="btn-secondary" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show top 20' : `Show all ${shown.length} players`}</button>}
        {!shown.length && <p className="sim-caption">No {position} players were included in this run.</p>}
      </>}
    </div>
  </>;
}