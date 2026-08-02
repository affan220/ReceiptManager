import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from "react";
import { Member, OrgSettings, defaultSettings } from "./store";
import { useAuth } from "./auth-context";
import { toast } from "sonner";
import {
  initializeDatabase,
  addMember as dbAddMember,
  updateMember as dbUpdateMember,
  deleteMember as dbDeleteMember,
  getMembers as dbGetMembers,
  saveSettings as dbSaveSettings,
  loadSettings as dbLoadSettings,
  loadProfile as dbLoadProfile,
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
  addMembers: (list: Partial<Member>[]) => Promise<number>;
  updateMember: (id: string, patch: Partial<Member>) => Promise<void>;
  deleteMember: (id: string) => Promise<void>;
  toggleHold: (id: string) => Promise<void>;
  setStatus: (id: string, status: Member["status"]) => Promise<void>;
  updateSettings: (s: OrgSettings) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

type DbMember = {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  amount: number | string;
  status: string;
  month: number;
  year: number;
  hold: boolean;
  months_pending: number;
  created_at: string;
  updated_at: string;
};

function rowToMember(r: DbMember): Member {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? "",
    amount: Number(r.amount),
    status: (r.status as Member["status"]) ?? "unpaid",
    month: r.month,
    year: r.year,
    hold: !!r.hold,
    months_pending: r.months_pending ?? 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function memberToInsert(m: Partial<Member>, userId: string) {
  const now = new Date();
  return {
    user_id: userId,
    name: m.name ?? "",
    phone: m.phone ?? "",
    amount: Number(m.amount ?? 0),
    status: (m.status ?? "unpaid") as Member["status"],
    month: m.month ?? now.getMonth() + 1,
    year: m.year ?? now.getFullYear(),
    hold: !!m.hold,
    months_pending: m.months_pending ?? 0,
  };
}

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
  if (cleaned.payment_mode !== undefined) {
    cleaned.payment_mode = cleaned.payment_mode === "account" ? "account" : "cash";
  }

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

  useEffect(() => { loadAll(); }, [loadAll]);

  const addMember = useCallback(async (m: Partial<Member>) => {
    if (!user) return null;
    try {
      const created = await dbAddMember(user.id, m);
      setMembers((prev) => [created, ...prev]);
      toast.success("Member added successfully");
      return created;
    } catch (error) {
      console.error("[members] insert error:", error);
      toast.error(error instanceof Error ? error.message : "Could not add member.");
      return null;
    }
  }, [user]);

  const addMembers = useCallback(async (list: Partial<Member>[]) => {
    if (!user || !list.length) return 0;
    const created: Member[] = [];
    try {
      for (const member of list) {
        const added = await dbAddMember(user.id, member);
        created.push(added);
      }
      setMembers((prev) => [...created, ...prev]);
      toast.success(`${created.length} member${created.length === 1 ? "" : "s"} imported successfully`);
      return created.length;
    } catch (error) {
      console.error("[members] bulk insert error:", error);
      toast.error(error instanceof Error ? error.message : "Could not import members.");
      return created.length;
    }
  }, [user]);

  const updateMember = useCallback(async (id: string, patch: Partial<Member>) => {
    if (!user) return;
    try {
      const updated = await dbUpdateMember(id, user.id, sanitizeMemberPatch(patch));
      setMembers((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (error) {
      console.error("[members] update error:", error);
      toast.error(error instanceof Error ? error.message : "Could not update member.");
    }
  }, [user]);

  const deleteMember = useCallback(async (id: string) => {
    if (!user) return;
    try {
      await dbDeleteMember(id, user.id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch (error) {
      console.error("[members] delete error:", error);
      toast.error(error instanceof Error ? error.message : "Could not delete member.");
    }
  }, [user]);

  const toggleHold = useCallback(async (id: string) => {
    const target = members.find((m) => m.id === id);
    if (!target) return;
    await updateMember(id, { hold: !target.hold });
  }, [members, updateMember]);

  const setStatus = useCallback(async (id: string, status: Member["status"]) => {
    const target = members.find((m) => m.id === id);
    if (!target) return;
    const patch: Partial<Member> = { status };
    if (status === "paid") patch.months_pending = 0;
    await updateMember(id, patch);
  }, [members, updateMember]);

  const updateSettings = useCallback(async (s: OrgSettings) => {
    if (!user) return;
    try {
      await dbSaveSettings(user.id, s);
      setSettings(s);
      toast.success("Settings saved");
    } catch (error) {
      console.error("[settings] save error:", error);
      toast.error(error instanceof Error ? error.message : "Could not save settings.");
    }
  }, [user]);

  const value = useMemo<AppCtx>(() => ({
    members, settings, profile, loading,
    addMember, addMembers, updateMember, deleteMember, toggleHold, setStatus,
    updateSettings, refresh: loadAll,
  }), [members, settings, profile, loading, addMember, addMembers, updateMember, deleteMember, toggleHold, setStatus, updateSettings, loadAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}
