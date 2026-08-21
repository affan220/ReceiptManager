import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTHS, initialsOf } from "@/lib/store";
import { getDepositSummary, getLedgerDashboardSummary, getMemberPayments, getOtherIncome } from "@/lib/DatabaseService";
import { phoneMatches } from "@/lib/phone";
import { generateReceiptPDF } from "@/lib/receipt";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import { Printer, FileText, ListChecks, Search, Landmark } from "lucide-react";

function formatPdfAmount(amount: number) { return `RS ${amount.toLocaleString()}`; }
type PrintStatusFilter = "all" | "paid" | "unpaid" | "pending" | "partial" | "hold";

export default function PrintCenter() {
  const { members, settings, loadMembers } = useApp();
  const now = new Date();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PrintStatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [printingPeriod, setPrintingPeriod] = useState(false);
  useEffect(() => { void loadMembers(); }, [loadMembers]);
  const years = useMemo(() => Array.from(new Set([...members.map((member) => member.year), now.getFullYear()])).sort((a, b) => b - a), [members, now]);

  const filtered = useMemo(() => members.filter((member) => {
    if (status === "hold" && !member.hold) return false;
    if (status !== "all" && status !== "hold" && member.status !== status) return false;
    return !search || `${member.name} ${member.payment_mode ?? "cash"} ${member.voucher_number ?? ""}`.toLowerCase().includes(search.toLowerCase()) || phoneMatches(member.phone, search);
  }), [members, search, status]);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => { if (filtered.every((member) => selected.has(member.id))) setSelected(new Set()); else setSelected(new Set(filtered.map((member) => member.id))); };

  const printReceipts = async () => {
    const list = members.filter((member) => selected.has(member.id));
    if (!list.length) { toast.error("Select members first"); return; }
    let generated = 0; let skipped = 0;
    for (const member of list) {
      try { const payment = (await getMemberPayments(member.id))[0]; if (!payment) { skipped += 1; continue; } await generateReceiptPDF(member, payment, settings); generated += 1; } catch { skipped += 1; }
    }
    if (generated) toast.success(`Generated ${generated} receipt${generated === 1 ? "" : "s"}${skipped ? `; ${skipped} skipped without a payment.` : ""}`); else toast.error("No selected contribution has a payment to receipt.");
  };

  const printList = () => {
    const list = members.filter((member) => selected.has(member.id));
    if (!list.length) { toast.error("Select members first"); return; }
    const doc = new jsPDF(); doc.setFontSize(16); doc.text(`${settings.name} — Member List`, 14, 18); doc.setFontSize(10); doc.setTextColor(120); doc.text(`Printed ${new Date().toLocaleString()}`, 14, 25);
    autoTable(doc, { startY: 32, head: [["#", "Name", "Phone", "Due", "Received", "Outstanding", "Status", "Payment Mode", "Payment Date", "Voucher", "Due Period"]], body: list.map((member, index) => [index + 1, member.name, member.phone, formatPdfAmount(member.amount), formatPdfAmount(member.amount_paid), formatPdfAmount(member.amount_pending), member.status === "partial" ? "Partially Paid" : member.status, (member.payment_mode ?? "cash") === "account" ? "Account" : "Cash", member.payment_date ?? "—", member.voucher_number ?? "—", `${MONTHS[member.month - 1]} ${member.year}`]), headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
    doc.save(`print-list-${Date.now()}.pdf`); toast.success("List ready");
  };

  const printPeriodReport = async () => {
    const selectedMonth = Number(month); const selectedYear = Number(year);
    setPrintingPeriod(true);
    try {
      const [other, deposits, accounting, periodMembers] = await Promise.all([getOtherIncome(selectedMonth, selectedYear), getDepositSummary(selectedMonth, selectedYear), getLedgerDashboardSummary(selectedMonth, selectedYear), Promise.resolve(members.filter((member) => member.month === selectedMonth && member.year === selectedYear))]);
      const doc = new jsPDF(); doc.setFontSize(16); doc.text(`${settings.name} — Monthly Report`, 14, 18); doc.setFontSize(10); doc.setTextColor(120); doc.text(`${MONTHS[selectedMonth - 1]} ${selectedYear} · Member report first`, 14, 25); doc.setTextColor(20); doc.text(`Member Payments ${formatPdfAmount(accounting.memberMonthlyCollection)}  |  Other ${formatPdfAmount(accounting.otherCollection)}  |  Monthly Collection ${formatPdfAmount(accounting.monthlyCollection)}  |  Yearly Total ${formatPdfAmount(accounting.yearlyCollection)}`, 14, 32);
      autoTable(doc, { startY: 39, head: [["#", "Member", "Phone", "Due", "Received", "Pending", "Status", "Mode"]], body: periodMembers.length ? periodMembers.map((member, index) => [index + 1, member.name, member.phone, formatPdfAmount(member.amount), formatPdfAmount(member.amount_paid), formatPdfAmount(member.amount_pending), member.status, (member.payment_mode ?? "cash") === "account" ? "Account" : "Cash"]) : [["No member contribution records for this period.", "", "", "", "", "", "", ""]], headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
      doc.addPage(); doc.setTextColor(20); doc.setFontSize(16); doc.text("OTHER COLLECTIONS", 14, 18); doc.setFontSize(10); doc.setTextColor(120); doc.text(`${MONTHS[selectedMonth - 1]} ${selectedYear} — begins on a new page`, 14, 25);
      autoTable(doc, { startY: 32, head: [["Friday Collections", "Amount", "Payment Mode", "Notes"]], body: other.fridayCollections.length ? other.fridayCollections.map((row) => [row.collectionDate, formatPdfAmount(row.amount), row.paymentMode === "account" ? "Account" : "Cash", row.notes || "—"]) : [["No Friday collection records for this period.", "", "", ""]], headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
      const fridayEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 45; doc.setTextColor(20); doc.text(`Friday Total: ${formatPdfAmount(accounting.fridayCollection)}`, 14, fridayEnd + 8);
      autoTable(doc, { startY: fridayEnd + 16, head: [["Room Rent", "Amount", "Payment Mode", "Notes"]], body: other.roomRents.length ? other.roomRents.map((row) => [row.rentDate, formatPdfAmount(row.amount), row.paymentMode === "account" ? "Account" : "Cash", row.notes || "—"]) : [["No room rent records for this period.", "", "", ""]], headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
      const rentEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fridayEnd + 30; doc.setTextColor(20); doc.setFontSize(11); doc.text(`Room Rent Total: ${formatPdfAmount(accounting.roomRentCollection)}`, 14, rentEnd + 8); doc.setFontSize(13); doc.text(`Other Total: ${formatPdfAmount(accounting.otherCollection)}`, 14, rentEnd + 16); doc.text(`Monthly Collection: ${formatPdfAmount(accounting.monthlyCollection)}`, 14, rentEnd + 24);
      doc.addPage(); doc.setFontSize(16); doc.text("DEPOSITS / CASH TO ACCOUNT TRANSFERS", 14, 18); doc.setFontSize(10); doc.setTextColor(120); doc.text(`${MONTHS[selectedMonth - 1]} ${selectedYear} — transfers only, not new income`, 14, 25); doc.setTextColor(20);
      autoTable(doc, { startY: 32, head: [["Deposit Date", "Amount", "Notes"]], body: deposits.deposits.length ? deposits.deposits.map((deposit) => [deposit.depositDate, formatPdfAmount(deposit.amount), deposit.notes || "—"]) : [["No deposits for this period.", "", ""]], headStyles: { fillColor: [20, 120, 90] }, styles: { fontSize: 8 } });
      const depositEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 45; doc.setFontSize(11); doc.text(`Cash Income Before Deposits: ${formatPdfAmount(deposits.cashIncome)}`, 14, depositEnd + 8); doc.text(`Total Deposited: ${formatPdfAmount(deposits.totalDeposited)}`, 14, depositEnd + 15); doc.text(`Available Cash: ${formatPdfAmount(deposits.availableCash)}`, 14, depositEnd + 22); doc.save(`monthly-report-${selectedYear}-${month}.pdf`); toast.success("Monthly report ready");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not generate the monthly report."); } finally { setPrintingPeriod(false); }
  };

  return <AppShell title="Print Center" subtitle="Batch print receipts, member lists, month-end reports, and separate deposit transfers">
    <div className="card-surface mb-4 flex flex-wrap items-center gap-3 p-4"><div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, phone, voucher, cash or account..." className="pl-9" /></div><Select value={status} onValueChange={(value) => setStatus(value as PrintStatusFilter)}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All status</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="partial">Partially paid</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="hold">Hold Ones</SelectItem></SelectContent></Select><Button variant="outline" onClick={toggleAll}><ListChecks className="mr-1.5 h-4 w-4" /> Toggle all</Button><Button variant="outline" onClick={printList} disabled={!selected.size}><Printer className="mr-1.5 h-4 w-4" /> Print list ({selected.size})</Button><Button onClick={() => void printReceipts()} disabled={!selected.size}><FileText className="mr-1.5 h-4 w-4" /> Print receipts ({selected.size})</Button></div>
    <div className="card-surface mb-4 flex flex-wrap items-center gap-3 p-4"><Landmark className="h-5 w-5 text-primary" /><p className="mr-2 text-sm font-medium">Month-end report</p><Select value={month} onValueChange={setMonth}><SelectTrigger className="w-[145px]"><SelectValue /></SelectTrigger><SelectContent>{MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent></Select><Select value={year} onValueChange={setYear}><SelectTrigger className="w-[115px]"><SelectValue /></SelectTrigger><SelectContent>{years.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={() => void printPeriodReport()} disabled={printingPeriod}>{printingPeriod ? <FileText className="mr-1.5 h-4 w-4 animate-pulse" /> : <Printer className="mr-1.5 h-4 w-4" />} Print Monthly Report</Button><p className="text-xs text-muted-foreground">Member results print first; Other Collections and Deposit transfers begin on separate following PDF pages.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((member) => { const isSelected = selected.has(member.id); return <button key={member.id} type="button" onClick={() => toggle(member.id)} className={`card-surface flex items-center gap-3 p-4 text-left transition-all ${isSelected ? "border-primary ring-2 ring-primary" : ""}`}><Checkbox checked={isSelected} className="pointer-events-none" /><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-primary font-semibold text-primary-foreground">{initialsOf(member.name)}</div><div className="min-w-0 flex-1"><p className="truncate font-medium">{member.name}</p><p className="truncate text-xs text-muted-foreground">Due {settings.currency}{member.amount.toLocaleString()} · Outstanding {settings.currency}{member.amount_pending.toLocaleString()} · {MONTHS[member.month - 1]} {member.year}{member.voucher_number ? ` · ${member.voucher_number}` : ""}</p></div></button>; })}{filtered.length === 0 && <div className="card-surface col-span-full p-10 text-center text-muted-foreground">No members match.</div>}</div>
  </AppShell>;
}
