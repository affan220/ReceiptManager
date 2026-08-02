import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { MemberCard } from "@/components/MemberCard";
import { MemberDialog } from "@/components/MemberDialog";
import { StatusMultiSelect, type StatusFilterValue } from "@/components/StatusMultiSelect";
import { useApp } from "@/lib/app-context";
import { Member, MONTHS } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, CheckCircle2, XCircle, Clock, Wallet, TrendingUp, AlertTriangle, Percent, Plus, Search, Building2 } from "lucide-react";

import { hasLegacyLocalStorageData, importLegacyLocalStorageData } from "@/lib/DatabaseService";
import { toast } from "sonner";

const ALL = "all";
const HOLD = "hold";
const ALL_STATUSES: StatusFilterValue[] = ["paid", "unpaid", "pending", "hold"];
const DASHBOARD_MONTH_KEY = "receipt-manager-dashboard-month";
const DASHBOARD_YEAR_KEY = "receipt-manager-dashboard-year";

function readStoredValue(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function saveStoredValue(key: string, value: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, value);
  }
}

export default function Dashboard() {
  const { members, settings, refresh } = useApp();
  const now = new Date();
  const [month, setMonth] = useState<string>(() => readStoredValue(DASHBOARD_MONTH_KEY, String(now.getMonth() + 1)));
  const [year, setYear] = useState<string>(() => readStoredValue(DASHBOARD_YEAR_KEY, String(now.getFullYear())));
  const [statuses, setStatuses] = useState<StatusFilterValue[]>(ALL_STATUSES);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [open, setOpen] = useState(false);
  const [hasLegacyData, setHasLegacyData] = useState(() => hasLegacyLocalStorageData());
  const [importing, setImporting] = useState(false);

  const handleImportLegacyData = async () => {
    setImporting(true);
    try {
      const res = await importLegacyLocalStorageData();
      toast.success(`Imported ${res.importedMembersCount} members and ${res.importedReceiptsCount} receipts to cloud!`);
      setHasLegacyData(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import legacy data.");
    } finally {
      setImporting(false);
    }
  };

  const selectedMonthLabel = month === ALL ? "All months" : MONTHS[Number(month) - 1];
  const selectedYearLabel = year === ALL ? "All years" : year;

  const years = useMemo(() => {
    const set = new Set<number>(members.map((m) => m.year));
    set.add(now.getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [members]);

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (month !== ALL && m.month !== Number(month)) return false;
      if (year !== ALL && m.year !== Number(year)) return false;
      const matchesStatus = m.hold
        ? statuses.includes(HOLD as StatusFilterValue) || statuses.includes(m.status as StatusFilterValue)
        : statuses.includes(m.status as StatusFilterValue);
      if (!matchesStatus) return false;
      if (search && !`${m.name} ${m.phone} ${m.payment_mode ?? "cash"}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [members, month, year, statuses, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const paid = filtered.filter((m) => m.status === "paid").length;
    const unpaid = filtered.filter((m) => m.status === "unpaid").length;
    const pending = filtered.filter((m) => m.status === "pending").length;
    const monthly = filtered.filter((m) => m.status === "paid").reduce((s, m) => s + m.amount, 0);
    const yearly = members
      .filter((m) => m.year === Number(year === ALL ? now.getFullYear() : year) && m.status === "paid")
      .reduce((s, m) => s + m.amount, 0);
    const outstanding = filtered
      .filter((m) => m.status !== "paid")
      .reduce((s, m) => s + m.amount * Math.max(1, m.months_pending || 1), 0);
    const cashReceived = filtered
      .filter((m) => m.status === "paid" && (m.payment_mode ?? "cash") === "cash")
      .reduce((s, m) => s + m.amount, 0);
    const accountReceived = filtered
      .filter((m) => m.status === "paid" && m.payment_mode === "account")
      .reduce((s, m) => s + m.amount, 0);
    const pct = total ? Math.round((paid / total) * 100) : 0;
    return { total, paid, unpaid, pending, monthly, yearly, outstanding, cashReceived, accountReceived, pct };
  }, [filtered, members, year]);

  const c = settings.currency;

  const handleMonthChange = (value: string) => {
    setMonth(value);
    saveStoredValue(DASHBOARD_MONTH_KEY, value);
  };

  const handleYearChange = (value: string) => {
    setYear(value);
    saveStoredValue(DASHBOARD_YEAR_KEY, value);
  };

  return (
    <AppShell
      title="Dashboard"
      subtitle={`Overview of contributions and collections - ${selectedMonthLabel} ${selectedYearLabel}`}
    >
      {hasLegacyData && (
        <div className="mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <div>
              <p className="font-medium text-amber-200">Legacy LocalStorage Data Found</p>
              <p className="text-xs text-amber-300/80">You have offline records stored in your browser. Click to migrate them to your cloud PostgreSQL database.</p>
            </div>
          </div>
          <Button onClick={handleImportLegacyData} disabled={importing} size="sm" className="bg-amber-600 hover:bg-amber-700 text-white">
            {importing ? "Importing..." : "Import Existing Data"}
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="card-surface p-4 mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, cash or account..."
            className="pl-9"
          />
        </div>
        <Select value={month} onValueChange={handleMonthChange}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All months</SelectItem>
            {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={handleYearChange}>
          <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All years</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <StatusMultiSelect value={statuses} onValueChange={setStatuses} className="w-[180px]" />
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-1.5 h-4 w-4" /> Add member
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 mb-6">
        <StatCard label="Total Members" value={stats.total} icon={Users} tone="primary" />
        <StatCard label="Paid" value={stats.paid} icon={CheckCircle2} tone="success" />
        <StatCard label="Unpaid" value={stats.unpaid} icon={XCircle} tone="destructive" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} tone="warning" />
        <StatCard label="Monthly Collection" value={`${c}${stats.monthly.toLocaleString()}`} icon={Wallet} tone="primary" hint={`${selectedMonthLabel} ${selectedYearLabel}`} />
        <StatCard label="Yearly Collection" value={`${c}${stats.yearly.toLocaleString()}`} icon={TrendingUp} tone="success" />
        <StatCard label="Outstanding" value={`${c}${stats.outstanding.toLocaleString()}`} icon={AlertTriangle} tone="destructive" />
        <StatCard label="Cash Received" value={`${c}${stats.cashReceived.toLocaleString()}`} icon={Wallet} tone="success" />
        <StatCard label="Account Received" value={`${c}${stats.accountReceived.toLocaleString()}`} icon={Building2} tone="info" />
        <StatCard label="Collection %" value={`${stats.pct}%`} icon={Percent} tone="accent" hint={`${stats.paid} of ${stats.total} paid`} />
      </div>

      {/* Members */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Members ({filtered.length})</h2>
      </div>

      {filtered.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-muted-foreground">No members match the current filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((m) => (
            <MemberCard key={m.id} member={m} onEdit={(mb) => { setEditing(mb); setOpen(true); }} />
          ))}
        </div>
      )}

      <MemberDialog open={open} onOpenChange={setOpen} member={editing} />
    </AppShell>
  );
}
