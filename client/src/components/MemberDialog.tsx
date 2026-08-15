import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Member, MemberStatus, MONTHS, NewMemberInput, PaymentAllocationInput } from "@/lib/store";
import { useApp } from "@/lib/app-context";
import { MemberLedgerDetail, PaymentRecord } from "@/lib/DatabaseService";
import { toast } from "sonner";
import { Loader2, SlidersHorizontal } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  member?: Member | null;
}

type FormState = NewMemberInput;

function formatPeriod(month: number, year: number) {
  return `${MONTHS[month - 1] ?? "Month"} ${year}`;
}

function suggestedAllocations(detail: MemberLedgerDetail | null, amount: number) {
  let remaining = Math.max(0, amount);
  const allocation: Record<string, number> = {};
  const dues = [...(detail?.dues ?? [])]
    .filter((due) => due.amount_pending > 0 && !due.hold)
    .sort((a, b) => a.year - b.year || a.month - b.month);

  dues.forEach((due) => {
    if (remaining <= 0) return;
    const applied = Math.min(remaining, due.amount_pending);
    allocation[due.id] = applied;
    remaining -= applied;
  });
  return allocation;
}

export function MemberDialog({ open, onOpenChange, member }: Props) {
  const { addMember, getMemberDetail, updateMember, recordPayment } = useApp();
  const isEdit = !!member;
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<FormState>({
    name: "", phone: "", amount: 0, status: "unpaid", payment_mode: "cash",
    month: new Date().getMonth() + 1, year: new Date().getFullYear(), all_months: false,
    hold: false, payment_date: null, voucher_number: null, payment_amount: 0, payment_notes: "", allocations: null,
  });
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<MemberLedgerDetail | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const [manualAllocation, setManualAllocation] = useState(false);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, number>>({});

  const dueOutstanding = detail?.due.amount_pending ?? Math.max(0, form.amount);
  const totalPendingAmount = detail?.due.total_pending_amount ?? dueOutstanding;
  const paymentAmount = Number(form.payment_amount ?? 0);
  const allocatedAmount = Object.values(allocationAmounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const paymentRequired = form.status === "paid" || form.status === "partial" || paymentAmount > 0;

  useEffect(() => {
    let active = true;
    if (!open) return () => { active = false; };

    const now = new Date();
    if (!member) {
      setDetail(null);
      setPaymentHistory([]);
      setManualAllocation(false);
      setAllocationAmounts({});
      setForm({
        name: "", phone: "", amount: 0, status: "unpaid", payment_mode: "cash",
        month: now.getMonth() + 1, year: now.getFullYear(), all_months: false,
        hold: false, payment_date: null, voucher_number: null, payment_amount: 0, payment_notes: "", allocations: null,
      });
      return () => { active = false; };
    }

    setForm({
      name: member.name,
      phone: member.phone,
      amount: member.amount,
      status: member.status,
      payment_mode: member.payment_mode ?? "cash",
      month: member.month,
      year: member.year,
      all_months: false,
      hold: member.hold,
      payment_date: member.payment_date,
      voucher_number: member.voucher_number,
      payment_amount: 0,
      payment_notes: "",
      allocations: null,
    });
    setManualAllocation(false);
    setAllocationAmounts({});
    void getMemberDetail(member.id).then((latest) => {
      if (!active || !latest) return;
      setDetail(latest);
      setPaymentHistory(latest.payments);
      setForm((previous) => ({
        ...previous,
        name: latest.due.name,
        phone: latest.due.phone,
        amount: latest.due.amount,
        status: latest.due.status,
        payment_mode: latest.due.payment_mode ?? "cash",
        hold: latest.due.hold,
        payment_date: latest.due.payment_date,
        voucher_number: latest.due.voucher_number,
      }));
    });
    return () => { active = false; };
  }, [open, member, getMemberDetail]);

  useEffect(() => {
    if (!manualAllocation) return;
    setAllocationAmounts(suggestedAllocations(detail, paymentAmount));
  }, [manualAllocation, paymentAmount, detail]);

  const allocationRows = useMemo(() => [...(detail?.dues ?? [])]
    .filter((due) => due.amount_pending > 0 && !due.hold)
    .sort((a, b) => a.year - b.year || a.month - b.month), [detail]);

  const paymentAllocations = (): PaymentAllocationInput[] | null => {
    if (!manualAllocation) return null;
    return allocationRows
      .map((due) => ({ monthly_due_id: due.id, allocated_amount: Number(allocationAmounts[due.id] ?? 0) }))
      .filter((allocation) => allocation.allocated_amount > 0);
  };

  const refreshDetail = async (id: string) => {
    const latest = await getMemberDetail(id);
    if (!latest) return;
    setDetail(latest);
    setPaymentHistory(latest.payments);
    setForm((previous) => ({
      ...previous,
      name: latest.due.name,
      phone: latest.due.phone,
      amount: latest.due.amount,
      status: latest.due.status,
      payment_mode: latest.due.payment_mode ?? "cash",
      hold: latest.due.hold,
      payment_date: latest.due.payment_date,
      voucher_number: latest.due.voucher_number,
      payment_amount: 0,
      payment_notes: "",
    }));
    setManualAllocation(false);
    setAllocationAmounts({});
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (form.amount < 0) {
      toast.error("Monthly amount must be zero or greater.");
      return;
    }
    if (!isEdit && paymentRequired && paymentAmount <= 0) {
      toast.error("Enter the actual payment amount received.");
      return;
    }
    if (isEdit && form.status === "paid" && paymentAmount <= 0 && dueOutstanding > 0) {
      toast.error("To mark this due paid, record the actual payment amount below.");
      return;
    }
    if (manualAllocation && paymentAmount > 0) {
      if (Math.abs(allocatedAmount - paymentAmount) > 0.001) {
        toast.error("Manual allocations must equal the payment amount.");
        return;
      }
      const invalid = allocationRows.some((due) => (allocationAmounts[due.id] ?? 0) > due.amount_pending);
      if (invalid) {
        toast.error("An allocation exceeds the remaining amount for that month.");
        return;
      }
    }

    setBusy(true);
    try {
      if (isEdit && member) {
        const updated = await updateMember(member.id, {
          name: form.name,
          phone: form.phone,
          amount: form.amount,
          status: form.status,
          hold: form.hold,
        });
        if (paymentAmount > 0) {
          const payment = await recordPayment(
            updated.id,
            paymentAmount,
            form.payment_date || today,
            form.payment_mode,
            form.voucher_number,
            form.payment_notes,
            paymentAllocations(),
          );
          toast.success(`Payment ${payment.voucherNumber} recorded`);
        }
        await refreshDetail(updated.id);
        toast.success("Monthly contribution updated");
        onOpenChange(false);
      } else {
        const initialPayment = paymentRequired ? paymentAmount : 0;
        const result = await addMember({
          ...form,
          status: initialPayment > 0 ? form.status : (form.status === "paid" || form.status === "partial" ? "pending" : form.status),
          payment_amount: initialPayment,
          payment_date: initialPayment > 0 ? (form.payment_date || today) : null,
        });
        if (result?.payment) toast.success(`Payment ${result.payment.voucherNumber} recorded`);
        if (result) onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 2 + i);
  const displayStatus = detail?.due.status ?? form.status;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-1.5rem)] flex-col overflow-hidden p-0 sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader className="shrink-0 border-b border-border px-5 pb-3 pt-5 sm:px-6">
          <DialogTitle>{isEdit ? "Edit member" : "Add new member"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this month only. Payment transactions remain in history." : "Fill in contribution and contact details."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="grid gap-4 pb-2">
            <div className="grid gap-2">
              <Label>Full name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Member name"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 ..." />
              </div>
              <div className="grid gap-2">
                <Label>Monthly amount</Label>
                <Input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>Month</Label>
                <Select
                  value={form.all_months ? "all_months" : String(form.month)}
                  disabled={isEdit}
                  onValueChange={(value) => setForm({ ...form, all_months: value === "all_months", month: value === "all_months" ? 1 : Number(value) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!isEdit && <SelectItem value="all_months">ALL MONTHS</SelectItem>}
                    {MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Year</Label>
                <Select value={String(form.year)} disabled={isEdit} onValueChange={(value) => setForm({ ...form, year: Number(value) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{years.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={displayStatus}
                  onValueChange={(value) => {
                    const status = value as MemberStatus;
                    const shouldPrefillPayment = !isEdit && status === "paid" && paymentAmount <= 0;
                    setForm({
                      ...form,
                      status,
                      payment_amount: shouldPrefillPayment ? form.amount : form.payment_amount,
                      payment_date: (status === "paid" || status === "partial") && !form.payment_date ? today : form.payment_date,
                    });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="partial">Partially Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.all_months && !isEdit && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                This creates an independent contribution record for every month of {form.year}. Existing months for the same name and phone are safely skipped.
              </div>
            )}

            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <Label className="text-sm">Actual payment</Label>
                  <p className="text-xs text-muted-foreground">A payment is stored once and can clear one or more pending months.</p>
                </div>
                {isEdit && <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium capitalize">{displayStatus}</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="payment-amount">Amount received</Label>
                  <Input id="payment-amount" type="number" min={0} step="0.01" value={form.payment_amount ?? 0} onChange={(e) => setForm({ ...form, payment_amount: Number(e.target.value) })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="payment-date">Payment date</Label>
                  <Input id="payment-date" type="date" value={form.payment_date ?? today} onChange={(e) => setForm({ ...form, payment_date: e.target.value || null })} disabled={paymentAmount <= 0 && !paymentRequired} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="voucher-number">Voucher number</Label>
                  <Input id="voucher-number" value={form.voucher_number ?? ""} onChange={(e) => setForm({ ...form, voucher_number: e.target.value })} placeholder="Auto-generated if blank" autoComplete="off" disabled={paymentAmount <= 0 && !paymentRequired} />
                </div>
                <div className="grid gap-2">
                  <Label>Payment mode</Label>
                  <div className="flex rounded-lg border border-input bg-muted/40 p-1">
                    <button type="button" disabled={paymentAmount <= 0 && !paymentRequired} onClick={() => setForm({ ...form, payment_mode: "cash" })} className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${(form.payment_mode ?? "cash") === "cash" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Cash</button>
                    <button type="button" disabled={paymentAmount <= 0 && !paymentRequired} onClick={() => setForm({ ...form, payment_mode: "account" })} className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${form.payment_mode === "account" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Account</button>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                <Label htmlFor="payment-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="payment-notes" value={form.payment_notes ?? ""} onChange={(e) => setForm({ ...form, payment_notes: e.target.value })} placeholder="Optional payment note" disabled={paymentAmount <= 0} />
              </div>

              {isEdit && paymentAmount > 0 && (
                <div className="mt-4 rounded-lg border border-border bg-background/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Payment allocation</p>
                      <p className="text-xs text-muted-foreground">Oldest pending months are used automatically unless you adjust them.</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setManualAllocation((value) => !value)}>
                      <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> {manualAllocation ? "Use automatic" : "Adjust"}
                    </Button>
                  </div>
                  {manualAllocation && (
                    <div className="mt-3 space-y-2">
                      {allocationRows.map((due) => (
                        <div key={due.id} className="grid grid-cols-[1fr_96px] items-center gap-3 text-sm">
                          <div>
                            <p className="font-medium">{formatPeriod(due.month, due.year)}</p>
                            <p className="text-xs text-muted-foreground">Remaining {due.amount_pending.toLocaleString()}</p>
                          </div>
                          <Input type="number" min={0} max={due.amount_pending} step="0.01" value={allocationAmounts[due.id] ?? 0} onChange={(e) => setAllocationAmounts({ ...allocationAmounts, [due.id]: Number(e.target.value) })} />
                        </div>
                      ))}
                      {allocationRows.length === 0 && <p className="text-xs text-muted-foreground">No outstanding month is available for allocation.</p>}
                      <div className="mt-2 flex justify-between border-t border-border pt-2 text-xs">
                        <span>Total payment: <strong>{paymentAmount.toLocaleString()}</strong></span>
                        <span>Allocated: <strong>{allocatedAmount.toLocaleString()}</strong> · Remaining: <strong>{Math.max(paymentAmount - allocatedAmount, 0).toLocaleString()}</strong></span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-3 py-2">
              <div>
                <Label className="text-sm">On hold</Label>
                <p className="text-xs text-muted-foreground">Pause reminders for this month only.</p>
              </div>
              <Switch checked={form.hold} onCheckedChange={(value) => setForm({ ...form, hold: value })} />
            </div>

            {(totalPendingAmount > 0 || displayStatus === "pending" || displayStatus === "partial") && (
              <div className="grid gap-2 rounded-xl border border-border bg-warning/10 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Pending summary</span>
                  <span className="text-xs text-muted-foreground">{detail?.due.months_pending ?? (dueOutstanding > 0 ? 1 : 0)} month{(detail?.due.months_pending ?? (dueOutstanding > 0 ? 1 : 0)) === 1 ? "" : "s"}</span>
                </div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">This month due</span><span className="font-medium">RS {form.amount.toLocaleString()}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">This month remaining</span><span className="font-medium">RS {dueOutstanding.toLocaleString()}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Total pending amount</span><span className="font-semibold text-warning">RS {totalPendingAmount.toLocaleString()}</span></div>
              </div>
            )}

            {isEdit && paymentHistory.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between"><Label className="text-sm">Payment history</Label><span className="text-xs text-muted-foreground">{paymentHistory.length} payment{paymentHistory.length === 1 ? "" : "s"}</span></div>
                <div className="space-y-2">
                  {paymentHistory.map((payment) => (
                    <div key={payment.id} className="rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono font-medium">{payment.voucherNumber}</span><span>{new Date(`${payment.paymentDate}T00:00:00`).toLocaleDateString()} · RS {payment.amount.toLocaleString()} · {payment.paymentMethod === "account" ? "Account" : "Cash"}</span></div>
                      {payment.allocations.length > 0 && <p className="mt-1 text-muted-foreground">Covers: {payment.allocations.map((allocation) => `${formatPeriod(allocation.month, allocation.year)} (${allocation.allocatedAmount.toLocaleString()})`).join(", ")}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-background px-5 py-3 sm:px-6" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Add member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
