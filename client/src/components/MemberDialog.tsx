import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Member, MONTHS, MemberStatus } from "@/lib/store";
import { useApp } from "@/lib/app-context";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  member?: Member | null;
}

export function MemberDialog({ open, onOpenChange, member }: Props) {
  const { addMember, updateMember } = useApp();
  const isEdit = !!member;
  const [form, setForm] = useState<Partial<Member>>({});
  const [busy, setBusy] = useState(false);
  const monthlyAmount = Number(form.amount ?? 0);
  const pendingMonths = Number(form.months_pending ?? 0);
  const totalPendingAmount = monthlyAmount * Math.max(1, pendingMonths);

  useEffect(() => {
    if (open) {
      const now = new Date();
      setForm(
        member
          ? { ...member, payment_mode: member.payment_mode ?? "cash" }
          : {
              name: "", phone: "", amount: 0, status: "unpaid", payment_mode: "cash",
              month: now.getMonth() + 1, year: now.getFullYear(),
              hold: false, months_pending: 0,
              payment_date: null, voucher_number: null,
            }
      );
    }
  }, [open, member]);


  const save = async () => {
    if (!form.name?.trim()) {
      toast.error("Name is required");
      return;
    }

    setBusy(true);
    try {
      if (isEdit && member) {
        await updateMember(member.id, form);
        toast.success("Member updated");
        onOpenChange(false);
      } else {
        const created = await addMember(form);
        if (created) {
          toast.success("Member added successfully");
          onOpenChange(false);
        }
        // If created is null, addMember already showed the error toast
      }
    } finally {
      setBusy(false);
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit member" : "Add new member"}</DialogTitle>
          <DialogDescription>Fill in contribution and contact details.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Full name</Label>
            <Input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Member name"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 ..."
              />
            </div>
            <div className="grid gap-2">
              <Label>Amount</Label>
              <Input
                type="number"
                min={0}
                value={form.amount ?? 0}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Month</Label>
              <Select
                value={String(form.month)}
                onValueChange={(v) => setForm({ ...form, month: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Year</Label>
              <Select
                value={String(form.year)}
                onValueChange={(v) => setForm({ ...form, year: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as MemberStatus })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isEdit && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/20 p-3">
              <div className="grid gap-2">
                <Label htmlFor="payment-date">Payment date</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={form.payment_date ?? ""}
                  onChange={(e) => setForm({ ...form, payment_date: e.target.value || null })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="voucher-number">Voucher number</Label>
                <Input
                  id="voucher-number"
                  value={form.voucher_number ?? ""}
                  onChange={(e) => setForm({ ...form, voucher_number: e.target.value })}
                  placeholder="e.g. VCH-2026-001"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Payment Mode</Label>
              <div className="flex rounded-lg border border-input p-1 bg-muted/40">
                <button
                  type="button"
                  disabled={form.status !== "paid"}
                  onClick={() => setForm({ ...form, payment_mode: "cash" })}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    (form.payment_mode ?? "cash") === "cash"
                      ? "bg-background text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  } ${form.status !== "paid" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  💵 Cash
                </button>
                <button
                  type="button"
                  disabled={form.status !== "paid"}
                  onClick={() => setForm({ ...form, payment_mode: "account" })}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    form.payment_mode === "account"
                      ? "bg-background text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  } ${form.status !== "paid" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  🏦 Account
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Months pending</Label>
              <Input
                type="number"
                min={0}
                value={form.months_pending ?? 0}
                onChange={(e) => setForm({ ...form, months_pending: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-3 py-2">
            <div>
              <Label className="text-sm">On hold</Label>
              <p className="text-xs text-muted-foreground">Pause reminders</p>
            </div>
            <Switch
              checked={!!form.hold}
              onCheckedChange={(v) => setForm({ ...form, hold: v })}
            />
          </div>


          {(pendingMonths > 0 || form.status === "pending") && (
            <div className="grid gap-2 rounded-xl border border-border bg-warning/10 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Pending summary</span>
                <span className="text-xs text-muted-foreground">
                  {pendingMonths} month{pendingMonths === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Monthly amount</span>
                <span className="font-medium">RS {monthlyAmount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total pending amount</span>
                <span className="font-semibold text-warning">RS {totalPendingAmount.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Add member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
