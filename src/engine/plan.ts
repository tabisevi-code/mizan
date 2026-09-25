/**
 * The planner: geometry, regulation, weather, load and money in, a ranked set
 * of buildable options out.
 *
 * Ranking is by net present value, not by a tuned score. If someone asks why
 * one option beat another, the answer is a number with a unit.
 *
 * Every option can be re-costed under different assumptions through `Factors`,
 * which is what lets the same code produce the uncertainty band and the
 * sensitivity chart instead of a single falsely precise figure.
 */

import { DEFAULT_BATTERY, simulateDispatch, type BatterySpec } from "./battery";
import {
  DEFAULT_MODULE,
  fitArray,
  ringsAreaM2,
  type ArrayFit,
  type ArrayLayout,
} from "./capacity";
import {
  avoidedCo2Tonnes,
  buildCapex,
  comparePpa,
  DEFAULT_PPA,
  evaluateFinance,
  type CapexLine,
  type FinanceResult,
  type OwnershipComparison,
  type PpaTerms,
} from "./finance";
import { buildLoadProfile, type LoadProfile } from "./load";
import {
  DEFAULT_GROUND_TILT_DEG,
  DEFAULT_PV_LOSSES,
  DEFAULT_ROOF_TILT_DEG,
  simulateArray,
} from "./pv";
import {
  RULE_SETS,
  labelEmirate,
  regulatoryCap,
  screenStructure,
  screenTechnologies,
  type CapResult,
  type StructuralVerdict,
} from "./rules";
import { modelledWeatherYear, type WeatherYear } from "./solar";
import { weatherOrModelled } from "./resource";
import { annualBill, selectTariff, type Tariff } from "./tariff";
import {
  BASE_FACTORS,
  monteCarlo,
  sensitivity,
  type Factors,
  type SensitivityEntry,
  type UncertaintyResult,
} from "./uncertainty";
import {
  HOURS_PER_YEAR,
  newSeries,
  type HourlySeries,
  type ScreenResult,
  type SiteProfile,
  type SimulationResult,
} from "./types";

export type BindingConstraint =
  | "roof-area"
  | "approved-load"
  | "tcl-slab"
  | "plot-cap"
  | "budget"
  | "self-consumption"
  | "none";

export type Sizing = {
  roofSolarKwp: number;
  groundSolarKwp: number;
  batteryKwh: number;
  layout: ArrayLayout;
};

export type PlanOption = {
  id: string;
  sizing: Sizing;
  battery: BatterySpec | null;
  capex: { lines: CapexLine[]; totalAed: number };
  simulation: SimulationResult;
  finance: FinanceResult;
  renewableShare: number;
  selfConsumptionRate: number;
  avoidedCo2Tonnes: number;
  bindingConstraint: BindingConstraint;
  bindingExplanation: string;
};

export type PlanContext = {
  site: SiteProfile;
  weather: WeatherYear;
  load: LoadProfile;
  tariff: Tariff | null;
  screens: ScreenResult[];
  structure: StructuralVerdict;
  cap: CapResult;
  roofAreaM2: number;
  groundAreaM2: number;
  /** How much fits with rows facing south, and with rows back to back east-west. */
  roofFit: Record<ArrayLayout, ArrayFit>;
  groundFit: ArrayFit;
  baselineBillAed: number;
  /** kWh per kWp per year for each layout, before any site factors. */
  specificYield: Record<ArrayLayout, number>;
  /** Row-shading loss against the share of the packed roof actually built. */
  shadingCurve: Record<ArrayLayout, { fill: number; loss: number }[]>;
  unit: Record<ArrayLayout, HourlySeries>;
  unitGround: HourlySeries;
};

/**
 * Why the customer's target could not be met, in one named case. The point is
 * to say which constraint failed and by how much, in the customer's units,
 * rather than return a worse answer with no explanation.
 */
export type Infeasibility = {
  kind:
    | "no-tariff"
    | "regulatory-cap"
    | "budget"
    | "area"
    | "self-consumption"
    | "no-options";
  /** What the target asked for, self-consumed kWh a year. */
  requiredKwh: number;
  /** The most any buildable option delivered, self-consumed kWh a year. */
  achievedKwh: number;
  /** requiredKwh minus achievedKwh. */
  shortfallKwh: number;
  explanation: string;
};

export type PlanResult = {
  context: PlanContext;
  options: PlanOption[];
  best: PlanOption | null;
  uncertainty: UncertaintyResult | null;
  sensitivity: SensitivityEntry[];
  ppa: OwnershipComparison | null;
  /** Present when nothing buildable meets the site's stated target. */
  infeasibility: Infeasibility | null;
  /** The option meeting the target at lowest cost, when one exists. */
  targetOption: PlanOption | null;
};

const EMPTY_FIT: ArrayFit = {
  kwp: 0,
  moduleCount: 0,
  usableAreaM2: 0,
  groundCoverageRatio: 0,
  wattsPerM2: 0,
};

const scaled = (unit: HourlySeries, factor: number): HourlySeries => {
  const output = newSeries();
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) output[hour] = unit[hour] * factor;
  return output;
};

const combine = (a: HourlySeries, b: HourlySeries, scaleA: number, scaleB: number): HourlySeries => {
  const output = newSeries();
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    output[hour] = a[hour] * scaleA + b[hour] * scaleB;
  }
  return output;
};

const ladder = (
  maxKwp: number,
  steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
): number[] => {
  if (maxKwp <= 0) return [0];
  return [...new Set(steps.map((fraction) => Math.round(maxKwp * fraction)))].sort((a, b) => a - b);
};

/**
 * Sandwich-panel roofs cannot take ballast, so the array has to be railed to
 * the structure below. That is more labour, more fixings and more sealing.
 */
const mountingCostFactor = (structure: StructuralVerdict): number =>
  structure.recommendedMounting === "railed-lightweight" ? 1.15 : 1;

/**
 * When the roof outline is known well enough to lay actual rows on it, the
 * caller passes the capacity that really packed in. It beats any area-times-
 * coverage estimate, so it wins.
 */
export type CapacityOverride = Partial<
  Record<
    ArrayLayout,
    {
      kwp: number;
      moduleCount: number;
      /**
       * Loss to the shadow of the row in front, sampled at a few fill levels.
       * It cannot be one number: a system smaller than the roof could hold is
       * built as whole rows spread across the roof, so below about six tenths
       * of the roof every row has a double gap in front of it and there is no
       * row shading at all. Sorted by `fill`, which is the share of the packed
       * capacity that is actually built. Comes from `shading.ts`, which needs
       * the real rows, so only the caller that packed them can supply it.
       */
      shadingCurve?: { fill: number; loss: number }[];
    }
  >
>;

export const buildContext = (
  site: SiteProfile,
  weather?: WeatherYear,
  packed?: CapacityOverride,
): PlanContext => {
  const roofAreaM2 = ringsAreaM2(site.roofRings);
  const groundAreaM2 = ringsAreaM2(site.groundRings);
  const screens = screenTechnologies(site, roofAreaM2, groundAreaM2);
  const structure = screenStructure(site.roofConstruction);
  const cap = regulatoryCap(site);
  const resolvedWeather = weatherOrModelled(site.location, weather);

  const load = buildLoadProfile({
    sector: site.sector,
    annualKwh: site.annualKwh,
    monthlyKwh: site.monthlyKwh,
  });

  const tariff = selectTariff({
    emirate: site.emirate,
    customerClass: site.customerClass,
    peakDemandKw: load.peakKw,
  });

  const roofFit: Record<ArrayLayout, ArrayFit> = {
    south: fitArray(roofAreaM2, "roof-flat", DEFAULT_ROOF_TILT_DEG, site.location.lat, DEFAULT_MODULE, undefined, "south"),
    "east-west": fitArray(roofAreaM2, "roof-flat", DEFAULT_ROOF_TILT_DEG, site.location.lat, DEFAULT_MODULE, undefined, "east-west"),
  };
  const groundFit = RULE_SETS[site.emirate].groundMountPermitted
    ? fitArray(groundAreaM2, "ground", DEFAULT_GROUND_TILT_DEG, site.location.lat)
    : EMPTY_FIT;

  for (const layout of ["south", "east-west"] as ArrayLayout[]) {
    const override = packed?.[layout];
    if (override && override.kwp > 0) {
      roofFit[layout] = {
        ...roofFit[layout],
        kwp: override.kwp,
        moduleCount: override.moduleCount,
      };
    }
  }

  const baselineBillAed = tariff ? annualBill(tariff, load.hourlyKw).totalAed : 0;

  // One kilowatt-peak of each layout, simulated once and then scaled. East-west
  // is two half-arrays pointing away from each other.
  const south = simulateArray(
    site.location,
    resolvedWeather,
    { kwp: 1, tiltDeg: DEFAULT_ROOF_TILT_DEG, azimuthDeg: 0, mounting: "roof-flat", dcAcRatio: 1.2 },
  );
  const east = simulateArray(
    site.location,
    resolvedWeather,
    { kwp: 0.5, tiltDeg: DEFAULT_ROOF_TILT_DEG, azimuthDeg: -90, mounting: "roof-flat", dcAcRatio: 1.2 },
  );
  const west = simulateArray(
    site.location,
    resolvedWeather,
    { kwp: 0.5, tiltDeg: DEFAULT_ROOF_TILT_DEG, azimuthDeg: 90, mounting: "roof-flat", dcAcRatio: 1.2 },
  );
  const eastWest = combine(east.hourlyAcKw, west.hourlyAcKw, 1, 1);
  const ground = simulateArray(site.location, resolvedWeather, {
    kwp: 1,
    tiltDeg: DEFAULT_GROUND_TILT_DEG,
    azimuthDeg: 0,
    mounting: "ground",
    dcAcRatio: 1.2,
  });

  let eastWestAnnual = 0;
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) eastWestAnnual += eastWest[hour];

  return {
    site,
    weather: resolvedWeather,
    load,
    tariff,
    screens,
    structure,
    cap,
    roofAreaM2,
    groundAreaM2,
    roofFit,
    groundFit,
    baselineBillAed,
    specificYield: { south: south.specificYield, "east-west": eastWestAnnual },
    shadingCurve: {
      south: packed?.south?.shadingCurve ?? [],
      "east-west": packed?.["east-west"]?.shadingCurve ?? [],
    },
    unit: { south: south.hourlyAcKw, "east-west": eastWest },
    unitGround: ground.hourlyAcKw,
  };
};

/**
 * Read the row-shading loss off the sampled curve. Between samples it is
 * straight-line; past either end it holds the nearest sample rather than
 * extrapolating into a number nobody computed.
 */
export const shadingAtFill = (curve: { fill: number; loss: number }[], fill: number): number => {
  if (curve.length === 0) return 0;
  if (fill <= curve[0].fill) return curve[0].loss;
  const last = curve[curve.length - 1];
  if (fill >= last.fill) return last.loss;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1];
    const b = curve[i];
    if (fill <= b.fill) {
      const span = b.fill - a.fill;
      if (span <= 0) return b.loss;
      return a.loss + ((fill - a.fill) / span) * (b.loss - a.loss);
    }
  }
  return last.loss;
};

/** Cost and value one specific system under one specific set of assumptions. */
export const evaluateSizing = (
  context: PlanContext,
  sizing: Sizing,
  factors: Factors = BASE_FACTORS,
): PlanOption | null => {
  const { tariff, site } = context;
  if (!tariff) return null;

  const totalKwp = sizing.roofSolarKwp + sizing.groundSolarKwp;
  if (totalKwp <= 0) return null;

  // How much of the roof this option actually covers decides how tightly the
  // rows sit, and therefore how much they shade each other.
  const packedKwp = context.roofFit[sizing.layout].kwp;
  const fill = packedKwp > 0 ? sizing.roofSolarKwp / packedKwp : 0;
  const shading = shadingAtFill(context.shadingCurve[sizing.layout], fill);

  const generation = combine(
    context.unit[sizing.layout],
    context.unitGround,
    sizing.roofSolarKwp * factors.yieldFactor * (1 - shading),
    sizing.groundSolarKwp * factors.yieldFactor,
  );

  const load =
    factors.loadFactor === 1 ? context.load.hourlyKw : scaled(context.load.hourlyKw, factors.loadFactor);

  const battery: BatterySpec | null =
    sizing.batteryKwh > 0
      ? {
          ...DEFAULT_BATTERY,
          capacityKwh: sizing.batteryKwh,
          powerKw: Math.round(sizing.batteryKwh / 2),
        }
      : null;

  const rawCapex = buildCapex({
    roofSolarKwp: sizing.roofSolarKwp,
    groundSolarKwp: sizing.groundSolarKwp,
    batteryKwh: sizing.batteryKwh,
    batteryPowerKw: battery?.powerKw ?? 0,
    connectionFeeAed: RULE_SETS[site.emirate].connectionFeeAed,
  });
  const costFactor = factors.capexFactor * mountingCostFactor(context.structure);
  const capex = {
    lines: rawCapex.lines.map((line) =>
      line.id === "connection" ? line : { ...line, aed: line.aed * costFactor },
    ),
    totalAed: 0,
  };
  capex.totalAed = capex.lines.reduce((total, line) => total + line.aed, 0);

  const simulation = simulateDispatch(generation, load, battery, tariff);
  const baseline =
    factors.loadFactor === 1 ? context.baselineBillAed : annualBill(tariff, load).totalAed;
  const withSolar = annualBill(tariff, simulation.hourly.imported).totalAed;
  const firstYearSavingsAed = baseline - withSolar;

  const batteryCapexAed = capex.lines.find((line) => line.id === "battery")?.aed ?? 0;

  const finance = evaluateFinance({
    capexAed: capex.totalAed,
    batteryCapexAed,
    installedKw: totalKwp,
    firstYearSavingsAed,
    firstYearGenerationKwh: simulation.generationKwh,
    assumptions: {
      tariffEscalation: factors.tariffEscalation,
      degradationPerYear: factors.degradationPerYear,
      omAedPerKwYear: 55 * factors.omFactor,
    },
  });

  const selfConsumptionRate =
    simulation.generationKwh > 0 ? simulation.selfConsumedKwh / simulation.generationKwh : 0;
  const loadKwh = context.load.annualKwh * factors.loadFactor;

  const { constraint, explanation } = identifyConstraint({
    context,
    sizing,
    totalKwp,
    capexAed: capex.totalAed,
    selfConsumptionRate,
  });

  return {
    id: `${sizing.layout}-r${sizing.roofSolarKwp}-g${sizing.groundSolarKwp}-b${sizing.batteryKwh}`,
    sizing,
    battery,
    capex,
    simulation,
    finance,
    renewableShare: loadKwh > 0 ? (simulation.selfConsumedKwh / loadKwh) * 100 : 0,
    selfConsumptionRate,
    avoidedCo2Tonnes: avoidedCo2Tonnes(simulation.selfConsumedKwh),
    bindingConstraint: constraint,
    bindingExplanation: explanation,
  };
};

export const plan = (
  site: SiteProfile,
  weather?: WeatherYear,
  ppaTerms: PpaTerms = DEFAULT_PPA,
  packed?: CapacityOverride,
): PlanResult => {
  const context = buildContext(site, weather, packed);
  if (!context.tariff) {
    return {
      context,
      options: [],
      best: null,
      uncertainty: null,
      sensitivity: [],
      ppa: null,
      infeasibility: {
        kind: "no-tariff",
        requiredKwh: targetKwh(site) ?? 0,
        achievedKwh: 0,
        shortfallKwh: targetKwh(site) ?? 0,
        explanation: `No published tariff could be matched to a ${site.customerClass} account in ${labelEmirate(site.emirate)}, so no bill and no saving can be priced.`,
      },
      targetOption: null,
    };
  }

  const dailyKwh = context.load.annualKwh / 365;
  const batteryLadder = [0, 0.1, 0.25, 0.4].map((fraction) => Math.round(dailyKwh * fraction));
  const options: PlanOption[] = [];
  // Everything the rules and geometry allow, ignoring budget, is also
  // evaluated so an infeasible answer can say which constraint stopped it.
  const unconstrained: PlanOption[] = [];

  for (const layout of ["south", "east-west"] as ArrayLayout[]) {
    const roofCeiling = Math.min(context.roofFit[layout].kwp, context.cap.capKw);
    for (const roofSolarKwp of ladder(roofCeiling)) {
      for (const groundSolarKwp of ladder(Math.min(context.groundFit.kwp, context.cap.capKw), [0, 0.5, 1])) {
        if (roofSolarKwp + groundSolarKwp > context.cap.capKw) continue;
        for (const batteryKwh of batteryLadder) {
          const option = evaluateSizing(context, { roofSolarKwp, groundSolarKwp, batteryKwh, layout });
          if (!option) continue;
          unconstrained.push(option);
          if (site.budgetAed && option.capex.totalAed > site.budgetAed) continue;
          options.push(option);
        }
      }
    }
  }

  options.sort((a, b) => b.finance.npvAed - a.finance.npvAed);
  const best = options[0] ?? null;
  const { infeasibility, targetOption } = assessTarget(context, options, unconstrained);

  if (!best) {
    return {
      context,
      options,
      best: null,
      uncertainty: null,
      sensitivity: [],
      ppa: null,
      infeasibility,
      targetOption,
    };
  }

  const evaluate = (factors: Factors) => {
    const option = evaluateSizing(context, best.sizing, factors);
    return {
      npvAed: option?.finance.npvAed ?? 0,
      paybackYears: option?.finance.simplePaybackYears ?? null,
      firstYearSavingsAed: option?.finance.firstYearSavingsAed ?? 0,
    };
  };

  return {
    context,
    options,
    best,
    uncertainty: monteCarlo(evaluate),
    sensitivity: sensitivity(evaluate),
    ppa: comparePpa({
      ownership: best.finance,
      selfConsumedKwh: best.simulation.selfConsumedKwh,
      avoidedBillYear1Aed: best.finance.firstYearSavingsAed,
      ppa: ppaTerms,
    }),
    infeasibility,
    targetOption,
  };
};

const targetKwh = (site: SiteProfile): number | null =>
  site.energyTargetShare && site.energyTargetShare > 0
    ? site.energyTargetShare * site.annualKwh
    : null;

const constraintLabel = (kind: Infeasibility["kind"]): string =>
  ({
    "no-tariff": "no matching tariff",
    "regulatory-cap": "the grid connection cap",
    budget: "the stated budget",
    area: "the mapped roof and land",
    "self-consumption": "how much of the generation the site can use",
    "no-options": "the site",
  })[kind];

/**
 * Whether any buildable option reaches the site's energy target, and when none
 * does, which single constraint is responsible. The named case is chosen by
 * what an unconstrained build would have delivered: if even an unlimited budget
 * cannot reach the target the binding limit is physical or regulatory, not
 * financial.
 */
const assessTarget = (
  context: PlanContext,
  options: PlanOption[],
  unconstrained: PlanOption[],
): { infeasibility: Infeasibility | null; targetOption: PlanOption | null } => {
  const target = targetKwh(context.site);
  const budget = context.site.budgetAed;

  const achievable = unconstrained.length > 0 ? unconstrained : options;
  const maxCoverage = achievable.reduce(
    (highest, option) => Math.max(highest, option.simulation.selfConsumedKwh),
    0,
  );

  if (options.length === 0) {
    const cheapest = unconstrained.reduce(
      (lowest, option) => (option.capex.totalAed < lowest.capex.totalAed ? option : lowest),
      unconstrained[0] ?? null,
    );
    if (cheapest && budget && cheapest.capex.totalAed > budget) {
      return {
        infeasibility: {
          kind: "budget",
          requiredKwh: target ?? context.load.annualKwh,
          achievedKwh: 0,
          shortfallKwh: target ?? context.load.annualKwh,
          explanation: `The cheapest buildable system costs AED ${Math.round(cheapest.capex.totalAed).toLocaleString()}, against a stated ceiling of AED ${budget.toLocaleString()}. The shortfall is capital, not site.`,
        },
        targetOption: null,
      };
    }
    return {
      infeasibility: {
        kind: context.cap.capKw <= 0 ? "regulatory-cap" : "area",
        requiredKwh: target ?? context.load.annualKwh,
        achievedKwh: 0,
        shortfallKwh: target ?? context.load.annualKwh,
        explanation:
          context.cap.capKw <= 0
            ? `The rules permit no connected capacity here: ${context.cap.explanation}`
            : "No mapped roof or land can take an array. A usable roof polygon or land parcel has to be supplied before anything can be sized.",
      },
      targetOption: null,
    };
  }

  if (target === null || maxCoverage >= target) {
    const meets = options.filter((option) => option.simulation.selfConsumedKwh >= (target ?? 0));
    const cheapestMeeting =
      meets.length > 0
        ? meets.reduce((lowest, option) =>
            option.capex.totalAed < lowest.capex.totalAed ? option : lowest,
          )
        : null;
    return { infeasibility: null, targetOption: cheapestMeeting };
  }

  // The target is unreachable. Name the blocker.
  const biggest = achievable.reduce((top, option) =>
    option.simulation.selfConsumedKwh > top.simulation.selfConsumedKwh ? option : top,
  );
  const capBlocks = context.cap.capKw !== Infinity;
  const roofFull = biggest.bindingConstraint === "roof-area";
  const kind: Infeasibility["kind"] = capBlocks
    ? "regulatory-cap"
    : roofFull
      ? "area"
      : "self-consumption";

  return {
    infeasibility: {
      kind,
      requiredKwh: target,
      achievedKwh: maxCoverage,
      shortfallKwh: target - maxCoverage,
      explanation: `The target asks for ${Math.round(target).toLocaleString()} kWh a year consumed from renewables; the largest buildable option delivers ${Math.round(maxCoverage).toLocaleString()}. ${constraintLabel(kind)} is what stops the gap. ${biggest.bindingExplanation}`,
    },
    targetOption: null,
  };
};

const identifyConstraint = (input: {
  context: PlanContext;
  sizing: Sizing;
  totalKwp: number;
  capexAed: number;
  selfConsumptionRate: number;
}): { constraint: BindingConstraint; explanation: string } => {
  const { context, sizing, totalKwp, selfConsumptionRate } = input;
  const roofCeiling = context.roofFit[sizing.layout].kwp;
  const capCeiling = context.cap.capKw;
  const budget = context.site.budgetAed;

  const nearCap = capCeiling !== Infinity && totalKwp >= capCeiling * 0.98;
  const nearRoof = totalKwp >= (roofCeiling + context.groundFit.kwp) * 0.98;

  if (nearCap && capCeiling <= roofCeiling) {
    const rule = context.cap.bindingRule;
    return {
      constraint:
        rule === "plot-cap" ? "plot-cap" : rule === "tcl-slab" ? "tcl-slab" : "approved-load",
      explanation: context.cap.explanation,
    };
  }
  if (nearRoof) {
    return {
      constraint: "roof-area",
      explanation: `The array fills the mapped roof: ${Math.round(context.roofFit[sizing.layout].usableAreaM2).toLocaleString()} m2 usable after a 30% allowance for plant, walkways and setbacks, at ${Math.round(context.roofFit[sizing.layout].groundCoverageRatio * 100)}% coverage.`,
    };
  }
  if (budget && input.capexAed >= budget * 0.95) {
    return {
      constraint: "budget",
      explanation: `The plan spends AED ${Math.round(input.capexAed).toLocaleString()} against a stated ceiling of AED ${budget.toLocaleString()}.`,
    };
  }
  if (selfConsumptionRate < 0.9) {
    return {
      constraint: "self-consumption",
      explanation: `Only ${Math.round(selfConsumptionRate * 100)}% of what the panels make is used on site. Surplus is credited against future bills rather than paid for, so extra panels earn very little.`,
    };
  }
  return { constraint: "none", explanation: "No single constraint binds this option." };
};

export const moduleCountFor = (kwp: number): number =>
  Math.round((kwp * 1000) / DEFAULT_MODULE.watts);
