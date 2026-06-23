import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from "react";
import { Member, OrgSettings, defaultSettings } from "./store";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";
import { toast } from "sonner";

interface Profile {
  id: string;
  full_name: string | null;
  organization: string | null;
  phone: string | null;
  address: string | null;
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

    const [memRes, setRes, profRes] = await Promise.all([
      supabase.from("members").select("*").order("created_at", { ascending: false }),
      supabase.from("org_settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    ]);

    if (memRes.error) toast.error("Failed to load members");
    else setMembers((memRes.data ?? []).map(rowToMember));

    if (setRes.data) {
      setSettings({
        name: setRes.data.name,
        tagline: setRes.data.tagline,
        address: setRes.data.address,
        phone: setRes.data.phone,
        email: setRes.data.email,
        logoDataUrl: setRes.data.logo_data_url,
        signatureLabel: setRes.data.signature_label,
        receiptPrefix: setRes.data.receipt_prefix,
        currency: setRes.data.currency,
      });
    }

    if (profRes.data) setProfile(profRes.data as Profile);

    setLoading(false);
  }, [user]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const addMember = useCallback(async (m: Partial<Member>) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("members")
      .insert(memberToInsert(m, user.id))
      .select()
      .single();
    if (error) { toast.error(error.message); return null; }
    const created = rowToMember(data as DbMember);
    setMembers((prev) => [created, ...prev]);
    return created;
  }, [user]);

  const addMembers = useCallback(async (list: Partial<Member>[]) => {
    if (!user || !list.length) return 0;
    const rows = list.map((m) => memberToInsert(m, user.id));
    const { data, error } = await supabase.from("members").insert(rows).select();
    if (error) { toast.error(error.message); return 0; }
    const created = (data ?? []).map((r) => rowToMember(r as DbMember));
    setMembers((prev) => [...created, ...prev]);
    return created.length;
  }, [user]);

  const updateMember = useCallback(async (id: string, patch: Partial<Member>) => {
    const { error } = await supabase.from("members").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch, updated_at: new Date().toISOString() } : m)));
  }, []);

  const deleteMember = useCallback(async (id: string) => {
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }, []);

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
    const { error } = await supabase.from("org_settings").upsert({
      user_id: user.id,
      name: s.name,
      tagline: s.tagline,
      address: s.address,
      phone: s.phone,
      email: s.email,
      logo_data_url: s.logoDataUrl,
      signature_label: s.signatureLabel,
      receipt_prefix: s.receiptPrefix,
      currency: s.currency,
    });
    if (error) { toast.error(error.message); return; }
    setSettings(s);
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
