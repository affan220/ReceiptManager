import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import {
  getReceiptsForUser,
  createReceiptForUser,
  updateReceiptForUser,
  deleteReceiptForUser,
} from "../services/receiptService.js";

export async function getReceipts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const receipts = await getReceiptsForUser(userId);
    res.json(receipts);
  } catch (error) {
    next(error);
  }
}

export async function createReceipt(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const receipt = await createReceiptForUser(userId, req.body);
    res.status(201).json(receipt);
  } catch (error) {
    next(error);
  }
}

export async function updateReceipt(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id), 10);
    const receipt = await updateReceiptForUser(id, userId, req.body);
    res.json(receipt);
  } catch (error) {
    next(error);
  }
}

export async function deleteReceipt(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id), 10);
    await deleteReceiptForUser(id, userId);
    res.json({ message: "Receipt deleted successfully" });
  } catch (error) {
    next(error);
  }
}
