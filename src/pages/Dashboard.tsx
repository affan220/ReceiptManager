import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { MemberCard } from "@/components/MemberCard";
import { MemberDialog } from "@/components/MemberDialog";
import { useApp } from "@/lib/app-context";
import { Member, MONTHS } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, CheckCircle2, XCircle, Clock, Wallet, TrendingUp, AlertTriangle, Percent, Plus, Search } from "lucide-react";

const ALL = "all";

export default function Dashboard() {
  const { members, settings } = useApp();
  const now = new Date();
  const [month, setMonth] = useState<string>(String(now.getMonth() + 1));
  const [year, setYear] = useState<string>(String(now.getFullYear()));
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [open, setOpen] = useState(false);

  const years = useMemo(() => {
    const set = new Set<number>(members.map((m) => m.year));
    set.add(now.getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [members]);

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (month !== ALL && m.month !== Number(month)) return false;
      if (year !== ALL && m.year !== Number(year)) return false;
      if (status !== ALL && m.status !== status) return false;
      if (search && !`${m.name} ${m.phone}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [members, month, year, status, search]);

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
    const pct = total ? Math.round((paid / total) * 100) : 0;
    return { total, paid, unpaid, pending, monthly, yearly, outstanding, pct };
  }, [filtered, members, year]);

  const c = settings.currency;

  return (
    <AppShell
      title="Dashboard"
      subtitle={`Overview of contributions and collections — ${MONTHS[now.getMonth()]} ${now.getFullYear()}`}
    >
      {/* Filters */}
      <div className="card-surface p-4 mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="pl-9"
          />
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All months</SelectItem>
            {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All years</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All status</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-1.5 h-4 w-4" /> Add member
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Total Members" value={stats.total} icon={Users} tone="primary" />
        <StatCard label="Paid" value={stats.paid} icon={CheckCircle2} tone="success" />
        <StatCard label="Unpaid" value={stats.unpaid} icon={XCircle} tone="destructive" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} tone="warning" />
        <StatCard label="Monthly Collection" value={`${c}${stats.monthly.toLocaleString()}`} icon={Wallet} tone="primary" hint={`${MONTHS[now.getMonth()]} ${now.getFullYear()}`} />
        <StatCard label="Yearly Collection" value={`${c}${stats.yearly.toLocaleString()}`} icon={TrendingUp} tone="success" />
        <StatCard label="Outstanding" value={`${c}${stats.outstanding.toLocaleString()}`} icon={AlertTriangle} tone="destructive" />
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
