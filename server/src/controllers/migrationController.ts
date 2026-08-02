import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import prisma from "../utils/prisma.js";

export async function importLocalStorageData(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const { members = [], receipts = [], settings } = req.body;

    let importedMembersCount = 0;
    let importedReceiptsCount = 0;

    // Map old member string IDs to new PostgreSQL numeric IDs if necessary
    const memberIdMap = new Map<string, number>();

    // 1. Import Members
    for (const m of members) {
      if (!m.name) continue;
      const created = await prisma.member.create({
        data: {
          userId,
          name: m.name,
          phone: m.phone || "",
          monthlyAmount: Number(m.amount || m.monthlyAmount || 0),
          status: m.status || "unpaid",
          paymentMode: m.payment_mode === "account" || m.paymentMode === "account" ? "account" : "cash",
          hold: Boolean(m.hold),
          pendingMonths: Number(m.months_pending || m.pendingMonths || 0),
        },
      });
      importedMembersCount++;
      if (m.id) {
        memberIdMap.set(String(m.id), created.id);
      }
    }

    // 2. Import Receipts
    for (const r of receipts) {
      let targetMemberId = r.memberId ? Number(r.memberId) : NaN;
      if (isNaN(targetMemberId) && r.memberId && memberIdMap.has(String(r.memberId))) {
        targetMemberId = memberIdMap.get(String(r.memberId))!;
      }

      // If still invalid, link to first created member or skip
      if (isNaN(targetMemberId)) {
        const firstMember = await prisma.member.findFirst({ where: { userId } });
        if (!firstMember) continue;
        targetMemberId = firstMember.id;
      }

      await prisma.receipt.create({
        data: {
          userId,
          memberId: targetMemberId,
          amount: Number(r.amount || 0),
          paymentMode: r.payment_mode === "account" || r.paymentMode === "account" ? "account" : "cash",
          receiptNumber: r.receiptNo || r.receiptNumber || `RCPT-${Date.now()}`,
          date: r.createdAt ? new Date(r.createdAt) : new Date(),
        },
      });
      importedReceiptsCount++;
    }

    // 3. Import Settings if present
    if (settings) {
      await prisma.settings.upsert({
        where: { userId },
        create: {
          userId,
          masjidName: settings.name || settings.masjidName || "My Masjid",
          logo: settings.logoDataUrl || settings.logo || null,
          receiptPrefix: settings.receiptPrefix || "RCPT",
          currency: settings.currency || "₹",
          theme: settings.theme || "light",
        },
        update: {
          masjidName: settings.name || settings.masjidName || "My Masjid",
          logo: settings.logoDataUrl || settings.logo || null,
          receiptPrefix: settings.receiptPrefix || "RCPT",
          currency: settings.currency || "₹",
        },
      });
    }

    res.json({
      message: "Data imported successfully to PostgreSQL",
      importedMembersCount,
      importedReceiptsCount,
    });
  } catch (error) {
    next(error);
  }
}
