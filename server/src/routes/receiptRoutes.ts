import { Router } from "express";
import { getReceipts, createReceipt, updateReceipt, deleteReceipt } from "../controllers/receiptController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken);

router.get("/", getReceipts);
router.post("/", createReceipt);
router.put("/:id", updateReceipt);
router.delete("/:id", deleteReceipt);

export default router;
