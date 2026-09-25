/**
 * Load profiles.
 *
 * A screening tool almost never gets interval meter data on day one, so this
 * builds an hourly shape from the sector, then scales it to whatever the
 * customer can evidence: twelve monthly bill readings if they have them, an
 * annual total if not.
 *
 * The shapes are normalised patterns, not measurements, and are labelled that
 * way. When real interval data arrives it replaces this module entirely.
 */

import { dayOfWeekIndex, monthOfHour } from "./calendar";
import {
  HOURS_PER_YEAR,
  newSeries,
  sum,
  type HourlySeries,
  type Provenance,
  type SectorArchetype,
} from "./types";

export const LOAD_SHAPE_SOURCE: Provenance = {
  kind: "assumption",
  label: "Sector load shape",
  asOf: "2026-09-23",
  caveat:
    "Normalised sector pattern, not this site's meter data. Cooling seasonality follows UAE ambient temperature. Replace with interval data before any investment decision.",
};

type ShapeSpec = {
  /** Fraction of peak drawn at each hour of a working day, 24 values. */
  weekday: number[];
  /** Same, for the Friday/Saturday weekend pattern used in the UAE. */
  weekend: number[];
  /**
   * How strongly the load tracks cooling demand, 0 to 1. A cold store barely
   * moves with ambient temperature; an office is almost all air conditioning.
   */
  coolingSensitivity: number;
};

const flat = (value: number) => new Array(24).fill(value);

const SHAPES: Record<SectorArchetype, ShapeSpec> = {
  warehouse: {
    weekday: [
      0.28, 0.27, 0.27, 0.27, 0.28, 0.32, 0.45, 0.68, 0.85, 0.93, 0.97, 1.0, 0.98, 0.95, 0.96, 0.94,
      0.88, 0.75, 0.55, 0.42, 0.36, 0.32, 0.3, 0.29,
    ],
    weekend: [
      0.25, 0.24, 0.24, 0.24, 0.25, 0.26, 0.3, 0.36, 0.42, 0.46, 0.48, 0.49, 0.48, 0.47, 0.46, 0.44,
      0.4, 0.36, 0.32, 0.3, 0.28, 0.27, 0.26, 0.25,
    ],
    coolingSensitivity: 0.45,
  },
  "cold-store": {
    weekday: [
      0.82, 0.8, 0.79, 0.78, 0.78, 0.8, 0.85, 0.9, 0.94, 0.97, 0.99, 1.0, 1.0, 0.99, 0.98, 0.97,
      0.95, 0.92, 0.9, 0.88, 0.86, 0.85, 0.84, 0.83,
    ],
    weekend: [
      0.78, 0.77, 0.76, 0.75, 0.75, 0.76, 0.79, 0.83, 0.86, 0.89, 0.91, 0.92, 0.92, 0.91, 0.9, 0.89,
      0.87, 0.85, 0.83, 0.82, 0.81, 0.8, 0.79, 0.78,
    ],
    coolingSensitivity: 0.55,
  },
  "factory-2shift": {
    weekday: [
      0.35, 0.34, 0.34, 0.35, 0.42, 0.62, 0.88, 0.96, 0.98, 1.0, 1.0, 0.98, 0.9, 0.95, 0.97, 0.96,
      0.93, 0.88, 0.78, 0.6, 0.45, 0.4, 0.37, 0.36,
    ],
    weekend: [
      0.3, 0.29, 0.29, 0.3, 0.32, 0.36, 0.42, 0.46, 0.48, 0.5, 0.5, 0.49, 0.47, 0.46, 0.45, 0.44,
      0.42, 0.4, 0.38, 0.35, 0.33, 0.32, 0.31, 0.3,
    ],
    coolingSensitivity: 0.35,
  },
  "factory-24h": {
    weekday: flat(0.92).map((value, hour) => (hour >= 9 && hour <= 16 ? 1.0 : value)),
    weekend: flat(0.86),
    coolingSensitivity: 0.3,
  },
  office: {
    weekday: [
      0.22, 0.21, 0.21, 0.21, 0.22, 0.26, 0.38, 0.62, 0.85, 0.95, 0.99, 1.0, 0.97, 0.93, 0.96, 0.95,
      0.9, 0.72, 0.48, 0.34, 0.28, 0.25, 0.24, 0.23,
    ],
    weekend: [
      0.2, 0.19, 0.19, 0.19, 0.2, 0.21, 0.23, 0.26, 0.3, 0.33, 0.35, 0.36, 0.35, 0.34, 0.33, 0.32,
      0.3, 0.27, 0.25, 0.23, 0.22, 0.21, 0.21, 0.2,
    ],
    coolingSensitivity: 0.7,
  },
  retail: {
    weekday: [
      0.3, 0.29, 0.28, 0.28, 0.29, 0.31, 0.36, 0.45, 0.6, 0.75, 0.85, 0.92, 0.95, 0.96, 0.97, 0.98,
      1.0, 1.0, 0.98, 0.92, 0.8, 0.62, 0.42, 0.33,
    ],
    weekend: [
      0.32, 0.31, 0.3, 0.3, 0.31, 0.32, 0.36, 0.44, 0.58, 0.74, 0.86, 0.94, 0.98, 1.0, 1.0, 1.0,
      1.0, 1.0, 0.99, 0.95, 0.86, 0.7, 0.48, 0.36,
    ],
    coolingSensitivity: 0.6,
  },
  "data-hall": {
    weekday: flat(0.95),
    weekend: flat(0.95),
    coolingSensitivity: 0.25,
  },
};

/** Monthly cooling weight derived from UAE ambient temperature, Jan..Dec. */
const COOLING_WEIGHT = [0.62, 0.64, 0.72, 0.84, 0.95, 1.0, 1.0, 1.0, 0.94, 0.85, 0.73, 0.65];

/**
 * Whether an hour falls on the site's non-working pattern.
 *
 * The UAE statutory weekend since 2022 is Saturday and Sunday, with Friday a
 * half-day for the public sector; much of the private sector still winds down
 * early on Friday too. So Friday keeps the weekday shape until 13:00 and the
 * weekend shape after, and Saturday and Sunday are weekend all day.
 */
const isWeekendHour = (hourOfYear: number): boolean => {
  const dow = dayOfWeekIndex(hourOfYear);
  const hourOfDay = hourOfYear % 24;
  return dow === 0 || dow === 6 || (dow === 5 && hourOfDay >= 13);
};

export type LoadProfileInput = {
  sector: SectorArchetype;
  annualKwh: number;
  /** Twelve monthly readings from real bills, Jan..Dec, if available. */
  monthlyKwh?: number[];
};

export type LoadProfile = {
  hourlyKw: HourlySeries;
  annualKwh: number;
  peakKw: number;
  /** Share of consumption that falls between 07:00 and 18:00. */
  daytimeShare: number;
  provenance: Provenance;
};

export const buildLoadProfile = (input: LoadProfileInput): LoadProfile => {
  const shape = SHAPES[input.sector];
  const raw = newSeries();

  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const month = monthOfHour(hour);
    const hourOfDay = hour % 24;
    const base = isWeekendHour(hour) ? shape.weekend[hourOfDay] : shape.weekday[hourOfDay];
    const cooling =
      1 - shape.coolingSensitivity + shape.coolingSensitivity * COOLING_WEIGHT[month];
    raw[hour] = base * cooling;
  }

  // Scale to the evidenced consumption, month by month when bills allow it.
  const hourlyKw = newSeries();
  if (input.monthlyKwh && input.monthlyKwh.length === 12) {
    const monthTotals = new Array(12).fill(0);
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) monthTotals[monthOfHour(hour)] += raw[hour];
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
      const month = monthOfHour(hour);
      hourlyKw[hour] = monthTotals[month] > 0 ? (raw[hour] / monthTotals[month]) * input.monthlyKwh[month] : 0;
    }
  } else {
    const total = sum(raw);
    const scale = total > 0 ? input.annualKwh / total : 0;
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) hourlyKw[hour] = raw[hour] * scale;
  }

  let peakKw = 0;
  let daytimeKwh = 0;
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    if (hourlyKw[hour] > peakKw) peakKw = hourlyKw[hour];
    const hourOfDay = hour % 24;
    if (hourOfDay >= 7 && hourOfDay < 18) daytimeKwh += hourlyKw[hour];
  }

  const annualKwh = sum(hourlyKw);
  return {
    hourlyKw,
    annualKwh,
    peakKw,
    daytimeShare: annualKwh > 0 ? daytimeKwh / annualKwh : 0,
    provenance: input.monthlyKwh
      ? {
          kind: "user-evidence",
          label: "Monthly bills",
          asOf: "2026-09-23",
          caveat: "Monthly totals are real; the within-day shape is still a sector pattern.",
        }
      : LOAD_SHAPE_SOURCE,
  };
};

export const SECTOR_LABELS: Record<SectorArchetype, string> = {
  warehouse: "Ambient warehouse",
  "cold-store": "Cold store",
  "factory-2shift": "Factory, two shifts",
  "factory-24h": "Factory, continuous",
  office: "Office",
  retail: "Retail",
  "data-hall": "Data hall",
};
