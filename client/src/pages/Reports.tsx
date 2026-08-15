import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { StatusMultiSelect, type StatusFilterValue } from "@/components/StatusMultiSelect";
import { useApp } from "@/lib/app-context";
import { MONTHS } from "@/lib/store";
import { PaymentRecord, getPayments } from "@/lib/DatabaseService";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, Users, CheckCircle2, AlertTriangle, FileDown, FileSpreadsheet, FileText, Search } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { toast } from "sonner";

type PaymentDateRange = "all" | "today" | "week" | "month" | "custom";
type ReportView = "dues" | "payments";
const PAGE_SIZE = 10;
const ALL_STATUSES: StatusFilterValue[] = ["paid", "unpaid", "pending", "hold"];

function matchesPaymentDate(value: string | null, range: PaymentDateRange, from: string, to: string) {
  if (range === "all") return true;
  if (!value) return false;
  const paymentDate = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === "today") return paymentDate.getTime() === today.getTime();
  if (range === "week") {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return paymentDate >= weekStart && paymentDate <= today;
  }
  if (range === "month") return paymentDate.getMonth() === today.getMonth() && paymentDate.getFullYear() === today.getFullYear();
  if (from && paymentDate < new Date(`${from}T00:00:00`)) return false;
  if (to && paymentDate > new Date(`${to}T00:00:00`)) return false;
  return Boolean(from || to);
}

function formatPdfAmount(amount: number) {
  return `RS ${amount.toLocaleString()}`;
}

function allocationsLabel(payment: PaymentRecord) {
  return payment.allocations.length
    ? payment.allocations.map((allocation) => `${MONTHS[allocation.month - 1]} ${allocation.year} (${allocation.allocatedAmount.toLocaleString()})`).join(", ")
    : "—";
}

export default function Reports() {
  const { members, settings } = useApp();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [view, setView] = useState<ReportView>("dues");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<StatusFilterValue[]>(ALL_STATUSES);
  const [month, setMonth] = useState("all");
  const [paymentMode, setPaymentMode] = useState<"all" | "cash" | "account">("all");
  const [paymentDateRange, setPaymentDateRange] = useState<PaymentDateRange>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    void getPayments().then((rows) => { if (active) setPayments(rows); }).catch(() => { if (active) setPayments([]); });
    return () => { active = false; };
  }, [members]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const filteredDues = useMemo(() => members.filter((member) => {
    const comparableStatus = member.status === "partial" ? "pending" : member.status;
    const matchesStatus = member.hold ? statuses.includes("hold") || statuses.includes(comparableStatus as StatusFilterValue) : statuses.includes(comparableStatus as StatusFilterValue);
    if (!matchesStatus) return false;
    if (month !== "all" && member.month !== Number(month)) return false;
    if (paymentMode !== "all" && (member.payment_mode ?? "cash") !== paymentMode) return false;
    if (!matchesPaymentDate(member.payment_date, paymentDateRange, dateFrom, dateTo)) return false;
    if (search && !`${member.name} ${member.phone} ${member.payment_mode ?? "cash"} ${member.voucher_number ?? ""} ${member.payment_date ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [members, search, statuses, month, paymentMode, paymentDateRange, dateFrom, dateTo]);

  const filteredPayments = useMemo(() => payments.filter((payment) => {
    if (paymentMode !== "all" && payment.paymentMethod !== paymentMode) return false;
    if (!matchesPaymentDate(payment.paymentDate, paymentDateRange, dateFrom, dateTo)) return false;
    const member = memberById.get(payment.memberId);
    const searchable = `${member?.name ?? ""} ${member?.phone ?? ""} ${payment.voucherNumber} ${payment.paymentMethod} ${payment.paymentDate}`.toLowerCase();
    if (search && !searchable.includes(search.toLowerCase())) return false;
    if (month !== "all" && !payment.allocations.some((allocation) => allocation.month === Number(month))) return false;
    return true;
  }), [payments, memberById, paymentMode, paymentDateRange, dateFrom, dateTo, search, month]);

  const summary = useMemo(() => {
    const expectedDues = filteredDues.reduce((sum, member) => sum + member.amount, 0);
    const actualCollected = filteredPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const outstanding = filteredDues.reduce((sum, member) => sum + member.amount_pending, 0);
    const paidCount = filteredDues.filter((member) => member.status === "paid").length;
    const collectionPercent = expectedDues ? Math.round((actualCollected / expectedDues) * 100) : 0;
    return { expectedDues, actualCollected, outstanding, paidCount, total: filteredDues.length, collectionPercent };
  }, [filteredDues, filteredPayments]);

  const activeRows = view === "dues" ? filteredDues : filteredPayments;
  const totalPages = Math.max(1, Math.ceil(activeRows.length / PAGE_SIZE));
  const pagedDues = filteredDues.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedPayments = filteredPayments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const c = settings.currency;

  const exportCSV = () => {
    if (view === "dues") {
      const headers = ["Name", "Phone", "Monthly Amount", "Amount Received", "Pending Amount", "Status", "Payment Mode", "Payment Date", "Voucher Number", "Due Month", "Due Year", "Months Pending", "Total Pending Amount", "Hold"];
      const rows = filteredDues.map((member) => [member.name, member.phone, member.amount, member.amount_paid, member.amount_pending, member.status, (member.payment_mode ?? "cash") === "account" ? "Account" : "Cash", member.payment_date ?? "", member.voucher_number ?? "", MONTHS[member.month - 1], member.year, member.months_pending, member.total_pending_amount, member.hold ? "Yes" : "No"]);
      const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `monthly-dues-${Date.now()}.csv`; anchor.click(); URL.revokeObjectURL(url);
    } else {
      const headers = ["Payment Date", "Voucher Number", "Member", "Actual Payment Amount", "Payment Mode", "Allocated Months", "Notes"];
      const rows = filteredPayments.map((payment) => [payment.paymentDate, payment.voucherNumber, memberById.get(payment.memberId)?.name ?? "", payment.amount, payment.paymentMethod === "account" ? "Account" : "Cash", allocationsLabel(payment), payment.notes]);
      const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `payments-${Date.now()}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }
    toast.success("CSV exported");
  };

  const exportXLSX = () => {
    const data = view === "dues"
      ? filteredDues.map((member) => ({ Name: member.name, Phone: member.phone, "Monthly Amount": member.amount, "Amount Received": member.amount_paid, "Pending Amount": member.amount_pending, Status: member.status, "Payment Mode": (member.payment_mode ?? "cash") === "account" ? "Account" : "Cash", "Payment Date": member.payment_date ?? "", "Voucher Number": member.voucher_number ?? "", "Due Month": MONTHS[member.month - 1], "Due Year": member.year, "Months Pending": member.months_pending, "Total Pending Amount": member.total_pending_amount, Hold: member.hold ? "Yes" : "No" }))
      : filteredPayments.map((payment) => ({ "Payment Date": payment.paymentDate, "Voucher Number": payment.voucherNumber, Member: memberById.get(payment.memberId)?.name ?? "", "Actual Payment Amount": payment.amount, "Payment Mode": payment.paymentMethod === "account" ? "Account" : "Cash", "Allocated Months": allocationsLabel(payment), Notes: payment.notes }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, view === "dues" ? "Monthly Dues" : "Payments");
    XLSX.writeFile(workbook, `${view}-${Date.now()}.xlsx`);
    toast.success("Excel exported");
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`${settings.name} - ${view === "dues" ? "Monthly Dues" : "Actual Payments"} Report`, 14, 18);
    doc.setFontSize(10); doc.setTextColor(120); doc.text(`Generated ${new Date().toLocaleString()}`, 14, 25);
    autoTable(doc, view === "dues" ? {
      startY: 32,
      head: [["Member", "Due", "Received", "Pending", "Status", "Payment Date", "Voucher", "Period"]],
      body: filteredDues.map((member) => [member.name, formatPdfAmount(member.amount), formatPdfAmount(member.amount_paid), formatPdfAmount(member.amount_pending), member.status, member.payment_date ?? "—", member.voucher_number ?? "—", `${MONTHS[member.month - 1]} ${member.year}`]),
      headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 },
    } : {
      startY: 32,
      head: [["Date", "Voucher", "Member", "Received", "Mode", "Allocated Months"]],
      body: filteredPayments.map((payment) => [payment.paymentDate, payment.voucherNumber, memberById.get(payment.memberId)?.name ?? "—", formatPdfAmount(payment.amount), payment.paymentMethod === "account" ? "Account" : "Cash", allocationsLabel(payment)]),
      headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 },
    });
    doc.save(`${view}-report-${Date.now()}.pdf`);
    toast.success("PDF exported");
  };

  const resetPage = () => setPage(1);

  return (
    <AppShell title="Reports" subtitle="Searchable monthly dues, actual payment, and allocation reports">
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Actual Collected" value={`${c}${summary.actualCollected.toLocaleString()}`} icon={Wallet} tone="success" /><StatCard label="Outstanding" value={`${c}${summary.outstanding.toLocaleString()}`} icon={AlertTriangle} tone="destructive" /><StatCard label="Members Paid" value={summary.paidCount} icon={CheckCircle2} tone="primary" /><StatCard label="Expected Dues" value={`${c}${summary.expectedDues.toLocaleString()}`} icon={Users} tone="accent" /></div>

      <div className="card-surface mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[190px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="Search by name, phone, voucher, mode..." className="pl-9" /></div>
        <Select value={view} onValueChange={(value) => { setView(value as ReportView); resetPage(); }}><SelectTrigger className="w-[155px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dues">Monthly dues</SelectItem><SelectItem value="payments">Actual payments</SelectItem></SelectContent></Select>
        {view === "dues" && <StatusMultiSelect value={statuses} onValueChange={(next) => { setStatuses(next); resetPage(); }} className="w-[180px]" />}
        <Select value={paymentMode} onValueChange={(value) => { setPaymentMode(value as "all" | "cash" | "account"); resetPage(); }}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Payment Mode" /></SelectTrigger><SelectContent><SelectItem value="all">All Payment Modes</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="account">Account</SelectItem></SelectContent></Select>
        <Select value={paymentDateRange} onValueChange={(value) => { setPaymentDateRange(value as PaymentDateRange); resetPage(); }}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Payment date" /></SelectTrigger><SelectContent><SelectItem value="all">All payment dates</SelectItem><SelectItem value="today">Today</SelectItem><SelectItem value="week">This week</SelectItem><SelectItem value="month">This month</SelectItem><SelectItem value="custom">Custom range</SelectItem></SelectContent></Select>
        {paymentDateRange === "custom" && <><Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); resetPage(); }} className="w-[145px]" aria-label="Payment date from" /><Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); resetPage(); }} className="w-[145px]" aria-label="Payment date to" /></>}
        <Select value={month} onValueChange={(value) => { setMonth(value); resetPage(); }}><SelectTrigger className="w-[145px]"><SelectValue placeholder="All months" /></SelectTrigger><SelectContent><SelectItem value="all">All due months</SelectItem>{MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent></Select>
        <div className="flex gap-2"><Button variant="outline" onClick={exportCSV}><FileDown className="mr-1.5 h-4 w-4" /> CSV</Button><Button variant="outline" onClick={exportXLSX}><FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel</Button><Button onClick={exportPDF}><FileText className="mr-1.5 h-4 w-4" /> PDF</Button></div>
      </div>

      <div className="card-surface overflow-hidden"><div className="overflow-x-auto"><Table>{view === "dues" ? <><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Due</TableHead><TableHead>Received</TableHead><TableHead>Pending</TableHead><TableHead>Status</TableHead><TableHead>Payment Mode</TableHead><TableHead>Payment Date</TableHead><TableHead>Voucher</TableHead><TableHead>Due Period</TableHead><TableHead className="text-right">Months Pending</TableHead></TableRow></TableHeader><TableBody>{pagedDues.map((member) => <TableRow key={member.id}><TableCell className="font-medium">{member.name}<div className="text-xs text-muted-foreground">{member.phone}</div></TableCell><TableCell>{c}{member.amount.toLocaleString()}</TableCell><TableCell>{c}{member.amount_paid.toLocaleString()}</TableCell><TableCell>{c}{member.amount_pending.toLocaleString()}</TableCell><TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${member.status === "paid" ? "bg-success/15 text-success" : member.status === "unpaid" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"}`}>{member.status === "partial" ? "partial" : member.status}</span></TableCell><TableCell>{(member.payment_mode ?? "cash") === "account" ? "Account" : "Cash"}</TableCell><TableCell>{member.payment_date ? new Date(`${member.payment_date}T00:00:00`).toLocaleDateString() : "—"}</TableCell><TableCell className="font-mono text-xs">{member.voucher_number || "—"}</TableCell><TableCell>{MONTHS[member.month - 1]} {member.year}</TableCell><TableCell className="text-right">{member.months_pending}</TableCell></TableRow>)}{pagedDues.length === 0 && <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">No results</TableCell></TableRow>}</TableBody></> : <><TableHeader><TableRow><TableHead>Payment Date</TableHead><TableHead>Voucher</TableHead><TableHead>Member</TableHead><TableHead>Actual Amount</TableHead><TableHead>Mode</TableHead><TableHead>Allocated Months</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{pagedPayments.map((payment) => <TableRow key={payment.id}><TableCell>{new Date(`${payment.paymentDate}T00:00:00`).toLocaleDateString()}</TableCell><TableCell className="font-mono text-xs">{payment.voucherNumber}</TableCell><TableCell className="font-medium">{memberById.get(payment.memberId)?.name ?? "—"}</TableCell><TableCell>{c}{payment.amount.toLocaleString()}</TableCell><TableCell>{payment.paymentMethod === "account" ? "Account" : "Cash"}</TableCell><TableCell className="max-w-[260px] whitespace-normal text-xs">{allocationsLabel(payment)}</TableCell><TableCell className="max-w-[180px] whitespace-normal text-xs text-muted-foreground">{payment.notes || "—"}</TableCell></TableRow>)}{pagedPayments.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No payments match the current filters.</TableCell></TableRow>}</TableBody></>}</Table></div><div className="flex items-center justify-between border-t border-border px-4 py-3"><p className="text-xs text-muted-foreground">Page {page} of {totalPages} · {activeRows.length} {view === "dues" ? "records" : "payments"} · Collection {summary.collectionPercent}%</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div></div>
    </AppShell>
  );
}
