import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { StatusMultiSelect, type StatusFilterValue } from "@/components/StatusMultiSelect";
import { useApp } from "@/lib/app-context";
import { MONTHS } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, Users, CheckCircle2, AlertTriangle, FileDown, FileSpreadsheet, FileText, ArrowUpDown, Search } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { toast } from "sonner";

type SortKey = "name" | "amount" | "month" | "year" | "status";
const PAGE_SIZE = 10;
const ALL_STATUSES: StatusFilterValue[] = ["paid", "unpaid", "pending", "hold"];

function formatPdfAmount(amount: number) {
  return `RS ${amount.toLocaleString()}`;
}

function getPendingAmounts(member: { amount: number; months_pending: number }) {
  const pendingMonths = Number(member.months_pending ?? 0);
  const monthlyPendingAmount = Number(member.amount ?? 0);
  const totalPendingAmount = monthlyPendingAmount * Math.max(1, pendingMonths);
  return { pendingMonths, monthlyPendingAmount, totalPendingAmount };
}

function getExportPendingAmounts(member: { amount: number; months_pending: number; status: string }) {
  const pending = getPendingAmounts(member);
  const totalPendingAmount = member.status === "paid" ? 0 : pending.totalPendingAmount;
  return { ...pending, totalPendingAmount };
}

export default function Reports() {
  const { members, settings } = useApp();
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<StatusFilterValue[]>(ALL_STATUSES);
  const [month, setMonth] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let list = members.filter((m) => {
      const matchesStatus = m.hold
        ? statuses.includes("hold") || statuses.includes(m.status as StatusFilterValue)
        : statuses.includes(m.status as StatusFilterValue);
      if (!matchesStatus) return false;
      if (month !== "all" && m.month !== Number(month)) return false;
      if (search && !`${m.name} ${m.phone}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const va = a[sortKey] as any;
      const vb = b[sortKey] as any;
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [members, search, statuses, month, sortKey, sortDir]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const summary = useMemo(() => {
    const totalCollected = members.filter((m) => m.status === "paid").reduce((s, m) => s + m.amount, 0);
    const outstanding = members
      .filter((m) => m.status !== "paid")
      .reduce((s, m) => s + m.amount * Math.max(1, m.months_pending || 1), 0);
    const paidCount = members.filter((m) => m.status === "paid").length;
    return { totalCollected, outstanding, paidCount, total: members.length };
  }, [members]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const c = settings.currency;

  const exportCSV = () => {
    const headers = ["Name", "Phone", "Amount", "Status", "Month", "Year", "Months Pending", "Monthly Pending", "Pending Total", "Hold"];
    const rows = filtered.map((m) => {
      const pending = getPendingAmounts(m);
      return [
        m.name,
        m.phone,
        m.amount,
        m.status,
        MONTHS[m.month - 1],
        m.year,
        pending.pendingMonths,
        pending.monthlyPendingAmount,
        pending.totalPendingAmount,
        m.hold ? "Yes" : "No",
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  const exportXLSX = () => {
    const data = filtered.map((m) => {
      const pending = getExportPendingAmounts(m);
      return {
        Name: m.name,
        Phone: m.phone,
        Amount: m.amount,
        Status: m.status,
        Month: MONTHS[m.month - 1],
        Year: m.year,
        "Months Pending": pending.pendingMonths,
        "Pending Total": pending.totalPendingAmount,
        Hold: m.hold ? "Yes" : "No",
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Members");
    XLSX.writeFile(wb, `members-${Date.now()}.xlsx`);
    toast.success("Excel exported");
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`${settings.name} - Members Report`, 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleString()}`, 14, 25);
    autoTable(doc, {
      startY: 32,
      head: [["Name", "Phone", "Amount", "Status", "Period", "Months", "Pending Total"]],
      body: filtered.map((m) => {
        const pending = getExportPendingAmounts(m);
        return [
          m.name,
          m.phone,
          formatPdfAmount(m.amount),
          m.status,
          `${MONTHS[m.month - 1]} ${m.year}`,
          pending.pendingMonths,
          formatPdfAmount(pending.totalPendingAmount),
        ];
      }),
      headStyles: { fillColor: [20, 120, 90] },
      styles: { fontSize: 9 },
    });
    doc.save(`report-${Date.now()}.pdf`);
    toast.success("PDF exported");
  };

  return (
    <AppShell title="Reports" subtitle="Searchable, sortable contribution and member reports">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Total Collected" value={`${c}${summary.totalCollected.toLocaleString()}`} icon={Wallet} tone="success" />
        <StatCard label="Outstanding" value={`${c}${summary.outstanding.toLocaleString()}`} icon={AlertTriangle} tone="destructive" />
        <StatCard label="Members Paid" value={summary.paidCount} icon={CheckCircle2} tone="primary" />
        <StatCard label="Total Members" value={summary.total} icon={Users} tone="accent" />
      </div>

      <div className="card-surface p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search members..." className="pl-9" />
        </div>
        <StatusMultiSelect value={statuses} onValueChange={(next) => { setStatuses(next); setPage(1); }} className="w-[180px]" />
        <Select value={month} onValueChange={(v) => { setMonth(v); setPage(1); }}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="All months" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All months</SelectItem>
            {MONTHS.map((label, index) => (
              <SelectItem key={label} value={String(index + 1)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}><FileDown className="mr-1.5 h-4 w-4" /> CSV</Button>
          <Button variant="outline" onClick={exportXLSX}><FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel</Button>
          <Button onClick={exportPDF}><FileText className="mr-1.5 h-4 w-4" /> PDF</Button>
        </div>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {([
                  ["name", "Name"], ["amount", "Amount"], ["month", "Month"], ["year", "Year"], ["status", "Status"],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <TableHead key={k}>
                    <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
                      {label} <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </TableHead>
                ))}
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Months Pending</TableHead>
                <TableHead className="text-right">Monthly Pending</TableHead>
                <TableHead className="text-right">Pending Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((m) => {
                const pending = getPendingAmounts(m);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{c}{m.amount.toLocaleString()}</TableCell>
                    <TableCell>{MONTHS[m.month - 1]}</TableCell>
                    <TableCell>{m.year}</TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
                        m.status === "paid" ? "bg-success/15 text-success" :
                        m.status === "unpaid" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"
                      }`}>{m.status}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.phone || "—"}</TableCell>
                    <TableCell className="text-right">{pending.pendingMonths}</TableCell>
                    <TableCell className="text-right">RS {pending.monthlyPendingAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">RS {pending.totalPendingAmount.toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
              {paged.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">No results</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {filtered.length} records
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
