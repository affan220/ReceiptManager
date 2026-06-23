import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTHS, initialsOf } from "@/lib/store";
import { generateReceiptPDF } from "@/lib/receipt";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import { Printer, FileText, ListChecks, Search } from "lucide-react";

export default function PrintCenter() {
  const { members, settings } = useApp();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => members.filter((m) => {
    if (status !== "all" && m.status !== status) return false;
    if (search && !`${m.name} ${m.phone}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [members, search, status]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleAll = () => {
    if (filtered.every((m) => selected.has(m.id))) setSelected(new Set());
    else setSelected(new Set(filtered.map((m) => m.id)));
  };

  const printReceipts = async () => {
    const list = members.filter((m) => selected.has(m.id));
    if (!list.length) { toast.error("Select members first"); return; }
    for (const m of list) {
      // eslint-disable-next-line no-await-in-loop
      await generateReceiptPDF(m, settings);
    }
    toast.success(`Generated ${list.length} receipts`);
  };

  const printList = () => {
    const list = members.filter((m) => selected.has(m.id));
    if (!list.length) { toast.error("Select members first"); return; }
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`${settings.name} — Member List`, 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Printed ${new Date().toLocaleString()}`, 14, 25);
    autoTable(doc, {
      startY: 32,
      head: [["#", "Name", "Phone", "Amount", "Status", "Period"]],
      body: list.map((m, i) => [i + 1, m.name, m.phone, `${settings.currency}${m.amount}`, m.status, `${MONTHS[m.month - 1]} ${m.year}`]),
      headStyles: { fillColor: [20, 120, 90] },
    });
    doc.save(`print-list-${Date.now()}.pdf`);
    toast.success("List ready");
  };

  return (
    <AppShell title="Print Center" subtitle="Batch print receipts and member lists">
      <div className="card-surface p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members..." className="pl-9" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={toggleAll}><ListChecks className="mr-1.5 h-4 w-4" /> Toggle all</Button>
        <Button variant="outline" onClick={printList} disabled={!selected.size}>
          <Printer className="mr-1.5 h-4 w-4" /> Print list ({selected.size})
        </Button>
        <Button onClick={printReceipts} disabled={!selected.size}>
          <FileText className="mr-1.5 h-4 w-4" /> Print receipts ({selected.size})
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((m) => {
          const isSel = selected.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m.id)}
              className={`card-surface p-4 text-left flex items-center gap-3 transition-all ${
                isSel ? "ring-2 ring-primary border-primary" : ""
              }`}
            >
              <Checkbox checked={isSel} className="pointer-events-none" />
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground font-semibold">
                {initialsOf(m.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {settings.currency}{m.amount} · {MONTHS[m.month - 1]} {m.year} · {m.status}
                </p>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full card-surface p-10 text-center text-muted-foreground">
            No members match.
          </div>
        )}
      </div>
    </AppShell>
  );
}
