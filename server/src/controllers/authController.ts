import { Response, NextFunction } from "express";
import { registerUser, loginUser, getUserById } from "../services/authService.js";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";

export async function register(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, password } = req.body;
    const result = await registerUser(username, password);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function login(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, password } = req.body;
    const result = await loginUser(username, password);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getMe(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const user = await getUserById(req.user.id);
    res.json({ user });
  } catch (error) {
    next(error);
  }
}
