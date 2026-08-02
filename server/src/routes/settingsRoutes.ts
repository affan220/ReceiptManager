import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settingsController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken);

router.get("/", getSettings);
router.put("/", updateSettings);

export default router;
