import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { StatusMultiSelect, type StatusFilterValue } from "@/components/StatusMultiSelect";
import { useApp } from "@/lib/app-context";
import { MONTHS } from "@/lib/store";
import { DepositSummary, getDepositSummary, getLedgerDashboardSummary, getOtherIncome, getPayments, LedgerDashboardSummary, OtherIncomeSummary, PaymentRecord } from "@/lib/DatabaseService";
import { phoneMatches } from "@/lib/phone";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, Users, CheckCircle2, AlertTriangle, FileDown, FileSpreadsheet, FileText, Search, Landmark, CalendarDays, Building2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { toast } from "sonner";

type PaymentDateRange = "all" | "today" | "week" | "month" | "custom";
type ReportView = "dues" | "payments" | "other";
type OtherRow = { id: string; category: "Friday Collection" | "Room Rent"; date: string; amount: number; paymentMode: "cash" | "account"; notes: string };
const PAGE_SIZE = 10;
const ALL_STATUSES: StatusFilterValue[] = ["paid", "unpaid", "pending", "hold"];
const emptyOther: OtherIncomeSummary = { fridayCollections: [], roomRents: [], fridayTotal: 0, roomRentTotal: 0, otherTotal: 0, cashTotal: 0, accountTotal: 0 };
const emptyDeposit: DepositSummary = { deposits: [], cashIncome: 0, totalDeposited: 0, availableCash: 0 };
const emptyAccounting: LedgerDashboardSummary = { total: 0, paid: 0, unpaid: 0, pending: 0, partial: 0, expectedDues: 0, monthlyCollection: 0, yearlyCollection: 0, outstanding: 0, cashReceived: 0, accountReceived: 0, collectionPercent: 0, memberMonthlyCollection: 0, memberYearlyCollection: 0, fridayCollection: 0, roomRentCollection: 0, otherCollection: 0, otherCashReceived: 0, otherAccountReceived: 0, cashIncomeBeforeDeposits: 0, accountIncomeBeforeDeposits: 0, depositedTotal: 0, totalCollection: 0, yearlyFridayCollection: 0, yearlyRoomRentCollection: 0, yearlyOtherCollection: 0, yearlyTotalCollection: 0 };

function matchesPaymentDate(value: string | null, range: PaymentDateRange, from: string, to: string) {
  if (range === "all") return true;
  if (!value) return false;
  const paymentDate = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === "today") return paymentDate.getTime() === today.getTime();
  if (range === "week") { const weekStart = new Date(today); weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)); return paymentDate >= weekStart && paymentDate <= today; }
  if (range === "month") return paymentDate.getMonth() === today.getMonth() && paymentDate.getFullYear() === today.getFullYear();
  if (from && paymentDate < new Date(`${from}T00:00:00`)) return false;
  if (to && paymentDate > new Date(`${to}T00:00:00`)) return false;
  return Boolean(from || to);
}

function formatPdfAmount(amount: number) { return `RS ${amount.toLocaleString()}`; }
function formatDate(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString(); }
function allocationsLabel(payment: PaymentRecord) { return payment.allocations.length ? payment.allocations.map((allocation) => `${MONTHS[allocation.month - 1]} ${allocation.year} (${allocation.allocatedAmount.toLocaleString()})`).join(", ") : "—"; }
function csvSection(title: string, headers: string[], rows: Array<Array<string | number>>) { return [[title], headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n"); }

export default function Reports() {
  const { members, settings, loadMembers } = useApp();
  const now = new Date();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [otherIncome, setOtherIncome] = useState<OtherIncomeSummary>(emptyOther);
  const [depositSummary, setDepositSummary] = useState<DepositSummary>(emptyDeposit);
  const [accounting, setAccounting] = useState<LedgerDashboardSummary>(emptyAccounting);
  const [view, setView] = useState<ReportView>("dues");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<StatusFilterValue[]>(ALL_STATUSES);
  const [month, setMonth] = useState("all");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [paymentMode, setPaymentMode] = useState<"all" | "cash" | "account">("all");
  const [paymentDateRange, setPaymentDateRange] = useState<PaymentDateRange>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const selectedMonth = month === "all" ? null : Number(month);
  const selectedYear = year === "all" ? null : Number(year);
  useEffect(() => { void loadMembers(); }, [loadMembers]);
  const years = useMemo(() => Array.from(new Set([...members.map((member) => member.year), now.getFullYear()])).sort((a, b) => b - a), [members, now]);

  useEffect(() => { let active = true; void getPayments().then((rows) => { if (active) setPayments(rows); }).catch(() => { if (active) setPayments([]); }); return () => { active = false; }; }, [members]);
  useEffect(() => { let active = true; void getOtherIncome(selectedMonth, selectedYear).then((data) => { if (active) setOtherIncome(data); }).catch(() => { if (active) setOtherIncome(emptyOther); }); return () => { active = false; }; }, [selectedMonth, selectedYear, members]);
  useEffect(() => { let active = true; void getLedgerDashboardSummary(selectedMonth, selectedYear).then((data) => { if (active) setAccounting(data); }).catch(() => { if (active) setAccounting(emptyAccounting); }); return () => { active = false; }; }, [selectedMonth, selectedYear, members]);
  useEffect(() => { let active = true; if (!selectedMonth || !selectedYear) { setDepositSummary(emptyDeposit); return () => { active = false; }; } void getDepositSummary(selectedMonth, selectedYear).then((data) => { if (active) setDepositSummary(data); }).catch(() => { if (active) setDepositSummary(emptyDeposit); }); return () => { active = false; }; }, [selectedMonth, selectedYear, members]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const filteredDues = useMemo(() => members.filter((member) => {
    const comparableStatus = member.status === "partial" ? "pending" : member.status;
    const matchesStatus = member.hold ? statuses.includes("hold") || statuses.includes(comparableStatus as StatusFilterValue) : statuses.includes(comparableStatus as StatusFilterValue);
    if (!matchesStatus || (selectedMonth && member.month !== selectedMonth) || (selectedYear && member.year !== selectedYear)) return false;
    if (paymentMode !== "all" && (member.payment_mode ?? "cash") !== paymentMode) return false;
    if (!matchesPaymentDate(member.payment_date, paymentDateRange, dateFrom, dateTo)) return false;
    return !search || `${member.name} ${member.payment_mode ?? "cash"} ${member.voucher_number ?? ""} ${member.payment_date ?? ""}`.toLowerCase().includes(search.toLowerCase()) || phoneMatches(member.phone, search);
  }), [members, statuses, selectedMonth, selectedYear, paymentMode, paymentDateRange, dateFrom, dateTo, search]);
  const filteredPayments = useMemo(() => payments.filter((payment) => {
    if (paymentMode !== "all" && payment.paymentMethod !== paymentMode) return false;
    if (!matchesPaymentDate(payment.paymentDate, paymentDateRange, dateFrom, dateTo)) return false;
    if (selectedYear && new Date(`${payment.paymentDate}T00:00:00`).getFullYear() !== selectedYear) return false;
    if (selectedMonth && !payment.allocations.some((allocation) => allocation.month === selectedMonth)) return false;
    const member = memberById.get(payment.memberId);
    return !search || `${member?.name ?? ""} ${payment.voucherNumber} ${payment.paymentMethod} ${payment.paymentDate}`.toLowerCase().includes(search.toLowerCase()) || phoneMatches(member?.phone, search);
  }), [payments, memberById, paymentMode, paymentDateRange, dateFrom, dateTo, search, selectedMonth, selectedYear]);
  const filteredOther = useMemo<OtherRow[]>(() => [
    ...otherIncome.fridayCollections.map((row) => ({ id: row.id, category: "Friday Collection" as const, date: row.collectionDate, amount: row.amount, paymentMode: row.paymentMode, notes: row.notes })),
    ...otherIncome.roomRents.map((row) => ({ id: row.id, category: "Room Rent" as const, date: row.rentDate, amount: row.amount, paymentMode: row.paymentMode, notes: row.notes })),
  ].filter((row) => (paymentMode === "all" || row.paymentMode === paymentMode) && matchesPaymentDate(row.date, paymentDateRange, dateFrom, dateTo) && (!search || `${row.category} ${row.date} ${row.paymentMode} ${row.notes}`.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => a.date.localeCompare(b.date)), [otherIncome, paymentMode, paymentDateRange, dateFrom, dateTo, search]);

  const summary = useMemo(() => ({
    expectedDues: accounting.expectedDues,
    memberCollected: accounting.memberMonthlyCollection,
    fridayCollected: accounting.fridayCollection,
    roomRentCollected: accounting.roomRentCollection,
    otherCollected: accounting.otherCollection,
    totalCollected: accounting.monthlyCollection,
    yearlyTotal: accounting.yearlyCollection,
    outstanding: accounting.outstanding,
    paidCount: accounting.paid,
    total: accounting.total,
    collectionPercent: accounting.collectionPercent,
  }), [accounting]);

  const activeRows = view === "dues" ? filteredDues : view === "payments" ? filteredPayments : filteredOther;
  const totalPages = Math.max(1, Math.ceil(activeRows.length / PAGE_SIZE));
  const pagedDues = filteredDues.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedPayments = filteredPayments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedOther = filteredOther.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const c = settings.currency;
  const resetPage = () => setPage(1);
  const exportMemberView = view === "payments" ? "payments" : "dues";

  const exportCSV = () => {
    const memberHeaders = exportMemberView === "dues" ? ["Name", "Phone", "Monthly Amount", "Amount Received", "Pending Amount", "Status", "Payment Mode", "Payment Date", "Voucher Number", "Due Month", "Due Year", "Months Pending", "Total Pending Amount", "Hold"] : ["Payment Date", "Voucher Number", "Member", "Actual Payment Amount", "Payment Mode", "Allocated Months", "Notes"];
    const memberRows = exportMemberView === "dues" ? filteredDues.map((member) => [member.name, member.phone, member.amount, member.amount_paid, member.amount_pending, member.status, (member.payment_mode ?? "cash") === "account" ? "Account" : "Cash", member.payment_date ?? "", member.voucher_number ?? "", MONTHS[member.month - 1], member.year, member.months_pending, member.total_pending_amount, member.hold ? "Yes" : "No"]) : filteredPayments.map((payment) => [payment.paymentDate, payment.voucherNumber, memberById.get(payment.memberId)?.name ?? "", payment.amount, payment.paymentMethod === "account" ? "Account" : "Cash", allocationsLabel(payment), payment.notes]);
    const otherRows = filteredOther.map((row) => [row.category, row.date, row.amount, row.paymentMode === "account" ? "Account" : "Cash", row.notes]);
    const accountingRows = [[summary.memberCollected, summary.fridayCollected, summary.roomRentCollected, summary.otherCollected, summary.totalCollected, summary.yearlyTotal, accounting.cashReceived, accounting.accountReceived, accounting.depositedTotal]];
    const depositRows = depositSummary.deposits.map((deposit) => [deposit.depositDate, MONTHS[deposit.month - 1], deposit.year, deposit.amount, deposit.notes, deposit.createdAt]);
    const content = `${csvSection("ACCOUNTING SUMMARY", ["Member Payments", "Friday Collection", "Room Rent", "Other Collection", "Monthly Collection", "Yearly Total", "Cash Received", "Account Received", "Deposits / Cash to Account Transfers"], accountingRows)}\n\n${csvSection(exportMemberView === "dues" ? "MEMBER MONTHLY DUES" : "MEMBER PAYMENTS", memberHeaders, memberRows)}\n\n${csvSection("OTHER COLLECTIONS", ["Category", "Date", "Amount", "Payment Mode", "Notes"], otherRows)}\n\n${csvSection("OTHER TOTALS", ["Friday Total", "Room Rent Total", "Other Total", "Monthly Collection"], [[summary.fridayCollected, summary.roomRentCollected, summary.otherCollected, summary.totalCollected]])}\n\n${csvSection("DEPOSITS / CASH TO ACCOUNT TRANSFERS", ["Date", "Month", "Year", "Amount", "Notes", "Created Date"], depositRows)}\n\n${csvSection("DEPOSIT TOTALS", ["Cash Income Before Deposits", "Total Deposited", "Available Cash"], [[depositSummary.cashIncome, depositSummary.totalDeposited, depositSummary.availableCash]])}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `report-${Date.now()}.csv`; anchor.click(); URL.revokeObjectURL(url); toast.success("CSV exported");
  };

  const exportXLSX = () => {
    const memberData = exportMemberView === "dues" ? filteredDues.map((member) => ({ Name: member.name, Phone: member.phone, "Monthly Amount": member.amount, "Amount Received": member.amount_paid, "Pending Amount": member.amount_pending, Status: member.status, "Payment Mode": (member.payment_mode ?? "cash") === "account" ? "Account" : "Cash", "Payment Date": member.payment_date ?? "", "Voucher Number": member.voucher_number ?? "", "Due Month": MONTHS[member.month - 1], "Due Year": member.year, "Months Pending": member.months_pending, "Total Pending Amount": member.total_pending_amount, Hold: member.hold ? "Yes" : "No" })) : filteredPayments.map((payment) => ({ "Payment Date": payment.paymentDate, "Voucher Number": payment.voucherNumber, Member: memberById.get(payment.memberId)?.name ?? "", "Actual Payment Amount": payment.amount, "Payment Mode": payment.paymentMethod === "account" ? "Account" : "Cash", "Allocated Months": allocationsLabel(payment), Notes: payment.notes }));
    const memberSheet = XLSX.utils.json_to_sheet(memberData);
    const otherSheet = XLSX.utils.aoa_to_sheet([["ACCOUNTING SUMMARY"], ["Member Payments", summary.memberCollected], ["Friday Collection", summary.fridayCollected], ["Room Rent", summary.roomRentCollected], ["Other Collection", summary.otherCollected], ["Monthly Collection", summary.totalCollected], ["Yearly Total", summary.yearlyTotal], ["Cash Received", accounting.cashReceived], ["Account Received", accounting.accountReceived], ["Deposits / Cash to Account Transfers", accounting.depositedTotal], [], ["OTHER COLLECTIONS"], [], ["Friday Collections"], ["Date", "Amount", "Payment Mode", "Notes"], ...otherIncome.fridayCollections.map((row) => [row.collectionDate, row.amount, row.paymentMode === "account" ? "Account" : "Cash", row.notes]), [], ["Friday Total", summary.fridayCollected], [], ["Room Rent"], ["Date", "Amount", "Payment Mode", "Notes"], ...otherIncome.roomRents.map((row) => [row.rentDate, row.amount, row.paymentMode === "account" ? "Account" : "Cash", row.notes]), [], ["Room Rent Total", summary.roomRentCollected], ["Other Total", summary.otherCollected], ["Monthly Collection", summary.totalCollected], [], ["DEPOSITS / CASH TO ACCOUNT TRANSFERS"], ["Date", "Month", "Year", "Amount", "Notes", "Created Date"], ...depositSummary.deposits.map((deposit) => [deposit.depositDate, MONTHS[deposit.month - 1], deposit.year, deposit.amount, deposit.notes, deposit.createdAt]), [], ["Cash Income Before Deposits", depositSummary.cashIncome], ["Total Deposited", depositSummary.totalDeposited], ["Available Cash", depositSummary.availableCash]]);
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, memberSheet, exportMemberView === "dues" ? "Monthly Dues" : "Payments"); XLSX.utils.book_append_sheet(workbook, otherSheet, "Other Collections"); XLSX.writeFile(workbook, `report-${Date.now()}.xlsx`); toast.success("Excel exported");
  };

  const exportPDF = () => {
    const doc = new jsPDF(); doc.setFontSize(16); doc.text(`${settings.name} - ${exportMemberView === "dues" ? "Monthly Dues" : "Actual Payments"} Report`, 14, 18); doc.setFontSize(10); doc.setTextColor(120); doc.text(`Generated ${new Date().toLocaleString()}`, 14, 25); doc.setTextColor(20); doc.text(`Member ${formatPdfAmount(summary.memberCollected)}  |  Other ${formatPdfAmount(summary.otherCollected)}  |  Monthly Collection ${formatPdfAmount(summary.totalCollected)}  |  Yearly Total ${formatPdfAmount(summary.yearlyTotal)}`, 14, 32);
    autoTable(doc, exportMemberView === "dues" ? { startY: 39, head: [["Member", "Due", "Received", "Pending", "Status", "Payment Date", "Voucher", "Period"]], body: filteredDues.map((member) => [member.name, formatPdfAmount(member.amount), formatPdfAmount(member.amount_paid), formatPdfAmount(member.amount_pending), member.status, member.payment_date ?? "—", member.voucher_number ?? "—", `${MONTHS[member.month - 1]} ${member.year}`]), headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 }     } : { startY: 39, head: [["Date", "Voucher", "Member", "Received", "Mode", "Allocated Months"]], body: filteredPayments.map((payment) => [payment.paymentDate, payment.voucherNumber, memberById.get(payment.memberId)?.name ?? "—", formatPdfAmount(payment.amount), payment.paymentMethod === "account" ? "Account" : "Cash", allocationsLabel(payment)]), headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
    doc.addPage(); doc.setTextColor(20); doc.setFontSize(16); doc.text("OTHER COLLECTIONS", 14, 18); doc.setFontSize(10); doc.setTextColor(120); doc.text(`${MONTHS[selectedMonth ? selectedMonth - 1 : now.getMonth()]} ${selectedYear ?? now.getFullYear()} — starts on a new page`, 14, 25);
    autoTable(doc, { startY: 32, head: [["Friday Collections", "Amount", "Payment Mode", "Notes"]], body: otherIncome.fridayCollections.length ? otherIncome.fridayCollections.map((row) => [formatDate(row.collectionDate), formatPdfAmount(row.amount), row.paymentMode === "account" ? "Account" : "Cash", row.notes || "—"]) : [["No Friday collection records for this period.", "", "", ""]], headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
    const fridayEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 45; doc.setTextColor(20); doc.setFontSize(10); doc.text(`Friday Total: ${formatPdfAmount(otherIncome.fridayTotal)}`, 14, fridayEnd + 8);
    autoTable(doc, { startY: fridayEnd + 16, head: [["Room Rent", "Amount", "Payment Mode", "Notes"]], body: otherIncome.roomRents.length ? otherIncome.roomRents.map((row) => [formatDate(row.rentDate), formatPdfAmount(row.amount), row.paymentMode === "account" ? "Account" : "Cash", row.notes || "—"]) : [["No room rent records for this period.", "", "", ""]], headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
    const rentEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fridayEnd + 30; doc.setTextColor(20); doc.setFontSize(11); doc.text(`Room Rent Total: ${formatPdfAmount(summary.roomRentCollected)}`, 14, rentEnd + 8); doc.setFontSize(13); doc.text(`Other Total: ${formatPdfAmount(summary.otherCollected)}`, 14, rentEnd + 16); doc.text(`Monthly Collection: ${formatPdfAmount(summary.totalCollected)}`, 14, rentEnd + 24);
    doc.addPage(); doc.setFontSize(16); doc.text("DEPOSITS / CASH TO ACCOUNT TRANSFERS", 14, 18); doc.setFontSize(10); doc.setTextColor(120); doc.text("Transfers only — not included as new income", 14, 25); doc.setTextColor(20);
    autoTable(doc, { startY: 32, head: [["Date", "Period", "Amount", "Notes"]], body: depositSummary.deposits.length ? depositSummary.deposits.map((deposit) => [formatDate(deposit.depositDate), `${MONTHS[deposit.month - 1]} ${deposit.year}`, formatPdfAmount(deposit.amount), deposit.notes || "—"]) : [["No deposit records for this period.", "", "", ""]], headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
    const depositEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 45; doc.setFontSize(11); doc.text(`Cash Income Before Deposits: ${formatPdfAmount(depositSummary.cashIncome)}`, 14, depositEnd + 8); doc.text(`Total Deposited: ${formatPdfAmount(depositSummary.totalDeposited)}`, 14, depositEnd + 15); doc.text(`Available Cash: ${formatPdfAmount(depositSummary.availableCash)}`, 14, depositEnd + 22); doc.save(`report-${Date.now()}.pdf`); toast.success("PDF exported");
  };

  return <AppShell title="Reports" subtitle="Member dues, actual payments, allocations, Friday collections, and room-rent reports">
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><StatCard label="Member Payments" value={`${c}${summary.memberCollected.toLocaleString()}`} icon={Wallet} tone="success" /><StatCard label="Friday Collection" value={`${c}${summary.fridayCollected.toLocaleString()}`} icon={CalendarDays} tone="success" /><StatCard label="Room Rent" value={`${c}${summary.roomRentCollected.toLocaleString()}`} icon={Building2} tone="info" /><StatCard label="Other Collection" value={`${c}${summary.otherCollected.toLocaleString()}`} icon={Landmark} tone="accent" /><StatCard label="Monthly Collection" value={`${c}${summary.totalCollected.toLocaleString()}`} icon={Building2} tone="primary" /><StatCard label="Yearly Total" value={`${c}${summary.yearlyTotal.toLocaleString()}`} icon={Users} tone="primary" /><StatCard label="Outstanding" value={`${c}${summary.outstanding.toLocaleString()}`} icon={AlertTriangle} tone="destructive" /></div>
    <div className="card-surface mb-4 flex flex-wrap items-center gap-3 p-4"><div className="relative min-w-[190px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="Search by name, phone, voucher, mode..." className="pl-9" /></div><Select value={view} onValueChange={(value) => { setView(value as ReportView); resetPage(); }}><SelectTrigger className="w-[165px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dues">Monthly dues</SelectItem><SelectItem value="payments">Actual payments</SelectItem><SelectItem value="other">Other collections</SelectItem></SelectContent></Select>{view === "dues" && <StatusMultiSelect value={statuses} onValueChange={(next) => { setStatuses(next); resetPage(); }} className="w-[180px]" />}<Select value={paymentMode} onValueChange={(value) => { setPaymentMode(value as "all" | "cash" | "account"); resetPage(); }}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Payment Mode" /></SelectTrigger><SelectContent><SelectItem value="all">All Payment Modes</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="account">Account</SelectItem></SelectContent></Select><Select value={paymentDateRange} onValueChange={(value) => { setPaymentDateRange(value as PaymentDateRange); resetPage(); }}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Payment date" /></SelectTrigger><SelectContent><SelectItem value="all">All payment dates</SelectItem><SelectItem value="today">Today</SelectItem><SelectItem value="week">This week</SelectItem><SelectItem value="month">This month</SelectItem><SelectItem value="custom">Custom range</SelectItem></SelectContent></Select>{paymentDateRange === "custom" && <><Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); resetPage(); }} className="w-[145px]" aria-label="Payment date from" /><Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); resetPage(); }} className="w-[145px]" aria-label="Payment date to" /></>}<Select value={month} onValueChange={(value) => { setMonth(value); resetPage(); }}><SelectTrigger className="w-[145px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All months</SelectItem>{MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent></Select><Select value={year} onValueChange={(value) => { setYear(value); resetPage(); }}><SelectTrigger className="w-[115px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All years</SelectItem>{years.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select><div className="flex gap-2"><Button variant="outline" onClick={exportCSV}><FileDown className="mr-1.5 h-4 w-4" /> CSV</Button><Button variant="outline" onClick={exportXLSX}><FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel</Button><Button onClick={exportPDF}><FileText className="mr-1.5 h-4 w-4" /> PDF</Button></div></div>
    <div className="card-surface overflow-hidden"><div className="overflow-x-auto"><Table>{view === "dues" ? <><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Due</TableHead><TableHead>Received</TableHead><TableHead>Pending</TableHead><TableHead>Status</TableHead><TableHead>Payment Mode</TableHead><TableHead>Payment Date</TableHead><TableHead>Voucher</TableHead><TableHead>Due Period</TableHead><TableHead className="text-right">Months Pending</TableHead></TableRow></TableHeader><TableBody>{pagedDues.map((member) => <TableRow key={member.id}><TableCell className="font-medium">{member.name}<div className="text-xs text-muted-foreground">{member.phone}</div></TableCell><TableCell>{c}{member.amount.toLocaleString()}</TableCell><TableCell>{c}{member.amount_paid.toLocaleString()}</TableCell><TableCell>{c}{member.amount_pending.toLocaleString()}</TableCell><TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${member.status === "paid" ? "bg-success/15 text-success" : member.status === "unpaid" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"}`}>{member.status === "partial" ? "partial" : member.status}</span></TableCell><TableCell>{(member.payment_mode ?? "cash") === "account" ? "Account" : "Cash"}</TableCell><TableCell>{member.payment_date ? formatDate(member.payment_date) : "—"}</TableCell><TableCell className="font-mono text-xs">{member.voucher_number || "—"}</TableCell><TableCell>{MONTHS[member.month - 1]} {member.year}</TableCell><TableCell className="text-right">{member.months_pending}</TableCell></TableRow>)}{pagedDues.length === 0 && <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">No results</TableCell></TableRow>}</TableBody></> : view === "payments" ? <><TableHeader><TableRow><TableHead>Payment Date</TableHead><TableHead>Voucher</TableHead><TableHead>Member</TableHead><TableHead>Actual Amount</TableHead><TableHead>Mode</TableHead><TableHead>Allocated Months</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{pagedPayments.map((payment) => <TableRow key={payment.id}><TableCell>{formatDate(payment.paymentDate)}</TableCell><TableCell className="font-mono text-xs">{payment.voucherNumber}</TableCell><TableCell className="font-medium">{memberById.get(payment.memberId)?.name ?? "—"}</TableCell><TableCell>{c}{payment.amount.toLocaleString()}</TableCell><TableCell>{payment.paymentMethod === "account" ? "Account" : "Cash"}</TableCell><TableCell className="max-w-[260px] whitespace-normal text-xs">{allocationsLabel(payment)}</TableCell><TableCell className="max-w-[180px] whitespace-normal text-xs text-muted-foreground">{payment.notes || "—"}</TableCell></TableRow>)}{pagedPayments.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No payments match the current filters.</TableCell></TableRow>}</TableBody></> : <><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Payment Mode</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{pagedOther.map((row) => <TableRow key={`${row.category}-${row.id}`}><TableCell className="font-medium">{row.category}</TableCell><TableCell>{formatDate(row.date)}</TableCell><TableCell>{c}{row.amount.toLocaleString()}</TableCell><TableCell>{row.paymentMode === "account" ? "Account" : "Cash"}</TableCell><TableCell className="text-muted-foreground">{row.notes || "—"}</TableCell></TableRow>)}{pagedOther.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No Other collection records match the current filters.</TableCell></TableRow>}</TableBody></>}</Table></div><div className="flex items-center justify-between border-t border-border px-4 py-3"><p className="text-xs text-muted-foreground">Page {page} of {totalPages} · {activeRows.length} {view === "dues" ? "records" : view === "payments" ? "payments" : "Other records"} · Member collection {summary.collectionPercent}%</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div></div>
  </AppShell>;
}
