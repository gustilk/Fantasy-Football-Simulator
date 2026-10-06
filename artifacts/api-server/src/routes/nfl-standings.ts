import { Router, type IRouter } from 'express';
import { GetNflStandingsResponse } from '@workspace/api-zod';
import { getNflStandings } from '../lib/nfl-standings';
const router: IRouter = Router();
router.get('/nfl-standings/:season', async (req, res) => {
  const season = Number(req.params.season);
  const week = req.query.week === undefined ? undefined : Number(req.query.week);
  if (!Number.isInteger(season) || season < 2002 || season > 2100
    || (week !== undefined && (!Number.isInteger(week) || week < 1 || week > 18))) {
    res.status(400).json({ error: 'Choose a valid NFL season and entering week (1–18).' }); return;
  }
  try {
    res.set('Cache-Control', 'no-store').json(GetNflStandingsResponse.parse(await getNflStandings(season, week)));
  } catch (error) {
    req.log.warn({ err: error }, 'NFL standings retrieval failed');
    res.status(502).json({ error: error instanceof Error ? error.message : 'ESPN standings could not be loaded. Saved data is unchanged.' });
  }
});
export default router;
