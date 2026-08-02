import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import {
  getMembersForUser,
  createMemberForUser,
  updateMemberForUser,
  deleteMemberForUser,
} from "../services/memberService.js";

export async function getMembers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const members = await getMembersForUser(userId);
    res.json(members);
  } catch (error) {
    next(error);
  }
}

export async function createMember(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const member = await createMemberForUser(userId, req.body);
    res.status(201).json(member);
  } catch (error) {
    next(error);
  }
}

export async function updateMember(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id), 10);
    const member = await updateMemberForUser(id, userId, req.body);
    res.json(member);
  } catch (error) {
    next(error);
  }
}

export async function deleteMember(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id), 10);
    await deleteMemberForUser(id, userId);
    res.json({ message: "Member deleted successfully" });
  } catch (error) {
    next(error);
  }
}
