import { Router } from "express";
import { getDashboardStats } from "../controllers/dashboardController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken);

router.get("/", getDashboardStats);

export default router;
