import { Router, type IRouter } from "express";
import healthRouter from "./health";
import seasonTeamsRouter from "./season-teams";

const router: IRouter = Router();

router.use(healthRouter);
router.use(seasonTeamsRouter);

export default router;
