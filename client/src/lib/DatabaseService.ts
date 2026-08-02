import api from "../api";
import { Member, OrgSettings, defaultSettings, PaymentMode } from "./store";
import { generateUsernameSuggestions, normalizeUsername } from "./auth";

export type ProfileRow = {
  id: string;
  full_name: string | null;
  organization: string | null;
  phone: string | null;
  address: string | null;
  username: string | null;
  created_at: string;
  updated_at: string;
};

export interface AuthUser {
  id: string;
  username: string;
  createdAt: string;
  user_metadata: { username: string };
}

export interface Receipt {
  id: string;
  userId: string;
  memberId: string;
  receiptSeq: number;
  receiptNo: string;
  month: number;
  year: number;
  amount: number;
  status: string;
  createdAt: string;
}

const LEGACY_STORAGE_KEYS = [
  "receipt_manager_users",
  "receipt_manager_current_user_id",
];

function dispatchAuthStateChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth-change"));
  }
}

export async function initializeDatabase(): Promise<void> {
  return Promise.resolve();
}

export async function createUser(username: string, password: string): Promise<AuthUser> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }
  if (!password) {
    throw new Error("Password is required.");
  }

  const response = await api.post("/auth/register", {
    username: normalizedUsername,
    password,
  });

  const { token, user } = response.data;
  localStorage.setItem("jwt_token", token);
  dispatchAuthStateChange();

  return {
    id: String(user.id),
    username: user.username,
    createdAt: user.createdAt,
    user_metadata: { username: user.username },
  };
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }

  const response = await api.post("/auth/login", {
    username: normalizedUsername,
    password,
  });

  const { token, user } = response.data;
  localStorage.setItem("jwt_token", token);
  dispatchAuthStateChange();

  return {
    id: String(user.id),
    username: user.username,
    createdAt: user.createdAt,
    user_metadata: { username: user.username },
  };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = localStorage.getItem("jwt_token");
  if (!token) return null;

  try {
    const response = await api.get("/auth/me");
    const user = response.data.user;
    return {
      id: String(user.id),
      username: user.username,
      createdAt: user.createdAt,
      user_metadata: { username: user.username },
    };
  } catch {
    localStorage.removeItem("jwt_token");
    return null;
  }
}

export async function logout(): Promise<void> {
  localStorage.removeItem("jwt_token");
  dispatchAuthStateChange();
}

export async function loadProfile(userId: string): Promise<ProfileRow | null> {
  try {
    const settings = await loadSettings(userId);
    const currentUser = await getCurrentUser();
    const now = new Date().toISOString();

    return {
      id: userId,
      full_name: null,
      organization: settings?.name ?? null,
      phone: settings?.phone ?? null,
      address: settings?.address ?? null,
      username: currentUser?.username ?? null,
      created_at: currentUser?.createdAt ?? now,
      updated_at: now,
    };
  } catch {
    return null;
  }
}

export async function getMembers(_userId?: string): Promise<Member[]> {
  const response = await api.get("/members");
  const data = response.data;

  return data.map((m: Record<string, unknown>) => ({
    id: String(m.id),
    name: String(m.name || ""),
    phone: String(m.phone || ""),
    amount: Number(m.monthlyAmount ?? m.amount ?? 0),
    status: (m.status as Member["status"]) || "unpaid",
    payment_mode: (m.paymentMode === "account" ? "account" : "cash") as PaymentMode,
    month: Number(m.month || new Date().getMonth() + 1),
    year: Number(m.year || new Date().getFullYear()),
    hold: Boolean(m.hold),
    months_pending: Number(m.pendingMonths ?? m.months_pending ?? 0),
    created_at: String(m.createdAt || new Date().toISOString()),
    updated_at: String(m.updatedAt || new Date().toISOString()),
  }));
}

export async function addMember(_userId: string, member: Partial<Member>): Promise<Member> {
  const response = await api.post("/members", {
    name: member.name,
    phone: member.phone,
    monthlyAmount: Number(member.amount ?? 0),
    status: member.status ?? "unpaid",
    paymentMode: member.payment_mode ?? "cash",
    hold: Boolean(member.hold),
    pendingMonths: Number(member.months_pending ?? 0),
  });

  const created = response.data;
  return {
    id: String(created.id),
    name: created.name,
    phone: created.phone || "",
    amount: Number(created.monthlyAmount),
    status: created.status,
    payment_mode: created.paymentMode === "account" ? "account" : "cash",
    month: member.month ?? new Date().getMonth() + 1,
    year: member.year ?? new Date().getFullYear(),
    hold: created.hold,
    months_pending: created.pendingMonths,
    created_at: created.createdAt,
    updated_at: created.updatedAt,
  };
}

export async function updateMember(id: string, _userId: string, patch: Partial<Member>): Promise<Member> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.phone !== undefined) payload.phone = patch.phone;
  if (patch.amount !== undefined) payload.monthlyAmount = Number(patch.amount);
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.payment_mode !== undefined) payload.paymentMode = patch.payment_mode;
  if (patch.hold !== undefined) payload.hold = Boolean(patch.hold);
  if (patch.months_pending !== undefined) payload.pendingMonths = Number(patch.months_pending);

  const response = await api.put(`/members/${id}`, payload);
  const updated = response.data;

  return {
    id: String(updated.id),
    name: updated.name,
    phone: updated.phone || "",
    amount: Number(updated.monthlyAmount),
    status: updated.status,
    payment_mode: updated.paymentMode === "account" ? "account" : "cash",
    month: patch.month ?? new Date().getMonth() + 1,
    year: patch.year ?? new Date().getFullYear(),
    hold: updated.hold,
    months_pending: updated.pendingMonths,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
  };
}

export async function deleteMember(id: string, _userId: string): Promise<void> {
  await api.delete(`/members/${id}`);
}

export async function searchMembers(userId: string, query: string): Promise<Member[]> {
  const normalized = query.trim().toLowerCase();
  const all = await getMembers(userId);
  if (!normalized) return all;
  return all.filter((member) =>
    `${member.name} ${member.phone} ${member.payment_mode ?? "cash"}`.toLowerCase().includes(normalized)
  );
}

export async function getDashboardStats(_userId?: string) {
  try {
    const response = await api.get("/dashboard");
    return response.data;
  } catch {
    const members = await getMembers();
    const total = members.length;
    const paid = members.filter((item) => item.status === "paid").length;
    const unpaid = members.filter((item) => item.status === "unpaid").length;
    const pending = members.filter((item) => item.status === "pending").length;
    const monthly = members.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
    const yearly = members
      .filter((item) => item.status === "paid" && item.year === new Date().getFullYear())
      .reduce((sum, item) => sum + item.amount, 0);
    const outstanding = members
      .filter((item) => item.status !== "paid")
      .reduce((sum, item) => sum + item.amount * Math.max(1, item.months_pending || 1), 0);
    const cashReceived = members
      .filter((item) => item.status === "paid" && (item.payment_mode ?? "cash") === "cash")
      .reduce((sum, item) => sum + item.amount, 0);
    const accountReceived = members
      .filter((item) => item.status === "paid" && item.payment_mode === "account")
      .reduce((sum, item) => sum + item.amount, 0);

    return { total, paid, unpaid, pending, monthly, yearly, outstanding, cashReceived, accountReceived };
  }
}

export async function loadSettings(_userId?: string): Promise<OrgSettings | null> {
  try {
    const response = await api.get("/settings");
    const s = response.data;
    return {
      name: s.masjidName || defaultSettings.name,
      tagline: defaultSettings.tagline,
      address: defaultSettings.address,
      phone: defaultSettings.phone,
      email: defaultSettings.email,
      logoDataUrl: s.logo || null,
      signatureLabel: defaultSettings.signatureLabel,
      receiptPrefix: s.receiptPrefix || defaultSettings.receiptPrefix,
      currency: s.currency || defaultSettings.currency,
    };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(
  _userId: string,
  data: Partial<OrgSettings> & { profile?: { full_name?: string; organization?: string } }
): Promise<void> {
  await api.put("/settings", {
    masjidName: data.name,
    logo: data.logoDataUrl,
    receiptPrefix: data.receiptPrefix,
    currency: data.currency,
  });
}

export async function suggestAvailableUsernames(username: string, limit = 5): Promise<string[]> {
  const normalized = normalizeUsername(username);
  if (!normalized) return [];

  const suggestions = generateUsernameSuggestions(normalized, limit * 3);
  return suggestions.slice(0, limit);
}

export async function saveReceipt(
  _userId: string,
  memberId: string,
  _month: number,
  _year: number,
  amount: number,
  _status: string
): Promise<string> {
  const numericMemberId = parseInt(memberId, 10);
  const response = await api.post("/receipts", {
    memberId: isNaN(numericMemberId) ? 1 : numericMemberId,
    amount,
    date: new Date(),
  });

  return response.data.receiptNumber || `RCPT-${Date.now()}`;
}

export async function getReceipts(_userId?: string): Promise<Receipt[]> {
  const response = await api.get("/receipts");
  return response.data.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    userId: String(r.userId),
    memberId: String(r.memberId),
    receiptSeq: 1,
    receiptNo: String(r.receiptNumber || ""),
    month: new Date(r.date as string).getMonth() + 1,
    year: new Date(r.date as string).getFullYear(),
    amount: Number(r.amount),
    status: "paid",
    createdAt: String(r.createdAt),
  }));
}

export async function updatePassword(_userId: string, _password: string): Promise<void> {
  return Promise.resolve();
}

/** Check if legacy LocalStorage data exists */
export function hasLegacyLocalStorageData(): boolean {
  if (typeof window === "undefined") return false;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith("receipt_manager_members_") || key.startsWith("receipt_manager_receipts_"))) {
      return true;
    }
  }
  return false;
}

/** Import legacy LocalStorage data to PostgreSQL backend and clear legacy keys */
export async function importLegacyLocalStorageData(): Promise<{ importedMembersCount: number; importedReceiptsCount: number }> {
  if (typeof window === "undefined") return { importedMembersCount: 0, importedReceiptsCount: 0 };

  const allMembers: unknown[] = [];
  const allReceipts: unknown[] = [];
  let settings: unknown = null;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith("receipt_manager_members_")) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) allMembers.push(...JSON.parse(raw));
      } catch {/* ignore */}
    } else if (key.startsWith("receipt_manager_receipts_")) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) allReceipts.push(...JSON.parse(raw));
      } catch {/* ignore */}
    } else if (key.startsWith("receipt_manager_settings_")) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) settings = JSON.parse(raw);
      } catch {/* ignore */}
    }
  }

  const response = await api.post("/migration/import-localstorage", {
    members: allMembers,
    receipts: allReceipts,
    settings,
  });

  // Clear legacy localStorage database keys
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith("receipt_manager_") && key !== "receipt_manager_theme")) {
      keysToRemove.push(key);
    }
  }
  for (const k of keysToRemove) {
    localStorage.removeItem(k);
  }

  return response.data;
}
