import { Router, type IRouter } from 'express';
import { GetFeaturedClassicSalaryResponse } from '@workspace/api-zod';
import { fetchFeaturedClassic, FeaturedClassicUnavailable } from '../lib/featured-classic';

const router: IRouter = Router();
router.get('/draftkings/featured-classic/:season', async (req, res) => {
  const season = Number(req.params.season);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    res.status(400).json({ error: 'Invalid NFL season.' }); return;
  }
  try {
    const result = GetFeaturedClassicSalaryResponse.parse(await fetchFeaturedClassic(season));
    res.set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    req.log.warn({ err: error }, 'Featured Classic salary retrieval failed');
    res.status(error instanceof FeaturedClassicUnavailable ? 404 : 502).json({
      error: error instanceof Error ? error.message : 'Could not retrieve DraftKings Featured Classic salaries. Your saved salaries have not changed.',
    });
  }
});
export default router;
