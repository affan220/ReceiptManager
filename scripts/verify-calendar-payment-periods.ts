import assert from "node:assert/strict";
import {
  calendarDateMatchesPeriod,
  calendarDateMatchesRange,
  calendarDateParts,
  isCalendarDate,
} from "../client/src/lib/calendar-date";

const cases = [
  { value: "2026-01-10", month: 1, year: 2026 },
  { value: "2026-03-25", month: 3, year: 2026 },
  { value: "2026-08-05", month: 8, year: 2026 },
] as const;

for (const test of cases) {
  assert.deepEqual(calendarDateParts(test.value), { year: test.year, month: test.month, day: Number(test.value.slice(8, 10)) });
  assert.equal(isCalendarDate(test.value), true);
  assert.equal(calendarDateMatchesPeriod(test.value, test.month, test.year), true);
  assert.equal(calendarDateMatchesPeriod(test.value, test.month === 12 ? 1 : test.month + 1, test.year), false);
  assert.equal(calendarDateMatchesPeriod(test.value, test.month, test.year + 1), false);
  assert.equal(calendarDateMatchesRange(test.value, "custom", test.value, test.value), true);
}

assert.equal(isCalendarDate("2026-02-29"), false);
assert.equal(isCalendarDate("2026-03-32"), false);
assert.equal(isCalendarDate("2026-3-25"), false);
assert.equal(calendarDateMatchesPeriod("2026-03-25", 8, 2026), false);
assert.equal(calendarDateMatchesPeriod("2026-03-25", 3, 2026), true);

console.log("Calendar payment-date tests passed for January, March, August, custom ranges, and invalid-date rejection.");
