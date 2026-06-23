import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Member, MONTHS, MemberStatus } from "@/lib/store";
import { useApp } from "@/lib/app-context";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  member?: Member | null;
}

export function MemberDialog({ open, onOpenChange, member }: Props) {
  const { addMember, updateMember } = useApp();
  const isEdit = !!member;
  const [form, setForm] = useState<Partial<Member>>({});

  useEffect(() => {
    if (open) {
      const now = new Date();
      setForm(member ?? {
        name: "", phone: "", amount: 0, status: "unpaid",
        month: now.getMonth() + 1, year: now.getFullYear(),
        hold: false, months_pending: 0,
      });
    }
  }, [open, member]);

  const save = () => {
    if (!form.name?.trim()) {
      toast.error("Name is required");
      return;
    }
    if (isEdit && member) {
      updateMember(member.id, form);
      toast.success("Member updated");
    } else {
      addMember(form);
      toast.success("Member added");
    }
    onOpenChange(false);
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
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Member name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 ..." />
            </div>
            <div className="grid gap-2">
              <Label>Amount</Label>
              <Input type="number" value={form.amount ?? 0} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Month</Label>
              <Select value={String(form.month)} onValueChange={(v) => setForm({ ...form, month: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Year</Label>
              <Select value={String(form.year)} onValueChange={(v) => setForm({ ...form, year: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as MemberStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Months pending</Label>
              <Input type="number" value={form.months_pending ?? 0} onChange={(e) => setForm({ ...form, months_pending: Number(e.target.value) })} />
            </div>
            <div className="flex items-end justify-between rounded-xl border border-border bg-muted/30 px-3 py-2">
              <div>
                <Label className="text-sm">On hold</Label>
                <p className="text-xs text-muted-foreground">Pause reminders</p>
              </div>
              <Switch checked={!!form.hold} onCheckedChange={(v) => setForm({ ...form, hold: v })} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>{isEdit ? "Save changes" : "Add member"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
