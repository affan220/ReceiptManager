import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { getReportsForUser } from "../services/reportsService.js";

export async function getReports(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const reports = await getReportsForUser(userId);
    res.json(reports);
  } catch (error) {
    next(error);
  }
}
