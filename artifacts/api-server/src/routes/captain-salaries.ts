import { Router, type IRouter } from 'express';
import { GetCaptainSalaryResponse } from '@workspace/api-zod';
import { CaptainUnavailable, fetchCaptainSalaries, validateCaptainMatchup } from '../lib/captain-salaries';

const router: IRouter = Router();
router.get('/draftkings/captain/:season', async (req, res) => {
  const { awayTeam, homeTeam, kickoff } = req.query;
  if (typeof awayTeam !== 'string' || typeof homeTeam !== 'string' || typeof kickoff !== 'string') {
    res.status(400).json({ error: 'Select the away team, home team and confirmed kickoff.' }); return;
  }
  const matchup = { season: Number(req.params.season), awayTeam, homeTeam, kickoff };
  try { validateCaptainMatchup(matchup); }
  catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid matchup.' }); return;
  }
  try {
    const result = GetCaptainSalaryResponse.parse(await fetchCaptainSalaries(matchup));
    res.set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    req.log.warn({ err: error }, 'Captain salary retrieval failed');
    res.status(error instanceof CaptainUnavailable ? 404 : 502).json({
      error: error instanceof Error ? error.message : 'Could not retrieve DraftKings Captain salaries. Your saved salaries have not changed.',
    });
  }
});
export default router;
