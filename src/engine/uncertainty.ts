/**
 * Uncertainty and sensitivity.
 *
 * Several inputs to this model are honest guesses: how dusty the site gets
 * between cleans, how much the customer really consumes, what an installer will
 * actually quote, how fast the tariff rises. Printing a single number like
 * "AED 1,046,089 a year" from inputs like those is false precision.
 *
 * So the engine runs the plan many times over plausible ranges of those inputs
 * and reports a band, plus which input is doing the damage.
 */

import { DEFAULT_FINANCE } from "./finance";

export type Factors = {
  /** Multiplier on annual PV output: weather, soiling and shading together. */
  yieldFactor: number;
  /** Multiplier on site consumption. */
  loadFactor: number;
  /** Multiplier on installed cost. */
  capexFactor: number;
  /** Multiplier on operations and maintenance cost. */
  omFactor: number;
  /** Annual electricity tariff rise, as a fraction. */
  tariffEscalation: number;
  /** Annual module output decline, as a fraction. */
  degradationPerYear: number;
};

export const BASE_FACTORS: Factors = {
  yieldFactor: 1,
  loadFactor: 1,
  capexFactor: 1,
  omFactor: 1,
  tariffEscalation: DEFAULT_FINANCE.tariffEscalation,
  degradationPerYear: DEFAULT_FINANCE.degradationPerYear,
};

export type FactorRange = {
  key: keyof Factors;
  label: string;
  /** What moving this actually represents, in the customer's words. */
  meaning: string;
  low: number;
  base: number;
  high: number;
};

/**
 * Ranges are deliberately wide. A screening tool that claims plus or minus 2%
 * on a roof nobody has walked is lying.
 */
export const DEFAULT_RANGES: FactorRange[] = [
  {
    key: "yieldFactor",
    label: "Solar output",
    meaning: "Dust, cloud, shading and how often the panels actually get cleaned",
    low: 0.88,
    base: 1,
    high: 1.08,
  },
  {
    key: "loadFactor",
    label: "Site consumption",
    meaning: "How much power the site really uses, and when",
    low: 0.85,
    base: 1,
    high: 1.15,
  },
  {
    key: "capexFactor",
    label: "Installed cost",
    meaning: "What an installer quotes once they have seen the roof",
    low: 0.85,
    base: 1,
    high: 1.25,
  },
  {
    key: "omFactor",
    label: "Upkeep cost",
    meaning: "Cleaning, monitoring and repairs over 25 years",
    low: 0.6,
    base: 1,
    high: 1.6,
  },
  {
    key: "tariffEscalation",
    label: "Electricity price rise",
    meaning: "How fast the utility raises its rates",
    low: 0,
    base: 0.02,
    high: 0.04,
  },
  {
    key: "degradationPerYear",
    label: "Panel ageing",
    meaning: "How quickly the panels lose output each year",
    low: 0.004,
    base: 0.005,
    high: 0.008,
  },
];

/** Deterministic generator, so the same site always shows the same band. */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Triangular draw: most weight near the base case, tails at the edges. */
const triangular = (random: () => number, low: number, base: number, high: number): number => {
  const u = random();
  const c = (base - low) / (high - low);
  if (u < c) return low + Math.sqrt(u * (high - low) * (base - low));
  return high - Math.sqrt((1 - u) * (high - low) * (high - base));
};

export type Band = { p10: number; p50: number; p90: number };

const percentile = (sorted: number[], fraction: number): number => {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

export type Metrics = {
  npvAed: number;
  paybackYears: number | null;
  firstYearSavingsAed: number;
};

export type UncertaintyResult = {
  runs: number;
  npv: Band;
  payback: Band;
  firstYearSavings: Band;
  /** Share of runs where the project never pays back at all. */
  neverPaysBackShare: number;
};

export const monteCarlo = (
  evaluate: (factors: Factors) => Metrics,
  runs = 250,
  ranges: FactorRange[] = DEFAULT_RANGES,
  seed = 20260923,
): UncertaintyResult => {
  const random = mulberry32(seed);
  const npvs: number[] = [];
  const paybacks: number[] = [];
  const savings: number[] = [];
  let neverPays = 0;

  for (let run = 0; run < runs; run += 1) {
    const factors = { ...BASE_FACTORS };
    for (const range of ranges) {
      factors[range.key] = triangular(random, range.low, range.base, range.high);
    }
    const metrics = evaluate(factors);
    npvs.push(metrics.npvAed);
    savings.push(metrics.firstYearSavingsAed);
    if (metrics.paybackYears === null) neverPays += 1;
    else paybacks.push(metrics.paybackYears);
  }

  npvs.sort((a, b) => a - b);
  paybacks.sort((a, b) => a - b);
  savings.sort((a, b) => a - b);

  return {
    runs,
    npv: { p10: percentile(npvs, 0.1), p50: percentile(npvs, 0.5), p90: percentile(npvs, 0.9) },
    payback: {
      p10: percentile(paybacks, 0.1),
      p50: percentile(paybacks, 0.5),
      p90: percentile(paybacks, 0.9),
    },
    firstYearSavings: {
      p10: percentile(savings, 0.1),
      p50: percentile(savings, 0.5),
      p90: percentile(savings, 0.9),
    },
    neverPaysBackShare: neverPays / runs,
  };
};

export type SensitivityEntry = {
  key: keyof Factors;
  label: string;
  meaning: string;
  lowNpvAed: number;
  highNpvAed: number;
  baseNpvAed: number;
  /** Total swing in NPV across the range, used to order the chart. */
  swingAed: number;
};

/**
 * One input moved at a time across its range, everything else held at base.
 * This is a tornado, not a variance decomposition: it shows which assumption
 * would embarrass you, not how the inputs interact.
 */
export const sensitivity = (
  evaluate: (factors: Factors) => Metrics,
  ranges: FactorRange[] = DEFAULT_RANGES,
): SensitivityEntry[] => {
  const baseNpv = evaluate(BASE_FACTORS).npvAed;
  return ranges
    .map((range) => {
      const low = evaluate({ ...BASE_FACTORS, [range.key]: range.low }).npvAed;
      const high = evaluate({ ...BASE_FACTORS, [range.key]: range.high }).npvAed;
      return {
        key: range.key,
        label: range.label,
        meaning: range.meaning,
        lowNpvAed: low,
        highNpvAed: high,
        baseNpvAed: baseNpv,
        swingAed: Math.abs(high - low),
      };
    })
    .sort((a, b) => b.swingAed - a.swingAed);
};
