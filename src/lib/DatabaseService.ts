import { Member, OrgSettings, defaultSettings } from "./store";
import { normalizeUsername } from "./auth";

const DB_NAME = "MasjidReceiptManagerDB";
const CURRENT_USER_KEY = "MasjidReceiptManagerCurrentUser";

type UserRow = {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
};

type MemberRow = {
  id: number;
  userId: string;
  name: string;
  phone: string;
  address: string;
  monthlyFee: number;
  pendingMonths: number;
  holdStatus: boolean;
  status: string;
  month: number;
  year: number;
  months_pending: number;
  createdAt: string;
  updatedAt: string;
};

type SettingsRow = {
  id: number;
  userId: string;
  data: Partial<OrgSettings> & { profile?: { full_name?: string; organization?: string } };
  createdAt: string;
  updatedAt: string;
};

type ReceiptRow = {
  id: number;
  userId: string;
  memberId: string;
  month: number;
  year: number;
  amount: number;
  status: string;
  receiptNo: string;
  createdAt: string;
};

type AppState = {
  nextIds: {
    users: number;
    members: number;
    settings: number;
    receipts: number;
  };
  users: UserRow[];
  members: MemberRow[];
  settings: SettingsRow[];
  receipts: ReceiptRow[];
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
  month: number;
  year: number;
  amount: number;
  status: string;
  receiptNo: string;
  createdAt: string;
}

const EMPTY_STATE: AppState = {
  nextIds: {
    users: 1,
    members: 1,
    settings: 1,
    receipts: 1,
  },
  users: [],
  members: [],
  settings: [],
  receipts: [],
};

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function cloneState(state: AppState): AppState {
  return {
    nextIds: { ...state.nextIds },
    users: [...state.users],
    members: [...state.members],
    settings: [...state.settings],
    receipts: [...state.receipts],
  };
}

function readState(): AppState {
  if (!isBrowser()) {
    throw new Error("Local storage is only available in the browser.");
  }

  const raw = localStorage.getItem(DB_NAME);
  if (!raw) {
    return cloneState(EMPTY_STATE);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      nextIds: {
        users: parsed.nextIds?.users ?? EMPTY_STATE.nextIds.users,
        members: parsed.nextIds?.members ?? EMPTY_STATE.nextIds.members,
        settings: parsed.nextIds?.settings ?? EMPTY_STATE.nextIds.settings,
        receipts: parsed.nextIds?.receipts ?? EMPTY_STATE.nextIds.receipts,
      },
      users: Array.isArray(parsed.users) ? parsed.users : [],
      members: Array.isArray(parsed.members) ? parsed.members : [],
      settings: Array.isArray(parsed.settings) ? parsed.settings : [],
      receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
    };
  } catch {
    return cloneState(EMPTY_STATE);
  }
}

function writeState(state: AppState) {
  if (!isBrowser()) {
    throw new Error("Local storage is only available in the browser.");
  }

  localStorage.setItem(DB_NAME, JSON.stringify(state));
}

function updateState(mutator: (state: AppState) => void) {
  const state = readState();
  mutator(state);
  writeState(state);
  return state;
}

function nextId(state: AppState, key: keyof AppState["nextIds"]) {
  const id = state.nextIds[key];
  state.nextIds[key] += 1;
  return id;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rotr(value: number, shift: number) {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256Fallback(data: Uint8Array) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const paddedLength = Math.ceil((data.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(data);
  buffer[data.length] = 0x80;

  const view = new DataView(buffer.buffer);
  const bitLength = data.length * 8;
  view.setUint32(buffer.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(buffer.length - 4, bitLength >>> 0, false);

  const words = new Uint32Array(64);

  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4, false);
    }

    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(words[i - 15], 7) ^ rotr(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotr(words[i - 2], 17) ^ rotr(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + words[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return H.map((value) => value.toString(16).padStart(8, "0")).join("");
}

async function hashPassword(password: string) {
  if (typeof window === "undefined") {
    throw new Error("Password hashing is only available in the browser.");
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const subtle = window.crypto?.subtle;

  if (subtle) {
    const hashBuffer = await subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  return sha256Fallback(data);
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: String(row.id),
    username: row.username,
    createdAt: row.createdAt,
    user_metadata: { username: row.username },
  };
}

function toMember(row: MemberRow): Member {
  return {
    id: String(row.id),
    name: row.name,
    phone: row.phone,
    amount: row.monthlyFee,
    status: row.status as Member["status"],
    month: row.month,
    year: row.year,
    hold: row.holdStatus,
    months_pending: row.months_pending,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function normalizeUserId(userId: string) {
  return String(userId);
}

export async function initializeDatabase() {
  try {
    if (!isBrowser()) {
      throw new Error("Local storage is only available in the browser.");
    }

    if (!localStorage.getItem(DB_NAME)) {
      writeState(cloneState(EMPTY_STATE));
    }
  } catch (error) {
    console.error("Local database initialization failed:", error);
    throw new Error("Could not initialize local database. Please refresh or try a different browser.");
  }
}

function dispatchAuthStateChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth-change"));
  }
}

export async function createUser(username: string, password: string) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }

  await initializeDatabase();
  const existing = readState().users.find((user) => user.username === normalizedUsername);
  if (existing) {
    throw new Error("Username already taken.");
  }

  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();
  const user = updateState((state) => {
    const id = nextId(state, "users");
    state.users.push({ id, username: normalizedUsername, passwordHash, createdAt });
  }).users.at(-1);

  if (!user) {
    throw new Error("Could not create user.");
  }

  const authUser = toAuthUser(user);
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(authUser));
  dispatchAuthStateChange();
  return authUser;
}

export async function login(username: string, password: string) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }

  await initializeDatabase();
  const row = readState().users.find((user) => user.username === normalizedUsername);
  if (!row) {
    throw new Error("Invalid username or password.");
  }

  const hash = await hashPassword(password);
  if (hash !== row.passwordHash) {
    throw new Error("Invalid username or password.");
  }

  const user = toAuthUser(row);
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  dispatchAuthStateChange();
  return user;
}

export async function getCurrentUser() {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CURRENT_USER_KEY);
  if (!raw) return null;

  try {
    const user = JSON.parse(raw) as AuthUser;
    if (!user?.id || !user?.username) {
      localStorage.removeItem(CURRENT_USER_KEY);
      return null;
    }
    return user;
  } catch {
    localStorage.removeItem(CURRENT_USER_KEY);
    return null;
  }
}

export async function logout() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(CURRENT_USER_KEY);
    dispatchAuthStateChange();
  }
}

export async function addMember(userId: string, member: Partial<Member>) {
  await initializeDatabase();
  const now = new Date().toISOString();
  const saved = updateState((state) => {
    const id = nextId(state, "members");
    state.members.push({
      id,
      userId: normalizeUserId(userId),
      name: member.name ?? "",
      phone: member.phone ?? "",
      address: "",
      monthlyFee: Number(member.amount ?? 0),
      pendingMonths: Number(member.months_pending ?? 0),
      holdStatus: Boolean(member.hold),
      status: member.status ?? "unpaid",
      month: Number(member.month ?? new Date().getMonth() + 1),
      year: Number(member.year ?? new Date().getFullYear()),
      months_pending: Number(member.months_pending ?? 0),
      createdAt: now,
      updatedAt: now,
    });
  }).members.at(-1);

  if (!saved) {
    throw new Error("Could not add member.");
  }

  return toMember(saved);
}

export async function updateMember(id: string, userId: string, patch: Partial<Member>) {
  await initializeDatabase();
  const state = updateState((draft) => {
    const record = draft.members.find((item) => item.id === Number(id));
    if (!record || record.userId !== normalizeUserId(userId)) {
      return;
    }

    record.name = patch.name ?? record.name;
    record.phone = patch.phone ?? record.phone;
    record.monthlyFee = patch.amount !== undefined ? Number(patch.amount) : record.monthlyFee;
    record.status = patch.status ?? record.status;
    record.month = patch.month !== undefined ? Number(patch.month) : record.month;
    record.year = patch.year !== undefined ? Number(patch.year) : record.year;
    record.holdStatus = patch.hold !== undefined ? Boolean(patch.hold) : record.holdStatus;
    record.months_pending = patch.months_pending !== undefined ? Number(patch.months_pending) : record.months_pending;
    record.updatedAt = new Date().toISOString();
  });

  const updated = state.members.find((item) => item.id === Number(id));
  if (!updated || updated.userId !== normalizeUserId(userId)) {
    throw new Error("Member not found.");
  }
  return toMember(updated);
}

export async function deleteMember(id: string, userId: string) {
  await initializeDatabase();
  const existing = readState().members.find((item) => item.id === Number(id) && item.userId === normalizeUserId(userId));
  if (!existing) {
    throw new Error("Member not found.");
  }

  updateState((draft) => {
    const index = draft.members.findIndex((item) => item.id === Number(id) && item.userId === normalizeUserId(userId));
    if (index >= 0) {
      draft.members.splice(index, 1);
    }
  });
}

export async function getMembers(userId: string) {
  await initializeDatabase();
  const raw = readState().members.filter((item) => item.userId === normalizeUserId(userId));
  return raw.map(toMember).sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
}

export async function searchMembers(userId: string, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return getMembers(userId);
  const all = await getMembers(userId);
  return all.filter((member) =>
    `${member.name} ${member.phone}`.toLowerCase().includes(normalized),
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

  return { total, paid, unpaid, pending, monthly, yearly, outstanding };
}

export async function saveSettings(userId: string, data: Partial<OrgSettings> & { profile?: { full_name?: string; organization?: string } }) {
  await initializeDatabase();
  const now = new Date().toISOString();
  updateState((state) => {
    const existing = state.settings.find((item) => item.userId === normalizeUserId(userId));
    if (existing) {
      existing.data = data;
      existing.updatedAt = now;
      return;
    }

    state.settings.push({
      id: nextId(state, "settings"),
      userId: normalizeUserId(userId),
      data,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export async function loadSettings(userId: string) {
  await initializeDatabase();
  const record = readState().settings.find((item) => item.userId === normalizeUserId(userId));
  return record?.data ?? null;
}

export async function saveReceipt(userId: string, memberId: string, month: number, year: number, amount: number, status: string) {
  await initializeDatabase();
  const settings = await loadSettings(userId);
  const prefix = settings?.receiptPrefix ?? defaultSettings.receiptPrefix;
  const state = readState();
  const receiptsForUser = state.receipts.filter((item) => item.userId === normalizeUserId(userId));
  const seq = receiptsForUser.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  const receiptNo = `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
  const createdAt = new Date().toISOString();
  updateState((draft) => {
    draft.receipts.push({
      id: nextId(draft, "receipts"),
      userId: normalizeUserId(userId),
      memberId,
      month,
      year,
      amount,
      status,
      receiptNo,
      createdAt,
    });
  });
  return receiptNo;
}

export async function getReceipts(userId: string) {
  await initializeDatabase();
  const raw = readState().receipts.filter((item) => item.userId === normalizeUserId(userId));
  return raw
    .map((item) => ({
      ...item,
      id: String(item.id),
    }))
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
}

export async function updatePassword(userId: string, password: string) {
  await initializeDatabase();
  const record = readState().users.find((item) => item.id === Number(userId));
  if (!record) {
    throw new Error("User not found.");
  }
  const passwordHash = await hashPassword(password);
  updateState((draft) => {
    const target = draft.users.find((item) => item.id === Number(userId));
    if (!target) {
      return;
    }
    target.passwordHash = passwordHash;
  });
}
