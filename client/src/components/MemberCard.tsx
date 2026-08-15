import { Member, MONTHS, initialsOf } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, MessageCircle, Pencil, Pause, Play, Trash2, FileText, CheckCircle2 } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { getMemberPayments } from "@/lib/DatabaseService";
import { toast } from "sonner";
import { generateReceiptPDF } from "@/lib/receipt";

interface Props {
  member: Member;
  onEdit: (m: Member) => void;
}

const statusStyles: Record<Member["status"], string> = {
  paid: "bg-success/15 text-success border-success/30",
  unpaid: "bg-destructive/15 text-destructive border-destructive/30",
  pending: "bg-warning/15 text-warning border-warning/30",
  partial: "bg-warning/15 text-warning border-warning/30",
};

export function MemberCard({ member, onEdit }: Props) {
  const { settings, deleteMember, toggleHold } = useApp();
  const pendingMonths = Number(member.months_pending ?? 0);
  const pendingTotal = Number(member.total_pending_amount ?? member.amount_pending ?? 0);

  const whatsapp = () => {
    const phone = member.phone.replace(/[^\d]/g, "");
    if (!phone) {
      toast.error("No phone number on file");
      return;
    }
    const message = encodeURIComponent(
      `Assalamu Alaikum ${member.name},\n\nThis is a reminder from ${settings.name} regarding your contribution of ${settings.currency}${member.amount_pending.toLocaleString()} remaining for ${MONTHS[member.month - 1]} ${member.year}.\n\nJazakAllah Khair.`,
    );
    window.open(`https://wa.me/${phone}?text=${message}`, "_blank");
  };

  const handleReceipt = async () => {
    try {
      const history = await getMemberPayments(member.id);
      const payment = history[0];
      if (!payment) {
        toast.error("Record a payment before generating a receipt.");
        return;
      }
      const number = await generateReceiptPDF(member, payment, settings);
      toast.success(`Receipt ${number} generated`);
    } catch {
      toast.error("Failed to generate receipt");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMember(member.id);
      toast.success(`${MONTHS[member.month - 1]} ${member.year} contribution record deleted`);
    } catch {
      // The shared provider presents the specific database failure.
    }
  };

  return (
    <div className="card-surface group flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-primary font-display font-semibold text-primary-foreground shadow-soft">{initialsOf(member.name)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h3 className="truncate font-semibold">{member.name}</h3>{member.hold && <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Hold</span>}</div>
          <p className="truncate text-xs text-muted-foreground">{member.phone || "No phone"}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="-mr-2 h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={whatsapp}><MessageCircle className="mr-2 h-4 w-4" /> WhatsApp reminder</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(member)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(member)}><CheckCircle2 className="mr-2 h-4 w-4" /> Record payment</DropdownMenuItem>
            <DropdownMenuItem onClick={handleReceipt}><FileText className="mr-2 h-4 w-4" /> Generate receipt</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void toggleHold(member.id)}>{member.hold ? <><Play className="mr-2 h-4 w-4" /> Resume</> : <><Pause className="mr-2 h-4 w-4" /> Put on hold</>}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void handleDelete()}><Trash2 className="mr-2 h-4 w-4" /> Delete this month</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Contribution</p><p className="font-display text-xl font-bold">{settings.currency}{member.amount.toLocaleString()}</p><p className="mt-0.5 text-xs text-muted-foreground">{MONTHS[member.month - 1]} {member.year}</p></div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap justify-end gap-1.5"><span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusStyles[member.status]}`}>{member.status === "partial" ? "Partially paid" : member.status}</span><span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${(member.payment_mode ?? "cash") === "account" ? "border-blue-500/30 bg-blue-500/15 text-blue-600 dark:text-blue-400" : "border-success/30 bg-success/15 text-success"}`}>{(member.payment_mode ?? "cash") === "account" ? "Account" : "Cash"}</span></div>
          {pendingMonths > 0 && <div className="text-right text-[11px] leading-tight text-muted-foreground"><div>{pendingMonths} month{pendingMonths > 1 ? "s" : ""} pending</div><div>This month: RS {member.amount_pending.toLocaleString()}</div><div>Total: RS {pendingTotal.toLocaleString()}</div></div>}
        </div>
      </div>

      {(member.payment_date || member.voucher_number) && <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{member.payment_date && <div>Latest payment: {new Date(`${member.payment_date}T00:00:00`).toLocaleDateString()}</div>}{member.voucher_number && <div>Voucher: {member.voucher_number}</div>}</div>}

      <div className="flex gap-2 pt-1"><Button variant="outline" size="sm" className="flex-1" onClick={whatsapp}><MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Remind</Button><Button variant="default" size="sm" className="flex-1" onClick={handleReceipt}><FileText className="mr-1.5 h-3.5 w-3.5" /> Receipt</Button></div>
    </div>
  );
}
