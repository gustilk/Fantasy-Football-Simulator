import type { MarketEvidence } from '@/lib/market-odds';

export default function MarketOddsSummary({ market, away, home }: { market: MarketEvidence; away: string; home: string }) {
  return <section className="market-summary" aria-labelledby="market-summary-title" data-testid="market-summary">
    <div className="content-heading" id="market-summary-title">MARKET BLEND · {Math.round(market.blend * 100)}% OUTCOME WEIGHTING</div>
    <p className="ensemble-note">{market.provider} · {market.source === 'ESPN' ? 'Public feed' : 'Manual entry'} · recorded {new Date(market.recordedAt).toLocaleString()}. Home spread {market.homeSpread > 0 ? '+' : ''}{market.homeSpread} · O/U {market.total}.</p>
    <div className="player-table-wrap"><table className="market-comparison">
      <thead><tr><th>Team</th><th>Market implied</th><th>Original model average</th><th>Market-weighted average</th></tr></thead>
      <tbody>
        <tr><th scope="row">{away}</th><td>{market.implied.away.toFixed(2)}</td><td>{market.baseline.away.toFixed(2)}</td><td>{market.weighted.away.toFixed(2)}</td></tr>
        <tr><th scope="row">{home}</th><td>{market.implied.home.toFixed(2)}</td><td>{market.baseline.home.toFixed(2)}</td><td>{market.weighted.home.toFixed(2)}</td></tr>
      </tbody>
    </table></div>
    <p className="ensemble-note">Effective sample size: {market.effectiveRuns.toFixed(1)} games after weighting. Win percentages, average DK projections, and ranges are market-weighted; the displayed score, drive log, DK PTS, and 20+ section remain one unweighted example game. No player receives fixed or guaranteed points.</p>
    {market.warnings.map(warning => <p className="history-warning" key={warning}>{warning}</p>)}
    <p className="ensemble-note">Original and weighted averages above use the same generated games. Turn odds off to use the original model. Accuracy improvement has not been validated; testing must use lines recorded before kickoff and paired seeds.</p>
  </section>;
}