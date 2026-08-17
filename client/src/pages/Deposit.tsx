import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createDeposit, Deposit, DepositSummary, getDepositSummary, removeDeposit, updateDeposit } from "@/lib/DatabaseService";
import { MONTHS } from "@/lib/store";
import { ArrowDownToLine, CalendarDays, FileSpreadsheet, Loader2, Pencil, Plus, Printer, Trash2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const DASHBOARD_MONTH_KEY = "receipt-manager-dashboard-month";
const DASHBOARD_YEAR_KEY = "receipt-manager-dashboard-year";
const DASHBOARD_LAST_MONTH_KEY = "receipt-manager-dashboard-last-month";
const DASHBOARD_LAST_YEAR_KEY = "receipt-manager-dashboard-last-year";

const emptySummary: DepositSummary = { deposits: [], cashIncome: 0, totalDeposited: 0, availableCash: 0 };
type DepositDraft = { depositDate: string; amount: string; notes: string };

function storedValue(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function localDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function defaultDateForPeriod(month: number, year: number) {
  const today = new Date();
  if (today.getMonth() + 1 === month && today.getFullYear() === year) return localDate(year, month, today.getDate());
  return localDate(year, month, 1);
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function blankDraft(month: number, year: number): DepositDraft {
  return { depositDate: defaultDateForPeriod(month, year), amount: "", notes: "" };
}

export default function DepositPage() {
  const { settings } = useApp();
  const now = new Date();
  const initialMonth = Number(storedValue(DASHBOARD_MONTH_KEY, String(now.getMonth() + 1)));
  const initialYear = Number(storedValue(DASHBOARD_YEAR_KEY, String(now.getFullYear())));
  const fallbackMonth = Number(storedValue(DASHBOARD_LAST_MONTH_KEY, String(now.getMonth() + 1)));
  const fallbackYear = Number(storedValue(DASHBOARD_LAST_YEAR_KEY, String(now.getFullYear())));
  const [month, setMonth] = useState(String(initialMonth >= 1 && initialMonth <= 12 ? initialMonth : fallbackMonth));
  const [year, setYear] = useState(String(initialYear >= 2000 && initialYear <= 2100 ? initialYear : fallbackYear));
  const [summary, setSummary] = useState<DepositSummary>(emptySummary);
  const [draft, setDraft] = useState<DepositDraft>(() => blankDraft(Number(month), Number(year)));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Deposit | null>(null);
  const [editDraft, setEditDraft] = useState<DepositDraft>(() => blankDraft(Number(month), Number(year)));
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState<Deposit | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const selectedMonth = Number(month);
  const selectedYear = Number(year);
  const years = useMemo(() => Array.from({ length: 9 }, (_, index) => now.getFullYear() - 3 + index).reverse(), [now]);
  const currency = settings.currency;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await getDepositSummary(selectedMonth, selectedYear));
    } catch (error) {
      setSummary(emptySummary);
      toast.error(error instanceof Error ? error.message : "Could not load deposits.");
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDraft(blankDraft(selectedMonth, selectedYear)); }, [selectedMonth, selectedYear]);

  const changeMonth = (value: string) => {
    setMonth(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DASHBOARD_LAST_MONTH_KEY, value);
    }
  };
  const changeYear = (value: string) => {
    setYear(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DASHBOARD_LAST_YEAR_KEY, value);
    }
  };

  const saveDeposit = async () => {
    const amount = Number(draft.amount);
    if (!draft.depositDate) { toast.error("Deposit date is required."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Enter a deposit amount greater than zero."); return; }
    setSaving(true);
    try {
      await createDeposit(selectedMonth, selectedYear, draft.depositDate, amount, draft.notes);
      setDraft(blankDraft(selectedMonth, selectedYear));
      await load();
      toast.success("Cash-to-account deposit added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the deposit.");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (deposit: Deposit) => {
    setEditing(deposit);
    setEditDraft({ depositDate: deposit.depositDate, amount: String(deposit.amount), notes: deposit.notes });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const amount = Number(editDraft.amount);
    if (!editDraft.depositDate) { toast.error("Deposit date is required."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Enter a deposit amount greater than zero."); return; }
    setSaving(true);
    try {
      await updateDeposit(editing.id, selectedMonth, selectedYear, editDraft.depositDate, amount, editDraft.notes);
      setEditOpen(false);
      setEditing(null);
      await load();
      toast.success("Deposit updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the deposit.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await removeDeposit(deleting.id);
      setDeleting(null);
      await load();
      toast.success("Deposit deleted. Cash availability was restored.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the deposit.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const printReport = () => {
    const doc = new jsPDF();
    doc.setFontSize(17);
    doc.text(`${settings.name} - DEPOSIT REPORT`, 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`${MONTHS[selectedMonth - 1]} ${selectedYear} · Cash to Account Transfers`, 14, 25);
    doc.setTextColor(25);
    autoTable(doc, {
      startY: 32,
      head: [["Deposit Date", "Amount", "Notes"]],
      body: summary.deposits.length ? summary.deposits.map((deposit) => [displayDate(deposit.depositDate), `${currency}${deposit.amount.toLocaleString()}`, deposit.notes || "—"]) : [["No deposits for this period.", "", ""]],
      headStyles: { fillColor: [20, 120, 90] },
      styles: { fontSize: 9 },
    });
    const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 42;
    doc.setFontSize(10);
    doc.text(`Cash income before deposits: ${currency}${summary.cashIncome.toLocaleString()}`, 14, finalY + 10);
    doc.text(`Total deposited: ${currency}${summary.totalDeposited.toLocaleString()}`, 14, finalY + 17);
    doc.setFontSize(12);
    doc.text(`Available cash: ${currency}${summary.availableCash.toLocaleString()}`, 14, finalY + 26);
    doc.save(`deposit-report-${selectedYear}-${String(selectedMonth).padStart(2, "0")}.pdf`);
    toast.success("Deposit report printed");
  };

  const exportExcel = () => {
    const rows = summary.deposits.map((deposit) => ({ Date: deposit.depositDate, Month: MONTHS[deposit.month - 1], Year: deposit.year, Amount: deposit.amount, Notes: deposit.notes, "Created Date": deposit.createdAt }));
    const sheet = XLSX.utils.aoa_to_sheet([
      ["DEPOSIT REPORT"],
      ["Accounting Period", `${MONTHS[selectedMonth - 1]} ${selectedYear}`],
      ["Cash Income Before Deposits", summary.cashIncome],
      ["Total Deposited", summary.totalDeposited],
      ["Available Cash", summary.availableCash],
      [],
      ["Date", "Month", "Year", "Amount", "Notes", "Created Date"],
      ...rows.map((row) => [row.Date, row.Month, row.Year, row.Amount, row.Notes, row["Created Date"]]),
      [],
      ["Total Deposited", summary.totalDeposited],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Deposits");
    XLSX.writeFile(book, `deposit-report-${selectedYear}-${String(selectedMonth).padStart(2, "0")}.xlsx`);
    toast.success("Deposit Excel exported");
  };

  return (
    <AppShell title="Deposit" subtitle={`Cash to account transfers — ${MONTHS[selectedMonth - 1]} ${selectedYear}`}>
      <div className="card-surface mb-6 flex flex-wrap items-center gap-3 p-4">
        <CalendarDays className="h-5 w-5 text-primary" />
        <Select value={month} onValueChange={changeMonth}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent>{MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={year} onValueChange={changeYear}><SelectTrigger className="w-[115px]"><SelectValue /></SelectTrigger><SelectContent>{years.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select>
        <p className="text-sm text-muted-foreground">A deposit transfers available cash to account. It never creates new income.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card-surface p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available Cash</p><p className="mt-1 font-display text-2xl font-bold text-primary">{currency}{summary.availableCash.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Safe maximum for this period</p></div><WalletCards className="h-5 w-5 text-primary" /></div></div>
        <div className="card-surface p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cash Income</p><p className="mt-1 font-display text-2xl font-bold">{currency}{summary.cashIncome.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Before cash-to-account transfers</p></div>
        <div className="card-surface p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Deposited</p><p className="mt-1 font-display text-2xl font-bold text-warning">{currency}{summary.totalDeposited.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Transferred to account</p></div>
        <div className="card-surface p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deposit Records</p><p className="mt-1 font-display text-2xl font-bold">{summary.deposits.length}</p><p className="mt-1 text-xs text-muted-foreground">{MONTHS[selectedMonth - 1]} {selectedYear} only</p></div>
      </div>

      <section className="card-surface mt-6 overflow-hidden">
        <div className="border-b border-border px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg font-semibold">Add Deposit</h2><p className="text-sm text-muted-foreground">Record the actual bank deposit date. The accounting month remains {MONTHS[selectedMonth - 1]} {selectedYear}.</p></div><ArrowDownToLine className="h-5 w-5 text-primary" /></div></div>
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5"><div className="grid gap-2"><Label htmlFor="deposit-date">Deposit Date</Label><Input id="deposit-date" type="date" value={draft.depositDate} onChange={(event) => setDraft({ ...draft, depositDate: event.target.value })} /></div><div className="grid gap-2"><Label>Accounting Month</Label><div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">{MONTHS[selectedMonth - 1]} {selectedYear}</div></div><div className="grid gap-2"><Label htmlFor="deposit-amount">Amount</Label><div className="flex overflow-hidden rounded-md border border-slate-900 bg-slate-950 text-white shadow-sm dark:border-black"><span className="flex items-center border-r border-white/15 px-3 text-sm text-white/70">{currency}</span><Input id="deposit-amount" type="number" min={0} step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="0" className="h-10 border-0 bg-transparent text-white placeholder:text-slate-400 focus-visible:ring-0" /></div></div><div className="grid gap-2 xl:col-span-1"><Label htmlFor="deposit-notes">Notes <span className="text-muted-foreground">(optional)</span></Label><Input id="deposit-notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Description" /></div><div className="flex items-end"><Button className="w-full" onClick={() => void saveDeposit()} disabled={saving || loading}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Add Deposit</Button></div></div>
      </section>

      <section className="card-surface mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-semibold">Deposit History</h2><p className="text-sm text-muted-foreground">Cash-to-account transfers for {MONTHS[selectedMonth - 1]} {selectedYear}.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button><Button onClick={printReport}><Printer className="mr-1.5 h-4 w-4" />Print Deposit Report</Button></div></div>
        {loading ? <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading deposits…</div> : summary.deposits.length === 0 ? <div className="p-12 text-center text-muted-foreground">No deposits recorded for this accounting period.</div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Deposit Date</TableHead><TableHead>Amount</TableHead><TableHead>Month / Year</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{summary.deposits.map((deposit) => <TableRow key={deposit.id}><TableCell className="font-medium whitespace-nowrap">{displayDate(deposit.depositDate)}</TableCell><TableCell>{currency}{deposit.amount.toLocaleString()}</TableCell><TableCell>{MONTHS[deposit.month - 1]} {deposit.year}</TableCell><TableCell className="max-w-[340px] whitespace-normal text-muted-foreground">{deposit.notes || "—"}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(deposit)} aria-label="Edit deposit"><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleting(deposit)} aria-label="Delete deposit"><Trash2 className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4"><span className="text-sm text-muted-foreground">Cash income {currency}{summary.cashIncome.toLocaleString()} − deposits {currency}{summary.totalDeposited.toLocaleString()}</span><span className="font-display text-xl font-bold">Available Cash {currency}{summary.availableCash.toLocaleString()}</span></div>
      </section>

      <Dialog open={editOpen} onOpenChange={(open) => { if (!open && !saving) setEditOpen(false); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Edit Deposit</DialogTitle><DialogDescription>Changing this transfer recalculates available cash and account balances without changing income totals.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label htmlFor="edit-deposit-date">Deposit Date</Label><Input id="edit-deposit-date" type="date" value={editDraft.depositDate} onChange={(event) => setEditDraft({ ...editDraft, depositDate: event.target.value })} /></div><div className="grid gap-2"><Label htmlFor="edit-deposit-amount">Amount</Label><Input id="edit-deposit-amount" type="number" min={0} step="0.01" value={editDraft.amount} onChange={(event) => setEditDraft({ ...editDraft, amount: event.target.value })} /></div><div className="grid gap-2"><Label htmlFor="edit-deposit-notes">Notes <span className="text-muted-foreground">(optional)</span></Label><Input id="edit-deposit-notes" value={editDraft.notes} onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button></DialogFooter></DialogContent></Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open && !deleteBusy) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this deposit?</AlertDialogTitle><AlertDialogDescription>This removes only the selected cash-to-account transfer. Available cash will increase and account balance will decrease by the same amount; collection totals do not change.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteBusy} onClick={(event) => { event.preventDefault(); void confirmDelete(); }}>{deleteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </AppShell>
  );
}
