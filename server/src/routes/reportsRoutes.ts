import { Router } from "express";
import { getReports } from "../controllers/reportsController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken);

router.get("/", getReports);

export default router;
