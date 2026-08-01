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

interface StoredUser {
  id: string;
  username: string;
  password?: string;
  createdAt: string;
}

const STORAGE_KEYS = {
  USERS: "receipt_manager_users",
  CURRENT_USER_ID: "receipt_manager_current_user_id",
  MEMBERS_PREFIX: "receipt_manager_members_",
  SETTINGS_PREFIX: "receipt_manager_settings_",
  PROFILES_PREFIX: "receipt_manager_profiles_",
  RECEIPTS_PREFIX: "receipt_manager_receipts_",
  SEQ_PREFIX: "receipt_manager_seq_",
};

function getItem<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function setItem<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("[LocalStorage] Error saving key:", key, error);
  }
}

function removeItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error("[LocalStorage] Error removing key:", key, error);
  }
}

function dispatchAuthStateChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth-change"));
  }
}

function mapAuthUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    user_metadata: { username: user.username },
  };
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

  const users = getItem<StoredUser[]>(STORAGE_KEYS.USERS, []);
  const existing = users.find((u) => u.username.toLowerCase() === normalizedUsername.toLowerCase());
  if (existing) {
    throw new Error("Username already taken.");
  }

  const now = new Date().toISOString();
  const newUser: StoredUser = {
    id: "usr_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
    username: normalizedUsername,
    password,
    createdAt: now,
  };

  users.push(newUser);
  setItem(STORAGE_KEYS.USERS, users);
  setItem(STORAGE_KEYS.CURRENT_USER_ID, newUser.id);

  dispatchAuthStateChange();
  return mapAuthUser(newUser);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }

  const users = getItem<StoredUser[]>(STORAGE_KEYS.USERS, []);
  const user = users.find(
    (u) => u.username.toLowerCase() === normalizedUsername.toLowerCase() && u.password === password
  );

  if (!user) {
    throw new Error("Invalid username or password.");
  }

  setItem(STORAGE_KEYS.CURRENT_USER_ID, user.id);
  dispatchAuthStateChange();
  return mapAuthUser(user);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const currentUserId = getItem<string | null>(STORAGE_KEYS.CURRENT_USER_ID, null);
  if (!currentUserId) return null;

  const users = getItem<StoredUser[]>(STORAGE_KEYS.USERS, []);
  const user = users.find((u) => u.id === currentUserId);
  if (!user) return null;

  return mapAuthUser(user);
}

export async function logout(): Promise<void> {
  removeItem(STORAGE_KEYS.CURRENT_USER_ID);
  dispatchAuthStateChange();
}

export async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const profile = getItem<ProfileRow | null>(STORAGE_KEYS.PROFILES_PREFIX + userId, null);
  if (profile) return profile;

  const users = getItem<StoredUser[]>(STORAGE_KEYS.USERS, []);
  const user = users.find((u) => u.id === userId);
  const now = new Date().toISOString();

  return {
    id: userId,
    full_name: null,
    organization: null,
    phone: null,
    address: null,
    username: user?.username ?? null,
    created_at: user?.createdAt ?? now,
    updated_at: now,
  };
}

export async function addMember(userId: string, member: Partial<Member>): Promise<Member> {
  const now = new Date().toISOString();
  const members = getItem<Member[]>(STORAGE_KEYS.MEMBERS_PREFIX + userId, []);
  const mode: PaymentMode = member.payment_mode === "account" ? "account" : "cash";

  const newMember: Member = {
    id: "mem_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
    name: member.name ?? "",
    phone: member.phone ?? "",
    amount: Number(member.amount ?? 0),
    status: (member.status ?? "unpaid") as Member["status"],
    payment_mode: mode,
    month: Number(member.month ?? new Date().getMonth() + 1),
    year: Number(member.year ?? new Date().getFullYear()),
    hold: Boolean(member.hold),
    months_pending: Number(member.months_pending ?? 0),
    created_at: now,
    updated_at: now,
  };

  members.unshift(newMember);
  setItem(STORAGE_KEYS.MEMBERS_PREFIX + userId, members);
  return newMember;
}

export async function updateMember(id: string, userId: string, patch: Partial<Member>): Promise<Member> {
  const members = getItem<Member[]>(STORAGE_KEYS.MEMBERS_PREFIX + userId, []);
  const index = members.findIndex((m) => m.id === id);

  if (index === -1) {
    throw new Error("Member not found.");
  }

  const existing = members[index];
  const mode: PaymentMode = patch.payment_mode !== undefined
    ? (patch.payment_mode === "account" ? "account" : "cash")
    : (existing.payment_mode === "account" ? "account" : "cash");

  const updated: Member = {
    ...existing,
    ...patch,
    payment_mode: mode,
    amount: patch.amount !== undefined ? Number(patch.amount) : existing.amount,
    month: patch.month !== undefined ? Number(patch.month) : existing.month,
    year: patch.year !== undefined ? Number(patch.year) : existing.year,
    hold: patch.hold !== undefined ? Boolean(patch.hold) : existing.hold,
    months_pending: patch.months_pending !== undefined ? Number(patch.months_pending) : existing.months_pending,
    updated_at: new Date().toISOString(),
  };

  members[index] = updated;
  setItem(STORAGE_KEYS.MEMBERS_PREFIX + userId, members);
  return updated;
}

export async function deleteMember(id: string, userId: string): Promise<void> {
  const members = getItem<Member[]>(STORAGE_KEYS.MEMBERS_PREFIX + userId, []);
  const filtered = members.filter((m) => m.id !== id);
  setItem(STORAGE_KEYS.MEMBERS_PREFIX + userId, filtered);
}

export async function getMembers(userId: string): Promise<Member[]> {
  const members = getItem<Member[]>(STORAGE_KEYS.MEMBERS_PREFIX + userId, []);
  return [...members].map((m) => ({
    ...m,
    payment_mode: (m.payment_mode === "account" ? "account" : "cash") as PaymentMode,
  })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function searchMembers(userId: string, query: string): Promise<Member[]> {
  const normalized = query.trim().toLowerCase();
  const all = await getMembers(userId);
  if (!normalized) return all;
  return all.filter((member) =>
    `${member.name} ${member.phone} ${member.payment_mode ?? "cash"}`.toLowerCase().includes(normalized)
  );
}

export async function getDashboardStats(userId: string) {
  const members = await getMembers(userId);
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


export async function saveSettings(
  userId: string,
  data: Partial<OrgSettings> & { profile?: { full_name?: string; organization?: string } }
): Promise<void> {
  const existingSettings = (await loadSettings(userId)) ?? defaultSettings;
  const updatedSettings: OrgSettings = {
    name: data.name ?? existingSettings.name,
    tagline: data.tagline ?? existingSettings.tagline,
    address: data.address ?? existingSettings.address,
    phone: data.phone ?? existingSettings.phone,
    email: data.email ?? existingSettings.email,
    logoDataUrl: data.logoDataUrl !== undefined ? data.logoDataUrl : existingSettings.logoDataUrl,
    signatureLabel: data.signatureLabel ?? existingSettings.signatureLabel,
    receiptPrefix: data.receiptPrefix ?? existingSettings.receiptPrefix,
    currency: data.currency ?? existingSettings.currency,
  };

  setItem(STORAGE_KEYS.SETTINGS_PREFIX + userId, updatedSettings);

  if (data.profile) {
    const existingProfile = await loadProfile(userId);
    const updatedProfile: ProfileRow = {
      id: userId,
      full_name: data.profile.full_name ?? existingProfile?.full_name ?? null,
      organization: data.profile.organization ?? data.name ?? existingProfile?.organization ?? null,
      phone: existingProfile?.phone ?? null,
      address: existingProfile?.address ?? null,
      username: existingProfile?.username ?? null,
      created_at: existingProfile?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setItem(STORAGE_KEYS.PROFILES_PREFIX + userId, updatedProfile);
  }
}

export async function loadSettings(userId: string): Promise<OrgSettings | null> {
  return getItem<OrgSettings | null>(STORAGE_KEYS.SETTINGS_PREFIX + userId, null);
}

export async function suggestAvailableUsernames(username: string, limit = 5): Promise<string[]> {
  const normalized = normalizeUsername(username);
  if (!normalized) return [];

  const users = getItem<StoredUser[]>(STORAGE_KEYS.USERS, []);
  const taken = new Set(users.map((u) => u.username.toLowerCase()));

  const suggestions = generateUsernameSuggestions(normalized, limit * 3);
  return suggestions.filter((name) => !taken.has(name.toLowerCase())).slice(0, limit);
}

export async function saveReceipt(
  userId: string,
  memberId: string,
  month: number,
  year: number,
  amount: number,
  status: string
): Promise<string> {
  const settings = await loadSettings(userId);
  const prefix = settings?.receiptPrefix ?? defaultSettings.receiptPrefix;

  const currentSeq = getItem<number>(STORAGE_KEYS.SEQ_PREFIX + userId, 0);
  const receiptSeq = currentSeq + 1;
  setItem(STORAGE_KEYS.SEQ_PREFIX + userId, receiptSeq);

  const receiptNo = `${prefix}-${year}-${String(receiptSeq).padStart(5, "0")}`;
  const now = new Date().toISOString();

  const receipts = getItem<Receipt[]>(STORAGE_KEYS.RECEIPTS_PREFIX + userId, []);
  const newReceipt: Receipt = {
    id: "rcpt_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
    userId,
    memberId,
    receiptSeq,
    receiptNo,
    month,
    year,
    amount,
    status,
    createdAt: now,
  };

  receipts.unshift(newReceipt);
  setItem(STORAGE_KEYS.RECEIPTS_PREFIX + userId, receipts);

  return receiptNo;
}

export async function getReceipts(userId: string): Promise<Receipt[]> {
  const receipts = getItem<Receipt[]>(STORAGE_KEYS.RECEIPTS_PREFIX + userId, []);
  return [...receipts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function updatePassword(userId: string, password: string): Promise<void> {
  const users = getItem<StoredUser[]>(STORAGE_KEYS.USERS, []);
  const userIndex = users.findIndex((u) => u.id === userId);
  if (userIndex === -1) {
    throw new Error("User not found.");
  }

  users[userIndex].password = password;
  setItem(STORAGE_KEYS.USERS, users);
}
