import type { DraftKingsAccuracyReport } from '@/lib/draftkings-accuracy';

const points = (n: number | null) => n === null ? '—' : n.toFixed(2);
const direction = (n: number | null) => n === null ? '—' : Math.abs(n) < 0.005 ? 'Balanced' : `${n > 0 ? 'High' : 'Low'} by ${Math.abs(n).toFixed(2)}`;

export default function DraftKingsAccuracy({ report, season, loading, failed, refresh }: {
  report: DraftKingsAccuracyReport; season: number; loading: boolean; failed: boolean; refresh: () => void;
}) {
  const { overall, positions, skipped } = report;
  return <details className="panel dk-accuracy" data-testid="dk-accuracy-report" open={new URLSearchParams(window.location.search).get('section') === 'accuracy' || undefined}>
    <summary>Accuracy report <span className="dk-muted">{!loading && !failed ? `· ${overall.count} matched player-games` : ''}</span></summary>
    {loading ? <p role="status">Loading actual results…</p> : failed ? <p role="alert">Could not load actual results. <button className="text-button" onClick={refresh}>Retry</button></p> : <>
      <p className="dk-short">{season} · All saved slates in this browser. Uses the last forecast saved before kickoff for each game, so repeat runs do not count twice.</p>
      {overall.count === 0 ? <p className="dk-note" data-testid="dk-accuracy-empty">No complete comparisons yet. Save new Sunday projections before kickoff. After games finish, import and save their actual history in Team Library, then enter official DK points under Actual → tap a player. Partial results and missing scores never count as zero.</p> : <>
        <div className="dk-accuracy-stats">
          <div><span>Matched games</span><strong>{overall.games}</strong></div>
          <div><span>Average miss · DK pts</span><strong>{points(overall.meanAbsoluteError)}</strong></div>
          <div><span>Prediction direction</span><strong>{direction(overall.bias)}</strong></div>
        </div>
        <div className="player-table-wrap"><table className="player-table" aria-label="DraftKings prediction accuracy by position">
          <thead><tr><th>Position</th><th>Player-games</th><th>Avg miss</th><th>Direction</th></tr></thead>
          <tbody>{positions.map(p => <tr key={p.position} data-testid={`dk-accuracy-${p.position}`}><td>{p.position}</td><td>{p.count}</td><td>{points(p.meanAbsoluteError)}</td><td>{direction(p.bias)}</td></tr>)}</tbody>
        </table></div>
        <p className="dk-short">Average miss ignores direction; lower is better. High/Low is the average projected-minus-actual difference. Small samples are not reliable evidence of improvement.</p>
      </>}
      <details className="dk-accuracy-method"><summary>What is counted and excluded?</summary>
        <p className="dk-short">Only complete recorded scoring lines or official points entered by you, matched by season, game, team, player ID and week. Inactive players are not assigned zero. These results describe your saved forecasts; they do not independently verify pregame availability or prove that 1x improves accuracy. The model is not automatically changed.</p>
        <ul className="dk-short">
          <li>{skipped.timing} game forecasts lack valid pregame generation/save times, or were saved after kickoff. Older saved slates remain available but are excluded from this report.</li>
          <li>{skipped.duplicateForecasts} repeat game forecasts replaced by the latest eligible run.</li>
          <li>{skipped.unavailable} player-games are upcoming or lack a complete actual result.</li>
          <li>{skipped.partial} player-games have partial scoring only.</li>
          <li>{skipped.mismatch} player-games have mismatched game/roster data, invalid predictions or invalid actual-entry times.</li>
        </ul>
      </details>
    </>}
  </details>;
}