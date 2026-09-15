import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import coursesRouter from "./courses";
import materialsRouter from "./materials";
import studyRouter from "./study";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(coursesRouter);
router.use(materialsRouter);
router.use(studyRouter);

export default router;
