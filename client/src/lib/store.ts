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

export interface ImportMemberInput {
  rowNumber: number;
  name: string;
  phone: string;
  amount: string;
  status: string;
  payment_mode: string;
  month: string;
  year: string;
  months_pending: string;
  payment_date: string;
  voucher_number: string;
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

function parseLine(line: string, delimiter: string) {
  const values: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === delimiter && !inQuotes) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function normalizedHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function firstValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return "";
}

/**
 * Parses comma- or tab-delimited source data without silently coercing values.
 * The database RPC performs final validation and returns row-level failures.
 */
export function parseDelimited(text: string): ImportMemberInput[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseLine(lines[0], delimiter).map(normalizedHeader);

  return lines.slice(1).map((line, index) => {
    const values = parseLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, columnIndex) => { row[header] = values[columnIndex] ?? ""; });
    return {
      rowNumber: index + 2,
      name: firstValue(row, ["name", "member", "member_name", "full_name"]),
      phone: firstValue(row, ["phone", "mobile", "phone_number"]),
      amount: firstValue(row, ["amount", "payment_amount"]),
      status: firstValue(row, ["status", "payment_status"]) || "unpaid",
      payment_mode: firstValue(row, ["payment_mode", "paymentmethod", "payment_method", "paymentmode", "mode"]) || "cash",
      month: firstValue(row, ["month"]),
      year: firstValue(row, ["year"]),
      months_pending: firstValue(row, ["months_pending", "pending_months", "pending"]) || "0",
      payment_date: firstValue(row, ["payment_date", "paymentdate", "date"]),
      voucher_number: firstValue(row, ["voucher_number", "voucher", "voucher_no", "voucher_number"]),
    };
  });
}
