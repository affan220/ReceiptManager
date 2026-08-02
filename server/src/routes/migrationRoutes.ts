import { Router } from "express";
import { importLocalStorageData } from "../controllers/migrationController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken);

router.post("/import-localstorage", importLocalStorageData);

export default router;
