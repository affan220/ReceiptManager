export type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function calendarDateParts(value: string | null | undefined): CalendarDateParts | null {
  const match = typeof value === "string" ? DATE_ONLY.exec(value) : null;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const localDate = new Date(year, month - 1, day);
  if (localDate.getFullYear() !== year || localDate.getMonth() + 1 !== month || localDate.getDate() !== day) return null;
  return { year, month, day };
}

export function isCalendarDate(value: string | null | undefined): value is string {
  return calendarDateParts(value) !== null;
}

export function formatCalendarDate(value: string | null | undefined): string {
  const parts = calendarDateParts(value);
  if (!parts) return "—";
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(parts.year, parts.month - 1, parts.day));
}

export function calendarDateMatchesPeriod(value: string | null | undefined, month: number | null, year: number | null): boolean {
  const parts = calendarDateParts(value);
  if (!parts) return false;
  return (!month || parts.month === month) && (!year || parts.year === year);
}

export function calendarDateMatchesRange(value: string | null | undefined, range: "all" | "today" | "week" | "month" | "custom", from: string, to: string): boolean {
  if (range === "all") return true;
  const parts = calendarDateParts(value);
  if (!parts) return false;
  const normalized = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;

  if (range === "custom") return Boolean((!from || normalized >= from) && (!to || normalized <= to) && (from || to));

  const today = new Date();
  const todayParts = { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
  if (range === "today") return parts.year === todayParts.year && parts.month === todayParts.month && parts.day === todayParts.day;
  if (range === "month") return parts.year === todayParts.year && parts.month === todayParts.month;

  const calendarValue = new Date(parts.year, parts.month - 1, parts.day).getTime();
  const weekStart = new Date(todayParts.year, todayParts.month - 1, todayParts.day);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(todayParts.year, todayParts.month - 1, todayParts.day);
  weekEnd.setHours(23, 59, 59, 999);
  return calendarValue >= weekStart.getTime() && calendarValue <= weekEnd.getTime();
}
