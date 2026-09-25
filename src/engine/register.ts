/**
 * The assumption register.
 *
 * A bankable answer is not a number, it is a number plus everything it leans
 * on. This module walks a finished plan and lists every input that is not a
 * direct measurement — where it came from, what it is worth, and how much the
 * answer moves when it is wrong. It is what separates a screening tool from a
 * spreadsheet: the same numbers, with their debts written next to them.
 */

import type { Provenance, SourceKind } from "./types";
import type { PlanResult } from "./plan";
import { RULE_SETS } from "./rules";
import { COST_SOURCE, OM_SOURCE, PPA_SOURCE, GRID_EMISSION_FACTOR, CORPORATE_TAX_SOURCE } from "./finance";
import { RESOURCE_PROVENANCE } from "./resource";
import type { SensitivityEntry } from "./uncertainty";

export type RegisterEntry = {
  /** What the engine consumed. */
  input: string;
  /** The value it used, in the customer's units. */
  value: string;
  kind: SourceKind;
  provenance: Provenance;
  /**
   * How much the best option's NPV swings across the tested range for this
   * input, in AED. Absent for inputs no sensitivity range covers.
   */
  swingAed?: number;
  /** The cheapest thing the operator can do to turn this into a fact. */
  howToResolve?: string;
};

const SOURCE_LABEL: Record<PlanResult["context"]["weather"]["source"], Provenance> = {
  "modelled-clear-sky": {
    kind: "model",
    label: "Clear-sky model",
    caveat:
      "Synthetic clear-sky year from latitude alone — no measured irradiance behind it. Outputs carry wide uncertainty.",
  },
  "pvgis-tmy": {
    kind: "dataset",
    label: "PVGIS typical meteorological year",
    url: "https://re.jrc.ec.europa.eu/pvg_tools/en/",
  },
  "nasa-power-climatology": RESOURCE_PROVENANCE,
};

const swingFor = (sensitivity: SensitivityEntry[], key: SensitivityEntry["key"]): number | undefined =>
  sensitivity.find((entry) => entry.key === key)?.swingAed;

const aedShort = (value: number): string =>
  `AED ${Math.round(value).toLocaleString("en-AE")}`;

/**
 * Every consequential input behind this plan, its provenance, and what being
 * wrong about it costs. Ordered facts first, then models, then assumptions —
 * so the top of the list is the part of the answer you can already stand on.
 */
export const assumptionRegister = (result: PlanResult): RegisterEntry[] => {
  const { context, best } = result;
  const entries: RegisterEntry[] = [];

  const rules = RULE_SETS[context.site.emirate];
  entries.push({
    input: "Regulatory cap and scheme rules",
    value: `${context.cap.capKw === Infinity ? "no cap" : `${Math.round(context.cap.capKw).toLocaleString()} kW`} — ${context.cap.explanation}`,
    kind: "authority",
    provenance: rules.provenance,
    howToResolve:
      context.cap.bindingRule === "tcl-slab" || context.cap.bindingRule === "approved-load"
        ? "Confirm the account's approved load / Total Connected Load letter."
        : undefined,
  });

  if (context.tariff) {
    entries.push({
      input: "Utility tariff",
      value: `${context.tariff.id} / ${context.tariff.utility} (${context.tariff.exportTreatment} exports)`,
      kind: context.tariff.provenance.kind,
      provenance: context.tariff.provenance,
      swingAed: swingFor(result.sensitivity, "tariffEscalation"),
    });
  }

  entries.push({
    input: "Site consumption",
    value: `${Math.round(context.load.annualKwh).toLocaleString()} kWh/yr, ${(context.load.daytimeShare * 100).toFixed(0)}% daytime`,
    kind: context.load.provenance.kind,
    provenance: context.load.provenance,
    swingAed: swingFor(result.sensitivity, "loadFactor"),
    howToResolve:
      context.load.provenance.kind === "assumption" || context.load.provenance.kind === "model"
        ? "Paste twelve monthly bills — the intake parser reads them into the profile."
        : undefined,
  });

  entries.push({
    input: "Solar resource",
    value: `weather source: ${context.weather.source}`,
    kind: SOURCE_LABEL[context.weather.source].kind,
    provenance: SOURCE_LABEL[context.weather.source],
    swingAed: swingFor(result.sensitivity, "yieldFactor"),
    howToResolve:
      context.weather.source === "modelled-clear-sky"
        ? "Re-run against the baked NASA POWER grid point for this site."
        : undefined,
  });

  entries.push({
    input: "Roof structure",
    value: `${context.structure.headline} — mounting assumed ${context.structure.recommendedMounting}`,
    kind: "assumption",
    provenance: context.structure.provenance,
    howToResolve: "Get the structural drawings or a surveyor's report.",
  });

  if (best) {
    entries.push({
      input: "Installed cost",
      value: `${aedShort(best.finance.capexAed)} for ${best.sizing.roofSolarKwp.toFixed(0)} kWp`,
      kind: "assumption",
      provenance: COST_SOURCE,
      swingAed: swingFor(result.sensitivity, "capexFactor"),
      howToResolve: "Obtain installer quotes; replace the range with a quoted price.",
    });
    entries.push({
      input: "O&M",
      value: `${aedShort(best.sizing.roofSolarKwp * 55)}/yr`,
      kind: "assumption",
      provenance: OM_SOURCE,
      swingAed: swingFor(result.sensitivity, "omFactor"),
    });
    entries.push({
      input: "Finance defaults",
      value: "8% discount, 2%/yr tariff escalation, 0.5%/yr degradation, inverter replaced year 12",
      kind: "assumption",
      provenance: {
        kind: "assumption",
        label: "Financial conventions",
        asOf: "2026-09-25",
        caveat:
          "Discount rate, escalation, degradation, inverter and battery replacement timing are conventions, not measurements. Each moves NPV materially.",
      },
      swingAed: swingFor(result.sensitivity, "degradationPerYear"),
    });
    if (result.ppa) {
      entries.push({
        input: "Developer PPA comparison",
        value: `PPA NPV ${aedShort(result.ppa.ppa.npvAed)} vs owning ${aedShort(result.ppa.own.npvAed)} — ${result.ppa.verdict} ahead by ${aedShort(result.ppa.differenceAed)}`,
        kind: "assumption",
        provenance: PPA_SOURCE,
        howToResolve: "Ask developers for a term sheet on this roof.",
      });
    }
    if (best.avoidedCo2Tonnes > 0) {
      entries.push({
        input: "Avoided emissions factor",
        value: `${GRID_EMISSION_FACTOR.kgPerKwh} kg CO2/kWh`,
        kind: GRID_EMISSION_FACTOR.provenance.kind,
        provenance: GRID_EMISSION_FACTOR.provenance,
      });
    }
    entries.push({
      input: "Corporate tax",
      value: "0% — not applied",
      kind: "authority",
      provenance: CORPORATE_TAX_SOURCE,
      howToResolve:
        "Mainland companies over the AED 375k threshold pay 9%; pass corporateTaxRate in finance assumptions if the customer is in scope.",
    });
  }

  const order: Record<SourceKind, number> = {
    "user-evidence": 0,
    authority: 1,
    dataset: 2,
    model: 3,
    assumption: 4,
  };
  return entries.sort((a, b) => order[a.kind] - order[b.kind]);
};

/** One-line verdict on how much of the plan rests on assumptions. */
export const registerSummary = (entries: RegisterEntry[]): string => {
  const assumed = entries.filter((entry) => entry.kind === "assumption").length;
  if (assumed === 0) return "Every consequential input carries evidence.";
  if (assumed <= 2) return `${assumed} inputs are assumptions — listed below.`;
  return `${assumed} of ${entries.length} inputs are assumptions. A quote, a survey and twelve bills would remove most of them.`;
};
