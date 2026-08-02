import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { getSettingsForUser, updateSettingsForUser } from "../services/settingsService.js";

export async function getSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const settings = await getSettingsForUser(userId);
    res.json(settings);
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const settings = await updateSettingsForUser(userId, req.body);
    res.json(settings);
  } catch (error) {
    next(error);
  }
}
