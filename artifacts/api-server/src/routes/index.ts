import { Router, type IRouter } from "express";
import healthRouter from "./health";
import seasonTeamsRouter from "./season-teams";
import nflAdvancedRouter from "./nfl-advanced";
import nflImportRouter from "./nfl-import";
import salaryFilesRouter from "./salary-files";
import featuredClassicRouter from "./featured-classic";
import captainSalariesRouter from "./captain-salaries";

const router: IRouter = Router();

router.use(healthRouter);
router.use(seasonTeamsRouter);
router.use(nflAdvancedRouter);
router.use(nflImportRouter);
router.use(salaryFilesRouter);
router.use(featuredClassicRouter);
router.use(captainSalariesRouter);

export default router;
