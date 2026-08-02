import prisma from "../utils/prisma.js";
import { memoryStore } from "./memoryDb.js";

export interface CreateMemberInput {
  name: string;
  phone?: string;
  monthlyAmount?: number;
  status?: string;
  paymentMode?: string;
  hold?: boolean;
  pendingMonths?: number;
}

export interface UpdateMemberInput {
  name?: string;
  phone?: string;
  monthlyAmount?: number;
  status?: string;
  paymentMode?: string;
  hold?: boolean;
  pendingMonths?: number;
}

export async function getMembersForUser(userId: number) {
  try {
    return await prisma.member.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    return memoryStore.members
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export async function createMemberForUser(userId: number, input: CreateMemberInput) {
  try {
    return await prisma.member.create({
      data: {
        userId,
        name: input.name,
        phone: input.phone || "",
        monthlyAmount: Number(input.monthlyAmount || 0),
        status: input.status || "unpaid",
        paymentMode: input.paymentMode === "account" ? "account" : "cash",
        hold: Boolean(input.hold),
        pendingMonths: Number(input.pendingMonths || 0),
      },
    });
  } catch {
    const created = {
      id: memoryStore.memberIdSeq++,
      userId,
      name: input.name,
      phone: input.phone || "",
      monthlyAmount: Number(input.monthlyAmount || 0),
      status: input.status || "unpaid",
      paymentMode: input.paymentMode === "account" ? "account" : "cash",
      hold: Boolean(input.hold),
      pendingMonths: Number(input.pendingMonths || 0),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryStore.members.unshift(created);
    return created;
  }
}

export async function updateMemberForUser(id: number, userId: number, input: UpdateMemberInput) {
  try {
    const existing = await prisma.member.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new Error("Member not found or unauthorized.");
    }

    return await prisma.member.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.monthlyAmount !== undefined && { monthlyAmount: Number(input.monthlyAmount) }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.paymentMode !== undefined && { paymentMode: input.paymentMode === "account" ? "account" : "cash" }),
        ...(input.hold !== undefined && { hold: Boolean(input.hold) }),
        ...(input.pendingMonths !== undefined && { pendingMonths: Number(input.pendingMonths) }),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Member not found or unauthorized.") {
      throw error;
    }
    const idx = memoryStore.members.findIndex((m) => m.id === id && m.userId === userId);
    if (idx === -1) {
      throw new Error("Member not found or unauthorized.");
    }

    const existing = memoryStore.members[idx];
    const updated = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.monthlyAmount !== undefined && { monthlyAmount: Number(input.monthlyAmount) }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.paymentMode !== undefined && { paymentMode: input.paymentMode === "account" ? "account" : "cash" }),
      ...(input.hold !== undefined && { hold: Boolean(input.hold) }),
      ...(input.pendingMonths !== undefined && { pendingMonths: Number(input.pendingMonths) }),
      updatedAt: new Date(),
    };
    memoryStore.members[idx] = updated;
    return updated;
  }
}

export async function deleteMemberForUser(id: number, userId: number) {
  try {
    const existing = await prisma.member.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new Error("Member not found or unauthorized.");
    }

    await prisma.member.delete({
      where: { id },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Member not found or unauthorized.") {
      throw error;
    }
    const idx = memoryStore.members.findIndex((m) => m.id === id && m.userId === userId);
    if (idx === -1) {
      throw new Error("Member not found or unauthorized.");
    }
    memoryStore.members.splice(idx, 1);
  }
}
