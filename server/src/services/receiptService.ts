import prisma from "../utils/prisma.js";
import { memoryStore } from "./memoryDb.js";

export interface CreateReceiptInput {
  memberId: number;
  amount: number;
  paymentMode?: string;
  receiptNumber?: string;
  date?: string | Date;
}

export async function getReceiptsForUser(userId: number) {
  try {
    return await prisma.receipt.findMany({
      where: { userId },
      include: {
        member: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    return memoryStore.receipts
      .filter((r) => r.userId === userId)
      .map((r) => {
        const mem = memoryStore.members.find((m) => m.id === r.memberId);
        return {
          ...r,
          member: mem ? { id: mem.id, name: mem.name, phone: mem.phone } : null,
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export async function createReceiptForUser(userId: number, input: CreateReceiptInput) {
  let receiptNumber = input.receiptNumber;

  try {
    if (!receiptNumber) {
      const settings = await prisma.settings.findUnique({ where: { userId } });
      const prefix = settings?.receiptPrefix || "RCPT";
      const count = await prisma.receipt.count({ where: { userId } });
      const year = new Date().getFullYear();
      receiptNumber = `${prefix}-${year}-${String(count + 1).padStart(5, "0")}`;
    }

    return await prisma.receipt.create({
      data: {
        userId,
        memberId: Number(input.memberId),
        amount: Number(input.amount),
        paymentMode: input.paymentMode === "account" ? "account" : "cash",
        receiptNumber,
        date: input.date ? new Date(input.date) : new Date(),
      },
      include: {
        member: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });
  } catch {
    if (!receiptNumber) {
      const count = memoryStore.receipts.filter((r) => r.userId === userId).length;
      const year = new Date().getFullYear();
      receiptNumber = `RCPT-${year}-${String(count + 1).padStart(5, "0")}`;
    }

    const created = {
      id: memoryStore.receiptIdSeq++,
      userId,
      memberId: Number(input.memberId),
      amount: Number(input.amount),
      paymentMode: input.paymentMode === "account" ? "account" : "cash",
      receiptNumber,
      date: input.date ? new Date(input.date) : new Date(),
      createdAt: new Date(),
    };
    memoryStore.receipts.unshift(created);

    const mem = memoryStore.members.find((m) => m.id === created.memberId);
    return {
      ...created,
      member: mem ? { id: mem.id, name: mem.name, phone: mem.phone } : null,
    };
  }
}

export async function updateReceiptForUser(id: number, userId: number, input: Partial<CreateReceiptInput>) {
  try {
    const existing = await prisma.receipt.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new Error("Receipt not found or unauthorized.");
    }

    return await prisma.receipt.update({
      where: { id },
      data: {
        ...(input.amount !== undefined && { amount: Number(input.amount) }),
        ...(input.paymentMode !== undefined && { paymentMode: input.paymentMode }),
        ...(input.receiptNumber !== undefined && { receiptNumber: input.receiptNumber }),
        ...(input.date !== undefined && { date: new Date(input.date) }),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Receipt not found or unauthorized.") {
      throw error;
    }
    const idx = memoryStore.receipts.findIndex((r) => r.id === id && r.userId === userId);
    if (idx === -1) {
      throw new Error("Receipt not found or unauthorized.");
    }
    const existing = memoryStore.receipts[idx];
    const updated = {
      ...existing,
      ...(input.amount !== undefined && { amount: Number(input.amount) }),
      ...(input.paymentMode !== undefined && { paymentMode: input.paymentMode }),
      ...(input.receiptNumber !== undefined && { receiptNumber: input.receiptNumber }),
      ...(input.date !== undefined && { date: new Date(input.date) }),
    };
    memoryStore.receipts[idx] = updated;
    return updated;
  }
}

export async function deleteReceiptForUser(id: number, userId: number) {
  try {
    const existing = await prisma.receipt.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new Error("Receipt not found or unauthorized.");
    }

    await prisma.receipt.delete({
      where: { id },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Receipt not found or unauthorized.") {
      throw error;
    }
    const idx = memoryStore.receipts.findIndex((r) => r.id === id && r.userId === userId);
    if (idx === -1) {
      throw new Error("Receipt not found or unauthorized.");
    }
    memoryStore.receipts.splice(idx, 1);
  }
}
