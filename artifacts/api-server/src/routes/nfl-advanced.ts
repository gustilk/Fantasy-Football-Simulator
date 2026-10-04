import { Router, type IRouter } from 'express';
import { GetNflAdvancedStatsParams, GetNflAdvancedStatsResponse } from '@workspace/api-zod';
import { NFL_TEAM_CODES } from '../lib/nfl-advanced-data';
import { getAdvancedNflStats } from '../lib/nfl-advanced-source';

const router: IRouter = Router();
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