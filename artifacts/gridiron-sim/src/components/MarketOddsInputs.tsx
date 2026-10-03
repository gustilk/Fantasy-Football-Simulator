import { impliedMarketScores, validateMarketOdds, type MarketOdds } from '@/lib/market-odds';

function localDateTime(value?: string) {
  const date = new Date(value ?? '');
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function MarketOddsInputs({ market, away, home, season, week, busy, onChange }: {
  market?: MarketOdds; away: string; home: string; season: number; week: number; busy: boolean;
  onChange: (market: MarketOdds | undefined) => void;
}) {
  const defaults: MarketOdds = { enabled: false, source: 'manual', awayTeam: away, homeTeam: home, season, week, recordedAt: new Date().toISOString() };
  const current = market ?? defaults;
  const patch = (changes: Partial<MarketOdds>, manual = true) => onChange({
    ...current, recordedAt: current.recordedAt ?? new Date().toISOString(), ...changes,
    ...(manual ? {
      source: 'manual' as const,
      provider: changes.provider ?? (current.source === 'ESPN' ? `${current.provider ?? 'Public quote'} (manual override)` : current.provider),
    } : {}),
  });
  let implied: ReturnType<typeof impliedMarketScores> | undefined;
  let validation = '';
  try {
    if (current.homeSpread !== undefined && current.total !== undefined) implied = impliedMarketScores(current.homeSpread, current.total);
    if (current.enabled) validateMarketOdds(current, away, home);
  } catch (error) { validation = error instanceof Error ? error.message : 'Check the market inputs.'; }
  return <section className="market-inputs" aria-labelledby="market-inputs-title" data-testid="market-inputs">
    <h3 className="section-mini-title" id="market-inputs-title">OPTIONAL VEGAS / MARKET ODDS</h3>
    <label className="market-toggle"><input type="checkbox" checked={current.enabled} disabled={busy}
      onChange={event => patch({ enabled: event.target.checked }, false)} data-testid="market-enabled" /> Blend odds into simulation averages</label>
    <p className="stats-help">Off by default. Select a scheduled game to prefill available public odds, or enter your own. Changing teams, week, or season clears these matchup-specific lines.</p>
    <div className="form-grid">
      <div className="field"><label htmlFor="market-spread">Home spread · {home}</label>
        <input id="market-spread" type="number" min="-40" max="40" step="0.5" placeholder="Example: -6" disabled={busy}
          value={current.homeSpread ?? ''} onChange={event => patch({ homeSpread: event.target.value === '' ? undefined : Number(event.target.value) })} />
        <span className="input-help">Negative = home favored. Positive = away favored.</span>
      </div>
      <div className="field"><label htmlFor="market-total">Over/under · combined points</label>
        <input id="market-total" type="number" min="10" max="100" step="0.5" placeholder="Example: 48" disabled={busy}
          value={current.total ?? ''} onChange={event => patch({ total: event.target.value === '' ? undefined : Number(event.target.value) })} />
      </div>
      <div className="field"><label htmlFor="market-provider">Sportsbook / source label</label>
        <input id="market-provider" value={current.provider ?? ''} placeholder="Manual entry" maxLength={100} disabled={busy}
          onChange={event => patch({ provider: event.target.value })} />
      </div>
      <div className="field"><label htmlFor="market-recorded">Recorded at · local time</label>
        <input id="market-recorded" type="datetime-local" disabled={busy} value={localDateTime(current.recordedAt)}
          onChange={event => patch({ recordedAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })} />
      </div>
    </div>
    {implied && <p className="stats-help"><strong>Market-implied points:</strong> {away} {implied.away.toFixed(2)} · {home} {implied.home.toFixed(2)}. These are not forced final scores.</p>}
    {market?.source === 'ESPN' && <p className="stats-help">Prefilled from ESPN’s public {market.provider} quote. Recorded at is the retrieval time, not a verified sportsbook update time. Editing a value marks it as a manual override.</p>}
    {current.enabled && Date.now() - Date.parse(current.recordedAt ?? '') > 86_400_000 && <p className="history-warning">Odds are more than 24 hours old. Verify the line and its recorded-at time.</p>}
    {validation && <p className="history-warning" role="alert">{validation}</p>}
    <p className="stats-help">When enabled: 65% original outcome weighting + 35% weighting toward games compatible with the spread and total. No extra rating or home-field bonus is added. Player roles and availability stay unchanged. This is an unvalidated heuristic, not a guarantee or a betting recommendation.</p>
    {market && <button className="text-button" disabled={busy} onClick={() => onChange(undefined)}>Clear odds / use original model</button>}
  </section>;
}