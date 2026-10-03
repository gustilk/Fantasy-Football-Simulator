import { Router, type IRouter } from "express";
import healthRouter from "./health";
import seasonTeamsRouter from "./season-teams";
import nflImportRouter from "./nfl-import";

const router: IRouter = Router();

router.use(healthRouter);
router.use(seasonTeamsRouter);
router.use(nflImportRouter);

export default router;
