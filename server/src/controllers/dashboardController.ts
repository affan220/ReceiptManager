import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { getDashboardStatsForUser } from "../services/dashboardService.js";

export async function getDashboardStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const stats = await getDashboardStatsForUser(userId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
}
