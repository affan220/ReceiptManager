import { defaultSettings, ImportMemberInput, Member, NewMemberInput, OrgSettings, PaymentAllocationInput } from "./store";
import { generateUsernameSuggestions, normalizeUsername, usernameToEmail } from "./auth";
import { supabase } from "./supabase";

export type ProfileRow = {
  id: string;
  full_name: string | null;
  organization: string | null;
  phone: string | null;
  address: string | null;
  username: string | null;
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
};

export interface AuthUser {
  id: string;
  username: string;
  createdAt: string;
  user_metadata: { username: string };
}

export interface PaymentAllocation {
  id?: string;
  monthlyDueId: string;
  allocatedAmount: number;
  month: number;
  year: number;
  dueAmount: number;
  memberName: string;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  memberId: string;
  memberIdentityId: string;
  voucherNumber: string;
  paymentDate: string;
  amount: number;
  paymentStatus: string;
  paymentMethod: "cash" | "account";
  notes: string;
  allocations: PaymentAllocation[];
  createdAt: string;
  updatedAt: string;
}

export interface MemberLedgerDetail {
  due: Member;
  dues: Member[];
  payments: PaymentRecord[];
}

export interface FridayCollection {
  id: string;
  collectionDate: string;
  amount: number;
  paymentMode: "cash" | "account";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomRent {
  id: string;
  rentDate: string;
  amount: number;
  paymentMode: "cash" | "account";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface OtherIncomeSummary {
  fridayCollections: FridayCollection[];
  roomRents: RoomRent[];
  fridayTotal: number;
  roomRentTotal: number;
  otherTotal: number;
  cashTotal: number;
  accountTotal: number;
}

export interface LedgerDashboardSummary {
  total: number;
  paid: number;
  unpaid: number;
  pending: number;
  partial: number;
  expectedDues: number;
  monthlyCollection: number;
  yearlyCollection: number;
  outstanding: number;
  cashReceived: number;
  accountReceived: number;
  collectionPercent: number;
  memberMonthlyCollection: number;
  memberYearlyCollection: number;
  fridayCollection: number;
  roomRentCollection: number;
  otherCollection: number;
  otherCashReceived: number;
  otherAccountReceived: number;
  totalCollection: number;
  yearlyFridayCollection: number;
  yearlyRoomRentCollection: number;
  yearlyOtherCollection: number;
  yearlyTotalCollection: number;
}

export interface AddMemberResult {
  member: Member | null;
  createdCount: number;
  skippedCount: number;
  payment: PaymentRecord | null;
}

export interface PaymentReceiptResult {
  receiptNo: string;
  paymentId: string;
  voucherNumber: string;
  paymentDate: string;
  amount: number;
  paymentMethod: "cash" | "account";
}

export interface BulkImportFailure {
  row: number;
  errors: string[];
}

export interface BulkImportResult {
  importedCount: number;
  failedCount: number;
  errors: BulkImportFailure[];
}

export type ThemePreference = "light" | "dark" | "liquid_glass";

export interface Receipt {
  id: string;
  userId: string;
  memberId: string;
  paymentId: string | null;
  receiptSeq: number;
  receiptNo: string;
  voucherNumber: string | null;
  paymentDate: string | null;
  paymentMethod: "cash" | "account" | null;
  month: number;
  year: number;
  amount: number;
  status: string;
  createdAt: string;
}

export class ActiveSessionError extends Error {
  deviceLabel?: string;

  constructor(message: string, deviceLabel?: string) {
    super(message);
    this.name = "ActiveSessionError";
    this.deviceLabel = deviceLabel;
  }
}

export class SessionEndedError extends Error {
  constructor() {
    super("Your session ended because this account was signed in on another device.");
    this.name = "SessionEndedError";
  }
}

type DbMember = {
  id: string;
  member_identity_id?: string | null;
  name: string;
  phone: string | null;
  amount: number | string;
  amount_paid?: number | string | null;
  amount_pending?: number | string | null;
  total_pending_amount?: number | string | null;
  status: string;
  payment_mode?: string | null;
  month: number;
  year: number;
  hold: boolean;
  months_pending: number;
  payment_date?: string | null;
  voucher_number?: string | null;
  legacy_review_required?: boolean | null;
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
  theme_preference?: ThemePreference;
};

type SessionClaim = {
  status?: "claimed" | "taken_over" | "active_elsewhere";
  device_label?: string;
  last_seen_at?: string;
};

type RpcImportResult = {
  imported_count?: number;
  failed_count?: number;
  errors?: Array<{ row?: number; errors?: string[] }>;
};

function dispatchAuthStateChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("auth-change"));
}

function dispatchSessionEnded() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("session-ended"));
}

function deviceLabel() {
  if (typeof navigator === "undefined") return "Browser";
  const agent = navigator.userAgent;
  if (/edg/i.test(agent)) return "Microsoft Edge";
  if (/firefox/i.test(agent)) return "Firefox";
  if (/chrome|chromium/i.test(agent)) return "Chrome";
  if (/safari/i.test(agent)) return "Safari";
  return "Browser";
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
  const amount = Number(row.amount ?? 0);
  const amountPaid = Number(row.amount_paid ?? (row.status === "paid" ? amount : 0));
  const amountPending = Number(row.amount_pending ?? Math.max(amount - amountPaid, 0));
  return {
    id: row.id,
    member_identity_id: row.member_identity_id ?? undefined,
    name: row.name,
    phone: row.phone ?? "",
    amount,
    amount_paid: amountPaid,
    amount_pending: amountPending,
    total_pending_amount: Number(row.total_pending_amount ?? amountPending),
    status: row.status === "partial" ? "partial" : row.status as Member["status"],
    payment_mode: row.payment_mode === "account" ? "account" : "cash",
    month: Number(row.month),
    year: Number(row.year),
    hold: Boolean(row.hold),
    months_pending: Number(row.months_pending ?? (amountPending > 0 ? 1 : 0)),
    payment_date: row.payment_date ?? null,
    voucher_number: row.voucher_number ?? null,
    legacy_review_required: Boolean(row.legacy_review_required),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAllocation(row: Record<string, unknown>): PaymentAllocation {
  return {
    id: row.id ? String(row.id) : undefined,
    monthlyDueId: String(row.monthly_due_id ?? row.monthlyDueId ?? ""),
    allocatedAmount: Number(row.allocated_amount ?? row.allocatedAmount ?? 0),
    month: Number(row.month ?? 0),
    year: Number(row.year ?? 0),
    dueAmount: Number(row.due_amount ?? row.dueAmount ?? 0),
    memberName: String(row.member_name ?? row.memberName ?? ""),
  };
}

function toOtherIncomeRow(row: Record<string, unknown>, kind: "friday" | "rent"): FridayCollection | RoomRent {
  const common = {
    id: String(row.id ?? ""),
    amount: Number(row.amount ?? 0),
    paymentMode: row.payment_mode === "account" ? "account" as const : "cash" as const,
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
  };
  return kind === "friday"
    ? { ...common, collectionDate: String(row.collection_date ?? "") }
    : { ...common, rentDate: String(row.rent_date ?? "") };
}

function toPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    id: String(row.id ?? row.payment_id ?? ""),
    userId: String(row.user_id ?? ""),
    memberId: String(row.member_id ?? ""),
    memberIdentityId: String(row.member_identity_id ?? ""),
    voucherNumber: String(row.voucher_number ?? ""),
    paymentDate: String(row.payment_date ?? ""),
    amount: Number(row.amount ?? 0),
    paymentStatus: String(row.payment_status ?? "paid"),
    paymentMethod: row.payment_method === "account" ? "account" : "cash",
    notes: String(row.notes ?? ""),
    allocations: Array.isArray(row.allocations) ? row.allocations.map((item) => toAllocation(item as Record<string, unknown>)) : [],
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function messageForDatabaseError(error: { code?: string; message?: string } | null | undefined, fallback: string) {
  const message = error?.message?.toLowerCase() ?? "";
  if (error?.code === "23505" && message.includes("voucher")) return "This voucher number already exists.";
  if (error?.code === "23505" && message.includes("period")) return "This member already has a contribution record for the selected month and year.";
  if (error?.code === "23505" && message.includes("username")) return "This username is already taken. Please choose another username.";
  if (message.includes("session has ended")) return new SessionEndedError().message;
  return error?.message || fallback;
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

async function claimCurrentSession(takeOver: boolean) {
  const { data, error } = await supabase.rpc("claim_active_session", {
    p_take_over: takeOver,
    p_device_label: deviceLabel(),
  });
  if (error) throw new Error("Unable to establish a secure device session.");
  const result = (data ?? {}) as SessionClaim;
  if (result.status === "active_elsewhere") {
    throw new ActiveSessionError("This account is already logged in on another device.", result.device_label);
  }
  return result;
}

export async function ensureActiveSession(): Promise<void> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    dispatchSessionEnded();
    throw new SessionEndedError();
  }
  const { data, error } = await supabase.rpc("heartbeat_active_session");
  if (error || data !== true) {
    dispatchSessionEnded();
    throw new SessionEndedError();
  }
}

async function resolveOwner(userId?: string) {
  await ensureActiveSession();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new SessionEndedError();
  if (userId && data.user.id !== userId) throw new Error("You do not have access to this account's data.");
  return data.user.id;
}

export async function initializeDatabase(): Promise<void> {
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

  let authenticatedUser = data.user;
  if (!data.session) {
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(normalizedUsername),
      password,
    });
    if (signInError || !signInData.user) {
      throw new Error("Account created, but sign-in is not available yet. Please contact an administrator.");
    }
    authenticatedUser = signInData.user;
  }

  await claimCurrentSession(false);
  const user = toAuthUser(authenticatedUser);
  dispatchAuthStateChange();
  return user;
}

export async function login(username: string, password: string, takeOver = false): Promise<AuthUser> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password) throw new Error("Username and password are required.");

  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(normalizedUsername),
    password,
  });
  if (error || !data.user) throw new Error(messageForAuthError(error?.message ?? "", "login"));

  try {
    await claimCurrentSession(takeOver);
  } catch (claimError) {
    await supabase.auth.signOut({ scope: "local" });
    throw claimError;
  }

  const user = toAuthUser(data.user);
  dispatchAuthStateChange();
  return user;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : toAuthUser(data.user);
}

export async function getValidatedCurrentUser(): Promise<AuthUser | null> {
  const current = await getCurrentUser();
  if (!current) return null;
  await ensureActiveSession();
  return current;
}

export async function logout(): Promise<void> {
  await supabase.rpc("release_active_session");
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error("Could not sign out. Please try again.");
  dispatchAuthStateChange();
}

export async function loadProfile(userId: string): Promise<ProfileRow | null> {
  await resolveOwner(userId);
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return data as ProfileRow;
}

export async function getMembers(userId?: string): Promise<Member[]> {
  await resolveOwner(userId);
  const { data, error } = await supabase.rpc("get_ledger_members");
  if (error) throw new Error(messageForDatabaseError(error, "Could not load member records."));
  return Array.isArray(data) ? data.map((row) => toMember(row as DbMember)) : [];
}

export async function getMemberLedgerDetail(id: string, userId?: string): Promise<MemberLedgerDetail | null> {
  await resolveOwner(userId);
  const { data, error } = await supabase.rpc("get_monthly_due_detail", { p_due_member_id: id });
  if (error) throw new Error(messageForDatabaseError(error, "Could not load the current member record."));
  if (!data || typeof data !== "object") return null;
  const payload = data as { due?: DbMember; dues?: DbMember[]; payments?: Array<Record<string, unknown>> };
  if (!payload.due) return null;
  return {
    due: toMember(payload.due),
    dues: Array.isArray(payload.dues) ? payload.dues.map(toMember) : [],
    payments: Array.isArray(payload.payments) ? payload.payments.map(toPayment) : [],
  };
}

export async function getMember(id: string, userId?: string): Promise<Member | null> {
  const detail = await getMemberLedgerDetail(id, userId);
  return detail?.due ?? null;
}

export async function addMember(userId: string, member: NewMemberInput): Promise<AddMemberResult> {
  await resolveOwner(userId);
  const { data, error } = await supabase.rpc("create_member_dues", {
    p_name: member.name.trim(),
    p_phone: member.phone.trim(),
    p_amount: Number(member.amount),
    p_month: Number(member.month),
    p_year: Number(member.year),
    p_all_months: Boolean(member.all_months),
    p_initial_status: member.status,
    p_payment_amount: Number(member.payment_amount ?? 0),
    p_payment_date: member.payment_date || null,
    p_payment_method: member.payment_mode,
    p_voucher_number: member.voucher_number?.trim() || null,
    p_hold: Boolean(member.hold),
    p_notes: member.payment_notes ?? "",
  });
  if (error) throw new Error(messageForDatabaseError(error, "Could not save the member record."));
  const result = (data ?? {}) as Record<string, unknown>;
  const createdIds = Array.isArray(result.created_due_ids) ? result.created_due_ids.map(String) : [];
  const firstMember = createdIds.length ? await getMember(createdIds[0], userId) : null;
  return {
    member: firstMember,
    createdCount: Number(result.created_count ?? 0),
    skippedCount: Number(result.skipped_count ?? 0),
    payment: result.payment && typeof result.payment === "object" ? toPayment(result.payment as Record<string, unknown>) : null,
  };
}

export async function updateMember(id: string, userId: string, patch: Partial<Member>): Promise<Member> {
  const current = await getMember(id, userId);
  if (!current) throw new Error("Member not found or could not be updated.");
  const merged = { ...current, ...patch };
  const { data, error } = await supabase.rpc("update_monthly_due", {
    p_due_member_id: id,
    p_name: merged.name.trim(),
    p_phone: merged.phone.trim(),
    p_amount: Number(merged.amount),
    p_hold: Boolean(merged.hold),
    p_status: merged.status,
  });
  if (error) throw new Error(messageForDatabaseError(error, "Member not found or could not be updated."));
  const detail = data as { due?: DbMember } | null;
  if (!detail?.due) throw new Error("Member not found or could not be updated.");
  return toMember(detail.due);
}

export async function deleteMember(id: string, userId: string): Promise<void> {
  await resolveOwner(userId);
  const { error } = await supabase.rpc("delete_monthly_due", { p_due_member_id: id });
  if (error) throw new Error(messageForDatabaseError(error, "Could not delete the selected monthly record."));
}

export async function recordMemberPayment(
  memberId: string,
  userId: string,
  amount: number,
  paymentDate: string,
  paymentMode: "cash" | "account",
  voucherNumber?: string | null,
  notes?: string,
  allocations?: PaymentAllocationInput[] | null,
): Promise<PaymentRecord> {
  await resolveOwner(userId);
  const payload = allocations?.map((allocation) => ({
    monthly_due_id: allocation.monthly_due_id,
    allocated_amount: Number(allocation.allocated_amount),
  })) ?? null;
  const { data, error } = await supabase.rpc("record_member_payment", {
    p_due_member_id: memberId,
    p_amount: Number(amount),
    p_payment_date: paymentDate,
    p_payment_method: paymentMode,
    p_voucher_number: voucherNumber?.trim() || null,
    p_notes: notes ?? "",
    p_allocations: payload,
  });
  if (error) throw new Error(messageForDatabaseError(error, "Could not record the payment."));
  return toPayment(data as Record<string, unknown>);
}

export async function bulkImportMembers(rows: ImportMemberInput[]): Promise<BulkImportResult> {
  await ensureActiveSession();
  const payload = rows.map(({ rowNumber: _rowNumber, ...row }) => row);
  const { data, error } = await supabase.rpc("bulk_import_members", { p_rows: payload });
  if (error) throw new Error(messageForDatabaseError(error, "Could not import members."));
  const result = (data ?? {}) as RpcImportResult;
  return {
    importedCount: Number(result.imported_count ?? 0),
    failedCount: Number(result.failed_count ?? 0),
    errors: (result.errors ?? []).map((entry) => ({
      row: Number(entry.row ?? 0),
      errors: Array.isArray(entry.errors) ? entry.errors.map(String) : ["Invalid row."],
    })),
  };
}

export async function getPayments(userId?: string): Promise<PaymentRecord[]> {
  await resolveOwner(userId);
  const { data, error } = await supabase.rpc("get_ledger_payments");
  if (error) throw new Error(messageForDatabaseError(error, "Could not load payment history."));
  return Array.isArray(data) ? data.map((row) => toPayment(row as Record<string, unknown>)) : [];
}

export async function getOtherIncome(month?: number | null, year?: number | null): Promise<OtherIncomeSummary> {
  await ensureActiveSession();
  const { data, error } = await supabase.rpc("get_other_income", { p_month: month ?? null, p_year: year ?? null });
  if (error) throw new Error(messageForDatabaseError(error, "Could not load Other collections."));
  const payload = (data ?? {}) as Record<string, unknown>;
  const fridayRows = Array.isArray(payload.friday_collections) ? payload.friday_collections : [];
  const rentRows = Array.isArray(payload.room_rents) ? payload.room_rents : [];
  return {
    fridayCollections: fridayRows.map((row) => toOtherIncomeRow(row as Record<string, unknown>, "friday") as FridayCollection),
    roomRents: rentRows.map((row) => toOtherIncomeRow(row as Record<string, unknown>, "rent") as RoomRent),
    fridayTotal: Number(payload.friday_total ?? 0),
    roomRentTotal: Number(payload.room_rent_total ?? 0),
    otherTotal: Number(payload.other_total ?? 0),
    cashTotal: Number(payload.cash_total ?? 0),
    accountTotal: Number(payload.account_total ?? 0),
  };
}

export async function saveFridayCollection(collectionDate: string, amount: number, paymentMode: "cash" | "account", notes = ""): Promise<FridayCollection> {
  await ensureActiveSession();
  const { data, error } = await supabase.rpc("upsert_friday_collection", {
    p_collection_date: collectionDate, p_amount: Number(amount), p_payment_mode: paymentMode, p_notes: notes,
  });
  if (error) throw new Error(messageForDatabaseError(error, "Could not save the Friday collection."));
  return toOtherIncomeRow(data as Record<string, unknown>, "friday") as FridayCollection;
}

export async function removeFridayCollection(id: string): Promise<void> {
  await ensureActiveSession();
  const { error } = await supabase.rpc("delete_friday_collection", { p_collection_id: id });
  if (error) throw new Error(messageForDatabaseError(error, "Could not delete the Friday collection."));
}

export async function createRoomRent(rentDate: string, amount: number, paymentMode: "cash" | "account", notes = ""): Promise<RoomRent> {
  await ensureActiveSession();
  const { data, error } = await supabase.rpc("create_room_rent", {
    p_rent_date: rentDate, p_amount: Number(amount), p_payment_mode: paymentMode, p_notes: notes,
  });
  if (error) throw new Error(messageForDatabaseError(error, "Could not save the room rent."));
  return toOtherIncomeRow(data as Record<string, unknown>, "rent") as RoomRent;
}

export async function updateRoomRent(id: string, rentDate: string, amount: number, paymentMode: "cash" | "account", notes = ""): Promise<RoomRent> {
  await ensureActiveSession();
  const { data, error } = await supabase.rpc("update_room_rent", {
    p_rent_id: id, p_rent_date: rentDate, p_amount: Number(amount), p_payment_mode: paymentMode, p_notes: notes,
  });
  if (error) throw new Error(messageForDatabaseError(error, "Could not update the room rent."));
  return toOtherIncomeRow(data as Record<string, unknown>, "rent") as RoomRent;
}

export async function removeRoomRent(id: string): Promise<void> {
  await ensureActiveSession();
  const { error } = await supabase.rpc("delete_room_rent", { p_rent_id: id });
  if (error) throw new Error(messageForDatabaseError(error, "Could not delete the room rent."));
}

export async function getMemberPayments(memberId: string, userId?: string): Promise<PaymentRecord[]> {
  const detail = await getMemberLedgerDetail(memberId, userId);
  return detail?.payments ?? [];
}

export async function getLedgerDashboardSummary(month?: number | null, year?: number | null): Promise<LedgerDashboardSummary> {
  await ensureActiveSession();
  const { data, error } = await supabase.rpc("get_ledger_dashboard_summary", {
    p_month: month ?? null,
    p_year: year ?? null,
  });
  if (error) throw new Error(messageForDatabaseError(error, "Could not calculate the dashboard summary."));
  const result = (data ?? {}) as Record<string, unknown>;
  return {
    total: Number(result.total ?? 0),
    paid: Number(result.paid ?? 0),
    unpaid: Number(result.unpaid ?? 0),
    pending: Number(result.pending ?? 0),
    partial: Number(result.partial ?? 0),
    expectedDues: Number(result.expected_dues ?? 0),
    monthlyCollection: Number(result.monthly_collection ?? 0),
    yearlyCollection: Number(result.yearly_collection ?? 0),
    outstanding: Number(result.outstanding ?? 0),
    cashReceived: Number(result.cash_received ?? 0),
    accountReceived: Number(result.account_received ?? 0),
    collectionPercent: Number(result.collection_percent ?? 0),
    memberMonthlyCollection: Number(result.member_monthly_collection ?? result.monthly_collection ?? 0),
    memberYearlyCollection: Number(result.member_yearly_collection ?? result.yearly_collection ?? 0),
    fridayCollection: Number(result.friday_collection ?? 0),
    roomRentCollection: Number(result.room_rent_collection ?? 0),
    otherCollection: Number(result.other_collection ?? 0),
    otherCashReceived: Number(result.other_cash_received ?? 0),
    otherAccountReceived: Number(result.other_account_received ?? 0),
    totalCollection: Number(result.total_collection ?? result.monthly_collection ?? 0),
    yearlyFridayCollection: Number(result.yearly_friday_collection ?? 0),
    yearlyRoomRentCollection: Number(result.yearly_room_rent_collection ?? 0),
    yearlyOtherCollection: Number(result.yearly_other_collection ?? 0),
    yearlyTotalCollection: Number(result.yearly_total_collection ?? result.yearly_collection ?? 0),
  };
}

export async function getDashboardStats(userId?: string) {
  await resolveOwner(userId);
  const summary = await getLedgerDashboardSummary();
  return {
    total: summary.total,
    paid: summary.paid,
    unpaid: summary.unpaid,
    pending: summary.pending,
    monthly: summary.monthlyCollection,
    yearly: summary.yearlyCollection,
    outstanding: summary.outstanding,
    cashReceived: summary.cashReceived,
    accountReceived: summary.accountReceived,
  };
}

export async function createPaymentReceipt(paymentId: string, userId?: string): Promise<PaymentReceiptResult> {
  await resolveOwner(userId);
  const { data, error } = await supabase.rpc("create_payment_receipt", { p_payment_id: paymentId });
  if (error) throw new Error(messageForDatabaseError(error, "Could not create the payment receipt."));
  const result = (data ?? {}) as Record<string, unknown>;
  return {
    receiptNo: String(result.receipt_no ?? ""),
    paymentId: String(result.payment_id ?? paymentId),
    voucherNumber: String(result.voucher_number ?? ""),
    paymentDate: String(result.payment_date ?? ""),
    amount: Number(result.amount ?? 0),
    paymentMethod: result.payment_method === "account" ? "account" : "cash",
  };
}

export async function loadSettings(userId?: string): Promise<OrgSettings | null> {
  const ownerId = await resolveOwner(userId);
  const { data, error } = await supabase.from("org_settings").select("*").eq("user_id", ownerId).maybeSingle();
  if (error) throw new Error(messageForDatabaseError(error, "Could not load organization settings."));
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
  const ownerId = await resolveOwner(userId);
  const record = {
    user_id: ownerId,
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
  if (error) throw new Error(messageForDatabaseError(error, "Could not save organization settings."));
}

export async function getReceipts(userId?: string): Promise<Receipt[]> {
  const ownerId = await resolveOwner(userId);
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(messageForDatabaseError(error, "Could not load receipt records."));
  return (data ?? []).map((row: Record<string, unknown>, index) => ({
    id: String(row.id),
    userId: String(row.user_id),
    memberId: String(row.member_id),
    paymentId: row.payment_id ? String(row.payment_id) : null,
    receiptSeq: index + 1,
    receiptNo: String(row.receipt_no),
    voucherNumber: row.voucher_number ? String(row.voucher_number) : null,
    paymentDate: row.payment_date ? String(row.payment_date) : null,
    paymentMethod: row.payment_method === "account" ? "account" : row.payment_method === "cash" ? "cash" : null,
    month: Number(row.month),
    year: Number(row.year),
    amount: Number(row.amount),
    status: String(row.status),
    createdAt: String(row.created_at),
  }));
}

export async function loadThemePreference(): Promise<ThemePreference> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return "light";
  await ensureActiveSession();
  const { data, error } = await supabase
    .from("org_settings")
    .select("theme_preference")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error || !data) return "light";
  const preference = (data as { theme_preference?: string }).theme_preference;
  return preference === "dark" || preference === "liquid_glass" ? preference : "light";
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  const currentUser = await getValidatedCurrentUser();
  if (!currentUser) throw new Error("Sign in before changing the theme.");
  const { error } = await supabase
    .from("org_settings")
    .upsert({ user_id: currentUser.id, theme_preference: preference }, { onConflict: "user_id" });
  if (error) throw new Error(messageForDatabaseError(error, "Could not save your theme preference."));
}

export async function suggestAvailableUsernames(username: string, limit = 5): Promise<string[]> {
  return generateUsernameSuggestions(normalizeUsername(username), limit);
}

export async function updatePassword(userId: string, password: string): Promise<void> {
  const currentUser = await getValidatedCurrentUser();
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
  const currentUser = await getValidatedCurrentUser();
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
    const result = await addMember(currentUser.id, {
      name: member.name ?? "",
      phone: member.phone ?? "",
      amount: Number(member.amount ?? 0),
      status: member.status ?? "unpaid",
      payment_mode: member.payment_mode === "account" ? "account" : "cash",
      month: Number(member.month ?? new Date().getMonth() + 1),
      year: Number(member.year ?? new Date().getFullYear()),
      hold: Boolean(member.hold),
      payment_date: member.payment_date ?? null,
      voucher_number: member.voucher_number ?? null,
      payment_amount: member.status === "paid" ? Number(member.amount ?? 0) : 0,
    });
    importedMembersCount += result.createdCount;
  }
  return { importedMembersCount, importedReceiptsCount: 0 };
}
