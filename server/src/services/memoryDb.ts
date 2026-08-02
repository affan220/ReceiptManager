// In-Memory fallback database store for environments without a running PostgreSQL instance

export interface MemUser {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemMember {
  id: number;
  userId: number;
  name: string;
  phone: string | null;
  monthlyAmount: number;
  status: string;
  paymentMode: string;
  hold: boolean;
  pendingMonths: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemReceipt {
  id: number;
  userId: number;
  memberId: number;
  amount: number;
  paymentMode: string;
  receiptNumber: string;
  date: Date;
  createdAt: Date;
}

export interface MemSettings {
  id: number;
  userId: number;
  masjidName: string;
  logo: string | null;
  receiptPrefix: string;
  currency: string;
  theme: string;
  createdAt: Date;
}

class MemoryStore {
  users: MemUser[] = [];
  members: MemMember[] = [];
  receipts: MemReceipt[] = [];
  settings: MemSettings[] = [];

  userIdSeq = 1;
  memberIdSeq = 1;
  receiptIdSeq = 1;
  settingsIdSeq = 1;
}

export const memoryStore = new MemoryStore();
