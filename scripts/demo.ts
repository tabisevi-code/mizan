/**
 * Run one site through the engine and print what the report would say.
 * Useful for checking the numbers without opening the app:
 *   npm run demo
 */

import { analyzeRoof } from "../src/engine/analyze.ts";
import { lngLatToMetres } from "../src/engine/packing.ts";
import { RULE_SETS, labelEmirate } from "../src/engine/rules.ts";
import { SECTOR_LABELS } from "../src/engine/load.ts";
import type { Ring, SiteProfile } from "../src/engine/types.ts";

const aed = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 });

/** Stand-in geometry until the bake script has pulled real footprints. */
const rectangle = (centre: { lat: number; lng: number }, widthM: number, heightM: number): Ring => {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((centre.lat * Math.PI) / 180);
  const dLat = heightM / 2 / mPerDegLat;
  const dLng = widthM / 2 / mPerDegLng;
  return [
    [centre.lng - dLng, centre.lat - dLat],
    [centre.lng + dLng, centre.lat - dLat],
    [centre.lng + dLng, centre.lat + dLat],
    [centre.lng - dLng, centre.lat + dLat],
  ];
};

const site: SiteProfile = {
  siteName: "Jebel Ali distribution centre",
  emirate: "dubai",
  customerClass: "industrial",
  sector: "warehouse",
  location: { lat: 25.0118, lng: 55.0877 },
  annualKwh: 5_040_000,
  approvedLoadKw: 1400,
  roofRings: [rectangle({ lat: 25.0118, lng: 55.0877 }, 220, 90)],
  groundRings: [rectangle({ lat: 25.0136, lng: 55.0877 }, 120, 60)],
  budgetAed: 6_000_000,
  evidence: {
    hasRoofSurvey: false,
    hasStructuralReserve: false,
    hasLandRights: false,
    hasIntervalMeterData: false,
    hasApprovedLoadLetter: true,
  },
};

// The same pipeline the app runs: real rows packed on the outline, shading
// measured from those rows, the plan built on what actually fits.
const roofPolygon = site.roofRings?.[0] ? lngLatToMetres(site.roofRings[0], site.location) : [];
const analysis = analyzeRoof({ site, polygon: roofPolygon });
const result = analysis.plan;
const { context, best } = result;

console.log(`\n${site.siteName} — ${labelEmirate(site.emirate)}, ${SECTOR_LABELS[site.sector]}`);
console.log("=".repeat(72));
console.log(`Weather year          ${context.weather.source}`);
console.log(
  `Specific yield        ${num.format(context.specificYield.south)} kWh/kWp/yr south-facing,` +
    ` ${num.format(context.specificYield["east-west"])} east-west`,
);
console.log(
  `Mapped roof           ${num.format(context.roofAreaM2)} m2 gross,` +
    ` ${num.format(context.roofFit.south.usableAreaM2)} m2 usable ->` +
    ` ${num.format(context.roofFit.south.kwp)} kWp south-facing,` +
    ` ${num.format(context.roofFit["east-west"].kwp)} kWp east-west`,
);
console.log(
  `Packed layout         ${num.format(analysis.packed.south.moduleCount)} modules,` +
    ` ${num.format(analysis.packed.south.kwp)} kWp south-facing,` +
    ` ${num.format(analysis.packed["east-west"].kwp)} kWp east-west`,
);
console.log(`Regulatory cap        ${num.format(context.cap.capKw)} kW (${context.cap.bindingRule})`);
console.log(`Scheme                ${RULE_SETS[site.emirate].scheme}`);
console.log(
  `Tariff                ${context.tariff?.utility} ${context.tariff?.id}, baseline bill ${aed.format(context.baselineBillAed)}/yr`,
);
console.log(
  `Load                  ${num.format(context.load.annualKwh)} kWh/yr, peak ${num.format(context.load.peakKw)} kW, ${Math.round(context.load.daytimeShare * 100)}% daytime`,
);

console.log("\nScreening");
for (const screen of context.screens) {
  console.log(`  ${screen.label.padEnd(22)} ${screen.status.padEnd(15)} ${screen.reason}`);
}

if (!best) {
  console.log(
    result.planUnavailableReason === "no-tariff"
      ? "\nNo buildable option: no published tariff is modelled for this emirate."
      : "\nNo buildable option within the stated constraints.",
  );
} else {
  console.log("\nRecommended plan");
  console.log("-".repeat(72));
  console.log(`  Rooftop PV          ${num.format(best.sizing.roofSolarKwp)} kWp`);
  console.log(`  Ground PV           ${num.format(best.sizing.groundSolarKwp)} kWp`);
  console.log(
    `  Battery             ${best.battery ? `${num.format(best.battery.capacityKwh)} kWh / ${num.format(best.battery.powerKw)} kW` : "none"}`,
  );
  console.log(`  Capex               ${aed.format(best.capex.totalAed)}`);
  for (const line of best.capex.lines) {
    console.log(`      ${line.label.padEnd(36)} ${aed.format(line.aed).padStart(14)}  ${line.basis}`);
  }
  console.log(`  Generation          ${num.format(best.simulation.generationKwh)} kWh/yr`);
  console.log(
    `  Self-consumed       ${num.format(best.simulation.selfConsumedKwh)} kWh (${Math.round(best.selfConsumptionRate * 100)}% of generation)`,
  );
  console.log(`  Exported            ${num.format(best.simulation.exportedKwh)} kWh (credited, not paid)`);
  console.log(`  Demand covered      ${best.renewableShare.toFixed(1)}%`);
  console.log(`  Year 1 saving       ${aed.format(best.finance.firstYearSavingsAed)}`);
  console.log(
    `  Simple payback      ${best.finance.simplePaybackYears?.toFixed(1) ?? "never"} years` +
      `   discounted ${best.finance.discountedPaybackYears?.toFixed(1) ?? "never"} years`,
  );
  console.log(
    `  IRR                 ${best.finance.irr ? `${(best.finance.irr * 100).toFixed(1)}%` : "not reportable"}`,
  );
  console.log(`  NPV at 8%           ${aed.format(best.finance.npvAed)}`);
  console.log(`  LCOE                AED ${best.finance.lcoeAedPerKwh.toFixed(3)}/kWh`);
  console.log(`  Avoided CO2         ${num.format(best.avoidedCo2Tonnes)} t/yr`);
  console.log(`  What limits it      ${best.bindingConstraint}: ${best.bindingExplanation}`);
  console.log(`  Layout              ${best.sizing.layout}`);
  console.log(`  Roof structure      ${context.structure.headline}`);
  const band = result.uncertainty!;
  console.log(
    `  Payback band        ${band.payback.p10.toFixed(1)} to ${band.payback.p90.toFixed(1)} years (middle ${band.payback.p50.toFixed(1)}), ${band.runs} runs`,
  );
  console.log(
    `  NPV band            ${aed.format(band.npv.p10)} to ${aed.format(band.npv.p90)}`,
  );
  console.log(`  Own vs PPA          ${result.ppa!.verdict}: ${result.ppa!.explanation}`);
  console.log("\n  What moves the answer most");
  for (const entry of result.sensitivity.slice(0, 4)) {
    console.log(
      `      ${entry.label.padEnd(24)} swing ${aed.format(entry.swingAed).padStart(14)}  (${entry.meaning})`,
    );
  }

  console.log("\nNext best options by NPV");
  for (const option of result.options.slice(1, 5)) {
    console.log(
      `  ${num.format(option.sizing.roofSolarKwp)} kWp + ${option.battery ? `${num.format(option.battery.capacityKwh)} kWh` : "no battery"}`.padEnd(
        34,
      ) +
        `NPV ${aed.format(option.finance.npvAed).padStart(14)}  payback ${option.finance.simplePaybackYears?.toFixed(1) ?? "never"}y  covers ${option.renewableShare.toFixed(0)}%`,
    );
  }
  console.log(`\n  ${result.options.length} options evaluated.`);
}
