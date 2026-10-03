import { getDivision, isDivisionGame } from '@/lib/nfl-divisions';

export default function DivisionMatchup({ team, opponent }: { team: string; opponent: string }) {
  if (!team || !opponent) return null;
  const division = getDivision(team), other = getDivision(opponent);
  const same = team.trim().toLowerCase() === opponent.trim().toLowerCase();
  const divisional = isDivisionGame(team, opponent);
  return <div className={`division-matchup${divisional ? ' divisional' : ''}`} data-testid="division-matchup" role="status">
    <strong>{same ? 'Choose two different teams' : divisional ? `Division game · ${division}` : division && other ? 'Non-division game' : 'Division unknown'}</strong>
    <span>{team} · {division ?? 'Unknown division'}<br />{opponent} · {other ?? 'Unknown division'}</span>
    <small>{divisional ? 'Familiar opponents. No automatic difficulty or fantasy-point penalty; recorded head-to-head stats can inform the model.' : 'Division labels alone do not change simulation probabilities.'} Current NFL alignment.</small>
  </div>;
}