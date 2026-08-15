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
import { getOtherIncome, createRoomRent, removeFridayCollection, removeRoomRent, saveFridayCollection, updateRoomRent, OtherIncomeSummary, RoomRent } from "@/lib/DatabaseService";
import { MONTHS, PaymentMode } from "@/lib/store";
import { Building2, CalendarDays, Loader2, Pencil, Plus, Save, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

type FridayDraft = { amount: string; paymentMode: PaymentMode; notes: string };
type RentDraft = { date: string; amount: string; paymentMode: PaymentMode; notes: string };
type DeleteTarget = { type: "friday" | "rent"; id: string } | null;

const emptyOther: OtherIncomeSummary = {
  fridayCollections: [], roomRents: [], fridayTotal: 0, roomRentTotal: 0, otherTotal: 0, cashTotal: 0, accountTotal: 0,
};

function localDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fridaysForMonth(year: number, month: number) {
  const lastDay = new Date(year, month, 0).getDate();
  const rows: string[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    if (new Date(year, month - 1, day).getDay() === 5) rows.push(localDate(year, month, day));
  }
  return rows;
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function blankRent(date: string): RentDraft {
  return { date, amount: "", paymentMode: "cash", notes: "" };
}

export default function Other() {
  const { settings } = useApp();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [income, setIncome] = useState<OtherIncomeSummary>(emptyOther);
  const [loading, setLoading] = useState(true);
  const [savingFriday, setSavingFriday] = useState<string | null>(null);
  const [fridayDrafts, setFridayDrafts] = useState<Record<string, FridayDraft>>({});
  const [rentOpen, setRentOpen] = useState(false);
  const [editingRent, setEditingRent] = useState<RoomRent | null>(null);
  const [rentDraft, setRentDraft] = useState<RentDraft>(() => blankRent(localDate(now.getFullYear(), now.getMonth() + 1, now.getDate())));
  const [savingRent, setSavingRent] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);

  const selectedMonth = Number(month);
  const selectedYear = Number(year);
  const fridayDates = useMemo(() => fridaysForMonth(selectedYear, selectedMonth), [selectedMonth, selectedYear]);
  const years = useMemo(() => Array.from({ length: 9 }, (_, index) => now.getFullYear() - 3 + index).reverse(), [now]);
  const currency = settings.currency;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getOtherIncome(selectedMonth, selectedYear);
      setIncome(next);
      const saved = new Map(next.fridayCollections.map((row) => [row.collectionDate, row]));
      setFridayDrafts((current) => {
        const draft: Record<string, FridayDraft> = {};
        fridayDates.forEach((date) => {
          const existing = saved.get(date);
          draft[date] = current[date] ?? (existing ? { amount: String(existing.amount), paymentMode: existing.paymentMode, notes: existing.notes } : { amount: "", paymentMode: "cash", notes: "" });
        });
        return draft;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Other collections.");
      setIncome(emptyOther);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear, fridayDates]);

  useEffect(() => { void load(); }, [load]);

  const fridayByDate = useMemo(() => new Map(income.fridayCollections.map((row) => [row.collectionDate, row])), [income.fridayCollections]);
  const updateFridayDraft = (date: string, patch: Partial<FridayDraft>) => setFridayDrafts((current) => ({ ...current, [date]: { ...(current[date] ?? { amount: "", paymentMode: "cash", notes: "" }), ...patch } }));

  const saveFriday = async (date: string) => {
    const draft = fridayDrafts[date] ?? { amount: "", paymentMode: "cash", notes: "" };
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter an amount greater than zero before saving this Friday.");
      return;
    }
    setSavingFriday(date);
    try {
      await saveFridayCollection(date, amount, draft.paymentMode, draft.notes);
      await load();
      toast.success(`Friday collection for ${displayDate(date)} saved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the Friday collection.");
    } finally {
      setSavingFriday(null);
    }
  };

  const openAddRent = () => {
    setEditingRent(null);
    setRentDraft(blankRent(localDate(selectedYear, selectedMonth, 1)));
    setRentOpen(true);
  };

  const openEditRent = (rent: RoomRent) => {
    setEditingRent(rent);
    setRentDraft({ date: rent.rentDate, amount: String(rent.amount), paymentMode: rent.paymentMode, notes: rent.notes });
    setRentOpen(true);
  };

  const saveRent = async () => {
    const amount = Number(rentDraft.amount);
    if (!rentDraft.date) { toast.error("Room rent date is required."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Enter a room rent amount greater than zero."); return; }
    setSavingRent(true);
    try {
      if (editingRent) await updateRoomRent(editingRent.id, rentDraft.date, amount, rentDraft.paymentMode, rentDraft.notes);
      else await createRoomRent(rentDraft.date, amount, rentDraft.paymentMode, rentDraft.notes);
      setRentOpen(false);
      await load();
      toast.success(editingRent ? "Room rent updated" : "Room rent added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the room rent.");
    } finally {
      setSavingRent(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === "friday") await removeFridayCollection(deleteTarget.id);
      else await removeRoomRent(deleteTarget.id);
      setDeleteTarget(null);
      await load();
      toast.success(deleteTarget.type === "friday" ? "Friday collection deleted" : "Room rent deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete this record.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppShell title="Other" subtitle={`Friday collections and room rents — ${MONTHS[selectedMonth - 1]} ${selectedYear}`}>
      <div className="card-surface mb-6 flex flex-wrap items-center gap-3 p-4">
        <CalendarDays className="h-5 w-5 text-primary" />
        <Select value={month} onValueChange={setMonth}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent>{MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={year} onValueChange={setYear}><SelectTrigger className="w-[115px]"><SelectValue /></SelectTrigger><SelectContent>{years.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select>
        <p className="text-sm text-muted-foreground">Friday dates are generated from the actual calendar. Opening a month never creates blank records.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="card-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Friday Collection</p><p className="mt-1 text-2xl font-display font-bold">{currency}{income.fridayTotal.toLocaleString()}</p></div>
        <div className="card-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Room Rent</p><p className="mt-1 text-2xl font-display font-bold">{currency}{income.roomRentTotal.toLocaleString()}</p></div>
        <div className="card-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Other Total</p><p className="mt-1 text-2xl font-display font-bold text-primary">{currency}{income.otherTotal.toLocaleString()}</p></div>
        <div className="card-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Other Cash</p><p className="mt-1 text-2xl font-display font-bold">{currency}{income.cashTotal.toLocaleString()}</p></div>
        <div className="card-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Other Account</p><p className="mt-1 text-2xl font-display font-bold">{currency}{income.accountTotal.toLocaleString()}</p></div>
      </div>

      <section className="card-surface mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-semibold">Friday Collection</h2><p className="text-sm text-muted-foreground">Enter only actual amounts. Each Friday is one independent collection record.</p></div><Wallet className="h-5 w-5 text-primary" /></div>
        {loading ? <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading collections…</div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Friday Date</TableHead><TableHead className="min-w-[150px]">Amount</TableHead><TableHead className="min-w-[135px]">Mode</TableHead><TableHead className="min-w-[170px]">Notes</TableHead><TableHead className="w-[130px] text-right">Action</TableHead></TableRow></TableHeader><TableBody>{fridayDates.map((date) => { const saved = fridayByDate.get(date); const draft = fridayDrafts[date] ?? { amount: "", paymentMode: "cash" as PaymentMode, notes: "" }; return <TableRow key={date}><TableCell className="font-medium whitespace-nowrap">{displayDate(date)}</TableCell><TableCell><div className="flex overflow-hidden rounded-md border border-slate-900 bg-slate-950 text-white shadow-sm dark:border-black"><span className="flex items-center border-r border-white/15 px-2 text-sm text-white/70">{currency}</span><Input type="number" min={0} step="0.01" value={draft.amount} onChange={(event) => updateFridayDraft(date, { amount: event.target.value })} placeholder="0" className="h-9 border-0 bg-transparent text-white placeholder:text-slate-400 focus-visible:ring-0" /></div></TableCell><TableCell><Select value={draft.paymentMode} onValueChange={(value) => updateFridayDraft(date, { paymentMode: value as PaymentMode })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="account">Account</SelectItem></SelectContent></Select></TableCell><TableCell><Input value={draft.notes} onChange={(event) => updateFridayDraft(date, { notes: event.target.value })} placeholder="Optional" className="h-9" /></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="sm" onClick={() => void saveFriday(date)} disabled={savingFriday === date}>{savingFriday === date ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-1 h-3.5 w-3.5" />Save</>}</Button>{saved && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ type: "friday", id: saved.id })} aria-label={`Delete collection for ${displayDate(date)}`}><Trash2 className="h-4 w-4" /></Button>}</div></TableCell></TableRow>; })}</TableBody></Table></div>}
        <div className="border-t border-border px-5 py-4 text-right"><span className="text-sm text-muted-foreground">Friday Collection Total</span><span className="ml-3 font-display text-xl font-bold">{currency}{income.fridayTotal.toLocaleString()}</span></div>
      </section>

      <section className="card-surface mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-semibold">Room Rent</h2><p className="text-sm text-muted-foreground">Independent manual entries based on their actual collection date.</p></div><Button onClick={openAddRent}><Plus className="mr-1.5 h-4 w-4" /> Add Room Rent</Button></div>
        {loading ? <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading room rents…</div> : income.roomRents.length === 0 ? <div className="p-10 text-center text-muted-foreground">No room rent records for this month.</div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Payment Mode</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{income.roomRents.map((rent) => <TableRow key={rent.id}><TableCell className="font-medium">{displayDate(rent.rentDate)}</TableCell><TableCell>{currency}{rent.amount.toLocaleString()}</TableCell><TableCell>{rent.paymentMode === "account" ? "Account" : "Cash"}</TableCell><TableCell className="max-w-[280px] whitespace-normal text-muted-foreground">{rent.notes || "—"}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEditRent(rent)} aria-label="Edit room rent"><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ type: "rent", id: rent.id })} aria-label="Delete room rent"><Trash2 className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
        <div className="border-t border-border px-5 py-4 text-right"><span className="text-sm text-muted-foreground">Room Rent Total</span><span className="ml-3 font-display text-xl font-bold">{currency}{income.roomRentTotal.toLocaleString()}</span></div>
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-5 py-4"><div><p className="text-sm font-medium">Other Total</p><p className="text-xs text-muted-foreground">Friday Collection + Room Rent for {MONTHS[selectedMonth - 1]} {selectedYear}</p></div><p className="font-display text-2xl font-bold text-primary">{currency}{income.otherTotal.toLocaleString()}</p></div>

      <Dialog open={rentOpen} onOpenChange={setRentOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{editingRent ? "Edit Room Rent" : "Add Room Rent"}</DialogTitle><DialogDescription>Use the actual collection date. The entry will appear in that month’s Other and dashboard totals.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label htmlFor="rent-date">Date</Label><Input id="rent-date" type="date" value={rentDraft.date} onChange={(event) => setRentDraft({ ...rentDraft, date: event.target.value })} /></div><div className="grid gap-2"><Label htmlFor="rent-amount">Amount</Label><Input id="rent-amount" type="number" min={0} step="0.01" value={rentDraft.amount} onChange={(event) => setRentDraft({ ...rentDraft, amount: event.target.value })} placeholder="0" /></div><div className="grid gap-2"><Label>Payment Mode</Label><Select value={rentDraft.paymentMode} onValueChange={(value) => setRentDraft({ ...rentDraft, paymentMode: value as PaymentMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="account">Account</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="rent-notes">Notes <span className="text-muted-foreground">(optional)</span></Label><Input id="rent-notes" value={rentDraft.notes} onChange={(event) => setRentDraft({ ...rentDraft, notes: event.target.value })} placeholder="Optional note" /></div></div><DialogFooter><Button variant="outline" onClick={() => setRentOpen(false)} disabled={savingRent}>Cancel</Button><Button onClick={() => void saveRent()} disabled={savingRent}>{savingRent && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editingRent ? "Save changes" : "Save room rent"}</Button></DialogFooter></DialogContent></Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this record?</AlertDialogTitle><AlertDialogDescription>This will remove only the selected {deleteTarget?.type === "friday" ? "Friday collection" : "room-rent entry"}. Member dues, payments, receipts, and other months will not be affected.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting} onClick={(event) => { event.preventDefault(); void confirmDelete(); }}>{deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </AppShell>
  );
}
