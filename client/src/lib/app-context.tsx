import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ImportMemberInput, Member, NewMemberInput, OrgSettings, PaymentAllocationInput, defaultSettings } from "./store";
import { useAuth } from "./auth-context";
import { toast } from "sonner";
import {
  AddMemberResult,
  BulkImportResult,
  LedgerDashboardSummary,
  MemberLedgerDetail,
  PaymentRecord,
  addMember as dbAddMember,
  bulkImportMembers as dbBulkImportMembers,
  deleteMember as dbDeleteMember,
  getLedgerDashboardSummary as dbGetLedgerDashboardSummary,
  getMember as dbGetMember,
  getMemberLedgerDetail as dbGetMemberLedgerDetail,
  getMembers as dbGetMembers,
  initializeDatabase,
  loadProfile as dbLoadProfile,
  loadSettings as dbLoadSettings,
  recordMemberPayment as dbRecordMemberPayment,
  saveSettings as dbSaveSettings,
  updateMember as dbUpdateMember,
} from "./DatabaseService";

interface Profile {
  id: string;
  full_name: string | null;
  organization: string | null;
  phone: string | null;
  address: string | null;
  username?: string | null;
}

interface AppCtx {
  members: Member[];
  settings: OrgSettings;
  profile: Profile | null;
  loading: boolean;
  membersLoading: boolean;
  loadMembers: (month?: number | null, year?: number | null, force?: boolean) => Promise<Member[]>;
  addMember: (m: NewMemberInput) => Promise<AddMemberResult | null>;
  addMembers: (list: ImportMemberInput[]) => Promise<BulkImportResult>;
  getMember: (id: string) => Promise<Member | null>;
  getMemberDetail: (id: string) => Promise<MemberLedgerDetail | null>;
  updateMember: (id: string, patch: Partial<Member>) => Promise<Member>;
  recordPayment: (memberId: string, amount: number, paymentDate: string, paymentMode: "cash" | "account", voucherNumber?: string | null, notes?: string, allocations?: PaymentAllocationInput[] | null) => Promise<PaymentRecord>;
  deleteMember: (id: string) => Promise<void>;
  toggleHold: (id: string) => Promise<void>;
  getDashboardSummary: (month?: number | null, year?: number | null) => Promise<LedgerDashboardSummary>;
  updateSettings: (s: OrgSettings) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);
const ALL_PERIOD_KEY = "all";

type Period = { month: number | null; year: number | null };

function periodKey(month?: number | null, year?: number | null) {
  return month && year ? `${year}-${month}` : ALL_PERIOD_KEY;
}

function periodForMember(member: Member): Period {
  return { month: member.month, year: member.year };
}

function samePeriod(left: Period, right: Period) {
  return left.month === right.month && left.year === right.year;
}

function sanitizeMemberPatch(patch: Partial<Member>) {
  const cleaned = { ...patch } as Partial<Member> & { id?: string; created_at?: string; updated_at?: string };
  delete cleaned.id;
  delete cleaned.created_at;
  delete cleaned.updated_at;
  delete cleaned.amount_paid;
  delete cleaned.amount_pending;
  delete cleaned.total_pending_amount;
  delete cleaned.member_identity_id;
  delete cleaned.legacy_review_required;

  if (cleaned.amount !== undefined) cleaned.amount = Number(cleaned.amount);
  if (cleaned.month !== undefined) cleaned.month = Number(cleaned.month);
  if (cleaned.year !== undefined) cleaned.year = Number(cleaned.year);
  if (cleaned.hold !== undefined) cleaned.hold = Boolean(cleaned.hold);
  if (cleaned.months_pending !== undefined) cleaned.months_pending = Number(cleaned.months_pending);
  if (cleaned.payment_mode !== undefined) cleaned.payment_mode = cleaned.payment_mode === "account" ? "account" : "cash";
  if (cleaned.payment_date !== undefined) cleaned.payment_date = cleaned.payment_date || null;
  if (cleaned.voucher_number !== undefined) cleaned.voucher_number = cleaned.voucher_number?.trim() || null;
  return cleaned as Partial<Member>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [settings, setSettings] = useState<OrgSettings>(defaultSettings);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const memberCacheRef = useRef(new Map<string, Member[]>());
  const activePeriodRef = useRef<Period>({ month: null, year: null });
  const loadMembersRequestRef = useRef(0);

  const clearCaches = useCallback(() => {
    memberCacheRef.current.clear();
    activePeriodRef.current = { month: null, year: null };
    loadMembersRequestRef.current += 1;
  }, []);

  const syncVisibleMembers = useCallback((period: Period, next: Member[]) => {
    if (samePeriod(activePeriodRef.current, period)) setMembers(next);
  }, []);

  const storePeriodMembers = useCallback((period: Period, next: Member[]) => {
    memberCacheRef.current.set(periodKey(period.month, period.year), next);
    syncVisibleMembers(period, next);
  }, [syncVisibleMembers]);


  const loadMembers = useCallback(async (month?: number | null, year?: number | null, force = false) => {
    if (!user) return [];
    const period = { month: month ?? null, year: year ?? null };
    const key = periodKey(period.month, period.year);
    activePeriodRef.current = period;

    const cached = memberCacheRef.current.get(key);
    if (!force && cached) {
      setMembers(cached);
      setMembersLoading(false);
      return cached;
    }

    const requestId = ++loadMembersRequestRef.current;
    setMembersLoading(true);
    try {
      const rows = await dbGetMembers(user.id, period.month, period.year);
      memberCacheRef.current.set(key, rows);
      if (requestId === loadMembersRequestRef.current && samePeriod(activePeriodRef.current, period)) setMembers(rows);
      return rows;
    } catch (error) {
      if (requestId === loadMembersRequestRef.current && samePeriod(activePeriodRef.current, period)) setMembers([]);
      toast.error(error instanceof Error ? error.message : "Could not load member records.");
      return [];
    } finally {
      if (requestId === loadMembersRequestRef.current) setMembersLoading(false);
    }
  }, [user]);

  const loadBootstrap = useCallback(async () => {
    if (!user) {
      clearCaches();
      setMembers([]);
      setSettings(defaultSettings);
      setProfile(null);
      setLoading(false);
      setMembersLoading(false);
      return;
    }

    setLoading(true);
    try {
      await initializeDatabase();
      const [savedSettings, savedProfileResult] = await Promise.all([
        dbLoadSettings(user.id),
        dbLoadProfile(user.id).catch(() => null),
      ]);
      setSettings(savedSettings ? { ...defaultSettings, ...savedSettings } : defaultSettings);
      if (!savedSettings) void dbSaveSettings(user.id, defaultSettings).catch(() => undefined);
      setProfile(savedProfileResult ?? {
        id: user.id,
        full_name: null,
        organization: null,
        phone: null,
        address: null,
        username: user.user_metadata?.username ?? user.username ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[app] bootstrap error:", error);
      toast.error(message || "Failed to initialize application data.");
      setSettings(defaultSettings);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [user, clearCaches]);

  useEffect(() => {
    clearCaches();
    setMembers([]);
    void loadBootstrap();
  }, [user, clearCaches, loadBootstrap]);

  const addMember = useCallback(async (member: NewMemberInput) => {
    if (!user) return null;
    try {
      const created = await dbAddMember(user.id, member);
      const period = { month: member.all_months ? null : member.month, year: member.year };
      if (created.payment) {
        memberCacheRef.current.clear();
        if (activePeriodRef.current.year === member.year) await loadMembers(activePeriodRef.current.month, activePeriodRef.current.year, true);
      } else if (created.member && !member.all_months) {
        const createdPeriod = periodForMember(created.member);
        const key = periodKey(createdPeriod.month, createdPeriod.year);
        const cached = memberCacheRef.current.get(key);
        if (cached) storePeriodMembers(createdPeriod, [created.member, ...cached.filter((item) => item.id !== created.member?.id)]);
      } else if (member.all_months && activePeriodRef.current.year === member.year) {
        memberCacheRef.current.delete(periodKey(activePeriodRef.current.month, activePeriodRef.current.year));
        await loadMembers(activePeriodRef.current.month, activePeriodRef.current.year, true);
      }

      if (created.createdCount > 0) {
        toast.success(created.skippedCount > 0
          ? `Added ${created.createdCount} month${created.createdCount === 1 ? "" : "s"}; skipped ${created.skippedCount} existing month${created.skippedCount === 1 ? "" : "s"}.`
          : `Added ${created.createdCount} contribution record${created.createdCount === 1 ? "" : "s"}.`);
      } else if (created.skippedCount > 0) {
        toast.message("This member already exists for the selected contribution period.");
      }
      return created;
    } catch (error) {
      console.error("[members] insert error:", error);
      toast.error(error instanceof Error ? error.message : "Could not add member.");
      return null;
    }
  }, [user, storePeriodMembers, loadMembers]);

  const addMembers = useCallback(async (list: ImportMemberInput[]) => {
    if (!user || !list.length) return { importedCount: 0, failedCount: 0, errors: [] };
    try {
      const result = await dbBulkImportMembers(list);
      if (result.importedCount > 0) {
        memberCacheRef.current.clear();
        await loadMembers(activePeriodRef.current.month, activePeriodRef.current.year, true);
        toast.success(`${result.importedCount} monthly contribution record${result.importedCount === 1 ? "" : "s"} imported successfully`);
      }
      return result;
    } catch (error) {
      console.error("[members] bulk import error:", error);
      const message = error instanceof Error ? error.message : "Could not import members.";
      toast.error(message);
      throw error;
    }
  }, [user, loadMembers]);

  const getMember = useCallback(async (id: string) => {
    if (!user) return null;
    try {
      const latest = await dbGetMember(id, user.id);
      if (latest) {
        const period = periodForMember(latest);
        const key = periodKey(period.month, period.year);
        const cached = memberCacheRef.current.get(key);
        if (cached) storePeriodMembers(period, cached.map((member) => member.id === id ? latest : member));
      }
      return latest;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the current member record.");
      return null;
    }
  }, [user, storePeriodMembers]);

  const getMemberDetail = useCallback(async (id: string) => {
    if (!user) return null;
    try {
      return await dbGetMemberLedgerDetail(id, user.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load payment details.");
      return null;
    }
  }, [user]);

  const updateMember = useCallback(async (id: string, patch: Partial<Member>) => {
    if (!user) throw new Error("Sign in before editing a member.");
    try {
      const updated = await dbUpdateMember(id, user.id, sanitizeMemberPatch(patch));
      const period = periodForMember(updated);
      memberCacheRef.current.clear();
      if (samePeriod(activePeriodRef.current, period)) {
        storePeriodMembers(period, members.map((member) => member.id === id ? updated : member));
      }
      return updated;
    } catch (error) {
      console.error("[members] update error:", error);
      const message = error instanceof Error ? error.message : "Could not update member.";
      toast.error(message);
      throw error;
    }
  }, [user, storePeriodMembers]);

  const recordPayment = useCallback(async (
    memberId: string,
    amount: number,
    paymentDate: string,
    paymentMode: "cash" | "account",
    voucherNumber?: string | null,
    notes?: string,
    allocations?: PaymentAllocationInput[] | null,
  ) => {
    if (!user) throw new Error("Sign in before recording a payment.");
    try {
      const payment = await dbRecordMemberPayment(memberId, user.id, amount, paymentDate, paymentMode, voucherNumber, notes, allocations);
      memberCacheRef.current.clear();
      await loadMembers(activePeriodRef.current.month, activePeriodRef.current.year, true);
      return payment;
    } catch (error) {
      console.error("[payments] record error:", error);
      const message = error instanceof Error ? error.message : "Could not record payment.";
      toast.error(message);
      throw error;
    }
  }, [user, members, loadMembers]);

  const deleteMember = useCallback(async (id: string) => {
    if (!user) return;
    try {
      const target = members.find((member) => member.id === id);
      await dbDeleteMember(id, user.id);
      if (target) {
        const period = periodForMember(target);
        memberCacheRef.current.clear();
        if (samePeriod(activePeriodRef.current, period)) {
          storePeriodMembers(period, members.filter((member) => member.id !== id));
        }
      }
    } catch (error) {
      console.error("[members] delete error:", error);
      toast.error(error instanceof Error ? error.message : "Could not delete the selected monthly record.");
      throw error;
    }
  }, [user, members, storePeriodMembers]);

  const toggleHold = useCallback(async (id: string) => {
    const target = members.find((member) => member.id === id);
    if (!target) return;
    await updateMember(id, { hold: !target.hold });
  }, [members, updateMember]);

  const getDashboardSummary = useCallback(async (month?: number | null, year?: number | null) => {
    return dbGetLedgerDashboardSummary(month, year);
  }, []);

  const updateSettings = useCallback(async (nextSettings: OrgSettings) => {
    if (!user) return;
    try {
      await dbSaveSettings(user.id, nextSettings);
      setSettings(nextSettings);
      toast.success("Settings saved");
    } catch (error) {
      console.error("[settings] save error:", error);
      toast.error(error instanceof Error ? error.message : "Could not save settings.");
      throw error;
    }
  }, [user]);

  const refresh = useCallback(async () => {
    await loadBootstrap();
    memberCacheRef.current.delete(periodKey(activePeriodRef.current.month, activePeriodRef.current.year));
    await loadMembers(activePeriodRef.current.month, activePeriodRef.current.year, true);
  }, [loadBootstrap, loadMembers]);

  const value = useMemo<AppCtx>(() => ({
    members, settings, profile, loading, membersLoading, loadMembers,
    addMember, addMembers, getMember, getMemberDetail, updateMember, recordPayment, deleteMember, toggleHold, getDashboardSummary,
    updateSettings, refresh,
  }), [members, settings, profile, loading, membersLoading, loadMembers, addMember, addMembers, getMember, getMemberDetail, updateMember, recordPayment, deleteMember, toggleHold, getDashboardSummary, updateSettings, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp must be used within AppProvider");
  return value;
}
