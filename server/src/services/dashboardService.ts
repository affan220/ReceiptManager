import { getMembersForUser } from "./memberService.js";

export async function getDashboardStatsForUser(userId: number) {
  const members = await getMembersForUser(userId);

  const total = members.length;
  const paid = members.filter((item) => item.status === "paid").length;
  const unpaid = members.filter((item) => item.status === "unpaid").length;
  const pending = members.filter((item) => item.status === "pending").length;

  const currentYear = new Date().getFullYear();

  const monthly = members
    .filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + item.monthlyAmount, 0);

  const yearly = members
    .filter((item) => item.status === "paid" && new Date(item.updatedAt).getFullYear() === currentYear)
    .reduce((sum, item) => sum + item.monthlyAmount, 0);

  const outstanding = members
    .filter((item) => item.status !== "paid")
    .reduce((sum, item) => sum + item.monthlyAmount * Math.max(1, item.pendingMonths || 1), 0);

  const cashReceived = members
    .filter((item) => item.status === "paid" && (item.paymentMode ?? "cash") === "cash")
    .reduce((sum, item) => sum + item.monthlyAmount, 0);

  const accountReceived = members
    .filter((item) => item.status === "paid" && item.paymentMode === "account")
    .reduce((sum, item) => sum + item.monthlyAmount, 0);

  return {
    total,
    paid,
    unpaid,
    pending,
    monthly,
    yearly,
    outstanding,
    cashReceived,
    accountReceived,
  };
}
