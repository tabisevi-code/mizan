/**
 * Monthly energy-mix screening for multi-technology portfolios.
 *
 * This is deliberately a simpler model than the hourly path in `plan.ts` /
 * `battery.ts`: it matches monthly energy totals, with no dispatch, no TOU
 * windows and no battery round-trip losses. Per DEVIN.md §10 that makes its
 * coverage numbers an optimistic ceiling on what the detailed simulation
 * would find — right for ranking which technologies are worth a closer look,
 * wrong for quoting a payback.
 */

import { MONTH_HOURS } from "./calendar";
import type { RenewableSource } from "./types";

export type RenewableSystem = {
  source: RenewableSource;
  capacityKw: number;
  /** AC output per installed kW (solar: kWp), Jan–Dec. Includes losses. */
  monthlyKwhPerKw: number[];
  capexAedPerKw: number;
  annualOmFraction: number;
};
export type FinancialResult = {
  capexAed: number; grossSavingsAed: number; annualOmAed: number;
  netSavingsAed: number; paybackYears: number | null; annualRoi: number | null;
};
const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
const nonnegative = (v: number, label: string) => {
  if (!Number.isFinite(v) || v < 0) throw new Error(`${label} must be finite and nonnegative`);
};
function months(values: number[], label: string) {
  if (values.length !== 12) throw new Error(`${label} requires 12 months`);
  values.forEach(v => nonnegative(v, label));
}

export function calculateFinancial(capexAed: number, grossSavingsAed: number, annualOmAed: number): FinancialResult {
  [capexAed, grossSavingsAed, annualOmAed].forEach(v => nonnegative(v, "Finance input"));
  const netSavingsAed = grossSavingsAed - annualOmAed;
  return { capexAed, grossSavingsAed, annualOmAed, netSavingsAed,
    paybackYears: capexAed > 0 && netSavingsAed > 0 ? capexAed / netSavingsAed : null,
    annualRoi: capexAed > 0 ? netSavingsAed / capexAed : null };
}

/** Water-to-wire efficiency η of a micro-hydro turbine and generator. */
export const HYDRO_TURBINE_EFFICIENCY = 0.65;

/** Physical hydro model: ρgQHη, capped by turbine rating; no pumped-storage credit. */
export function hydroMonthlyYield(capacityKw: number, headM: number, flowCms: number[], efficiency = HYDRO_TURBINE_EFFICIENCY): number[] {
  nonnegative(capacityKw, "Hydro capacity"); nonnegative(headM, "Head"); months(flowCms, "Flow");
  if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 1) throw new Error("Efficiency must be in (0, 1]");
  return flowCms.map((flow, m) => capacityKw === 0 ? 0 : Math.min(capacityKw, 9.81 * flow * headM * efficiency) * MONTH_HOURS[m] / capacityKw);
}

/** Descriptive seasonality, not reliability, firm capacity or an hourly dispatch score. */
export function analyzeComplementarity(series: number[][]) {
  series.forEach(s => months(s, "Generation"));
  const active = series.filter(s => total(s) > 0);
  const daily = MONTH_HOURS.map((hours, m) => total(active.map(s => s[m])) / (hours / 24));
  const mean = total(daily) / 12;
  const cv = mean > 0 ? Math.sqrt(total(daily.map(v => (v - mean) ** 2)) / 12) / mean : null;
  const peaks = active.filter(s => {
    const rates = s.map((v, m) => v / MONTH_HOURS[m]);
    return Math.max(...rates) - Math.min(...rates) > 1e-8;
  }).map(s => {
    const rates = s.map((v, m) => v / MONTH_HOURS[m]);
    return rates.indexOf(Math.max(...rates));
  });
  const peakOffsetMonths = peaks.length < 2 ? null : Math.max(...peaks.flatMap(a => peaks.map(b => Math.min(Math.abs(a - b), 12 - Math.abs(a - b)))));
  return { stabilityScore: cv === null ? null : Math.round(100 * Math.max(0, 1 - cv)), peakOffsetMonths };
}

export function analyzeRenewableCombination(name: string, systems: RenewableSystem[], annualConsumptionKwh: number,
  options: { tariffAedPerKwh?: number; monthlyLoadKwh?: number[] } = {}) {
  nonnegative(annualConsumptionKwh, "Consumption");
  const tariff = options.tariffAedPerKwh ?? 0.30;
  nonnegative(tariff, "Tariff");
  const load = options.monthlyLoadKwh ?? MONTH_HOURS.map(h => annualConsumptionKwh * h / 8760);
  months(load, "Load");
  if (Math.abs(total(load) - annualConsumptionKwh) > Math.max(0.01, annualConsumptionKwh * 1e-8)) throw new Error("Monthly load must sum to annual consumption");
  const seen = new Set<RenewableSource>();
  const generation = systems.map(system => {
    if (seen.has(system.source)) throw new Error("Duplicate energy source");
    seen.add(system.source);
    nonnegative(system.capacityKw, "Capacity"); nonnegative(system.capexAedPerKw, "Capex");
    nonnegative(system.annualOmFraction, "O&M");
    if (system.annualOmFraction > 1) throw new Error("O&M fraction exceeds 1");
    months(system.monthlyKwhPerKw, "Yield");
    if (system.monthlyKwhPerKw.some((v, m) => v > MONTH_HOURS[m])) throw new Error("Yield exceeds nameplate capacity");
    return system.monthlyKwhPerKw.map(v => v * system.capacityKw);
  });
  const monthlyGenerationKwh = MONTH_HOURS.map((_, m) => total(generation.map(s => s[m])));
  // Monthly matching is an optimistic ceiling: no hourly coincidence or export payment assumed.
  const matched = monthlyGenerationKwh.map((v, m) => Math.min(v, load[m]));
  const bySource = systems.map((system, i) => {
    const gross = total(generation[i].map((v, m) => monthlyGenerationKwh[m] > 0 ? matched[m] * v / monthlyGenerationKwh[m] * tariff : 0));
    const capex = system.capacityKw * system.capexAedPerKw;
    return { source: system.source, capacityKw: system.capacityKw, monthlyKwh: generation[i], annualKwh: total(generation[i]),
      financial: calculateFinancial(capex, gross, capex * system.annualOmFraction) };
  });
  const annualGeneration = total(monthlyGenerationKwh);
  const financial = calculateFinancial(total(bySource.map(s => s.financial.capexAed)), total(matched) * tariff, total(bySource.map(s => s.financial.annualOmAed)));
  const recommendations = ["Savings use monthly load matching: an optimistic ceiling until interval meter and generation data are available. Surplus earns no revenue."];
  if (annualGeneration > annualConsumptionKwh) recommendations.push("Annual generation exceeds consumption; assess curtailment, storage and connection limits before increasing capacity.");
  if (systems.some(s => s.source !== "solar")) recommendations.push("Wind, water or subsurface measurements, land rights and technology-specific connection approval are required before investment.");
  return { name, bySource, monthlyGenerationKwh, financial, recommendations,
    annualResults: { totalMwh: annualGeneration / 1000,
      generationToLoadPercent: annualConsumptionKwh > 0 ? annualGeneration / annualConsumptionKwh * 100 : null,
      loadCoveragePercent: annualConsumptionKwh > 0 ? total(matched) / annualConsumptionKwh * 100 : null,
      surplusKwh: annualGeneration - total(matched) },
    complementarity: analyzeComplementarity(generation) };
}

export function compareScenarios(scenarios: { name: string; systems: RenewableSystem[] }[], annualKwh: number,
  options: Parameters<typeof analyzeRenewableCombination>[3] = {}) {
  return scenarios.map(s => analyzeRenewableCombination(s.name, s.systems, annualKwh, options));
}
