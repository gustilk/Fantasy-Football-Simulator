import { Trophy } from 'lucide-react';
import { groupFantasyLeaders } from '@/lib/fantasy-leaders';

type ScoredPlayer = { name: string; team: string; position: string; draftKings: number };

export default function FantasyLeaders({ players }: { players: ScoredPlayer[] }) {
  const groups = groupFantasyLeaders(players);
  const count = groups.reduce((total, group) => total + group.players.length, 0);
  return <section className="fantasy-leaders" aria-labelledby="fantasy-leaders-title" data-testid="fantasy-leaders">
    <div className="content-heading" id="fantasy-leaders-title">
      <Trophy size={15} className="heading-icon" /> 20+ DRAFTKINGS POINTS
      <span className="panel-index">{count} PLAYERS</span>
    </div>
    <p className="ensemble-note">Players from both teams with at least 20 DK PTS in the displayed simulated game, ranked highest to lowest within each position. These are game points, not average projections.</p>
    <div className="fantasy-leaders-grid">
      {groups.map(group => <section className="fantasy-leader-group" key={group.position} aria-labelledby={`fantasy-leaders-${group.position}`}>
        <h3 id={`fantasy-leaders-${group.position}`}>{group.label} <span>{group.players.length}</span></h3>
        {group.players.length ? <ol>
          {group.players.map((player, index) => <li key={`${player.team}-${player.name}-${index}`}>
            <div><strong>{player.name}</strong><span>{player.team}</span></div>
            <strong className="fantasy-leader-points">{player.draftKings.toFixed(2)}</strong>
          </li>)}
        </ol> : <p className="fantasy-leader-empty">No players reached 20 points.</p>}
      </section>)}
    </div>
  </section>;
}