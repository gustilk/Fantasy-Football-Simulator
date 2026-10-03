import { Router, type IRouter } from "express";
import { GetNflDepthChartParams, GetNflDepthChartResponse, PreviewNflTeamParams, PreviewNflTeamResponse } from "@workspace/api-zod";
import { NflSourceError, previewNflTeam, getNflDepthChart } from "../lib/nfl-source";

const router: IRouter = Router();
router.get("/nfl-depth-chart/:season/:team", async (req, res): Promise<void> => {
  const parsed = GetNflDepthChartParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Choose a valid NFL team and season." }); return; }
  try {
    res.json(GetNflDepthChartResponse.parse(await getNflDepthChart(parsed.data.season, parsed.data.team)));
  } catch (error) {
    res.status(error instanceof NflSourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : "Depth chart unavailable." });
  }
});
router.post("/nfl-import/:season/:team", async (req, res): Promise<void> => {
  const parsed = PreviewNflTeamParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Choose a valid NFL team and season from 2000 to 2100." }); return; }
  try {
    const preview = await previewNflTeam(parsed.data.season, parsed.data.team);
    res.json(PreviewNflTeamResponse.parse(preview));
  } catch (error) {
    res.status(error instanceof NflSourceError ? error.status : 502).json({
      error: error instanceof NflSourceError ? error.message : "The source returned an unexpected data format. Nothing was saved. Try again later.",
    });
  }
});
export default router;