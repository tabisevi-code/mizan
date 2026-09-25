/**
 * Structured site report.
 *
 * The on-screen verdict is written for a person reading a page; this is the
 * same answer shaped for a company that has to act on it. Every recommended
 * step carries the benefit it unlocks, quantified where the model supports a
 * number, so the list can be dropped into a work order or an investment memo
 * without anyone re-reading the UI.
 *
 * It is data, not prose: serialise it to JSON and hand it to whoever owns the
 * next step — facilities for the surveys, procurement for the tender, finance
 * for the ownership question.
 */

import type { FinanceResult, OwnershipComparison } from "./finance";
import type { BindingConstraint, PlanResult } from "./plan";
import type { UncertaintyResult } from "./uncertainty";
import type { Emirate, SiteProfile } from "./types";

/** How much work a step is for whoever has to do it. */
export type Effort = "low" | "medium" | "high";

export type ReportAction = {
  /** The order to act in: evidence before money, money before construction. */
  order: number;
  /** Imperative one-liner — the thing to put on a work order. */
  action: string;
  /** What to actually do, concretely. */
  detail: string;
  /** Why it is worth doing — what it unlocks, saves or confirms. */
  benefit: string;
  /** Annual benefit in AED where the model can price it. */
  benefitAedPerYear?: number;
  /** Additional buildable capacity in kWp where a step unlocks it. */
  benefitKwp?: number;
  effort: Effort;
};

export type ReportRecommendation = {
  layout: "south" | "east-west";
  roofSolarKwp: number;
  groundSolarKwp: number;
  moduleCount: number;
  batteryKwh: number;
  batteryPowerKw: number;
  generationKwhPerYear: number;
  selfConsumedKwhPerYear: number;
  exportedKwhPerYear: number;
  /** Share of generation used on site rather than exported. */
  selfConsumptionRate: number;
  /** Share of the site's annual demand covered, percent. */
  renewableSharePct: number;
  avoidedCo2TonnesPerYear: number;
  capexAed: number;
  capexLines: { label: string; aed: number; basis: string }[];
  firstYearSavingsAed: number;
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;
  irrPct: number | null;
  npvAed: number;
  lcoeAedPerKwh: number;
  bindingConstraint: BindingConstraint;
  bindingExplanation: string;
};

export type ReportAlternative = {
  roofSolarKwp: number;
  groundSolarKwp: number;
  batteryKwh: number;
  layout: "south" | "east-west";
  capexAed: number;
  npvAed: number;
  simplePaybackYears: number | null;
  renewableSharePct: number;
};

export type SiteReport = {
  schemaVersion: 1;
  generatedAt: string;
  generator: string;
  site: {
    name: string;
    emirate: Emirate;
    sector: string;
    location: { lat: number; lng: number };
    annualConsumptionKwh: number;
    approvedLoadKw?: number;
    roofAreaM2: number;
  };
  verdict: {
    status: "good" | "warn" | "stop";
    headline: string;
    reason: string;
  };
  /** Why the plan could not be priced, when it could not. */
  planUnavailableReason?: "no-tariff";
  recommendation: ReportRecommendation | null;
  /** Next-best options by NPV, for the cases where the winner is not wanted. */
  alternatives: ReportAlternative[];
  uncertainty: {
    runs: number;
    npvAed: { p10: number; p50: number; p90: number };
    paybackYears: { p10: number; p50: number; p90: number };
    neverPaysBackShare: number;
  } | null;
  /** Own-versus-PPA on the same cashflows, when a tariff exists to compare. */
  financing: {
    verdict: "own" | "ppa";
    differenceAed: number;
    explanation: string;
  } | null;
  /** Screens that need a named measurement before they can move. */
  openEvidence: { technology: string; reason: string; unblockedBy?: string }[];
  /** Electrical/design warnings the installer must see, not hide. */
  warnings: string[];
  /** What to do, in order, each step carrying the benefit it brings. */
  actions: ReportAction[];
  /** The assumptions the numbers rest on, so nobody quotes them as measured. */
  caveats: string[];
};

export type ReportInput = {
  site: SiteProfile;
  result: PlanResult;
  verdict: { status: "good" | "warn" | "stop"; headline: string; reason: string };
  /** What physically packed on the roof for the recommended layout. */
  packedKwp: number;
  packedModuleCount: number;
  /** Annual yield lost to row-to-row shading, as a fraction. */
  rowShadingLoss: number | null;
  /** Annual plane-of-array yield lost to neighbouring buildings, as a fraction. */
  obstructionLoss: number | null;
  /** Warnings from the electrical design, verbatim. */
  designWarnings: string[];
  /** When the report was built; injected so tests can pin it. */
  generatedAt?: string;
};

const round = (value: number, places = 0): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const recommendationOf = (
  result: PlanResult,
  packedKwp: number,
  packedModuleCount: number,
): ReportRecommendation | null => {
  const best = result.best;
  if (!best) return null;
  const finance: FinanceResult = best.finance;
  // Panels to install: the packed count thinned to the recommended fill —
  // the same ratio the wiring design uses.
  const moduleCount =
    packedModuleCount > 0 && packedKwp > 0
      ? Math.round(packedModuleCount * Math.min(1, best.sizing.roofSolarKwp / packedKwp))
      : 0;
  return {
    layout: best.sizing.layout,
    roofSolarKwp: round(best.sizing.roofSolarKwp, 1),
    groundSolarKwp: round(best.sizing.groundSolarKwp, 1),
    moduleCount,
    batteryKwh: round(best.battery?.capacityKwh ?? 0, 1),
    batteryPowerKw: round(best.battery?.powerKw ?? 0, 1),
    generationKwhPerYear: round(best.simulation.generationKwh),
    selfConsumedKwhPerYear: round(best.simulation.selfConsumedKwh),
    exportedKwhPerYear: round(best.simulation.exportedKwh),
    selfConsumptionRate: round(best.selfConsumptionRate, 3),
    renewableSharePct: round(best.renewableShare, 1),
    avoidedCo2TonnesPerYear: round(best.avoidedCo2Tonnes, 1),
    capexAed: round(best.capex.totalAed),
    capexLines: best.capex.lines.map((line) => ({
      label: line.label,
      aed: round(line.aed),
      basis: line.basis,
    })),
    firstYearSavingsAed: round(finance.firstYearSavingsAed),
    simplePaybackYears: finance.simplePaybackYears === null ? null : round(finance.simplePaybackYears, 1),
    discountedPaybackYears:
      finance.discountedPaybackYears === null ? null : round(finance.discountedPaybackYears, 1),
    irrPct: finance.irr === null ? null : round(finance.irr * 100, 1),
    npvAed: round(finance.npvAed),
    lcoeAedPerKwh: round(finance.lcoeAedPerKwh, 3),
    bindingConstraint: best.bindingConstraint,
    bindingExplanation: best.bindingExplanation,
  };
};

export const buildReport = (input: ReportInput): SiteReport => {
  const { site, result } = input;
  const { context, best } = result;
  const tariff = context.tariff;
  const scheme = context.tariff?.utility === "ADDC" ? "DoE self-supply" : "Shams Dubai";

  const actions: ReportAction[] = [];

  if (result.planUnavailableReason === "no-tariff") {
    actions.push(
      {
        order: 1,
        action: "Obtain the current tariff schedule from the supply authority",
        detail:
          "No published tariff for this emirate is modelled. Ask SEWA, EtihadWE or the site's distribution company for the commercial/industrial rate schedule and any export or self-consumption scheme terms.",
        benefit:
          "Turns this screening into a costed plan. Today the engine can size the array but cannot price a saved kilowatt-hour, so no payback figure exists.",
        effort: "low",
      },
      {
        order: 2,
        action: "Pull 12 months of meter readings for the site",
        detail:
          "Monthly bills at minimum; half-hour interval data if the meter provides it. Feed the readings back into the model in place of the sector load shape.",
        benefit:
          "The load profile is currently a typical sector shape. Real readings decide whether the site uses enough power in daylight for solar to pay at all.",
        effort: "low",
      },
    );
  } else if (!best) {
    if (context.structure.status === "not-viable" || context.structure.recommendedMounting === "blocked") {
      actions.push({
        order: 1,
        action: "Get a structural engineer's report on the roof",
        detail: `${context.structure.headline} ${context.structure.detail}`,
        benefit:
          "The roof build is the reason nothing is recommended. Only an engineer's assessment can move this — either it confirms the roof can carry an array, or it closes the question.",
        effort: "medium",
      });
    }
    if (context.cap.capKw <= 0) {
      actions.push({
        order: actions.length + 1,
        action: "Confirm the approved load on the electricity account",
        detail: context.cap.explanation,
        benefit:
          "The regulatory cap is what binds here. Confirming or raising the approved load is the only thing that changes the answer.",
        effort: "medium",
      });
    }
  } else {
    // A buildable plan exists. Order the steps the way a company would act:
    // evidence first, utility process, then procurement.
    const saving = best.finance.firstYearSavingsAed;
    const cappedKwp = Math.max(0, input.packedKwp - Math.min(context.cap.capKw, input.packedKwp));

    if (!site.evidence.hasIntervalMeterData) {
      actions.push({
        order: 1,
        action: "Pull 12 months of interval meter data",
        detail:
          "Ask the utility for the site's half-hourly consumption history, or read it off the meter. Replace the sector load shape before signing anything.",
        benefit: `Every dirham of the AED ${Math.round(saving).toLocaleString()} year-one saving rests on the modelled load shape matching how this building actually uses power.`,
        benefitAedPerYear: round(saving),
        effort: "low",
      });
    }

    if (context.structure.status === "needs-evidence") {
      actions.push({
        order: actions.length + 1,
        action: "Commission a roof structural assessment",
        detail: `${context.structure.headline} ${context.structure.detail}`,
        benefit: `Confirms the roof can carry the ${Math.round(input.packedModuleCount).toLocaleString()}-panel layout before it is tendered. If railed mounting is required, the extra 15% is already in the quoted capex.`,
        effort: "medium",
      });
    }

    if (
      (best.bindingConstraint === "approved-load" || best.bindingConstraint === "plot-cap") &&
      cappedKwp > 1
    ) {
      actions.push({
        order: actions.length + 1,
        action: "Apply to raise the approved load / connection capacity",
        detail: `${context.cap.explanation} The regulator will not approve a system beyond it.`,
        benefit: `Unlocks up to ${Math.round(cappedKwp).toLocaleString()} kWp of additional roof that currently cannot be connected.`,
        benefitKwp: round(cappedKwp, 1),
        effort: "high",
      });
    }

    const exportShare =
      best.simulation.generationKwh > 0
        ? best.simulation.exportedKwh / best.simulation.generationKwh
        : 0;
    if (exportShare > 0.3 && !best.battery) {
      actions.push({
        order: actions.length + 1,
        action: "Phase the build or add storage to cut the exported share",
        detail: `${Math.round(exportShare * 100)}% of generation leaves the site. Exported units are credited against later bills, never paid out — they only earn if the site uses them back.`,
        benefit: `Resizing or adding a battery converts ${Math.round(best.simulation.exportedKwh).toLocaleString()} kWh/yr of low-value export into bill savings.`,
        effort: "medium",
      });
    }

    if (best.battery) {
      actions.push({
        order: actions.length + 1,
        action: "Include the recommended battery in the tender",
        detail: `${Math.round(best.battery.capacityKwh)} kWh / ${Math.round(best.battery.powerKw)} kW, dispatched against the ${tariff?.utility ?? "utility"} tariff and the site's own load shape.`,
        benefit:
          "The plan's payback assumes the battery shifts solar into the hours the site would otherwise import at the peak rate. Dropping it changes the economics, not just the hardware list.",
        effort: "medium",
      });
    }

    if ((input.obstructionLoss ?? 0) > 0.03) {
      actions.push({
        order: actions.length + 1,
        action: "Verify neighbouring building heights before committing",
        detail:
          "Taller buildings next door shade this roof. Their heights are estimated or mapped, not surveyed.",
        benefit: `${Math.round((input.obstructionLoss ?? 0) * 100)}% of annual in-plane energy is currently attributed to their shadow. If they are shorter than assumed, the yield — and the payback — improve.`,
        effort: "low",
      });
    }

    if (result.ppa && result.ppa.verdict === "ppa") {
      actions.push({
        order: actions.length + 1,
        action: "Request PPA offers before committing capital",
        detail: result.ppa.explanation,
        benefit: `A power purchase agreement is modelled as worth AED ${Math.round(result.ppa.differenceAed).toLocaleString()} more than buying, with no upfront cost.`,
        effort: "low",
      });
    }

    actions.push({
      order: actions.length + 1,
      action: "Tender the design to installers",
      detail:
        `The AED ${Math.round(best.capex.totalAed).toLocaleString()} capex uses a published UAE per-kW range tapered by size, not a quote. ` +
        (input.designWarnings.length > 0
          ? `${input.designWarnings.length} electrical design warning${input.designWarnings.length === 1 ? "" : "s"} must go to whoever prices it.`
          : "The electrical design — string lengths, inverter count, cable sizes — is in this report for pricing."),
      benefit:
        "Replaces the assumed cost basis with real prices. The payback moves with the quote, so tender before board approval, not after.",
      effort: "medium",
    });

    actions.push({
      order: actions.length + 1,
      action: `Submit the ${scheme} connection application`,
      detail:
        "The distribution scheme's approval is required before construction and is what makes exported units creditable. Approved load, single-line diagram and the structural assessment go in with it.",
      benefit: "Grid connection and export credits do not exist without it.",
      effort: "low",
    });
  }

  const recommendation = recommendationOf(result, input.packedKwp, input.packedModuleCount);

  const openEvidence = context.screens
    .filter((screen) => screen.status === "needs-evidence")
    .map((screen) => ({
      technology: screen.label,
      reason: screen.reason,
      ...(screen.unblockedBy ? { unblockedBy: screen.unblockedBy } : {}),
    }));

  const caveats = [
    "Sunlight is a fitted model checked against PVGIS at 16 UAE points, not metered output from this roof.",
    "The load profile is a sector shape, not this building's meter data, unless interval data has been supplied.",
    "Costs are published UAE ranges tapered by size, ex-VAT and inclusive of cabling and inverters — not an installer's quote.",
    tariff
      ? `Tariff: ${tariff.utility} ${tariff.customerClass}, published ${tariff.provenance.asOf ?? "date unknown"}. Confirm current rates before decision.`
      : "No tariff is modelled for this emirate; the plan is unpriced.",
    "Roof outline is community-mapped (OpenStreetMap) and is not a title plan.",
  ];

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    generator: "mizan engine",
    site: {
      name: site.siteName,
      emirate: site.emirate,
      sector: site.sector,
      location: site.location,
      annualConsumptionKwh: site.annualKwh,
      ...(site.approvedLoadKw !== undefined ? { approvedLoadKw: site.approvedLoadKw } : {}),
      roofAreaM2: round(context.roofAreaM2),
    },
    verdict: input.verdict,
    ...(result.planUnavailableReason
      ? { planUnavailableReason: result.planUnavailableReason }
      : {}),
    recommendation,
    alternatives: result.options.slice(1, 6).map((option) => ({
      roofSolarKwp: round(option.sizing.roofSolarKwp, 1),
      groundSolarKwp: round(option.sizing.groundSolarKwp, 1),
      batteryKwh: round(option.sizing.batteryKwh, 1),
      layout: option.sizing.layout,
      capexAed: round(option.capex.totalAed),
      npvAed: round(option.finance.npvAed),
      simplePaybackYears:
        option.finance.simplePaybackYears === null
          ? null
          : round(option.finance.simplePaybackYears, 1),
      renewableSharePct: round(option.renewableShare, 1),
    })),
    uncertainty: uncertaintyOf(result.uncertainty),
    financing: financingOf(result.ppa),
    openEvidence,
    warnings: input.designWarnings,
    actions,
    caveats,
  };
};

const uncertaintyOf = (
  uncertainty: UncertaintyResult | null,
): SiteReport["uncertainty"] =>
  uncertainty === null
    ? null
    : {
        runs: uncertainty.runs,
        npvAed: {
          p10: round(uncertainty.npv.p10),
          p50: round(uncertainty.npv.p50),
          p90: round(uncertainty.npv.p90),
        },
        paybackYears: {
          p10: round(uncertainty.payback.p10, 1),
          p50: round(uncertainty.payback.p50, 1),
          p90: round(uncertainty.payback.p90, 1),
        },
        neverPaysBackShare: round(uncertainty.neverPaysBackShare, 3),
      };

const financingOf = (ppa: OwnershipComparison | null): SiteReport["financing"] =>
  ppa === null
    ? null
    : { verdict: ppa.verdict, differenceAed: round(ppa.differenceAed), explanation: ppa.explanation };
