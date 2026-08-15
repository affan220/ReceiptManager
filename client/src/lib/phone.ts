export function indianMobileDigits(value: string | null | undefined): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  return digits.slice(0, 10);
}

export function isIndianMobile(value: string | null | undefined): boolean {
  return indianMobileDigits(value).length === 10;
}

export function formatIndianMobile(value: string | null | undefined): string {
  const digits = indianMobileDigits(value);
  return digits.length === 10 ? `+91 ${digits}` : String(value ?? "").trim();
}

export function phoneMatches(phone: string | null | undefined, search: string): boolean {
  const query = search.trim();
  if (!query) return true;
  if (String(phone ?? "").toLowerCase().includes(query.toLowerCase())) return true;
  const phoneDigits = indianMobileDigits(phone);
  const queryDigits = indianMobileDigits(query);
  return Boolean(queryDigits) && phoneDigits.includes(queryDigits);
}
