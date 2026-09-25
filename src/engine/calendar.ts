/**
 * Calendar helpers shared across the engine.
 *
 * Every simulation runs on the same reference year: 8,760 hours, no leap day,
 * index 0 = 1 January 00:00 local standard time. Month and weekday lookups
 * used to be re-implemented in five different files; they live here so the
 * load model, the tariff billing, the battery dispatch and the shading loss
 * can never disagree about which month an hour belongs to.
 */

import { HOURS_PER_YEAR } from "./types";

/** Days in each calendar month, Jan..Dec, for the non-leap reference year. */
export const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Hours in each calendar month, Jan..Dec. */
export const MONTH_HOURS = MONTH_LENGTHS.map((days) => days * 24);

/** Day of year, 1-365, for an hour of the year. */
export const dayOfYearFromHour = (hourOfYear: number): number =>
  Math.floor(hourOfYear / 24) + 1;

/** Month index 0-11 for an hour of the year. */
export const monthOfHour = (hourOfYear: number): number => {
  let remaining = dayOfYearFromHour(hourOfYear);
  for (let month = 0; month < 12; month += 1) {
    if (remaining <= MONTH_LENGTHS[month]) return month;
    remaining -= MONTH_LENGTHS[month];
  }
  return 11;
};

/** Month index for every hour of the year, computed once. */
export const MONTH_OF_HOUR: Uint8Array = (() => {
  const out = new Uint8Array(HOURS_PER_YEAR);
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) out[hour] = monthOfHour(hour);
  return out;
})();

/**
 * Day of week for an hour of the year: 0 = Sunday ... 6 = Saturday.
 *
 * The reference year starts on a Thursday, so `firstDayOffset` is 4. That
 * happens to be the real 1 January 2026, but any year starting on a Thursday
 * gives the same result.
 */
export const dayOfWeekIndex = (hourOfYear: number, firstDayOffset = 4): number =>
  (Math.floor(hourOfYear / 24) + firstDayOffset) % 7;
