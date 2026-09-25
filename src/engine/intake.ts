/**
 * Company intake.
 *
 * A business arrives with a bill, not a data model. This module pulls the
 * fields the engine needs out of whatever the customer can paste — DEWA,
 * ADDC, SEWA or EtihadWE bill text, or a month-by-month kWh export — and
 * proposes them with a confidence per field. Nothing lands in the site
 * profile until the operator confirms it, because a misread bill becomes a
 * wrong answer that looks like a measurement.
 */

import type { Emirate, Provenance, SiteProfile } from "./types";

export type FieldConfidence = "high" | "medium" | "low";

export type FieldProposal = {
  key: "monthlyKwh" | "annualKwh" | "approvedLoadKw" | "emirate" | "customerClass";
  label: string;
  /** Human-readable value shown next to the confirm control. */
  display: string;
  /** The parsed value in engine units. */
  monthlyKwh?: number[];
  annualKwh?: number;
  approvedLoadKw?: number;
  emirate?: Emirate;
  customerClass?: "commercial" | "industrial";
  confidence: FieldConfidence;
  /** What in the text this came from, so the operator can check it. */
  basis: string;
};

export type BillProposal = {
  /** Which utility the text looks like it came from, if it can be told. */
  utility: "dewa" | "addc" | "sewa" | "etihadwe" | "unknown";
  fields: FieldProposal[];
  /** Anything detected but too uncertain to propose silently. */
  notes: string[];
};

const NUMBER = /[\d,]+(?:\.\d+)?/g;

const parseNumber = (text: string): number | null => {
  const match = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const MONTH_NAME: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};

const detectUtility = (text: string): BillProposal["utility"] => {
  const lower = text.toLowerCase();
  if (/dewa|dubai electricity|shams|dubai water/.test(lower)) return "dewa";
  if (/addc|aadc|abu dhabi distribution|al ain distribution/.test(lower)) return "addc";
  if (/sewa|sharjah electricity/.test(lower)) return "sewa";
  if (/etihad|fewa|utico|federal electricity/.test(lower)) return "etihadwe";
  return "unknown";
};

const UTILITY_EMIRATES: Record<string, Emirate> = {
  dewa: "dubai",
  addc: "abu-dhabi",
  sewa: "sharjah",
};

/**
 * Rows like "JAN  12,345" or "Jan-25  12345 kWh" or "2025-01  12345". A row
 * earns a month only when a month token is adjacent to the number; loose
 * integers in a bill mean too many things to trust.
 */
const monthlyFromText = (text: string): { month: number; kwh: number; basis: string }[] => {
  const rows: { month: number; kwh: number; basis: string }[] = [];
  const seen = new Set<number>();

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const name of Object.keys(MONTH_NAME)) {
      const month = MONTH_NAME[name];
      if (seen.has(month)) continue;
      const monthRe = new RegExp(`\\b${name}\\b[-\\s]?\\d{0,2}\\b`, "i");
      if (!monthRe.test(lower)) continue;
      // Take the largest kWh-looking number on the line: the billed amount.
      const numbers = line.match(NUMBER) ?? [];
      const kwh = numbers
        .map((token) => Number(token.replace(/,/g, "")))
        .filter((value) => Number.isFinite(value) && value >= 50 && value < 1e9)
        .sort((a, b) => b - a)[0];
      if (kwh === undefined) continue;
      seen.add(month);
      rows.push({ month, kwh, basis: line.trim() });
    }
    // ISO-style rows: 2025-01  12345
    const iso = lower.match(/\b(19|20)\d{2}-(0[1-9]|1[0-2])\b/);
    if (iso) {
      const month = Number(iso[0].slice(5)) - 1;
      if (!seen.has(month)) {
        const numbers = line.match(NUMBER) ?? [];
        const kwh = numbers
          .map((token) => Number(token.replace(/,/g, "")))
          .filter((value) => value >= 50 && value < 1e9)
          .sort((a, b) => b - a)[0];
        if (kwh !== undefined) {
          seen.add(month);
          rows.push({ month, kwh, basis: line.trim() });
        }
      }
    }
  }
  return rows.sort((a, b) => a.month - b.month);
};

/** DEWA bills state "Total Approved Load" or "Contract Demand" in kW/kVA. */
const approvedLoadFromText = (text: string): { kw: number; basis: string } | null => {
  const patterns = [
    /(?:total\s+)?approved\s+load[^0-9]{0,20}([\d,]+(?:\.\d+)?)\s*(?:kw|kva|kilowatt)?/i,
    /contract\s+demand[^0-9]{0,20}([\d,]+(?:\.\d+)?)\s*(?:kw|kva)?/i,
    /connected\s+load[^0-9]{0,20}([\d,]+(?:\.\d+)?)\s*(?:kw|kva)?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const kw = parseNumber(match[1]);
      if (kw && kw > 0 && kw < 1e6) return { kw, basis: match[0].trim() };
    }
  }
  return null;
};

/** "Total consumption ... 123,456 kWh" or "Total units ...". */
const annualFromText = (text: string): { kwh: number; basis: string } | null => {
  const patterns = [
    /(?:total|annual)\s+(?:consumption|units|usage)[^0-9]{0,20}([\d,]+(?:\.\d+)?)\s*kwh/i,
    /total[^0-9]{0,10}([\d,]{4,})\s*kwh/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const kwh = parseNumber(match[1]);
      if (kwh && kwh > 1000) return { kwh, basis: match[0].trim() };
    }
  }
  return null;
};

export const extractBill = (text: string): BillProposal => {
  const utility = detectUtility(text);
  const fields: FieldProposal[] = [];
  const notes: string[] = [];

  const monthly = monthlyFromText(text);
  if (monthly.length >= 10) {
    const monthlyKwh = new Array(12).fill(0);
    for (const row of monthly) monthlyKwh[row.month] = row.kwh;
    const total = monthlyKwh.reduce((sum, value) => sum + value, 0);
    fields.push({
      key: "monthlyKwh",
      label: "Monthly consumption",
      display: `12 months, ${Math.round(total).toLocaleString()} kWh a year`,
      monthlyKwh,
      annualKwh: total,
      confidence: monthly.length === 12 ? "high" : "medium",
      basis: monthly.slice(0, 3).map((row) => row.basis).join("; ") + " …",
    });
  } else {
    if (monthly.length > 0) {
      notes.push(
        `Only ${monthly.length} months of consumption could be read; a partial year flatters or starves the load model, so it was not proposed.`,
      );
    }
    const annual = annualFromText(text);
    if (annual) {
      fields.push({
        key: "annualKwh",
        label: "Annual consumption",
        display: `${Math.round(annual.kwh).toLocaleString()} kWh a year`,
        annualKwh: annual.kwh,
        confidence: "medium",
        basis: annual.basis,
      });
    }
  }

  const approvedLoad = approvedLoadFromText(text);
  if (approvedLoad) {
    fields.push({
      key: "approvedLoadKw",
      label: "Approved load",
      display: `${Math.round(approvedLoad.kw).toLocaleString()} kW`,
      approvedLoadKw: approvedLoad.kw,
      confidence: "high",
      basis: approvedLoad.basis,
    });
  } else {
    notes.push(
      "No approved-load figure was found. In Dubai the installed cap is a slab share of Total Connected Load, so this number decides what can be built — get the account's approved load or TCL before trusting the sizing.",
    );
  }

  const emirate = UTILITY_EMIRATES[utility];
  if (emirate) {
    fields.push({
      key: "emirate",
      label: "Emirate",
      display: emirate,
      emirate,
      confidence: "high",
      basis: `utility detected as ${utility.toUpperCase()}`,
    });
  }

  return { utility, fields, notes };
};

/**
 * The fields a confirmed proposal is allowed to write to a site profile. The
 * operator confirms each one against the bill; nothing is applied unreviewed.
 */
export const applyBillProposal = (
  site: SiteProfile,
  proposal: BillProposal,
  confirmed: FieldProposal["key"][],
): SiteProfile => {
  const next: SiteProfile = { ...site };
  for (const field of proposal.fields) {
    if (!confirmed.includes(field.key)) continue;
    if (field.key === "monthlyKwh" && field.monthlyKwh) {
      next.monthlyKwh = field.monthlyKwh;
      if (field.annualKwh) next.annualKwh = field.annualKwh;
      next.evidence = { ...next.evidence, hasIntervalMeterData: true };
    }
    if (field.key === "annualKwh" && field.annualKwh) next.annualKwh = field.annualKwh;
    if (field.key === "approvedLoadKw" && field.approvedLoadKw) {
      next.approvedLoadKw = field.approvedLoadKw;
      next.evidence = { ...next.evidence, hasApprovedLoadLetter: true };
    }
    if (field.key === "emirate" && field.emirate) next.emirate = field.emirate;
    if (field.key === "customerClass" && field.customerClass) next.customerClass = field.customerClass;
  }
  return next;
};

/**
 * The intake questions that move the answer most, in the order to ask them.
 * A guided flow renders this list; the point of ordering it is that approved
 * load and roof construction decide feasibility before load shape matters.
 */
export const INTAKE_QUESTIONS: {
  key: keyof SiteProfile | "roofRings" | "evidence";
  label: string;
  why: string;
  /** Lower number asks earlier. */
  rank: number;
}[] = [
  {
    key: "emirate",
    label: "Which emirate is the site in?",
    why: "Rules, tariffs and what export earns differ per emirate.",
    rank: 1,
  },
  {
    key: "approvedLoadKw",
    label: "Approved load on the electricity account, in kW",
    why: "In Dubai this is the binding legal cap: the installed array is a slab share of Total Connected Load, not the roof size.",
    rank: 2,
  },
  {
    key: "roofConstruction",
    label: "How is the roof built?",
    why: "Concrete takes a ballasted array; sandwich panel usually needs railed mounting and a structural check.",
    rank: 3,
  },
  {
    key: "annualKwh",
    label: "Annual consumption, kWh — or twelve monthly bills",
    why: "The load the system must offset. Monthly readings are worth much more than an annual figure.",
    rank: 4,
  },
  {
    key: "roofRings",
    label: "The roof outline or usable roof area",
    why: "Decides how much physically fits after setbacks and walkways.",
    rank: 5,
  },
  {
    key: "budgetAed",
    label: "Is there a capital budget ceiling, AED?",
    why: "Options over it are excluded and the planner reports which constraint binds.",
    rank: 6,
  },
  {
    key: "energyTargetShare",
    label: "Share of consumption you want renewables to cover, %",
    why: "The planner checks whether it is reachable and names the blocker when it is not.",
    rank: 7,
  },
  {
    key: "evidence",
    label: "What can you evidence? Interval data, structural reserve, land rights",
    why: "Evidence gates the technology screens; without it wind, biomass, hydro, tidal and geothermal stay provisional.",
    rank: 8,
  },
];
