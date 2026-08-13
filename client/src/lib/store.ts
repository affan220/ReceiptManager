// Shared data model types.
// Schema kept stable so a Python/Kivy mirror app can use the same field names.

export type MemberStatus = "paid" | "unpaid" | "pending";
export type PaymentMode = "cash" | "account";

export interface Member {
  id: string;
  name: string;
  phone: string;
  amount: number;
  status: MemberStatus;
  payment_mode?: PaymentMode;
  month: number;
  year: number;
  hold: boolean;
  months_pending: number;
  payment_date: string | null;
  voucher_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgSettings {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  signatureLabel: string;
  receiptPrefix: string;
  currency: string;
}

export const APP_VERSION = "1.0.0";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const defaultSettings: OrgSettings = {
  name: "My Masjid",
  tagline: "Donation & Receipt Management",
  address: "",
  phone: "",
  email: "",
  logoDataUrl: null,
  signatureLabel: "Authorized Signatory",
  receiptPrefix: "RCPT",
  currency: "₹",
};

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

// CSV / TXT parsing (header: name,phone,amount,status,payment_mode,month,year)
export function parseDelimited(text: string): Partial<Member>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.split(delim);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
    const status = (row.status?.toLowerCase() as MemberStatus) || "unpaid";
    const rawMode = (row.payment_mode || row.paymentmode || row.mode || "cash").toLowerCase();
    const payment_mode: PaymentMode = rawMode === "account" ? "account" : "cash";
    return {
      name: row.name || row.member || "Unknown",
      phone: row.phone || row.mobile || "",
      amount: Number(row.amount || 0),
      status: ["paid", "unpaid", "pending"].includes(status) ? status : "unpaid",
      payment_mode,
      month: Number(row.month) || new Date().getMonth() + 1,
      year: Number(row.year) || new Date().getFullYear(),
      months_pending: Number(row.months_pending || row.pending || 0),
      payment_date: row.payment_date || row.paymentdate || null,
      voucher_number: row.voucher_number || row.voucher || null,
    };
  });
}

