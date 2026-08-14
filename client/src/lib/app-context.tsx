import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ImportMemberInput, Member, OrgSettings, defaultSettings } from "./store";
import { useAuth } from "./auth-context";
import { toast } from "sonner";
import {
  BulkImportResult,
  addMember as dbAddMember,
  bulkImportMembers as dbBulkImportMembers,
  deleteMember as dbDeleteMember,
  getMember as dbGetMember,
  getMembers as dbGetMembers,
  initializeDatabase,
  loadProfile as dbLoadProfile,
  loadSettings as dbLoadSettings,
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
  addMember: (m: Partial<Member>) => Promise<Member | null>;
  addMembers: (list: ImportMemberInput[]) => Promise<BulkImportResult>;
  getMember: (id: string) => Promise<Member | null>;
  updateMember: (id: string, patch: Partial<Member>) => Promise<Member>;
  deleteMember: (id: string) => Promise<void>;
  toggleHold: (id: string) => Promise<void>;
  setStatus: (id: string, status: Member["status"]) => Promise<void>;
  updateSettings: (s: OrgSettings) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

function sanitizeMemberPatch(patch: Partial<Member>) {
  const cleaned = { ...patch } as Partial<Member> & { id?: string; created_at?: string; updated_at?: string };
  delete cleaned.id;
  delete cleaned.created_at;
  delete cleaned.updated_at;

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

  const loadAll = useCallback(async () => {
    if (!user) {
      setMembers([]);
      setSettings(defaultSettings);
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      await initializeDatabase();
      const [membersList, savedSettings, savedProfileResult] = await Promise.all([
        dbGetMembers(user.id),
        dbLoadSettings(user.id),
        dbLoadProfile(user.id).catch(() => null),
      ]);
      setMembers(membersList);
      if (savedSettings) {
        setSettings({ ...defaultSettings, ...savedSettings });
      } else {
        await dbSaveSettings(user.id, defaultSettings);
        setSettings(defaultSettings);
      }
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
      console.error("[app] load error:", error);
      toast.error(message || "Failed to initialize application data.");
      setMembers([]);
      setSettings(defaultSettings);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const addMember = useCallback(async (member: Partial<Member>) => {
    if (!user) return null;
    try {
      const created = await dbAddMember(user.id, member);
      setMembers((previous) => [created, ...previous]);
      await loadAll();
      toast.success("Member added successfully");
      return created;
    } catch (error) {
      console.error("[members] insert error:", error);
      toast.error(error instanceof Error ? error.message : "Could not add member.");
      return null;
    }
  }, [user, loadAll]);

  const addMembers = useCallback(async (list: ImportMemberInput[]) => {
    if (!user || !list.length) return { importedCount: 0, failedCount: 0, errors: [] };
    try {
      const result = await dbBulkImportMembers(list);
      await loadAll();
      if (result.importedCount > 0) {
        toast.success(`${result.importedCount} member${result.importedCount === 1 ? "" : "s"} imported successfully`);
      }
      return result;
    } catch (error) {
      console.error("[members] bulk import error:", error);
      const message = error instanceof Error ? error.message : "Could not import members.";
      toast.error(message);
      throw error;
    }
  }, [user, loadAll]);

  const getMember = useCallback(async (id: string) => {
    if (!user) return null;
    try {
      const latest = await dbGetMember(id, user.id);
      if (latest) setMembers((previous) => previous.map((member) => member.id === id ? latest : member));
      return latest;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the current member record.");
      return null;
    }
  }, [user]);

  const updateMember = useCallback(async (id: string, patch: Partial<Member>) => {
    if (!user) throw new Error("Sign in before editing a member.");
    try {
      const updated = await dbUpdateMember(id, user.id, sanitizeMemberPatch(patch));
      setMembers((previous) => previous.map((member) => member.id === id ? updated : member));
      await loadAll();
      return updated;
    } catch (error) {
      console.error("[members] update error:", error);
      const message = error instanceof Error ? error.message : "Could not update member.";
      toast.error(message);
      throw error;
    }
  }, [user, loadAll]);

  const deleteMember = useCallback(async (id: string) => {
    if (!user) return;
    try {
      await dbDeleteMember(id, user.id);
      setMembers((previous) => previous.filter((member) => member.id !== id));
      await loadAll();
    } catch (error) {
      console.error("[members] delete error:", error);
      toast.error(error instanceof Error ? error.message : "Could not delete member.");
      throw error;
    }
  }, [user, loadAll]);

  const toggleHold = useCallback(async (id: string) => {
    const target = members.find((member) => member.id === id);
    if (!target) return;
    await updateMember(id, { hold: !target.hold });
  }, [members, updateMember]);

  const setStatus = useCallback(async (id: string, status: Member["status"]) => {
    const target = members.find((member) => member.id === id);
    if (!target) return;
    const patch: Partial<Member> = { status };
    if (status === "paid") patch.months_pending = 0;
    await updateMember(id, patch);
  }, [members, updateMember]);

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

  const value = useMemo<AppCtx>(() => ({
    members, settings, profile, loading,
    addMember, addMembers, getMember, updateMember, deleteMember, toggleHold, setStatus,
    updateSettings, refresh: loadAll,
  }), [members, settings, profile, loading, addMember, addMembers, getMember, updateMember, deleteMember, toggleHold, setStatus, updateSettings, loadAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp must be used within AppProvider");
  return value;
}
