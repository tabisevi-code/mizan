/**
 * Capital cost, cashflow and the numbers a finance director actually asks for:
 * payback, IRR, net present value and levelised cost of energy.
 *
 * Two things this module refuses to do, because both would flatter the result:
 *   - value exported kWh as cash in Dubai, where DEWA credits surplus against
 *     future bills indefinitely but never pays it out;
 *   - hold output flat across the life, when modules degrade every year.
 */

import type { Provenance, TechnologyId } from "./types";

export const COST_SOURCE: Provenance = {
  kind: "assumption",
  label: "UAE installed-cost range",
  url: "https://www.sun2x.ae/blog/solar-cost-dubai-2026.html",
  asOf: "2026-09-23",
  caveat:
    "Published vendor ranges for UAE commercial rooftop, tapered by system size. Balance-of-system specifics — cable metres, string counts, inverter count from the electrical design — are inside this flat per-kW rate rather than priced separately. Quoted ex-VAT: a VAT-registered business reclaims the 5% input VAT, so ex-VAT capex is the basis the (VAT-inclusive) bill savings should be compared against. Replace with quoted prices before any decision.",
};

export const OM_SOURCE: Provenance = {
  kind: "assumption",
  label: "O&M convention",
  asOf: "2026-09-23",
  caveat:
    "No citable UAE benchmark was found. AED 55/kW/year reflects industry convention including frequent cleaning for Gulf dust.",
};

/**
 * Installed cost per kW, tapered with system size. A 100 kW job carries its
 * mobilisation over few kilowatts; a megawatt does not.
 */
export const solarCostPerKw = (kwp: number, mounting: "roof" | "ground"): number => {
  if (kwp <= 0) return 0;
  const roof = 3400 - 1000 * Math.min(1, Math.log10(Math.max(kwp, 10) / 50) / Math.log10(20));
  const base = Math.max(2400, roof);
  return mounting === "ground" ? base * 0.9 : base;
};

export type CapexLine = {
  id: TechnologyId | "bos" | "connection";
  label: string;
  aed: number;
  basis: string;
};

export type CapexInput = {
  roofSolarKwp: number;
  groundSolarKwp: number;
  batteryKwh: number;
  batteryPowerKw: number;
  connectionFeeAed: number | null;
};

export const buildCapex = (input: CapexInput): { lines: CapexLine[]; totalAed: number } => {
  const lines: CapexLine[] = [];

  if (input.roofSolarKwp > 0) {
    const rate = solarCostPerKw(input.roofSolarKwp, "roof");
    lines.push({
      id: "roof-solar",
      label: "Rooftop PV, supplied and installed",
      aed: input.roofSolarKwp * rate,
      basis: `${Math.round(input.roofSolarKwp).toLocaleString()} kWp at AED ${Math.round(rate).toLocaleString()}/kW`,
    });
  }
  if (input.groundSolarKwp > 0) {
    const rate = solarCostPerKw(input.groundSolarKwp, "ground");
    lines.push({
      id: "ground-solar",
      label: "Ground-mounted PV, supplied and installed",
      aed: input.groundSolarKwp * rate,
      basis: `${Math.round(input.groundSolarKwp).toLocaleString()} kWp at AED ${Math.round(rate).toLocaleString()}/kW`,
    });
  }
  if (input.batteryKwh > 0) {
    // Split energy and power so a high-power, low-energy battery prices sanely.
    const energyAed = input.batteryKwh * 1100;
    const powerAed = input.batteryPowerKw * 900;
    lines.push({
      id: "battery",
      label: "Battery energy storage",
      aed: energyAed + powerAed,
      basis: `${Math.round(input.batteryKwh).toLocaleString()} kWh at AED 1,100/kWh plus ${Math.round(input.batteryPowerKw).toLocaleString()} kW at AED 900/kW`,
    });
  }
  if (input.connectionFeeAed) {
    lines.push({
      id: "connection",
      label: "Utility connection fee",
      aed: input.connectionFeeAed,
      basis: "Published scheme fee",
    });
  }

  return { lines, totalAed: lines.reduce((total, line) => total + line.aed, 0) };
};

export type FinanceAssumptions = {
  /** Discount rate used for NPV and LCOE. */
  discountRate: number;
  /** Expected annual rise in the electricity tariff. */
  tariffEscalation: number;
  /**
   * Annual rise in the O&M rate. Holding O&M flat while savings escalate
   * would flatter every project, so it escalates with general prices.
   */
  omEscalation: number;
  /** Module output decline per year. */
  degradationPerYear: number;
  omAedPerKwYear: number;
  /**
   * Inverters do not last as long as modules. A 25-year model that never
   * replaces them is quietly optimistic by a few hundred dirhams a kilowatt.
   */
  inverterReplacementYear: number;
  inverterReplacementAedPerKw: number;
  /** Battery replacement in this year, as a share of original battery capex. */
  batteryReplacementYear: number;
  batteryReplacementShare: number;
  /**
   * Marginal corporate tax rate applied to net operational savings. Bill
   * savings increase taxable profit and O&M is deductible, so both are scaled
   * by (1 - rate). Zero for non-taxpaying customers. UAE mainland companies
   * at or above the threshold pay 9% under Federal Decree-Law 47 of 2022.
   */
  corporateTaxRate: number;
  analysisYears: number;
};

export const CORPORATE_TAX_SOURCE: Provenance = {
  kind: "authority",
  label: "UAE Corporate Tax — Federal Decree-Law No. 47 of 2022",
  url: "https://mof.gov.ae/corporate-tax-faq/",
  asOf: "2026-09-25",
  caveat:
    "9% on taxable profits above AED 375,000, effective for financial years starting on or after 1 June 2023. Qualifying free-zone income can be 0%. The engine scales net savings by (1 - rate) — it does not model depreciation allowances.",
};

export const DEFAULT_FINANCE: FinanceAssumptions = {
  discountRate: 0.08,
  tariffEscalation: 0.02,
  omEscalation: 0.02,
  degradationPerYear: 0.005,
  omAedPerKwYear: 55,
  inverterReplacementYear: 12,
  inverterReplacementAedPerKw: 300,
  batteryReplacementYear: 12,
  batteryReplacementShare: 0.5,
  corporateTaxRate: 0,
  analysisYears: 25,
};

export type CashflowYear = {
  year: number;
  generationKwh: number;
  savingsAed: number;
  omAed: number;
  replacementAed: number;
  netAed: number;
  cumulativeAed: number;
  discountedNetAed: number;
};

export type FinanceResult = {
  capexAed: number;
  firstYearSavingsAed: number;
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;
  irr: number | null;
  npvAed: number;
  lcoeAedPerKwh: number;
  lifetimeSavingsAed: number;
  cashflow: CashflowYear[];
};

export type FinanceInput = {
  capexAed: number;
  batteryCapexAed: number;
  installedKw: number;
  /** First-year bill saving in AED: the bill without solar minus the bill with it. */
  firstYearSavingsAed: number;
  firstYearGenerationKwh: number;
  assumptions?: Partial<FinanceAssumptions>;
};

const irrFromCashflows = (flows: number[]): number | null => {
  const npvAt = (rate: number) =>
    flows.reduce((total, flow, index) => total + flow / (1 + rate) ** index, 0);

  if (npvAt(0) <= 0) return null; // never pays back undiscounted

  let low = 0;
  let high = 1.5;
  if (npvAt(high) > 0) return null; // implausibly good; refuse to report it

  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    if (npvAt(mid) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
};

export const evaluateFinance = (input: FinanceInput): FinanceResult => {
  const assumptions = { ...DEFAULT_FINANCE, ...input.assumptions };
  const cashflow: CashflowYear[] = [];
  const flows: number[] = [-input.capexAed];

  let cumulative = -input.capexAed;
  let simplePayback: number | null = null;
  let discountedPayback: number | null = null;
  let discountedCumulative = -input.capexAed;
  let discountedGeneration = 0;
  let discountedCost = input.capexAed;
  let lifetimeSavings = 0;

  for (let year = 1; year <= assumptions.analysisYears; year += 1) {
    const degradation = (1 - assumptions.degradationPerYear) ** (year - 1);
    const escalation = (1 + assumptions.tariffEscalation) ** (year - 1);
    const generationKwh = input.firstYearGenerationKwh * degradation;
    const savingsAed = input.firstYearSavingsAed * degradation * escalation;
    const omAed =
      input.installedKw * assumptions.omAedPerKwYear * (1 + assumptions.omEscalation) ** (year - 1);
    const batteryReplacementAed =
      input.batteryCapexAed > 0 && year === assumptions.batteryReplacementYear
        ? input.batteryCapexAed * assumptions.batteryReplacementShare
        : 0;
    const inverterReplacementAed =
      year === assumptions.inverterReplacementYear
        ? input.installedKw * assumptions.inverterReplacementAedPerKw
        : 0;
    const replacementAed = batteryReplacementAed + inverterReplacementAed;

    const netAed =
      (savingsAed - omAed) * (1 - assumptions.corporateTaxRate) - replacementAed;
    cumulative += netAed;
    lifetimeSavings += netAed;
    flows.push(netAed);

    const discountFactor = 1 / (1 + assumptions.discountRate) ** year;
    const discountedNet = netAed * discountFactor;
    const previousDiscountedCumulative = discountedCumulative;
    discountedCumulative += discountedNet;
    discountedGeneration += generationKwh * discountFactor;
    discountedCost += (omAed + replacementAed) * discountFactor;

    if (simplePayback === null && cumulative >= 0 && netAed > 0) {
      simplePayback = year - cumulative / netAed;
    }
    if (discountedPayback === null && discountedCumulative >= 0 && discountedNet > 0) {
      discountedPayback = year - discountedCumulative / discountedNet;
      if (previousDiscountedCumulative >= 0) discountedPayback = year - 1;
    }

    cashflow.push({
      year,
      generationKwh,
      savingsAed,
      omAed,
      replacementAed,
      netAed,
      cumulativeAed: cumulative,
      discountedNetAed: discountedNet,
    });
  }

  const npvAed = flows.reduce(
    (total, flow, index) => total + flow / (1 + assumptions.discountRate) ** index,
    0,
  );

  return {
    capexAed: input.capexAed,
    firstYearSavingsAed: input.firstYearSavingsAed,
    simplePaybackYears: simplePayback,
    discountedPaybackYears: discountedPayback,
    irr: irrFromCashflows(flows),
    npvAed,
    lcoeAedPerKwh: discountedGeneration > 0 ? discountedCost / discountedGeneration : 0,
    lifetimeSavingsAed: lifetimeSavings,
    cashflow,
  };
};

/** UAE grid emission factor, used for avoided CO2. */
export const GRID_EMISSION_FACTOR = {
  kgPerKwh: 0.4041,
  provenance: {
    kind: "authority",
    label: "DEWA grid factor",
    url: "https://www.dewa.gov.ae/en/consumer/sustainability/sustainability-reports",
    asOf: "2026-09-23",
    caveat:
      "DEWA 2020 reported factor. Dubai's generation mix has decarbonised since, so this overstates avoided emissions; update from the latest sustainability report.",
  } satisfies Provenance,
};

export const avoidedCo2Tonnes = (kwh: number): number =>
  (kwh * GRID_EMISSION_FACTOR.kgPerKwh) / 1000;

// --- buy it, or let someone else own it ------------------------------------

/**
 * Most UAE customers are not choosing between solar and no solar. They are
 * choosing between paying for a system and signing a power purchase agreement,
 * where a developer builds it on their roof for nothing up front and sells them
 * the output at a fixed rate for 20 to 25 years.
 *
 * A tool that only prices ownership answers a question the customer is not
 * asking, so both are modelled side by side.
 */
export const PPA_SOURCE: Provenance = {
  kind: "assumption",
  label: "PPA rate assumption",
  asOf: "2026-09-23",
  caveat:
    "UAE developers do not publish their rates. The default range is indicative and must be replaced with a real offer before any decision.",
};

export type PpaTerms = {
  /** What the developer charges for each kWh the site uses. */
  aedPerKwh: number;
  /** Annual rise built into the contract. */
  escalation: number;
  termYears: number;
};

export const DEFAULT_PPA: PpaTerms = {
  aedPerKwh: 0.21,
  escalation: 0.02,
  termYears: 25,
};

export type OwnershipComparison = {
  own: { capexAed: number; npvAed: number; year1SavingsAed: number; paybackYears: number | null };
  ppa: { capexAed: 0; npvAed: number; year1SavingsAed: number };
  /** Which option has the higher net present value, and by how much. */
  verdict: "own" | "ppa";
  differenceAed: number;
  explanation: string;
};

export const comparePpa = (input: {
  ownership: FinanceResult;
  selfConsumedKwh: number;
  avoidedBillYear1Aed: number;
  ppa?: PpaTerms;
  assumptions?: Partial<FinanceAssumptions>;
}): OwnershipComparison => {
  const terms = input.ppa ?? DEFAULT_PPA;
  const assumptions = { ...DEFAULT_FINANCE, ...input.assumptions };

  let ppaNpv = 0;
  let ppaYear1 = 0;
  for (let year = 1; year <= Math.min(terms.termYears, assumptions.analysisYears); year += 1) {
    const degradation = (1 - assumptions.degradationPerYear) ** (year - 1);
    const avoided =
      input.avoidedBillYear1Aed * degradation * (1 + assumptions.tariffEscalation) ** (year - 1);
    const paid =
      input.selfConsumedKwh * degradation * terms.aedPerKwh * (1 + terms.escalation) ** (year - 1);
    const net = avoided - paid;
    if (year === 1) ppaYear1 = net;
    ppaNpv += net / (1 + assumptions.discountRate) ** year;
  }

  const verdict = input.ownership.npvAed >= ppaNpv ? "own" : "ppa";
  const difference = Math.abs(input.ownership.npvAed - ppaNpv);

  return {
    own: {
      capexAed: input.ownership.capexAed,
      npvAed: input.ownership.npvAed,
      year1SavingsAed: input.ownership.firstYearSavingsAed,
      paybackYears: input.ownership.simplePaybackYears,
    },
    ppa: { capexAed: 0, npvAed: ppaNpv, year1SavingsAed: ppaYear1 },
    verdict,
    explanation:
      verdict === "own"
        ? `Buying the system is worth about AED ${Math.round(difference).toLocaleString()} more over 25 years than signing a power purchase agreement at AED ${terms.aedPerKwh.toFixed(2)}/kWh, if the capital is available.`
        : `A power purchase agreement at AED ${terms.aedPerKwh.toFixed(2)}/kWh is worth about AED ${Math.round(difference).toLocaleString()} more than buying, and needs nothing up front.`,
    differenceAed: difference,
  };
};
