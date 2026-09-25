/**
 * The recommender: given a site it answers "what should be built here, how
 * much of each, and what does the emirate allow".
 *
 * The search is deliberately small and explainable — a few solar sizes times
 * a few turbine counts, scored on net annual saving with monthly load
 * matching. Anything that cannot pass the emirate's published connection
 * scheme is not recommended at all; it is listed as blocked or needing
 * evidence, so a good-looking number can never quietly outrank a legal wall.
 */

import { analyzeRenewableCombination, type RenewableSystem } from "./renewable-combinations";
import { RULE_SETS, dubaiTclContributionKw } from "./rules";
import { TURBINES, windClimate, windYield, type Turbine } from "./wind";
import { nearestWindSite } from "../data/wind-sites";
import type { Emirate } from "./types";

export type RecommendedSource = {
  source: "solar" | "wind";
  capacityKw: number;
  /** For wind: the turbine archetype id, so the yield model matches the text. */
  turbineId?: string;
  /** e.g. "2 × 900 kW IEC II turbine" or "850 kWp rooftop array". */
  detail: string;
};

export type LegalItem = {
  status: "eligible" | "needs-evidence" | "not-permitted";
  text: string;
};

export type Recommendation = {
  mix: RecommendedSource[];
  result: ReturnType<typeof analyzeRenewableCombination>;
  /** kWp of solar the rules and the configured design ceiling allow. */
  solarCapKw: number;
  solarCapNote: string;
  /** Wind capacity factor the recommendation rests on, when wind is offered. */
  windCapacityFactor: number | null;
  windHubSpeedMs: number | null;
  legal: LegalItem[];
  /** Technically workable options the law or evidence rules out. */
  rejected: string[];
  evidenceNeeded: string[];
};

export type RecommendInput = {
  emirate: Emirate;
  lat: number;
  lng: number;
  annualKwh: number;
  /** Design ceiling for solar, kWp — roof fit or land fit already computed. */
  solarCapKw: number;
  /** Approved Load / TCL in kW, where a bill figure exists. */
  approvedLoadKw?: number;
  tariffAedPerKwh: number;
  solarMonthlyKwhPerKw: number[];
  solarCapexAedPerKw: number;
  solarOmFraction: number;
  windCapexAedPerKw: number;
  windOmFraction: number;
  /** Optional wind site and turbine overrides (for published-scale demos). */
  windSiteId?: string;
  windTurbineId?: string;
};

/** Turbine archetype chosen by the scale of plant that could plausibly go here. */
export const turbineForScale = (capacityKw: number): Turbine =>
  capacityKw >= 5000 ? TURBINES["utility-4500"] : capacityKw >= 1500 ? TURBINES["utility-2000"] : TURBINES["mid-900"];

export const recommendMix = (input: RecommendInput, hurdleYears = 8): Recommendation => {
  const rules = RULE_SETS[input.emirate];
  const legal: LegalItem[] = [];
  const rejected: string[] = [];
  const evidenceNeeded: string[] = [];

  // --- legal solar ceiling -------------------------------------------------
  let solarCapKw = input.solarCapKw;
  let solarCapNote =
    "Design ceiling from the site's solar fit. Approved Load was not supplied, so the utility cap cannot be confirmed — treat this as a ceiling pending the account figure.";
  if (input.approvedLoadKw) {
    const regulated =
      input.emirate === "dubai"
        ? Math.min(dubaiTclContributionKw(input.approvedLoadKw), rules.plotCapKw ?? Infinity)
        : Math.min(
            (rules.approvedLoadFraction ?? 1) * input.approvedLoadKw,
            rules.plotCapKw ?? Infinity,
          );
    if (regulated < solarCapKw) solarCapKw = regulated;
    solarCapNote =
      input.emirate === "dubai"
        ? `Shams Dubai v4.1 tiered cap: ${Math.round(solarCapKw).toLocaleString()} kWp against ${input.approvedLoadKw.toLocaleString()} kW Total Connected Load.`
        : `${rules.scheme}: ${Math.round((rules.approvedLoadFraction ?? 1) * 100)}% of the ${input.approvedLoadKw.toLocaleString()} kW approved load, ${rules.plotCapKw ? `max ${rules.plotCapKw.toLocaleString()} kW per unit, ` : ""}whichever binds.`;
  }

  legal.push({
    status: rules.confidence === "published" ? "eligible" : rules.confidence === "partial" ? "needs-evidence" : "not-permitted",
    text:
      rules.confidence === "published"
        ? `${rules.scheme}: rooftop solar is a published, connectable scheme. Design approval and enrolled contractors still apply.`
        : rules.confidence === "partial"
          ? `${rules.scheme}: the scheme exists but parts are unpublished — ${rules.provenance.caveat ?? "confirm with the utility."}`
          : `${rules.scheme}: no published scheme was found; do not commit spend until the utility confirms.`,
  });
  if (rules.exportTreatment === "credit-expires-annually") {
    legal.push({ status: "needs-evidence", text: "Export credit expires within the year — oversizing solar beyond on-site use earns nothing." });
  }
  if (rules.exportTreatment === "unknown") {
    legal.push({ status: "needs-evidence", text: "No export compensation is published; the model credits only energy used on site." });
  }
  rules.notes.forEach((note) => evidenceNeeded.push(note));

  // --- wind ----------------------------------------------------------------
  const climateId = input.windSiteId ?? nearestWindSite(input.lat, input.lng).id;
  const climateName = windClimate(climateId).name;
  const windScaleKw = Math.max(500, Math.min(input.annualKwh / 2000, 45000));
  const turbine = input.windTurbineId ? TURBINES[input.windTurbineId] : turbineForScale(windScaleKw);
  const yieldResult = windYield(climateId, turbine.id);
  const cf = yieldResult.capacityFactor;
  const windLegal = rules.nonSolarScheme === "none" || rules.nonSolarScheme === "none published";

  // Count that would roughly cover the annual load; bounded for the search.
  const kwhPerUnit = yieldResult.annualKwhPerKw * turbine.ratedKw;
  const maxUnits = kwhPerUnit > 0 ? Math.min(8, Math.ceil((input.annualKwh * 0.8) / kwhPerUnit)) : 0;
  const windAllowedInMix =
    cf >= 0.18 && !windLegal && rules.confidence !== "unverified" && maxUnits > 0;

  if (cf < 0.18) {
    rejected.push(
      `Wind: ${(cf * 100).toFixed(0)}% modelled capacity factor at ${climateName} (${yieldResult.hubSpeedMs.toFixed(1)} m/s at ${turbine.hubHeightM} m hub) is below the level where wind beats solar on cost. Global Wind Atlas + ERA5, not a mast survey.`,
    );
  } else if (windLegal || rules.confidence === "unverified") {
    rejected.push(
      `Wind: ${(cf * 100).toFixed(0)}% modelled capacity factor at ${climateName} — technically workable, but ${rules.scheme} publishes no connection path for it. ${input.emirate === "dubai" ? "A bespoke RSB generation licence is the precedent." : "Utility confirmation is required before this is a recommendation."}`,
    );
    evidenceNeeded.push("Utility connection approval for non-solar generation; mast or LiDAR wind campaign; aviation and noise clearances.");
  } else {
    evidenceNeeded.push("Wind is recommended on modelled climate data: commission a mast or LiDAR campaign plus aviation (GCAA) and noise clearances before contracting.");
  }

  // --- the search ----------------------------------------------------------
  const solarYield = input.solarMonthlyKwhPerKw;
  const solarSystem = (kwp: number): RenewableSystem => ({
    source: "solar",
    capacityKw: kwp,
    monthlyKwhPerKw: solarYield,
    capexAedPerKw: input.solarCapexAedPerKw,
    annualOmFraction: input.solarOmFraction,
  });
  const windSystem = (units: number): RenewableSystem => ({
    source: "wind",
    capacityKw: units * turbine.ratedKw,
    monthlyKwhPerKw: yieldResult.monthlyKwhPerKw,
    capexAedPerKw: input.windCapexAedPerKw,
    annualOmFraction: input.windOmFraction,
  });

  // A zero solar ceiling still evaluates wind; solarCapKw=0 -> [0].
  const solarSteps = solarCapKw > 0 ? [0.25, 0.5, 0.75, 1].map((f) => solarCapKw * f) : [0];
  const windCounts = windAllowedInMix ? Array.from({ length: maxUnits + 1 }, (_, i) => i) : [0];

  const evaluate = (solarKw: number, units: number) => {
    const systems = [solarKw > 0 ? solarSystem(solarKw) : null, units > 0 ? windSystem(units) : null].filter(
      (s): s is RenewableSystem => s !== null,
    );
    return analyzeRenewableCombination("search", systems, input.annualKwh, { tariffAedPerKwh: input.tariffAedPerKwh });
  };

  let best: { solarKw: number; units: number; score: number; result: ReturnType<typeof analyzeRenewableCombination> } | null = null;
  let bestPaybackMix = { solarKw: 0, units: 0, payback: Number.POSITIVE_INFINITY, result: null as ReturnType<typeof analyzeRenewableCombination> | null };
  for (const solarKw of solarSteps) {
    for (const units of windCounts) {
      if (solarKw === 0 && units === 0) continue;
      const result = evaluate(solarKw, units);
      const payback = result.financial.paybackYears;
      if (payback !== null && payback < bestPaybackMix.payback) {
        bestPaybackMix = { solarKw, units, payback, result };
      }
      // Score on net saving; hard-filter mixes that miss the hurdle entirely.
      if (payback === null || payback > hurdleYears) continue;
      const score = result.financial.netSavingsAed;
      if (!best || score > best.score) best = { solarKw, units, score, result };
    }
  }
  // If nothing beats the hurdle, the honest answer is the best-payback mix.
  if (!best) {
    if (bestPaybackMix.result) {
      best = { solarKw: bestPaybackMix.solarKw, units: bestPaybackMix.units, score: 0, result: bestPaybackMix.result };
    } else {
      best = { solarKw: 0, units: 0, score: 0, result: evaluate(0, 0) };
    }
    if (windAllowedInMix && best.units === 0 && cf >= 0.18) {
      rejected.push(
        `Wind: ${(cf * 100).toFixed(0)}% modelled capacity factor at ${climateName} is workable, but no unit count clears the ${hurdleYears}-year limit at the assumed AED ${input.tariffAedPerKwh}/kWh rate — it loses on cost, not on resource.`,
      );
    }
  } else if (windAllowedInMix && best.units === 0 && cf >= 0.18) {
    rejected.push(
      `Wind: ${(cf * 100).toFixed(0)}% modelled capacity factor at ${climateName} is workable and legal here, but every unit count pushed payback past ${hurdleYears} years at the assumed rate — solar alone wins on cost.`,
    );
  }

  const mix: RecommendedSource[] = [];
  if (best.solarKw > 0) {
    mix.push({ source: "solar", capacityKw: best.solarKw, detail: `${Math.round(best.solarKw).toLocaleString()} kWp rooftop solar` });
  }
  if (best.units > 0) {
    mix.push({
      source: "wind",
      capacityKw: best.units * turbine.ratedKw,
      turbineId: turbine.id,
      detail: `${best.units} × ${turbine.ratedKw.toLocaleString()} kW ${turbine.class} turbine${best.units > 1 ? "s" : ""} (${(cf * 100).toFixed(0)}% modelled CF at ${climateName})`,
    });
  }

  return {
    mix,
    result: best.result,
    solarCapKw,
    solarCapNote,
    windCapacityFactor: windAllowedInMix || cf >= 0.18 ? cf : null,
    windHubSpeedMs: cf >= 0.18 ? yieldResult.hubSpeedMs : null,
    legal,
    rejected,
    evidenceNeeded,
  };
};
