import { Router, type IRouter } from 'express';
import { GetNflAdvancedStatsParams, GetNflAdvancedStatsResponse, GetNflMatchupEvidenceParams } from '@workspace/api-zod';
import { NFL_TEAM_CODES } from '../lib/nfl-advanced-data';
import { getAdvancedNflStats } from '../lib/nfl-advanced-source';

const router: IRouter = Router();
router.get('/nfl-matchup-evidence/:season/:team/:beforeWeek/:window', async (req, res): Promise<void> => {
  // Numeric enum path params arrive as strings; generated literal validators
  // intentionally don't coerce those (unlike the integer path validators).
  const params = GetNflMatchupEvidenceParams.safeParse({ ...req.params,
    window: /^(4|18)$/.test(String(req.params.window)) ? Number(req.params.window) : NaN });
  if (!params.success || !Object.values(NFL_TEAM_CODES).includes(params.data.team)) {
    res.status(400).json({ error: 'Choose a valid team, season, cutoff and four-game/prior-season window.' }); return;
  }
  try {
    const p = params.data;
    res.set('Cache-Control', 'no-store').json(GetNflAdvancedStatsResponse.parse(await getAdvancedNflStats(p.season, p.team, p.beforeWeek, p.window)));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Football evidence unavailable; no invented data substituted.' });
  }
});
router.get('/nfl-advanced/:season/:team/:beforeWeek', async (req, res): Promise<void> => {
  const params = GetNflAdvancedStatsParams.safeParse(req.params);
  if (!params.success || !Object.values(NFL_TEAM_CODES).includes(params.data.team)) {
    res.status(400).json({ error: 'Choose a valid NFL team, season and cutoff week 1–19.' }); return;
  }
  try {
    res.json(GetNflAdvancedStatsResponse.parse(await getAdvancedNflStats(params.data.season, params.data.team, params.data.beforeWeek)));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Advanced NFL source could not be verified. No invented data was substituted.' });
  }
});
export default router;