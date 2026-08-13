import { defaultSettings, Member, OrgSettings, PaymentMode } from "./store";
import { generateUsernameSuggestions, normalizeUsername, usernameToEmail } from "./auth";
import { supabase } from "./supabase";

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

type DbMember = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  amount: number | string;
  status: string;
  payment_mode?: string | null;
  month: number;
  year: number;
  hold: boolean;
  months_pending: number;
  payment_date?: string | null;
  voucher_number?: string | null;
  created_at: string;
  updated_at: string;
};

type DbSettings = {
  user_id: string;
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logo_data_url: string | null;
  signature_label: string;
  receipt_prefix: string;
  currency: string;
};

function dispatchAuthStateChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("auth-change"));
}

function toAuthUser(user: { id: string; created_at?: string; email?: string | null; user_metadata?: Record<string, unknown> }): AuthUser {
  const metadataUsername = typeof user.user_metadata?.username === "string" ? user.user_metadata.username : "";
  const emailUsername = user.email?.split("@")[0] ?? "";
  const username = normalizeUsername(metadataUsername || emailUsername);
  return {
    id: user.id,
    username,
    createdAt: user.created_at ?? new Date().toISOString(),
    user_metadata: { username },
  };
}

function toMember(row: DbMember): Member {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    amount: Number(row.amount),
    status: row.status as Member["status"],
    payment_mode: row.payment_mode === "account" ? "account" : "cash",
    month: Number(row.month),
    year: Number(row.year),
    hold: Boolean(row.hold),
    months_pending: Number(row.months_pending ?? 0),
    payment_date: row.payment_date ?? null,
    voucher_number: row.voucher_number ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function memberInsert(userId: string, member: Partial<Member>) {
  const now = new Date();
  return {
    user_id: userId,
    name: member.name?.trim() || "",
    phone: member.phone?.trim() || "",
    amount: Number(member.amount ?? 0),
    status: member.status ?? "unpaid",
    payment_mode: member.payment_mode === "account" ? "account" : "cash",
    month: Number(member.month ?? now.getMonth() + 1),
    year: Number(member.year ?? now.getFullYear()),
    hold: Boolean(member.hold),
    months_pending: Number(member.months_pending ?? 0),
    ...(member.payment_date ? { payment_date: member.payment_date } : {}),
    ...(member.voucher_number?.trim() ? { voucher_number: member.voucher_number.trim() } : {}),
  };
}

function memberPatch(member: Partial<Member>) {
  const patch: Record<string, unknown> = {};
  if (member.name !== undefined) patch.name = member.name.trim();
  if (member.phone !== undefined) patch.phone = member.phone.trim();
  if (member.amount !== undefined) patch.amount = Number(member.amount);
  if (member.status !== undefined) patch.status = member.status;
  if (member.payment_mode !== undefined) patch.payment_mode = member.payment_mode === "account" ? "account" : "cash";
  if (member.month !== undefined) patch.month = Number(member.month);
  if (member.year !== undefined) patch.year = Number(member.year);
  if (member.hold !== undefined) patch.hold = Boolean(member.hold);
  if (member.months_pending !== undefined) patch.months_pending = Number(member.months_pending);
  if (member.payment_date !== undefined) patch.payment_date = member.payment_date || null;
  if (member.voucher_number !== undefined) patch.voucher_number = member.voucher_number.trim() || null;
  return patch;
}

function messageForAuthError(message: string, action: "login" | "register") {
  const normalized = message.toLowerCase();
  if (normalized.includes("already registered") || normalized.includes("duplicate") || normalized.includes("unique")) {
    return "This username is already taken.";
  }
  if (action === "login") return "Invalid username or password.";
  if (normalized.includes("password")) return "Password does not meet the security requirements.";
  return "Unable to create the account. Please try a different username or contact an administrator.";
}

export async function initializeDatabase(): Promise<void> {
  // The Supabase client validates configuration when it is constructed. This function
  // remains for compatibility with the existing application provider.
  return Promise.resolve();
}

export async function createUser(username: string, password: string): Promise<AuthUser> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password) throw new Error("Username and password are required.");

  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(normalizedUsername),
    password,
    options: { data: { username: normalizedUsername } },
  });
  if (error || !data.user) throw new Error(messageForAuthError(error?.message ?? "", "register"));

  if (!data.session) {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(normalizedUsername),
      password,
    });
    if (signInError) throw new Error("Account created, but sign-in is not available yet. Please contact an administrator.");
  }

  const user = toAuthUser(data.user);
  dispatchAuthStateChange();
  return user;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password) throw new Error("Username and password are required.");

  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(normalizedUsername),
    password,
  });
  if (error || !data.user) throw new Error(messageForAuthError(error?.message ?? "", "login"));

  const user = toAuthUser(data.user);
  dispatchAuthStateChange();
  return user;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : toAuthUser(data.user);
}

export async function logout(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("Could not sign out. Please try again.");
  dispatchAuthStateChange();
}

export async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return data as ProfileRow;
}

export async function getMembers(userId?: string): Promise<Member[]> {
  const currentUser = await getCurrentUser();
  const ownerId = userId ?? currentUser?.id;
  if (!ownerId) return [];

  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Could not load member records.");
  return ((data ?? []) as DbMember[]).map(toMember);
}

export async function addMember(userId: string, member: Partial<Member>): Promise<Member> {
  const { data, error } = await supabase
    .from("members")
    .insert(memberInsert(userId, member))
    .select()
    .single();
  if (error || !data) throw new Error("Could not save the member record.");
  return toMember(data as DbMember);
}

export async function updateMember(id: string, userId: string, patch: Partial<Member>): Promise<Member> {
  const { data, error } = await supabase
    .from("members")
    .update(memberPatch(patch))
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (error || !data) throw new Error("Member not found or could not be updated.");
  return toMember(data as DbMember);
}

export async function deleteMember(id: string, userId: string): Promise<void> {
  const { error } = await supabase.from("members").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error("Could not delete the member record.");
}

export async function searchMembers(userId: string, query: string): Promise<Member[]> {
  const normalized = query.trim().toLowerCase();
  const members = await getMembers(userId);
  if (!normalized) return members;
  return members.filter((member) => `${member.name} ${member.phone} ${member.payment_mode}`.toLowerCase().includes(normalized));
}

export async function getDashboardStats(userId?: string) {
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
    .filter((item) => item.status === "paid" && item.payment_mode === "cash")
    .reduce((sum, item) => sum + item.amount, 0);
  const accountReceived = members
    .filter((item) => item.status === "paid" && item.payment_mode === "account")
    .reduce((sum, item) => sum + item.amount, 0);
  return { total, paid, unpaid, pending, monthly, yearly, outstanding, cashReceived, accountReceived };
}

export async function loadSettings(userId?: string): Promise<OrgSettings | null> {
  const currentUser = await getCurrentUser();
  const ownerId = userId ?? currentUser?.id;
  if (!ownerId) return null;

  const { data, error } = await supabase.from("org_settings").select("*").eq("user_id", ownerId).maybeSingle();
  if (error) throw new Error("Could not load organization settings.");
  if (!data) return null;
  const s = data as DbSettings;
  return {
    name: s.name,
    tagline: s.tagline,
    address: s.address,
    phone: s.phone,
    email: s.email,
    logoDataUrl: s.logo_data_url,
    signatureLabel: s.signature_label,
    receiptPrefix: s.receipt_prefix,
    currency: s.currency,
  };
}

export async function saveSettings(userId: string, settings: Partial<OrgSettings> & { profile?: { full_name?: string; organization?: string } }): Promise<void> {
  const record = {
    user_id: userId,
    name: settings.name ?? defaultSettings.name,
    tagline: settings.tagline ?? defaultSettings.tagline,
    address: settings.address ?? defaultSettings.address,
    phone: settings.phone ?? defaultSettings.phone,
    email: settings.email ?? defaultSettings.email,
    logo_data_url: settings.logoDataUrl ?? defaultSettings.logoDataUrl,
    signature_label: settings.signatureLabel ?? defaultSettings.signatureLabel,
    receipt_prefix: settings.receiptPrefix ?? defaultSettings.receiptPrefix,
    currency: settings.currency ?? defaultSettings.currency,
  };
  const { error } = await supabase.from("org_settings").upsert(record, { onConflict: "user_id" });
  if (error) throw new Error("Could not save organization settings.");
}

export async function suggestAvailableUsernames(username: string, limit = 5): Promise<string[]> {
  return generateUsernameSuggestions(normalizeUsername(username), limit);
}

export async function saveReceipt(userId: string, memberId: string, month: number, year: number, amount: number, status: string): Promise<string> {
  const [settings, sequenceResult] = await Promise.all([loadSettings(userId), supabase.rpc("next_receipt_number")]);
  if (sequenceResult.error || sequenceResult.data === null) throw new Error("Could not allocate a receipt number.");

  const receiptNo = `${settings?.receiptPrefix ?? defaultSettings.receiptPrefix}-${year}-${String(sequenceResult.data).padStart(5, "0")}`;
  const { error } = await supabase.from("receipts").insert({
    user_id: userId,
    member_id: memberId,
    month,
    year,
    amount,
    status,
    receipt_no: receiptNo,
  });
  if (error) throw new Error("Could not save the receipt record.");
  return receiptNo;
}

export async function getReceipts(userId?: string): Promise<Receipt[]> {
  const currentUser = await getCurrentUser();
  const ownerId = userId ?? currentUser?.id;
  if (!ownerId) return [];
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Could not load receipt records.");
  return (data ?? []).map((row: Record<string, unknown>, index) => ({
    id: String(row.id),
    userId: String(row.user_id),
    memberId: String(row.member_id),
    receiptSeq: index + 1,
    receiptNo: String(row.receipt_no),
    month: Number(row.month),
    year: Number(row.year),
    amount: Number(row.amount),
    status: String(row.status),
    createdAt: String(row.created_at),
  }));
}

export async function updatePassword(userId: string, password: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.id !== userId) throw new Error("You must be signed in to update your password.");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error("Could not update the password. Please try again.");
}

export function hasLegacyLocalStorageData(): boolean {
  if (typeof window === "undefined") return false;
  return Object.keys(localStorage).some((key) => key.startsWith("receipt_manager_members_") || key.startsWith("receipt_manager_receipts_"));
}

export async function importLegacyLocalStorageData(): Promise<{ importedMembersCount: number; importedReceiptsCount: number }> {
  if (typeof window === "undefined") return { importedMembersCount: 0, importedReceiptsCount: 0 };
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("Sign in before importing legacy data.");

  const legacyMembers: Partial<Member>[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith("receipt_manager_members_")) continue;
    try {
      const raw = localStorage.getItem(key);
      if (raw) legacyMembers.push(...JSON.parse(raw));
    } catch { /* Ignore malformed legacy records. */ }
  }

  let importedMembersCount = 0;
  for (const member of legacyMembers) {
    await addMember(currentUser.id, member);
    importedMembersCount += 1;
  }
  return { importedMembersCount, importedReceiptsCount: 0 };
}
