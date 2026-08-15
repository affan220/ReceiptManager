import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTHS, initialsOf } from "@/lib/store";
import { getMemberPayments } from "@/lib/DatabaseService";
import { generateReceiptPDF } from "@/lib/receipt";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import { Printer, FileText, ListChecks, Search } from "lucide-react";

function formatPdfAmount(amount: number) {
  return `RS ${amount.toLocaleString()}`;
}

type PrintStatusFilter = "all" | "paid" | "unpaid" | "pending" | "partial" | "hold";

export default function PrintCenter() {
  const { members, settings } = useApp();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PrintStatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => members.filter((member) => {
    if (status === "hold") return member.hold && (!search || `${member.name} ${member.phone} ${member.payment_mode ?? "cash"} ${member.voucher_number ?? ""}`.toLowerCase().includes(search.toLowerCase()));
    if (status !== "all" && member.status !== status) return false;
    if (search && !`${member.name} ${member.phone} ${member.payment_mode ?? "cash"} ${member.voucher_number ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [members, search, status]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (filtered.every((member) => selected.has(member.id))) setSelected(new Set());
    else setSelected(new Set(filtered.map((member) => member.id)));
  };

  const printReceipts = async () => {
    const list = members.filter((member) => selected.has(member.id));
    if (!list.length) { toast.error("Select members first"); return; }
    let generated = 0;
    let skipped = 0;
    for (const member of list) {
      try {
        // A due can receive multiple payments; use its latest actual transaction for this existing batch action.
        // eslint-disable-next-line no-await-in-loop
        const payment = (await getMemberPayments(member.id))[0];
        if (!payment) { skipped += 1; continue; }
        // eslint-disable-next-line no-await-in-loop
        await generateReceiptPDF(member, payment, settings);
        generated += 1;
      } catch { skipped += 1; }
    }
    if (generated) toast.success(`Generated ${generated} receipt${generated === 1 ? "" : "s"}${skipped ? `; ${skipped} skipped without a payment.` : ""}`);
    else toast.error("No selected contribution has a payment to receipt.");
  };

  const printList = () => {
    const list = members.filter((member) => selected.has(member.id));
    if (!list.length) { toast.error("Select members first"); return; }
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`${settings.name} — Member List`, 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Printed ${new Date().toLocaleString()}`, 14, 25);
    autoTable(doc, {
      startY: 32,
      head: [["#", "Name", "Phone", "Due", "Received", "Outstanding", "Status", "Payment Mode", "Payment Date", "Voucher", "Due Period"]],
      body: list.map((member, index) => [
        index + 1,
        member.name,
        member.phone,
        formatPdfAmount(member.amount),
        formatPdfAmount(member.amount_paid),
        formatPdfAmount(member.amount_pending),
        member.status === "partial" ? "Partially Paid" : member.status,
        (member.payment_mode ?? "cash") === "account" ? "Account" : "Cash",
        member.payment_date ?? "—",
        member.voucher_number ?? "—",
        `${MONTHS[member.month - 1]} ${member.year}`,
      ]),
      headStyles: { fillColor: [20, 120, 90] },
      styles: { fontSize: 8 },
    });
    doc.save(`print-list-${Date.now()}.pdf`);
    toast.success("List ready");
  };

  return (
    <AppShell title="Print Center" subtitle="Batch print receipts and member lists">
      <div className="card-surface mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, phone, voucher, cash or account..." className="pl-9" /></div>
        <Select value={status} onValueChange={(value) => setStatus(value as PrintStatusFilter)}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All status</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="partial">Partially paid</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="hold">Hold Ones</SelectItem></SelectContent></Select>
        <Button variant="outline" onClick={toggleAll}><ListChecks className="mr-1.5 h-4 w-4" /> Toggle all</Button>
        <Button variant="outline" onClick={printList} disabled={!selected.size}><Printer className="mr-1.5 h-4 w-4" /> Print list ({selected.size})</Button>
        <Button onClick={() => void printReceipts()} disabled={!selected.size}><FileText className="mr-1.5 h-4 w-4" /> Print receipts ({selected.size})</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((member) => {
          const isSelected = selected.has(member.id);
          return <button key={member.id} type="button" onClick={() => toggle(member.id)} className={`card-surface flex items-center gap-3 p-4 text-left transition-all ${isSelected ? "border-primary ring-2 ring-primary" : ""}`}><Checkbox checked={isSelected} className="pointer-events-none" /><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-primary font-semibold text-primary-foreground">{initialsOf(member.name)}</div><div className="min-w-0 flex-1"><p className="truncate font-medium">{member.name}</p><p className="truncate text-xs text-muted-foreground">Due {settings.currency}{member.amount.toLocaleString()} · Outstanding {settings.currency}{member.amount_pending.toLocaleString()} · {MONTHS[member.month - 1]} {member.year}{member.voucher_number ? ` · ${member.voucher_number}` : ""}</p></div></button>;
        })}
        {filtered.length === 0 && <div className="card-surface col-span-full p-10 text-center text-muted-foreground">No members match.</div>}
      </div>
    </AppShell>
  );
}
