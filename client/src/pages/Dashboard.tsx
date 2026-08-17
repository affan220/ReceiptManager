import { useEffect, useMemo, useState } from "react";
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
import { Users, CheckCircle2, XCircle, Clock, Wallet, TrendingUp, AlertTriangle, Percent, Plus, Search, Building2, CalendarDays, Landmark } from "lucide-react";
import { LedgerDashboardSummary, hasLegacyLocalStorageData, importLegacyLocalStorageData } from "@/lib/DatabaseService";
import { phoneMatches } from "@/lib/phone";
import { toast } from "sonner";

const ALL = "all";
const HOLD = "hold";
const ALL_STATUSES: StatusFilterValue[] = ["paid", "unpaid", "pending", "hold"];
const DASHBOARD_MONTH_KEY = "receipt-manager-dashboard-month";
const DASHBOARD_YEAR_KEY = "receipt-manager-dashboard-year";
const DASHBOARD_LAST_MONTH_KEY = "receipt-manager-dashboard-last-month";
const DASHBOARD_LAST_YEAR_KEY = "receipt-manager-dashboard-last-year";

function readStoredValue(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function saveStoredValue(key: string, value: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
}

const emptySummary: LedgerDashboardSummary = {
  total: 0, paid: 0, unpaid: 0, pending: 0, partial: 0, expectedDues: 0,
  monthlyCollection: 0, yearlyCollection: 0, outstanding: 0, cashReceived: 0,
  accountReceived: 0, collectionPercent: 0, memberMonthlyCollection: 0, memberYearlyCollection: 0,
  fridayCollection: 0, roomRentCollection: 0, otherCollection: 0, otherCashReceived: 0, otherAccountReceived: 0,
  cashIncomeBeforeDeposits: 0, accountIncomeBeforeDeposits: 0, depositedTotal: 0,
  totalCollection: 0, yearlyFridayCollection: 0, yearlyRoomRentCollection: 0, yearlyOtherCollection: 0, yearlyTotalCollection: 0,
};

export default function Dashboard() {
  const { members, settings, refresh, getDashboardSummary } = useApp();
  const now = new Date();
  const [month, setMonth] = useState<string>(() => readStoredValue(DASHBOARD_MONTH_KEY, String(now.getMonth() + 1)));
  const [year, setYear] = useState<string>(() => readStoredValue(DASHBOARD_YEAR_KEY, String(now.getFullYear())));
  const [statuses, setStatuses] = useState<StatusFilterValue[]>(ALL_STATUSES);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [open, setOpen] = useState(false);
  const [hasLegacyData, setHasLegacyData] = useState(() => hasLegacyLocalStorageData());
  const [importing, setImporting] = useState(false);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerDashboardSummary>(emptySummary);

  const selectedMonth = month === ALL ? null : Number(month);
  const selectedYear = year === ALL ? null : Number(year);
  const addMemberMonth = selectedMonth ?? Number(readStoredValue(DASHBOARD_LAST_MONTH_KEY, String(now.getMonth() + 1)));
  const addMemberYear = selectedYear ?? Number(readStoredValue(DASHBOARD_LAST_YEAR_KEY, String(now.getFullYear())));

  useEffect(() => {
    let active = true;
    void getDashboardSummary(selectedMonth, selectedYear)
      .then((summary) => { if (active) setLedgerSummary(summary); })
      .catch(() => { if (active) setLedgerSummary(emptySummary); });
    return () => { active = false; };
  }, [getDashboardSummary, selectedMonth, selectedYear, members]);

  const handleImportLegacyData = async () => {
    setImporting(true);
    try {
      const res = await importLegacyLocalStorageData();
      toast.success(`Imported ${res.importedMembersCount} monthly contribution records to cloud.`);
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
  }, [members, now]);

  const filtered = useMemo(() => members.filter((member) => {
    if (month !== ALL && member.month !== Number(month)) return false;
    if (year !== ALL && member.year !== Number(year)) return false;
    const comparableStatus = member.status === "partial" ? "pending" : member.status;
    const matchesStatus = member.hold
      ? statuses.includes(HOLD as StatusFilterValue) || statuses.includes(comparableStatus as StatusFilterValue)
      : statuses.includes(comparableStatus as StatusFilterValue);
    if (!matchesStatus) return false;
    if (search && !`${member.name} ${member.payment_mode ?? "cash"} ${member.voucher_number ?? ""}`.toLowerCase().includes(search.toLowerCase()) && !phoneMatches(member.phone, search)) return false;
    return true;
  }), [members, month, year, statuses, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const paid = filtered.filter((member) => member.status === "paid").length;
    const unpaid = filtered.filter((member) => member.status === "unpaid").length;
    const pending = filtered.filter((member) => member.status === "pending" || member.status === "partial").length;
    return { total, paid, unpaid, pending, ...ledgerSummary };
  }, [filtered, ledgerSummary]);

  const c = settings.currency;

  const handleMonthChange = (value: string) => {
    setMonth(value);
    saveStoredValue(DASHBOARD_MONTH_KEY, value);
    if (value !== ALL) saveStoredValue(DASHBOARD_LAST_MONTH_KEY, value);
  };

  const handleYearChange = (value: string) => {
    setYear(value);
    saveStoredValue(DASHBOARD_YEAR_KEY, value);
    if (value !== ALL) saveStoredValue(DASHBOARD_LAST_YEAR_KEY, value);
  };

  return (
    <AppShell title="Dashboard" subtitle={`Overview of contributions and collections - ${selectedMonthLabel} ${selectedYearLabel}`}>
      {hasLegacyData && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
            <div><p className="font-medium text-amber-200">Legacy LocalStorage Data Found</p><p className="text-xs text-amber-300/80">You have offline records stored in your browser. Click to migrate them to your cloud PostgreSQL database.</p></div>
          </div>
          <Button onClick={handleImportLegacyData} disabled={importing} size="sm" className="bg-amber-600 text-white hover:bg-amber-700">{importing ? "Importing..." : "Import Existing Data"}</Button>
        </div>
      )}

      <div className="card-surface mb-6 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, phone, cash or account..." className="pl-9" /></div>
        <Select value={month} onValueChange={handleMonthChange}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All months</SelectItem>{MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={year} onValueChange={handleYearChange}><SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All years</SelectItem>{years.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select>
        <StatusMultiSelect value={statuses} onValueChange={setStatuses} className="w-[180px]" />
        <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Add member</Button>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <StatCard label="Total Members" value={stats.total} icon={Users} tone="primary" />
        <StatCard label="Paid" value={stats.paid} icon={CheckCircle2} tone="success" />
        <StatCard label="Unpaid" value={stats.unpaid} icon={XCircle} tone="destructive" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} tone="warning" />
        <StatCard label="Monthly Collection" value={`${c}${stats.monthlyCollection.toLocaleString()}`} icon={Wallet} tone="primary" hint={`Member ${c}${stats.memberMonthlyCollection.toLocaleString()} + Other ${c}${stats.otherCollection.toLocaleString()}`} />
        <StatCard label="Friday Collection" value={`${c}${stats.fridayCollection.toLocaleString()}`} icon={CalendarDays} tone="success" />
        <StatCard label="Room Rent" value={`${c}${stats.roomRentCollection.toLocaleString()}`} icon={Building2} tone="info" />
        <StatCard label="Other Collection" value={`${c}${stats.otherCollection.toLocaleString()}`} icon={Landmark} tone="accent" hint="Friday + Room Rent" />
        <StatCard label="Member Payments" value={`${c}${stats.memberMonthlyCollection.toLocaleString()}`} icon={TrendingUp} tone="success" hint="Actual member payments received" />
        <StatCard label="Yearly Total" value={`${c}${stats.yearlyCollection.toLocaleString()}`} icon={TrendingUp} tone="primary" hint={`Member ${c}${stats.memberYearlyCollection.toLocaleString()} + Other ${c}${stats.yearlyOtherCollection.toLocaleString()}`} />
        <StatCard label="Outstanding" value={`${c}${stats.outstanding.toLocaleString()}`} icon={AlertTriangle} tone="destructive" />
        <StatCard label="Cash Received" value={`${c}${stats.cashReceived.toLocaleString()}`} icon={Wallet} tone="success" hint={stats.depositedTotal > 0 ? `${c}${stats.cashIncomeBeforeDeposits.toLocaleString()} cash income − ${c}${stats.depositedTotal.toLocaleString()} deposited` : `Other ${c}${stats.otherCashReceived.toLocaleString()}`} />
        <StatCard label="Account Received" value={`${c}${stats.accountReceived.toLocaleString()}`} icon={Building2} tone="info" hint={stats.depositedTotal > 0 ? `${c}${stats.accountIncomeBeforeDeposits.toLocaleString()} income + ${c}${stats.depositedTotal.toLocaleString()} deposited` : `Other ${c}${stats.otherAccountReceived.toLocaleString()}`} />
        <StatCard label="Collection %" value={`${stats.collectionPercent.toLocaleString()}%`} icon={Percent} tone="accent" hint={`${c}${stats.expectedDues.toLocaleString()} expected dues`} />
      </div>

      <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Members ({filtered.length})</h2></div>
      {filtered.length === 0 ? <div className="card-surface p-12 text-center"><p className="text-muted-foreground">No members match the current filters.</p></div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map((item) => <MemberCard key={item.id} member={item} onEdit={(selected) => { setEditing(selected); setOpen(true); }} />)}</div>}

      <MemberDialog open={open} onOpenChange={setOpen} member={editing} defaultMonth={addMemberMonth} defaultYear={addMemberYear} />
    </AppShell>
  );
}
