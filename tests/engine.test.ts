import assert from "node:assert/strict";
import test from "node:test";

import { simulateDispatch, DEFAULT_BATTERY } from "../src/engine/battery.ts";
import { fitArray, groundCoverageRatio, ringAreaM2 } from "../src/engine/capacity.ts";
import { buildCapex, evaluateFinance, solarCostPerKw } from "../src/engine/finance.ts";
import { buildLoadProfile } from "../src/engine/load.ts";
import { plan } from "../src/engine/plan.ts";
import { DEFAULT_PV_LOSSES, simulateArray } from "../src/engine/pv.ts";
import { HYDRO_TURBINE_EFFICIENCY } from "../src/engine/renewable-combinations.ts";
import { RULE_SETS, regulatoryCap, screenTechnologies } from "../src/engine/rules.ts";
import { clearSkyGhi, declination, modelledWeatherYear, solarPosition } from "../src/engine/solar.ts";
import { annualBill, marginalRate, selectTariff, TARIFFS } from "../src/engine/tariff.ts";
import { HOURS_PER_YEAR, newSeries, sum, type Ring, type SiteProfile } from "../src/engine/types.ts";

const JEBEL_ALI = { lat: 25.0118, lng: 55.0877 };

const emptyEvidence = {
  hasRoofSurvey: false,
  hasStructuralReserve: false,
  hasLandRights: false,
  hasIntervalMeterData: false,
  hasApprovedLoadLetter: false,
};

/** A 200 m by 100 m rectangle, so the expected area is exactly 20,000 m2. */
const rectangleRing = (centre: { lat: number; lng: number }, widthM: number, heightM: number): Ring => {
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

// --- solar geometry --------------------------------------------------------

test("declination swings between the tropics", () => {
  const june = (declination(172) * 180) / Math.PI;
  const december = (declination(355) * 180) / Math.PI;
  assert.ok(june > 23 && june < 23.5, `June solstice declination was ${june}`);
  assert.ok(december < -23 && december > -23.5, `December solstice declination was ${december}`);
});

const highestSunOnDay = (dayOfYear: number) => {
  let bestHour = 0;
  let bestAltitude = -90;
  for (let hour = (dayOfYear - 1) * 24; hour < dayOfYear * 24; hour += 1) {
    const position = solarPosition(JEBEL_ALI, hour);
    if (position.altitudeDeg > bestAltitude) {
      bestAltitude = position.altitudeDeg;
      bestHour = hour;
    }
  }
  return { hour: bestHour, altitudeDeg: bestAltitude, position: solarPosition(JEBEL_ALI, bestHour) };
};

test("noon sun matches the textbook altitude at both solstices", () => {
  // Winter solstice: 90 - latitude - 23.44 = 41.5 degrees at Jebel Ali, due south.
  const winter = highestSunOnDay(355);
  assert.ok(
    Math.abs(winter.altitudeDeg - 41.5) < 1,
    `winter noon altitude was ${winter.altitudeDeg.toFixed(2)}`,
  );
  assert.ok(
    Math.abs(winter.position.azimuthDeg) < 8,
    `winter noon azimuth was ${winter.position.azimuthDeg.toFixed(1)}`,
  );

  // Summer solstice: 90 - latitude + 23.44 = 88.4, so the sun passes just north
  // of vertical and the azimuth flips towards north. Altitude is the check that
  // stays well conditioned.
  const summer = highestSunOnDay(172);
  assert.ok(
    Math.abs(summer.altitudeDeg - 88.4) < 1.5,
    `summer noon altitude was ${summer.altitudeDeg.toFixed(2)}`,
  );
});

test("clear-sky irradiance peaks near the solar constant at the zenith", () => {
  assert.equal(clearSkyGhi(0), 0);
  const zenith = clearSkyGhi(1);
  assert.ok(zenith > 1000 && zenith < 1060, `zenith clear-sky GHI was ${zenith}`);
});

// --- PV --------------------------------------------------------------------

test("modelled Dubai yield lands inside the published UAE range", () => {
  const weather = modelledWeatherYear(JEBEL_ALI);
  const result = simulateArray(
    JEBEL_ALI,
    weather,
    { kwp: 1000, tiltDeg: 10, azimuthDeg: 0, mounting: "roof-flat", dcAcRatio: 1.2 },
    DEFAULT_PV_LOSSES,
  );
  // Global Solar Atlas puts UAE PVOUT at roughly 1,650-1,800 kWh/kWp for an
  // optimally tilted system. A shallow roof tilt with Gulf soiling should land
  // below that but not absurdly so.
  assert.ok(
    result.specificYield > 1300 && result.specificYield < 1800,
    `specific yield was ${result.specificYield.toFixed(0)} kWh/kWp`,
  );
});

test("array output scales linearly with size at a fixed DC to AC ratio", () => {
  const weather = modelledWeatherYear(JEBEL_ALI);
  const unit = simulateArray(JEBEL_ALI, weather, {
    kwp: 1,
    tiltDeg: 10,
    azimuthDeg: 0,
    mounting: "roof-flat",
    dcAcRatio: 1.2,
  });
  const large = simulateArray(JEBEL_ALI, weather, {
    kwp: 500,
    tiltDeg: 10,
    azimuthDeg: 0,
    mounting: "roof-flat",
    dcAcRatio: 1.2,
  });
  const ratio = large.annualKwh / (unit.annualKwh * 500);
  assert.ok(Math.abs(ratio - 1) < 1e-6, `scaling ratio was ${ratio}`);
});

// --- geometry --------------------------------------------------------------

test("ring area matches a rectangle of known size", () => {
  const ring = rectangleRing(JEBEL_ALI, 200, 100);
  const area = ringAreaM2(ring);
  assert.ok(Math.abs(area - 20000) / 20000 < 0.01, `area was ${area.toFixed(0)} m2`);
});

test("row spacing costs area as tilt rises", () => {
  const shallow = groundCoverageRatio(10, 25);
  const steep = groundCoverageRatio(30, 25);
  assert.ok(shallow > steep, `shallow ${shallow} should exceed steep ${steep}`);
  assert.ok(steep > 0.2 && shallow <= 0.95);
});

test("a 20,000 m2 roof yields a plausible array size", () => {
  const fit = fitArray(20000, "roof-flat", 10, 25);
  // 30% obstruction allowance, ~85% coverage at 10 degrees, ~225 W/m2 of module.
  assert.ok(fit.kwp > 1500 && fit.kwp < 3200, `fit was ${fit.kwp.toFixed(0)} kWp`);
  assert.equal(fit.usableAreaM2, 14000);
});

// --- tariffs ---------------------------------------------------------------

test("DEWA industrial marginal rate steps at 10,000 kWh a month", () => {
  const tariff = TARIFFS.find((item) => item.id === "dewa-industrial")!;
  assert.equal(marginalRate(tariff, 5000, 0), 0.23 + 0.06);
  assert.equal(marginalRate(tariff, 20000, 0), 0.38 + 0.06);
});

test("ADDC over 1 MW charges the summer afternoon peak", () => {
  const tariff = selectTariff({
    emirate: "abu-dhabi",
    customerClass: "industrial",
    peakDemandKw: 1500,
  })!;
  assert.equal(tariff.id, "addc-industrial-over-1mw");
  // 1 July is day 182, so hour 4356 is early afternoon on that day.
  const julyAfternoon = (182 - 1) * 24 + 14;
  const julyNight = (182 - 1) * 24 + 3;
  assert.equal(marginalRate(tariff, 0, julyAfternoon), 0.366);
  assert.equal(marginalRate(tariff, 0, julyNight), 0.27);
});

test("a Dubai bill adds VAT and the meter charge", () => {
  const tariff = TARIFFS.find((item) => item.id === "dewa-industrial")!;
  const flat = newSeries();
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) flat[hour] = 100; // 876,000 kWh a year
  const bill = annualBill(tariff, flat);
  assert.ok(bill.vatAed > 0);
  assert.equal(bill.meterAed, 35 * 12);
  // Consumption far exceeds the first slab every month, so the effective rate
  // should sit just under the top slab plus surcharge, grossed up for VAT.
  assert.ok(
    bill.effectiveAedPerKwh > 0.44 && bill.effectiveAedPerKwh < 0.47,
    `effective rate was ${bill.effectiveAedPerKwh}`,
  );
});

// --- rules -----------------------------------------------------------------

test("Dubai forbids ground mount and caps capacity by the DRRG slab share of connected load", () => {
  assert.equal(RULE_SETS.dubai.groundMountPermitted, false);

  // DRRG v4.1 s2.2: 100% of the first 100 kW, 75% of 100-200, 50% of 200-400,
  // 25% of 400-600, 5% above 600, ceiling 1,000 kW.
  const small = makeSite({ approvedLoadKw: 80 });
  assert.equal(regulatoryCap(small).capKw, 80);

  const site = makeSite({ approvedLoadKw: 1200 });
  assert.equal(regulatoryCap(site).capKw, 355);
  assert.equal(regulatoryCap(site).bindingRule, "tcl-slab");

  const mid = makeSite({ approvedLoadKw: 600 });
  assert.equal(regulatoryCap(mid).capKw, 325);

  const hugeSite = makeSite({ approvedLoadKw: 20000 });
  assert.equal(regulatoryCap(hugeSite).capKw, 1000);
  assert.equal(regulatoryCap(hugeSite).bindingRule, "tcl-slab");
});

test("an unknown approved load leaves only the published per-plot ceiling", () => {
  const site = makeSite({ approvedLoadKw: undefined });
  const cap = regulatoryCap(site);
  assert.equal(cap.capKw, 1000);
  assert.equal(cap.bindingRule, "plot-cap");
});

test("every emirate resolves a tariff", () => {
  for (const emirate of [
    "dubai",
    "abu-dhabi",
    "sharjah",
    "ajman",
    "umm-al-quwain",
    "ras-al-khaimah",
    "fujairah",
  ] as const) {
    const commercial = selectTariff({ emirate, customerClass: "commercial" });
    const industrial = selectTariff({ emirate, customerClass: "industrial" });
    assert.ok(commercial, `no commercial tariff for ${emirate}`);
    assert.ok(industrial, `no industrial tariff for ${emirate}`);
  }
});

test("EtihadWE and SEWA slab rates match the published schedules", () => {
  const rak = selectTariff({ emirate: "ras-al-khaimah", customerClass: "commercial" })!;
  assert.equal(rak.id, "etihadwe-commercial");
  assert.equal(marginalRate(rak, 500, 0), 0.23 + 0.05);
  assert.equal(marginalRate(rak, 20000, 0), 0.38 + 0.05);

  const sewa = selectTariff({ emirate: "sharjah", customerClass: "commercial" })!;
  assert.equal(marginalRate(sewa, 500, 0), 0.23 + 0.06);
  assert.equal(marginalRate(sewa, 20000, 0), 0.38 + 0.06);
});

test("ground solar screens as not permitted in Dubai however much land there is", () => {
  const site = makeSite({});
  const screens = screenTechnologies(site, 20000, 50000);
  const ground = screens.find((item) => item.id === "ground-solar")!;
  assert.equal(ground.status, "not-permitted");
});

test("marine and geothermal options screen out with a reason, not a slider", () => {
  const site = makeSite({});
  const screens = screenTechnologies(site, 20000, 0);
  for (const id of ["tidal", "hydro", "geothermal", "biomass"] as const) {
    const screen = screens.find((item) => item.id === id)!;
    assert.equal(screen.status, "not-viable");
    assert.ok(screen.reason.length > 30, `${id} needs a real reason`);
  }
});

test("hydro screening uses the same turbine efficiency as the yield model", () => {
  const site = makeSite({ evidence: { ...emptyEvidence, hydro: { flowCms: 1, headM: 10 } } });
  const hydro = screenTechnologies(site, 20000, 0).find((item) => item.id === "hydro")!;
  assert.equal(hydro.status, "needs-evidence");
  assert.match(hydro.reason, /roughly 64 kW/);
  assert.equal(Math.round(9.81 * 1 * 10 * HYDRO_TURBINE_EFFICIENCY), 64);
});

// --- dispatch --------------------------------------------------------------

test("energy balance holds with a battery in the loop", () => {
  const generation = newSeries();
  const load = newSeries();
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const hourOfDay = hour % 24;
    generation[hour] = hourOfDay >= 7 && hourOfDay <= 17 ? 100 : 0;
    load[hour] = 40;
  }
  const battery = { ...DEFAULT_BATTERY, capacityKwh: 500, powerKw: 250 };
  const result = simulateDispatch(generation, load, battery);

  // Everything generated or imported either serves load, is exported, is lost
  // in the battery, or is still stored at midnight on 31 December.
  const balance =
    result.generationKwh +
    result.importedKwh -
    result.exportedKwh -
    sum(load) -
    result.batteryLossKwh -
    result.batteryStoredKwh;
  assert.ok(Math.abs(balance) < 1, `balance error was ${balance.toFixed(3)} kWh`);
  assert.ok(result.selfConsumedKwh > 0 && result.exportedKwh > 0);
  assert.ok(result.batteryLossKwh > 0, "a round trip must lose something");
});

test("a battery raises self-consumption", () => {
  const generation = newSeries();
  const load = newSeries();
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const hourOfDay = hour % 24;
    generation[hour] = hourOfDay >= 8 && hourOfDay <= 16 ? 100 : 0;
    load[hour] = 30;
  }
  const without = simulateDispatch(generation, load, null);
  const with500 = simulateDispatch(generation, load, {
    ...DEFAULT_BATTERY,
    capacityKwh: 500,
    powerKw: 250,
  });
  assert.ok(with500.selfConsumedKwh > without.selfConsumedKwh);
  assert.ok(with500.importedKwh < without.importedKwh);
});

// --- load ------------------------------------------------------------------

test("load profiles scale to the evidenced annual consumption", () => {
  const profile = buildLoadProfile({ sector: "warehouse", annualKwh: 5_000_000 });
  assert.ok(Math.abs(profile.annualKwh - 5_000_000) / 5_000_000 < 1e-6);
  assert.ok(profile.peakKw > 0);
  assert.ok(profile.daytimeShare > 0.5, `warehouse daytime share was ${profile.daytimeShare}`);
});

test("monthly bill readings override the modelled seasonality", () => {
  const monthly = [1, 1, 1, 1, 1, 5, 5, 5, 1, 1, 1, 1].map((value) => value * 100_000);
  const profile = buildLoadProfile({ sector: "office", annualKwh: 0, monthlyKwh: monthly });
  const total = monthly.reduce((sumKwh, value) => sumKwh + value, 0);
  assert.ok(Math.abs(profile.annualKwh - total) / total < 1e-6);
});

// --- finance ---------------------------------------------------------------

test("installed cost per kW falls with system size", () => {
  assert.ok(solarCostPerKw(100, "roof") > solarCostPerKw(1000, "roof"));
  assert.ok(solarCostPerKw(1000, "roof") >= 2400);
});

test("IRR and payback agree on a simple project", () => {
  const result = evaluateFinance({
    capexAed: 1_000_000,
    batteryCapexAed: 0,
    installedKw: 0, // no O&M, so the arithmetic is checkable by hand
    firstYearSavingsAed: 200_000,
    firstYearGenerationKwh: 1_000_000,
    assumptions: { tariffEscalation: 0, degradationPerYear: 0, discountRate: 0.08 },
  });
  assert.ok(result.simplePaybackYears !== null);
  assert.ok(Math.abs(result.simplePaybackYears! - 5) < 0.01, `payback ${result.simplePaybackYears}`);
  assert.ok(result.irr !== null && result.irr > 0.19 && result.irr < 0.21, `IRR ${result.irr}`);
  assert.ok(result.npvAed > 0);
  assert.ok(result.lcoeAedPerKwh > 0);
});

test("a project that never pays back reports no IRR rather than a flattering one", () => {
  const result = evaluateFinance({
    capexAed: 10_000_000,
    batteryCapexAed: 0,
    installedKw: 1000,
    firstYearSavingsAed: 50_000,
    firstYearGenerationKwh: 100_000,
  });
  assert.equal(result.irr, null);
  assert.equal(result.simplePaybackYears, null);
  assert.ok(result.npvAed < 0);
});

// --- end to end ------------------------------------------------------------

test("a Dubai warehouse plan respects the regulatory cap and reports what binds it", () => {
  const site = makeSite({ approvedLoadKw: 900 });
  const result = plan(site);
  assert.ok(result.best, "expected at least one buildable option");
  const best = result.best!;
  assert.ok(best.sizing.roofSolarKwp + best.sizing.groundSolarKwp <= 900 + 1e-6);
  assert.equal(best.sizing.groundSolarKwp, 0, "ground mount is not permitted in Dubai");
  assert.ok(best.bindingExplanation.length > 20);
  assert.ok(best.finance.capexAed > 0);
  assert.ok(best.renewableShare > 0 && best.renewableShare <= 100);
});

test("every option stays inside a stated budget", () => {
  const site = makeSite({ approvedLoadKw: 2000, budgetAed: 1_500_000 });
  const result = plan(site);
  for (const option of result.options) {
    assert.ok(option.capex.totalAed <= 1_500_000, `option ${option.id} broke the budget`);
  }
});

test("east-west layout is offered and fits more on the same roof", () => {
  const site = makeSite({ approvedLoadKw: 5000 });
  const result = plan(site);
  const eastWest = result.context.roofFit["east-west"].kwp;
  const south = result.context.roofFit.south.kwp;
  assert.ok(eastWest > south, `east-west ${eastWest} should exceed south ${south}`);
  // More panels but less per panel: yield per kWp must fall.
  assert.ok(
    result.context.specificYield["east-west"] < result.context.specificYield.south,
    "east-west earns less per kWp",
  );
});

test("a sandwich-panel roof is flagged and costs more to mount", () => {
  const ballasted = plan(makeSite({ roofConstruction: "concrete" })).best!;
  const railed = plan(makeSite({ roofConstruction: "sandwich-panel" })).best!;
  assert.equal(railed.sizing.roofSolarKwp, ballasted.sizing.roofSolarKwp);
  assert.ok(
    railed.capex.totalAed > ballasted.capex.totalAed,
    "railing a light roof costs more than ballasting a concrete one",
  );
});

test("inverter replacement appears in the cashflow", () => {
  const best = plan(makeSite({})).best!;
  const year12 = best.finance.cashflow.find((row) => row.year === 12)!;
  const year11 = best.finance.cashflow.find((row) => row.year === 11)!;
  assert.ok(year12.replacementAed > 0, "year 12 should carry an inverter replacement");
  assert.equal(year11.replacementAed, 0);
});

test("uncertainty produces a band, not a point", () => {
  const result = plan(makeSite({}));
  const band = result.uncertainty!;
  assert.ok(band.npv.p10 < band.npv.p50 && band.npv.p50 < band.npv.p90);
  assert.ok(band.payback.p10 <= band.payback.p90);
  assert.ok(band.runs >= 100);
});

test("sensitivity ranks the assumptions by how much they move the answer", () => {
  const result = plan(makeSite({}));
  assert.ok(result.sensitivity.length >= 5);
  for (let index = 1; index < result.sensitivity.length; index += 1) {
    assert.ok(result.sensitivity[index - 1].swingAed >= result.sensitivity[index].swingAed);
  }
  assert.ok(result.sensitivity[0].swingAed > 0);
});

test("owning and a power purchase agreement are compared on the same basis", () => {
  const result = plan(makeSite({}));
  const ppa = result.ppa!;
  assert.equal(ppa.ppa.capexAed, 0);
  assert.ok(ppa.own.capexAed > 0);
  assert.ok(["own", "ppa"].includes(ppa.verdict));
  assert.ok(ppa.explanation.includes("AED"));
});

function makeSite(overrides: Partial<SiteProfile>): SiteProfile {
  return {
    siteName: "Test site",
    emirate: "dubai",
    customerClass: "industrial",
    sector: "warehouse",
    location: JEBEL_ALI,
    annualKwh: 5_000_000,
    approvedLoadKw: 1200,
    roofRings: [rectangleRing(JEBEL_ALI, 200, 100)],
    groundRings: [rectangleRing({ lat: JEBEL_ALI.lat + 0.002, lng: JEBEL_ALI.lng }, 150, 100)],
    evidence: { ...emptyEvidence },
    ...overrides,
  };
}

// --- packing ---------------------------------------------------------------

test("panel rows are packed inside the actual roof outline", async () => {
  const { packRoof, polygonAreaM2 } = await import("../src/engine/packing.ts");
  // A 100 m by 60 m shed with a 20 m by 20 m notch cut out of one corner.
  const shed: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 60],
    [20, 60],
    [20, 40],
    [0, 40],
  ];
  const result = packRoof(shed, 25);
  assert.ok(result.moduleCount > 200, `only ${result.moduleCount} modules packed`);
  assert.ok(result.kwp > 100 && result.kwp < 800, `kwp was ${result.kwp}`);
  assert.ok(result.netAreaM2 < polygonAreaM2(shed), "the setback must cost area");

  // Nothing may stick out past the roof edge.
  for (const row of result.rows) {
    assert.ok(row.x >= -1 && row.x + row.w <= 101, `row runs outside the roof: ${row.x}..${row.x + row.w}`);
    assert.ok(row.y >= -1 && row.y + row.h <= 61, `row runs outside the roof: ${row.y}`);
  }
});

test("east-west rows pack tighter than south-facing rows", async () => {
  const { packRoof } = await import("../src/engine/packing.ts");
  const square: [number, number][] = [
    [0, 0],
    [80, 0],
    [80, 80],
    [0, 80],
  ];
  const south = packRoof(square, 25, { layout: "south" });
  const eastWest = packRoof(square, 25, { layout: "east-west" });
  // At a 10 degree tilt the row gap south-facing rows need is small, so the
  // east-west gain is real but modest. Claiming more would be marketing.
  assert.ok(
    eastWest.moduleCount > south.moduleCount * 1.05,
    `east-west ${eastWest.moduleCount} vs south ${south.moduleCount}`,
  );
});

test("a tiny roof packs nothing rather than something", async () => {
  const { packRoof } = await import("../src/engine/packing.ts");
  const tiny: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  assert.equal(packRoof(tiny, 25).moduleCount, 0);
});

// --- electrical design -----------------------------------------------------

test("string length obeys the cold voltage limit with no headroom to spare", async () => {
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, sizeString, vocAt } = await import(
    "../src/engine/electrical.ts"
  );
  const module = MODULES[0];
  const inverter = INVERTERS[1];
  const sizing = sizeString(module, inverter, DESIGN_TEMPERATURES.dubai);

  assert.ok(sizing.feasible);
  // The chosen string must fit under the inverter's absolute limit...
  assert.ok(
    sizing.stringVocColdV <= inverter.maxSystemVdc,
    `${sizing.stringVocColdV} V exceeds ${inverter.maxSystemVdc} V`,
  );
  // ...and one more module must not fit, or we left capacity on the table.
  const oneMore = (sizing.modulesPerString + 1) * vocAt(module, DESIGN_TEMPERATURES.dubai.recordLowC);
  assert.ok(oneMore > inverter.maxSystemVdc, "could have fitted another module");
});

test("the hot limit binds harder than the cold limit in the Gulf", async () => {
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, TEMPERATE_REFERENCE, sizeString } = await import(
    "../src/engine/electrical.ts"
  );
  const module = MODULES[0];
  const inverter = INVERTERS[1];
  const gulf = sizeString(module, inverter, DESIGN_TEMPERATURES.dubai);
  const temperate = sizeString(module, inverter, TEMPERATE_REFERENCE);

  // Mild winter: longer strings allowed here.
  assert.ok(
    gulf.maxModulesPerString > temperate.maxModulesPerString,
    `gulf ${gulf.maxModulesPerString} vs temperate ${temperate.maxModulesPerString}`,
  );
  // Brutal summer: the hot cell needs a longer string here to stay in the
  // inverter's full-power window. Compare before rounding — both round to the
  // same whole number, which is exactly why the engine flags the margin.
  assert.ok(
    gulf.rawMinModules > temperate.rawMinModules,
    `gulf min ${gulf.rawMinModules} vs temperate ${temperate.rawMinModules}`,
  );
  assert.ok(gulf.vmpHotV < temperate.vmpHotV, "hot Vmp should be lower in the Gulf");
  // A rooftop cell in Dubai should land in the seventies, not the forties.
  assert.ok(gulf.hotCellC > 70 && gulf.hotCellC < 90, `cell ${gulf.hotCellC}`);
});

test("voltage coefficients move the right way", async () => {
  const { MODULES, vocAt, vmpAt, iscAt } = await import("../src/engine/electrical.ts");
  const module = MODULES[0];
  assert.ok(vocAt(module, 0) > module.vocV, "cold raises Voc");
  assert.ok(vocAt(module, 60) < module.vocV, "heat lowers Voc");
  assert.ok(vmpAt(module, 80) < module.vmpV * 0.9, "heat lowers Vmp hard");
  assert.ok(iscAt(module, 80) > module.iscA, "heat slightly raises Isc");
});

test("leapfrog order visits every module once and ends beside where it started", async () => {
  const { leapfrogOrder } = await import("../src/engine/electrical.ts");
  for (const n of [2, 3, 8, 17, 20, 21]) {
    const order = leapfrogOrder(n);
    assert.equal(order.length, n, `length for ${n}`);
    assert.equal(new Set(order).size, n, `no repeats for ${n}`);
    assert.equal(order[0], 0, `starts at 0 for ${n}`);
    if (n > 1) assert.equal(order[order.length - 1], 1, `ends at 1 for ${n}`);
  }
});

test("leapfrog needs no return run along the row, straight stringing does", async () => {
  const { MODULES, leapfrogOrder } = await import("../src/engine/electrical.ts");
  const module = MODULES[0];
  const n = 20;
  const at = (i: number): [number, number] => [i * module.widthM, 0];
  const order = leapfrogOrder(n);
  const ends = Math.abs(at(order[0])[0] - at(order[order.length - 1])[0]);
  // Leapfrog finishes one module away from the start.
  assert.ok(ends < module.widthM * 1.01, `ends ${ends} m apart`);
  // Straight stringing would finish a whole row away.
  const straight = Math.abs(at(0)[0] - at(n - 1)[0]);
  assert.ok(straight > module.widthM * 18, `straight ${straight} m`);
});

test("a designed roof wires whole strings and accounts for every module", async () => {
  const { packRoof } = await import("../src/engine/packing.ts");
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, designElectrical } = await import(
    "../src/engine/electrical.ts"
  );
  const roof: [number, number][] = [
    [0, 0],
    [120, 0],
    [120, 80],
    [0, 80],
  ];
  const packed = packRoof(roof, 25);
  const design = designElectrical({
    rows: packed.rows,
    module: MODULES[0],
    inverter: INVERTERS[1],
    temperatures: DESIGN_TEMPERATURES.dubai,
    plantAt: [60, 40],
  });

  assert.ok(design.strings.length > 0, "wired nothing");
  const wired = design.strings.reduce((total, run) => total + run.modules.length, 0);
  assert.equal(wired, design.modulesWired);
  assert.equal(wired + design.strandedModules, packed.moduleCount);
  // Every string is exactly the sized length.
  for (const run of design.strings) {
    assert.equal(run.modules.length, design.sizing.modulesPerString);
  }
  // Strings are spread across the inverters, none overfilled.
  const perInverter = new Map<number, number>();
  for (const run of design.strings) {
    perInverter.set(run.inverter, (perInverter.get(run.inverter) ?? 0) + 1);
  }
  for (const count of perInverter.values()) {
    assert.ok(count <= design.sizing.maxStringsPerInverter, `${count} strings on one inverter`);
  }
});

test("cable is sized up until the voltage drop target is met", async () => {
  const { packRoof } = await import("../src/engine/packing.ts");
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, designElectrical, DC_DROP_TARGET } = await import(
    "../src/engine/electrical.ts"
  );
  const roof: [number, number][] = [
    [0, 0],
    [200, 0],
    [200, 90],
    [0, 90],
  ];
  const packed = packRoof(roof, 25);
  const design = designElectrical({
    rows: packed.rows,
    module: MODULES[0],
    inverter: INVERTERS[1],
    temperatures: DESIGN_TEMPERATURES.dubai,
    plantAt: [10, 5],
  });

  for (const run of design.cable.runs) {
    // Either the run meets the target, or it is already on the largest cable.
    assert.ok(
      run.dropFraction <= DC_DROP_TARGET + 1e-9 || run.crossSectionMm2 === 25,
      `${run.lengthM.toFixed(0)} m on ${run.crossSectionMm2} mm2 drops ${(run.dropFraction * 100).toFixed(2)}%`,
    );
  }
  // A long thin roof should need more than one cable size.
  assert.ok(design.cable.homeRunM > 0);
  assert.ok(design.cable.sizesUsedMm2.length >= 1);
});

test("the module limit thins the array instead of truncating it", async () => {
  const { packRoof } = await import("../src/engine/packing.ts");
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, designElectrical } = await import(
    "../src/engine/electrical.ts"
  );
  const roof: [number, number][] = [
    [0, 0],
    [150, 0],
    [150, 100],
    [0, 100],
  ];
  const packed = packRoof(roof, 25);
  const half = Math.floor(packed.moduleCount / 2);
  const design = designElectrical({
    rows: packed.rows,
    module: MODULES[0],
    inverter: INVERTERS[1],
    temperatures: DESIGN_TEMPERATURES.dubai,
    plantAt: [75, 50],
    moduleLimit: half,
  });
  assert.ok(design.modulesWired <= half);
  // Half the rows are built, spread from one end of the roof to the other
  // rather than filling the first rows and stopping.
  const rowsTouched = [...new Set(design.strings.flatMap((run) => run.modules.map((m) => m.row)))];
  assert.ok(Math.min(...rowsTouched) < packed.rows.length * 0.15, `starts at row ${Math.min(...rowsTouched)}`);
  assert.ok(Math.max(...rowsTouched) > packed.rows.length * 0.85, `stops at row ${Math.max(...rowsTouched)}`);
  // Within a row it is whole rows, never every other panel: consecutive
  // modules in a string sit one module width apart.
  const run = design.strings[0];
  const inRow = run.modules.filter((m) => m.row === run.modules[0].row);
  for (let i = 1; i < inRow.length; i += 1) {
    const gap = Math.abs(inRow[i].at[0] - inRow[i - 1].at[0]);
    assert.ok(gap < MODULES[0].widthM * 1.05, `panels ${gap.toFixed(2)} m apart within a row`);
  }
});

test("a mild winter buys extra modules per string", async () => {
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, climateStringAdvantage } = await import(
    "../src/engine/electrical.ts"
  );
  const gain = climateStringAdvantage(MODULES[0], INVERTERS[1], DESIGN_TEMPERATURES.dubai);
  assert.ok(gain.extraModules >= 1, `no advantage: ${JSON.stringify(gain)}`);
  assert.ok(gain.fractionFewerStrings > 0 && gain.fractionFewerStrings < 0.3);
});

test("inverter count respects power rating, not just tracker inputs", async () => {
  const { packRoof } = await import("../src/engine/packing.ts");
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, designElectrical } = await import(
    "../src/engine/electrical.ts"
  );
  // A big roof on a small inverter: nine trackers would physically accept far
  // more array than 110 kW can convert. The count must be driven by power.
  const roof: [number, number][] = [
    [0, 0],
    [140, 0],
    [140, 70],
    [60, 70],
    [60, 45],
    [0, 45],
  ];
  const packed = packRoof(roof, 25);
  const design = designElectrical({
    rows: packed.rows,
    module: MODULES[0],
    inverter: INVERTERS[1],
    temperatures: DESIGN_TEMPERATURES.dubai,
    plantAt: [40, 22],
  });
  assert.ok(design.dcAcRatio <= 1.35, `DC/AC ${design.dcAcRatio}`);
  assert.ok(
    design.kwpWired <= INVERTERS[1].maxDcKw * design.inverterCount,
    `${design.kwpWired} kWp on ${design.inverterCount} inverters`,
  );
  // Strings dealt evenly: no inverter carries more than one extra.
  const counts = new Map<number, number>();
  for (const run of design.strings) counts.set(run.inverter, (counts.get(run.inverter) ?? 0) + 1);
  assert.equal(counts.size, design.inverterCount, "an inverter was left with no strings");
  const loads = [...counts.values()];
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 1, `uneven: ${loads.join(",")}`);
});

test("the chosen inverter lands near a 1.2 DC to AC ratio", async () => {
  const { MODULES, DESIGN_TEMPERATURES, chooseInverter, TARGET_DC_AC_RATIO } = await import(
    "../src/engine/electrical.ts"
  );
  for (const kwp of [60, 180, 350, 750, 1400]) {
    const inverter = chooseInverter(kwp, DESIGN_TEMPERATURES.dubai, MODULES[0]);
    const count = Math.max(1, Math.round(kwp / (inverter.acKw * TARGET_DC_AC_RATIO)));
    const ratio = kwp / (count * inverter.acKw);
    assert.ok(ratio > 0.9 && ratio < 1.36, `${kwp} kWp -> ${count} x ${inverter.acKw} kW = ${ratio}`);
  }
});

// --- setback geometry ------------------------------------------------------

test("a setback keeps every point the stated distance from the roof edge", async () => {
  const { shrinkPolygon, distanceToEdge, pointInPolygon } = await import("../src/engine/packing.ts");
  const lShaped: [number, number][] = [
    [0, 0],
    [140, 0],
    [140, 70],
    [60, 70],
    [60, 45],
    [0, 45],
  ];
  const setback = 1.5;
  const inner = shrinkPolygon(lShaped, setback);
  assert.ok(inner.length >= 6, `offset collapsed to ${inner.length} points`);
  // The invariant is "no closer than the setback", not "exactly the setback".
  // At the inside corner of an L the offset vertex sits 1.5 m clear of both
  // edges, which puts it 1.5 x root 2 from the corner point itself.
  for (const point of inner) {
    assert.ok(pointInPolygon(point, lShaped), `${point} fell outside the roof`);
    const d = distanceToEdge(point, lShaped);
    assert.ok(d >= setback - 0.01, `${point} is only ${d.toFixed(2)} m from the edge`);
  }
  // Every convex corner sits exactly on the setback; only the one reflex
  // corner is further in.
  const onTheLine = inner.filter((point) => Math.abs(distanceToEdge(point, lShaped) - setback) < 0.01);
  assert.equal(onTheLine.length, inner.length - 1, "expected exactly one reflex corner");
  const reflex = inner.find((point) => distanceToEdge(point, lShaped) > setback + 0.01)!;
  assert.ok(Math.abs(distanceToEdge(reflex, lShaped) - setback * Math.SQRT2) < 0.01);
});

test("a setback takes a strip off each edge, not a share off the whole shape", async () => {
  const { shrinkPolygon, polygonAreaM2 } = await import("../src/engine/packing.ts");
  // A long thin shed: scaling towards the centroid would take a fixed
  // percentage and barely touch the short sides. A real offset takes 1.5 m off
  // all four, so the width loses proportionally far more than the length.
  const shed: [number, number][] = [
    [0, 0],
    [200, 0],
    [200, 30],
    [0, 30],
  ];
  const inner = shrinkPolygon(shed, 1.5);
  const xs = inner.map(([x]) => x);
  const ys = inner.map(([, y]) => y);
  assert.ok(Math.abs(Math.min(...xs) - 1.5) < 0.01, `left edge at ${Math.min(...xs)}`);
  assert.ok(Math.abs(Math.max(...xs) - 198.5) < 0.01, `right edge at ${Math.max(...xs)}`);
  assert.ok(Math.abs(Math.min(...ys) - 1.5) < 0.01, `bottom edge at ${Math.min(...ys)}`);
  assert.ok(Math.abs(Math.max(...ys) - 28.5) < 0.01, `top edge at ${Math.max(...ys)}`);
  // 197 x 27 = 5,319 m2 out of 6,000.
  assert.ok(Math.abs(polygonAreaM2(inner) - 5319) < 1, `area ${polygonAreaM2(inner)}`);
});

test("a roof narrower than twice the setback has no buildable area at all", async () => {
  const { shrinkPolygon } = await import("../src/engine/packing.ts");
  const catwalk: [number, number][] = [
    [0, 0],
    [80, 0],
    [80, 2.4],
    [0, 2.4],
  ];
  assert.equal(shrinkPolygon(catwalk, 1.5).length, 0);
});

test("the offset winds the same way whichever way the outline was drawn", async () => {
  const { shrinkPolygon, polygonAreaM2 } = await import("../src/engine/packing.ts");
  const clockwise: [number, number][] = [
    [0, 0],
    [0, 60],
    [100, 60],
    [100, 0],
  ];
  const anticlockwise: [number, number][] = [...clockwise].reverse();
  const a = polygonAreaM2(shrinkPolygon(clockwise, 2));
  const b = polygonAreaM2(shrinkPolygon(anticlockwise, 2));
  assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);
  assert.ok(Math.abs(a - 96 * 56) < 0.01, `area ${a}`);
});

test("home run cable stays on the building", async () => {
  const { packRoof, plantPositions, pointInPolygon, distanceToEdge } = await import(
    "../src/engine/packing.ts"
  );
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, designElectrical } = await import(
    "../src/engine/electrical.ts"
  );
  // A roof set at an angle to the panel rows, which is the case that used to
  // send cable flying across open air.
  const angle = Math.PI / 7;
  const corners: [number, number][] = [
    [0, 0],
    [180, 0],
    [180, 80],
    [0, 80],
  ];
  const diagonal = corners.map(
    ([x, y]) =>
      [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)] as [
        number,
        number,
      ],
  );
  const packed = packRoof(diagonal, 25);
  const design = designElectrical({
    rows: packed.rows,
    module: MODULES[0],
    inverter: INVERTERS[1],
    temperatures: DESIGN_TEMPERATURES.dubai,
    plantAt: plantPositions(diagonal).inverter,
    roof: diagonal,
  });
  assert.ok(design.strings.length > 5, `only ${design.strings.length} strings`);
  for (const run of design.strings) {
    // Every turn in the route sits on the roof, within a centimetre.
    for (const point of run.homeRunPath.slice(1, -1)) {
      assert.ok(
        pointInPolygon(point, diagonal) || distanceToEdge(point, diagonal) < 0.05,
        `cable turns at ${point.map((v) => v.toFixed(1)).join(",")}, off the building`,
      );
    }
    // Routed cable is never shorter than the straight line it replaces.
    const direct = Math.hypot(
      run.homeRunPath[0][0] - design.inverterAt[run.inverter][0],
      run.homeRunPath[0][1] - design.inverterAt[run.inverter][1],
    );
    assert.ok(run.homeRunM >= direct - 0.01, `routed ${run.homeRunM} < direct ${direct}`);
  }
});

test("a legal short string is wired rather than thrown away", async () => {
  const { packRoof, plantPositions } = await import("../src/engine/packing.ts");
  const { MODULES, INVERTERS, DESIGN_TEMPERATURES, designElectrical } = await import(
    "../src/engine/electrical.ts"
  );
  const roof: [number, number][] = [
    [0, 0],
    [160, 0],
    [160, 95],
    [0, 95],
  ];
  const packed = packRoof(roof, 25);
  const design = designElectrical({
    rows: packed.rows,
    module: MODULES[0],
    inverter: INVERTERS[1],
    temperatures: DESIGN_TEMPERATURES.dubai,
    plantAt: plantPositions(roof).inverter,
    roof,
  });
  const { minModulesPerString, modulesPerString } = design.sizing;
  // No string is ever illegal in either direction.
  for (const run of design.strings) {
    assert.ok(
      run.modules.length >= minModulesPerString && run.modules.length <= modulesPerString,
      `string of ${run.modules.length}`,
    );
  }
  // What is thrown away is only what is too short to be a legal string.
  assert.ok(
    design.strandedModules < minModulesPerString * design.strings.length,
    `${design.strandedModules} stranded`,
  );
  // A short string never shares a tracker input with a full one.
  const byInput = new Map<string, number[]>();
  for (const run of design.strings) {
    const key = `${run.inverter}:${run.mppt}`;
    byInput.set(key, [...(byInput.get(key) ?? []), run.modules.length]);
  }
  for (const [key, lengths] of byInput) {
    assert.equal(new Set(lengths).size, 1, `input ${key} mixes string lengths: ${lengths.join(",")}`);
    assert.ok(lengths.length <= design.sizing.stringsPerMppt, `input ${key} has ${lengths.length} strings`);
  }
});

// --- row shading -----------------------------------------------------------

const JEBEL_ALI_SITE = { lat: 25.0118, lng: 55.0877 };

/** A weather year with sunlight only in the hours of the day we want. */
const weatherLimitedTo = async (keepHour: (hourOfDay: number) => boolean) => {
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const year = modelledWeatherYear(JEBEL_ALI_SITE);
  const ghi = new Float64Array(year.ghi);
  for (let hour = 0; hour < ghi.length; hour += 1) {
    if (!keepHour(hour % 24)) ghi[hour] = 0;
  }
  return { ...year, ghi };
};

test("row spacing clears the shadow at the design point and not a degree below", async () => {
  const { shadedFraction } = await import("../src/engine/shading.ts");
  const length = 2.278;
  const tilt = 10;
  const rise = length * Math.sin((tilt * Math.PI) / 180);
  const gap = 0.447; // what the packer leaves at this tilt and latitude
  const designTan = rise / gap; // the profile angle the spacing was set for

  assert.equal(shadedFraction(designTan, gap, length, tilt), 0, "shaded at the design point");
  assert.ok(shadedFraction(designTan * 1.2, gap, length, tilt) === 0, "shaded with the sun higher");
  const lower = shadedFraction(designTan * 0.8, gap, length, tilt);
  assert.ok(lower > 0 && lower < 1, `just below the design point: ${lower}`);
  // Lower sun always means more shadow, never less.
  let previous = 0;
  for (const factor of [0.9, 0.7, 0.5, 0.3, 0.1]) {
    const f = shadedFraction(designTan * factor, gap, length, tilt);
    assert.ok(f >= previous, `not monotone at ${factor}: ${f} after ${previous}`);
    previous = f;
  }
  // With the sun on the horizon the shadow of the front row's top edge lies
  // level with the back row's top edge, so the whole module is in it.
  assert.ok(shadedFraction(1e-4, gap, length, tilt) > 0.999, "should approach a whole module");
  assert.equal(shadedFraction(0, gap, length, tilt), 1);
});

test("the front row and any row with a double gap are never shaded", async () => {
  const { packRoof } = await import("../src/engine/packing.ts");
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { rowShading } = await import("../src/engine/shading.ts");
  const { DEFAULT_PACK } = await import("../src/engine/packing.ts");

  const packed = packRoof(
    [
      [0, 0],
      [160, 0],
      [160, 95],
      [0, 95],
    ],
    JEBEL_ALI_SITE.lat,
  );
  const shading = rowShading(packed.rows, JEBEL_ALI_SITE, modelledWeatherYear(JEBEL_ALI_SITE), {
    tiltDeg: 10,
    azimuthDeg: 0,
    moduleLengthM: DEFAULT_PACK.moduleHeightM,
    moduleWidthM: DEFAULT_PACK.moduleWidthM,
    albedo: 0.15,
  });

  // Rows sorted south to north; the first has nothing in front of it, so it
  // is shaded by exactly nothing.
  const order = packed.rows.map((row, index) => ({ index, y: row.y })).sort((a, b) => a.y - b.y);
  const first = order[0].index;
  assert.ok(
    shading.byModule[first].every((loss) => loss === 0),
    "the southernmost row was shaded by something",
  );

  const depth = DEFAULT_PACK.moduleHeightM * Math.cos((10 * Math.PI) / 180);
  const worstAt = (index: number) => Math.max(...shading.byModule[index]);
  const single: number[] = [];
  const double: number[] = [];
  for (let i = 1; i < order.length; i += 1) {
    const spacing = order[i].y - order[i - 1].y;
    (spacing > depth * 1.8 ? double : single).push(worstAt(order[i].index));
  }
  assert.ok(double.length > 0 && single.length > 0, "expected both spacings on this roof");
  // A row with a double gap in front is only caught by a sun within a few
  // degrees of the horizon, which carries next to no energy. It is not
  // mathematically zero, and claiming it was would be the wrong kind of tidy.
  assert.ok(
    Math.max(...double) < Math.min(...single) / 100,
    `double-gap rows lose ${Math.max(...double)}, single-gap rows ${Math.min(...single)}`,
  );
  assert.ok(Math.max(...double) < 1e-6, `double-gap loss ${Math.max(...double)} is not negligible`);
});

test("morning shadows fall west and afternoon shadows fall east", async () => {
  const { rowShading } = await import("../src/engine/shading.ts");
  const { DEFAULT_PACK } = await import("../src/engine/packing.ts");
  const options = {
    tiltDeg: 10,
    azimuthDeg: 0,
    moduleLengthM: DEFAULT_PACK.moduleHeightM,
    moduleWidthM: DEFAULT_PACK.moduleWidthM,
    albedo: 0.15,
  };
  const depth = DEFAULT_PACK.moduleHeightM * Math.cos((10 * Math.PI) / 180);
  // A short front row over the west end, and a long row behind it.
  const width = 20 * DEFAULT_PACK.moduleWidthM;
  const rows = [
    { x: 0, y: 0, w: width, h: depth, modules: 20 },
    { x: 0, y: depth + 0.447, w: width * 3, h: depth, modules: 60 },
  ];

  // A threshold, not "greater than zero": a sun a hair above the horizon
  // throws a shadow the length of the roof and leaves floating-point dust on
  // every module. Anything under a billionth of the year is not a shadow.
  const shadedSpan = (byModule: number[][]) => {
    const indices = byModule[1].map((loss, i) => (loss > 1e-9 ? i : -1)).filter((i) => i >= 0);
    return indices.length === 0 ? null : { first: indices[0], last: indices[indices.length - 1] };
  };

  const morning = shadedSpan(
    rowShading(rows, JEBEL_ALI_SITE, await weatherLimitedTo((h) => h >= 6 && h <= 9), options)
      .byModule,
  );
  const afternoon = shadedSpan(
    rowShading(rows, JEBEL_ALI_SITE, await weatherLimitedTo((h) => h >= 15 && h <= 18), options)
      .byModule,
  );

  assert.ok(morning, "nothing shaded in the morning");
  assert.ok(afternoon, "nothing shaded in the afternoon");
  // With the sun in the east the shadow is thrown west, so it cannot reach
  // past the east end of the row casting it.
  assert.ok(morning!.last <= 19, `morning shadow reached module ${morning!.last}`);
  // With the sun in the west it is thrown east, past that end.
  assert.ok(afternoon!.last > 19, `afternoon shadow stopped at module ${afternoon!.last}`);
  assert.ok(
    afternoon!.first >= morning!.first,
    `afternoon span starts west of the morning one: ${afternoon!.first} vs ${morning!.first}`,
  );
});

test("bypass diodes make the electrical loss the larger of the two", async () => {
  const { packRoof, DEFAULT_PACK } = await import("../src/engine/packing.ts");
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { rowShading } = await import("../src/engine/shading.ts");
  const packed = packRoof(
    [
      [0, 0],
      [160, 0],
      [160, 95],
      [0, 95],
    ],
    JEBEL_ALI_SITE.lat,
  );
  const shading = rowShading(packed.rows, JEBEL_ALI_SITE, modelledWeatherYear(JEBEL_ALI_SITE), {
    tiltDeg: 10,
    azimuthDeg: 0,
    moduleLengthM: DEFAULT_PACK.moduleHeightM,
    moduleWidthM: DEFAULT_PACK.moduleWidthM,
    albedo: 0.15,
  });
  assert.ok(shading.arrayLoss > 0, "no geometric shading at all");
  assert.ok(
    shading.electricalArrayLoss > shading.arrayLoss,
    `electrical ${shading.electricalArrayLoss} is not above geometric ${shading.arrayLoss}`,
  );
  // A shadow can never cost more than the whole module.
  assert.ok(shading.electricalArrayLoss < 0.2, `implausible ${shading.electricalArrayLoss}`);
  // It is a winter problem: the sun is too high the rest of the year.
  const summer = Math.max(...shading.monthlyLoss.slice(4, 8));
  const winter = Math.max(shading.monthlyLoss[0], shading.monthlyLoss[11]);
  assert.ok(winter > summer, `winter ${winter} should beat summer ${summer}`);
});

test("thinning to half the rows removes the shading entirely", async () => {
  const { packRoof, DEFAULT_PACK } = await import("../src/engine/packing.ts");
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { shadingCurve, thinRows } = await import("../src/engine/shading.ts");
  const packed = packRoof(
    [
      [0, 0],
      [160, 0],
      [160, 95],
      [0, 95],
    ],
    JEBEL_ALI_SITE.lat,
  );
  // Thinning spreads: it keeps rows from both ends of the roof.
  const half = thinRows(packed.rows, 0.5);
  assert.ok(half.length > 0 && half.length < packed.rows.length);
  assert.ok(half[0].y < packed.rows[2].y, "thinning truncated instead of spreading");
  assert.ok(
    half[half.length - 1].y > packed.rows[packed.rows.length - 3].y,
    "thinning dropped the far end of the roof",
  );

  const curve = shadingCurve(packed.rows, JEBEL_ALI_SITE, modelledWeatherYear(JEBEL_ALI_SITE), {
    tiltDeg: 10,
    azimuthDeg: 0,
    moduleLengthM: DEFAULT_PACK.moduleHeightM,
    moduleWidthM: DEFAULT_PACK.moduleWidthM,
    albedo: 0.15,
  });
  // More roof covered never means less shading.
  for (let i = 1; i < curve.length; i += 1) {
    assert.ok(curve[i].loss >= curve[i - 1].loss - 1e-12, `curve dips at fill ${curve[i].fill}`);
  }
  assert.ok(curve[0].loss < 1e-6, `a quarter-full roof should have no row shading, got ${curve[0].loss}`);
  assert.ok(curve[curve.length - 1].loss > 0, "a full roof should have some");
});

test("the planner reads shading off the curve and clamps past both ends", async () => {
  const { shadingAtFill } = await import("../src/engine/plan.ts");
  const curve = [
    { fill: 0.25, loss: 0 },
    { fill: 0.5, loss: 0 },
    { fill: 0.75, loss: 0.01 },
    { fill: 1, loss: 0.02 },
  ];
  assert.equal(shadingAtFill(curve, 0.1), 0);
  assert.equal(shadingAtFill(curve, 0.5), 0);
  assert.ok(Math.abs(shadingAtFill(curve, 0.875) - 0.015) < 1e-9);
  assert.equal(shadingAtFill(curve, 1.4), 0.02, "extrapolated past the last sample");
  assert.equal(shadingAtFill([], 0.9), 0, "no curve should mean no claim");
});

test("shading costs real energy in the array simulation", async () => {
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { simulateArray } = await import("../src/engine/pv.ts");
  const weather = modelledWeatherYear(JEBEL_ALI_SITE);
  const spec = {
    kwp: 100,
    tiltDeg: 10,
    azimuthDeg: 0,
    mounting: "roof-flat" as const,
    dcAcRatio: 1.2,
  };
  const clear = simulateArray(JEBEL_ALI_SITE, weather, spec);
  const shaded = simulateArray(JEBEL_ALI_SITE, weather, spec, undefined, 0.015);
  const drop = 1 - shaded.annualKwh / clear.annualKwh;
  assert.ok(Math.abs(drop - 0.015) < 1e-6, `1.5% shading produced a ${(drop * 100).toFixed(3)}% drop`);
  assert.ok(
    clear.lossBreakdown.some((item) => item.label.includes("row in front")),
    "shading is missing from the named loss stack",
  );
});

// --- shading from taller buildings -----------------------------------------

const shadeOpts = async () => {
  const { DEFAULT_PACK } = await import("../src/engine/packing.ts");
  return {
    tiltDeg: 10,
    azimuthDeg: 0,
    moduleLengthM: DEFAULT_PACK.moduleHeightM,
    moduleWidthM: DEFAULT_PACK.moduleWidthM,
    albedo: 0.15,
  };
};

/** A square block of `size` metres centred at (cx, cy). */
const block = (cx: number, cy: number, size: number): [number, number][] => [
  [cx - size / 2, cy - size / 2],
  [cx + size / 2, cy - size / 2],
  [cx + size / 2, cy + size / 2],
  [cx - size / 2, cy + size / 2],
];

test("the sky energy map accounts for the same sunlight the transposition does", async () => {
  const { modelledWeatherYear, solarPosition, transpose } = await import("../src/engine/solar.ts");
  const { buildSkyEnergy } = await import("../src/engine/shading.ts");
  const options = await shadeOpts();
  const weather = modelledWeatherYear(JEBEL_ALI_SITE);
  const sky = buildSkyEnergy(JEBEL_ALI_SITE, weather, options);

  // Independent path: add the direct component up hour by hour.
  let direct = 0;
  for (let hour = 0; hour < 8760; hour += 1) {
    if (weather.ghi[hour] <= 0) continue;
    const sun = solarPosition(JEBEL_ALI_SITE, hour);
    if (sun.altitudeDeg <= 0) continue;
    direct += transpose(
      weather.ghi[hour],
      Math.floor(hour / 24) + 1,
      sun,
      options.tiltDeg,
      options.azimuthDeg,
      options.albedo,
    ).directWm2;
  }
  assert.ok(Math.abs(sky.total - direct) / direct < 1e-9, `${sky.total} vs ${direct}`);
  // Everything in the map is also reachable through the cumulative view.
  const top = sky.cumulative.filter((_, i) => (i + 1) % (sky.elevationBins + 1) === 0);
  const viaCumulative = top.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(viaCumulative - sky.total) / sky.total < 1e-9);
});

test("a neighbour no taller than the roof blocks nothing", async () => {
  const { packRoof, DEFAULT_PACK } = await import("../src/engine/packing.ts");
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { buildSkyEnergy, obstructionShading, neighbourObstructions } = await import(
    "../src/engine/shading.ts"
  );
  const options = await shadeOpts();
  const sky = buildSkyEnergy(JEBEL_ALI_SITE, modelledWeatherYear(JEBEL_ALI_SITE), options);
  const packed = packRoof(block(0, 0, 100), JEBEL_ALI_SITE.lat);

  // Three sheds all 12 m tall, all around a roof that is also 12 m.
  const neighbours = [
    { ring: block(0, -80, 60), heightM: 12, label: "south" },
    { ring: block(-80, 0, 60), heightM: 12, label: "west" },
    { ring: block(0, 80, 60), heightM: 12, label: "north" },
  ];
  const level = neighbourObstructions(neighbours, 12, 400, [0, 0]);
  assert.equal(level.obstructions.length, 0, "a same-height shed should drop out");
  assert.equal(level.considered, 3);

  const shading = obstructionShading(packed.rows, level.obstructions, sky, DEFAULT_PACK.moduleWidthM);
  assert.equal(shading.arrayLoss, 0);
  assert.equal(shading.clearShare, 1);

  // Raise one of them and it starts to matter.
  const raised = neighbourObstructions(
    [{ ring: block(0, -80, 60), heightM: 60, label: "tower" }],
    12,
    400,
    [0, 0],
  );
  assert.equal(raised.obstructions.length, 1);
  assert.equal(raised.obstructions[0].riseM, 48);
  const withTower = obstructionShading(packed.rows, raised.obstructions, sky, DEFAULT_PACK.moduleWidthM);
  assert.ok(withTower.arrayLoss > 0.02, `a 48 m rise 80 m south should bite: ${withTower.arrayLoss}`);
});

test("at this latitude a tower to the east costs more than one to the south", async () => {
  const { packRoof, DEFAULT_PACK } = await import("../src/engine/packing.ts");
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { buildSkyEnergy, obstructionShading } = await import("../src/engine/shading.ts");
  const options = await shadeOpts();
  const sky = buildSkyEnergy(JEBEL_ALI_SITE, modelledWeatherYear(JEBEL_ALI_SITE), options);
  const packed = packRoof(block(0, 0, 100), JEBEL_ALI_SITE.lat);
  const tower = (cx: number, cy: number) => [{ ring: block(cx, cy, 40), riseM: 50, label: "t" }];

  const south = obstructionShading(packed.rows, tower(0, -90), sky, DEFAULT_PACK.moduleWidthM);
  const north = obstructionShading(packed.rows, tower(0, 90), sky, DEFAULT_PACK.moduleWidthM);
  const east = obstructionShading(packed.rows, tower(-90, 0), sky, DEFAULT_PACK.moduleWidthM);

  // The sun never comes from due north here, so a tower there costs nothing.
  assert.ok(north.arrayLoss < 0.005, `north ${north.arrayLoss}`);
  assert.ok(south.arrayLoss > north.arrayLoss * 5, `south ${south.arrayLoss} vs north ${north.arrayLoss}`);

  // The part worth pinning: at 25 degrees north the sun is never low in the
  // south, so a tower there is above the sun's path for only a short while.
  // A tower to the east blocks every sunrise of the year, and costs more. The
  // European habit of keeping the south side clear is the wrong rule here.
  assert.ok(
    east.arrayLoss > south.arrayLoss,
    `east ${east.arrayLoss} should exceed south ${south.arrayLoss} at this latitude`,
  );

  // And it genuinely is a latitude effect, not a quirk of the model: run the
  // same roof and the same tower at a northern European latitude and the
  // ordering turns over.
  const berlin = { lat: 52.5, lng: JEBEL_ALI_SITE.lng };
  const berlinSky = buildSkyEnergy(berlin, modelledWeatherYear(berlin), options);
  const berlinRoof = packRoof(block(0, 0, 100), berlin.lat);
  const berlinSouth = obstructionShading(berlinRoof.rows, tower(0, -90), berlinSky, DEFAULT_PACK.moduleWidthM);
  const berlinEast = obstructionShading(berlinRoof.rows, tower(-90, 0), berlinSky, DEFAULT_PACK.moduleWidthM);
  assert.ok(
    berlinSouth.arrayLoss > berlinEast.arrayLoss * 1.8,
    `at 52.5N south ${berlinSouth.arrayLoss} should dominate east ${berlinEast.arrayLoss}`,
  );
});

test("distance and roof height both let a roof out of the shadow", async () => {
  const { packRoof, DEFAULT_PACK } = await import("../src/engine/packing.ts");
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { buildSkyEnergy, obstructionShading, neighbourObstructions } = await import(
    "../src/engine/shading.ts"
  );
  const options = await shadeOpts();
  const sky = buildSkyEnergy(JEBEL_ALI_SITE, modelledWeatherYear(JEBEL_ALI_SITE), options);
  const packed = packRoof(block(0, 0, 100), JEBEL_ALI_SITE.lat);

  // Measured on the east side, where a tower at this latitude actually costs
  // something at every distance worth testing.
  let previous = 1;
  for (const away of [70, 110, 180, 300]) {
    const loss = obstructionShading(
      packed.rows,
      [{ ring: block(-away, 0, 40), riseM: 60, label: "t" }],
      sky,
      DEFAULT_PACK.moduleWidthM,
    ).arrayLoss;
    assert.ok(loss < previous, `moving it to ${away} m did not help: ${loss} after ${previous}`);
    previous = loss;
  }
  assert.ok(previous < 0.002, `at 300 m it should be all but gone: ${previous}`);

  // Climbing the tower is the other way out.
  const neighbour = [{ ring: block(0, -80, 60), heightM: 100, label: "tower" }];
  let last = 1;
  for (const roofHeight of [5, 30, 60, 95]) {
    const { obstructions } = neighbourObstructions(neighbour, roofHeight, 400, [0, 0]);
    const loss = obstructionShading(packed.rows, obstructions, sky, DEFAULT_PACK.moduleWidthM).arrayLoss;
    assert.ok(loss < last, `a roof at ${roofHeight} m did not improve on the last: ${loss} vs ${last}`);
    last = loss;
  }
  assert.ok(last < 0.01, `level with the top it should be nearly clear: ${last}`);
});

test("unmapped heights are counted, never invented", async () => {
  const { neighbourObstructions } = await import("../src/engine/shading.ts");
  const { obstructions, unknownHeights, considered } = neighbourObstructions(
    [
      { ring: block(0, -60, 40), heightM: null, label: "unknown" },
      { ring: block(60, 0, 40), heightM: 40, label: "tall" },
      { ring: block(-60, 0, 40), heightM: 8, label: "short" },
      { ring: block(0, 900, 40), heightM: 200, label: "far away" },
    ],
    12,
    400,
    [0, 0],
  );
  assert.equal(considered, 3, "the far one is out of reach");
  assert.equal(unknownHeights, 1);
  assert.equal(obstructions.length, 1, "only the taller mapped one shades");
  assert.equal(obstructions[0].label, "tall");
});

test("the panels nearest a tower lose most", async () => {
  const { packRoof, DEFAULT_PACK } = await import("../src/engine/packing.ts");
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { buildSkyEnergy, obstructionShading } = await import("../src/engine/shading.ts");
  const options = await shadeOpts();
  const sky = buildSkyEnergy(JEBEL_ALI_SITE, modelledWeatherYear(JEBEL_ALI_SITE), options);
  // A long roof running east-west with a tower off its west end.
  const packed = packRoof(
    [
      [0, 0],
      [240, 0],
      [240, 60],
      [0, 60],
    ],
    JEBEL_ALI_SITE.lat,
  );
  const shading = obstructionShading(
    packed.rows,
    [{ ring: block(-40, 30, 50), riseM: 80, label: "tower" }],
    sky,
    DEFAULT_PACK.moduleWidthM,
  );
  const first = packed.rows[0];
  const west = shading.byModule[0][0];
  const east = shading.byModule[0][first.modules - 1];
  assert.ok(west > east * 2, `west end ${west} should far exceed east end ${east}`);
  assert.ok(shading.worstModuleLoss > shading.arrayLoss, "the worst panel should beat the average");
  assert.equal(shading.culprits[0].label, "tower");
});

// --- validation against PVGIS ----------------------------------------------

test("annual yield stays within a couple of per cent of PVGIS across the UAE", async () => {
  const { modelledWeatherYear } = await import("../src/engine/solar.ts");
  const { simulateArray, ENGINE_VALIDATION } = await import("../src/engine/pv.ts");
  const reference = (await import("../src/data/pvgis-uae-pvcalc.json", { with: { type: "json" } }))
    .default as { sites: { n: string; lat: number; lon: number; E_y: number; H_y: number }[] };

  const errors = reference.sites.map((site) => {
    const at = { lat: site.lat, lng: site.lon };
    const sim = simulateArray(at, modelledWeatherYear(at), {
      kwp: 1,
      tiltDeg: 10,
      azimuthDeg: 0,
      mounting: "roof-flat",
      dcAcRatio: 1.2,
    });
    return (sim.specificYield - site.E_y) / site.E_y;
  });
  const avg = errors.reduce((a, b) => a + b, 0) / errors.length;
  const absAvg = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;

  // No systematic lean in either direction. This is the check that caught two
  // large errors pointing opposite ways and hiding each other: the sunlight
  // was 7% low everywhere and the module model 12% generous.
  assert.ok(Math.abs(avg) < 0.01, `bias ${(avg * 100).toFixed(2)}%`);
  assert.ok(absAvg < 0.02, `mean absolute error ${(absAvg * 100).toFixed(2)}%`);
  assert.ok(Math.max(...errors.map(Math.abs)) < 0.05, "a site drifted more than 5%");
  // What the engine advertises has to be what it does.
  assert.ok(Math.abs(absAvg - ENGINE_VALIDATION.yieldMeanAbsError) < 0.005, "published error is stale");
});

test("a roof runs hotter than a ground rack, and produces less", async () => {
  const { modelledWeatherYear, MOUNTING_THERMAL, WIND_AT_MODULE } = await import(
    "../src/engine/solar.ts"
  );
  const { simulateArray } = await import("../src/engine/pv.ts");
  const at = JEBEL_ALI_SITE;
  const weather = modelledWeatherYear(at);
  const spec = { kwp: 1, tiltDeg: 10, azimuthDeg: 0, dcAcRatio: 1.2 };
  const roof = simulateArray(at, weather, { ...spec, mounting: "roof-flat" });
  const ground = simulateArray(at, weather, { ...spec, mounting: "ground" });

  assert.ok(
    MOUNTING_THERMAL["roof-flat"].u0 < MOUNTING_THERMAL.ground.u0,
    "a roof should cool worse than a free rack",
  );
  // Same tilt and same sun, so any difference is the cooling. Ground also sees
  // more reflected light, so the gap is not purely thermal, but a roof must
  // not come out ahead.
  assert.ok(roof.specificYield < ground.specificYield, `roof ${roof.specificYield} vs ground ${ground.specificYield}`);
  assert.ok(WIND_AT_MODULE > 0 && WIND_AT_MODULE < 1, "module wind must be a share of the weather file");
});

test("weak light costs efficiency, and the model behaves at both ends", async () => {
  const { huldRelativeEfficiency } = await import("../src/engine/solar.ts");
  // At standard test conditions the module is at its rated efficiency.
  assert.ok(Math.abs(huldRelativeEfficiency(1000, 25) - 1) < 1e-9);
  // Weak light costs something even when the module is cool.
  assert.ok(huldRelativeEfficiency(200, 25) < 0.97, "200 W/m2 should cost a few per cent");
  assert.ok(huldRelativeEfficiency(100, 25) < huldRelativeEfficiency(200, 25));
  // Heat costs more than weak light does on a Gulf roof.
  assert.ok(huldRelativeEfficiency(1000, 65) < 0.85, "65 C should cost more than 15%");
  // Monotone in temperature, and never negative however extreme.
  assert.ok(huldRelativeEfficiency(1000, 80) < huldRelativeEfficiency(1000, 65));
  assert.ok(huldRelativeEfficiency(1000, 200) >= 0);
  assert.equal(huldRelativeEfficiency(0, 25), 0);
});

test("the clearness index is the measured one, and holds outside the fitted band", async () => {
  const { clearnessFor, CLEARNESS_FIT } = await import("../src/engine/solar.ts");
  const [low, high] = CLEARNESS_FIT.latRange;
  // Northern UAE is the humid coast and hazier than the southern desert.
  const north = clearnessFor(high);
  const south = clearnessFor(low);
  for (let m = 0; m < 12; m += 1) {
    assert.ok(south[m] > north[m], `month ${m}: south ${south[m]} should beat north ${north[m]}`);
  }
  // Held flat beyond the sites it was fitted on rather than extrapolated.
  assert.deepEqual(clearnessFor(low - 5), south);
  assert.deepEqual(clearnessFor(high + 5), north);
  // Summer is the hazy season here, not the clearest one.
  const middle = clearnessFor((low + high) / 2);
  assert.ok(middle[6] < middle[0], "July should be hazier than January");
  assert.ok(CLEARNESS_FIT.previousAnnualError > CLEARNESS_FIT.crossValidatedAnnualError * 3);
});

// --- UAE resource layer ------------------------------------------------------

test("the baked resource grid returns a point near every UAE site", async () => {
  const { resourcePointFor } = await import("../src/engine/resource.ts");
  const point = resourcePointFor(JEBEL_ALI);
  assert.ok(Math.abs(point.lat - JEBEL_ALI.lat) <= 0.4);
  assert.ok(Math.abs(point.lng - JEBEL_ALI.lng) <= 0.4);
  assert.equal(point.ghiKwhM2Day.length, 12);
  assert.ok(point.ghiKwhM2Day.every((v) => v > 2 && v < 9), "UAE GHI should sit in the 2-9 band");
});

test("the measured weather year tracks the grid's irradiation, not a constant", async () => {
  const { resourcePointFor, weatherYearFor, measuredGhiDaily } = await import("../src/engine/resource.ts");
  const weather = weatherYearFor(JEBEL_ALI);
  assert.equal(weather.source, "nasa-power-climatology");
  // weather.ghi is Wh/m2 summed over hours; the grid's figure is kWh/m2/day.
  const annual = sum(weather.ghi) / 1000;
  const measuredAnnual = measuredGhiDaily(JEBEL_ALI).reduce((t, m, i) => t + m * [31,28,31,30,31,30,31,31,30,31,30,31][i], 0);
  // Modelled hours cannot exceed measured means by more than a few percent.
  assert.ok(Math.abs(annual - measuredAnnual) / measuredAnnual < 0.08,
    `modelled ${annual.toFixed(0)} vs measured ${measuredAnnual.toFixed(0)}`);
  // Al Ain is further inland: its GHI must differ from the coast's.
  const inland = resourcePointFor({ lat: 24.2, lng: 55.7 });
  const coast = resourcePointFor(JEBEL_ALI);
  assert.notDeepEqual(inland.ghiKwhM2Day, coast.ghiKwhM2Day);
});

test("wind shear lifts hub-height speed and Rayleigh CF stays sane", async () => {
  const { rayleighCapacityFactor, windAtHeight, windMonthlyKwhPerKw } = await import("../src/engine/resource.ts");
  assert.ok(windAtHeight(4, 10, 50) > 4);
  // A 2 m/s mean still has a Rayleigh tail above cut-in, but it is tiny.
  assert.ok(rayleighCapacityFactor(2) < 0.05, `2 m/s CF ${rayleighCapacityFactor(2)} too high`);
  const cf = rayleighCapacityFactor(7);
  assert.ok(cf > 0.15 && cf < 0.7, `CF ${cf} implausible for 7 m/s`);
  const monthly = windMonthlyKwhPerKw(JEBEL_ALI);
  assert.equal(monthly.length, 12);
  assert.ok(monthly.every((v) => v >= 0 && v <= 744));
});

test("the measured UAE soiling curve replaces the assumed daily rate", async () => {
  const { endOfCycleSoilingLoss, meanSoilingLoss } = await import("../src/engine/pv.ts");
  assert.equal(endOfCycleSoilingLoss(15), 0.04);
  assert.equal(endOfCycleSoilingLoss(90), 0.13);
  const measured = meanSoilingLoss({ ...DEFAULT_PV_LOSSES, cleaningIntervalDays: 30 });
  assert.ok(measured > 0.02 && measured < 0.08, `30-day mean loss was ${measured}`);
  const manual = meanSoilingLoss({ ...DEFAULT_PV_LOSSES, useMeasuredUaeSoiling: false });
  assert.ok(Math.abs(manual - (0.0035 * 21) / 2) < 1e-9);
});

test("an unreachable energy target names the constraint and the shortfall", async () => {
  const { plan } = await import("../src/engine/plan.ts");
  // Asking for 90% coverage on a 5 GWh load needs ~4.5 GWh self-consumed —
  // far more than this roof and a 1,000 kW ceiling can deliver.
  const result = plan(makeSite({ energyTargetShare: 0.9 }));
  assert.ok(result.infeasibility, "expected the target to be flagged unreachable");
  assert.equal(result.infeasibility!.requiredKwh, 4_500_000);
  assert.ok(result.infeasibility!.shortfallKwh > 0);
  assert.ok(result.infeasibility!.explanation.length > 30);

  // A modest target is met and the cheapest meeting option is offered.
  const modest = plan(makeSite({ energyTargetShare: 0.05 }));
  assert.equal(modest.infeasibility, null);
  assert.ok(modest.targetOption, "expected a meeting option");
  assert.ok(modest.targetOption!.simulation.selfConsumedKwh >= 0.05 * 5_000_000);
});

test("bill intake proposes fields and applies only confirmed ones", async () => {
  const { extractBill, applyBillProposal } = await import("../src/engine/intake.ts");
  const bill = [
    "DEWA — Dubai Electricity and Water Authority",
    "Commercial account statement",
    "Total Approved Load    1,200 kW",
    "JAN-25   380,000 kWh",
    "FEB-25   350,000 kWh",
    "MAR-25   410,000 kWh",
    "APR-25   450,000 kWh",
    "MAY-25   520,000 kWh",
    "JUN-25   560,000 kWh",
    "JUL-25   610,000 kWh",
    "AUG-25   600,000 kWh",
    "SEP-25   540,000 kWh",
    "OCT-25   470,000 kWh",
    "NOV-25   400,000 kWh",
    "DEC-25   390,000 kWh",
  ].join("\n");
  const proposal = extractBill(bill);
  assert.equal(proposal.utility, "dewa");
  const monthly = proposal.fields.find((f) => f.key === "monthlyKwh");
  assert.ok(monthly, "expected a monthly consumption proposal");
  assert.equal(monthly!.monthlyKwh!.length, 12);
  assert.equal(monthly!.annualKwh, 5_680_000);
  assert.ok(proposal.fields.some((f) => f.key === "approvedLoadKw" && f.approvedLoadKw === 1200));
  assert.ok(proposal.fields.some((f) => f.key === "emirate" && f.emirate === "dubai"));

  // Nothing lands unconfirmed.
  const site = makeSite();
  const untouched = applyBillProposal(site, proposal, []);
  assert.equal(untouched.annualKwh, site.annualKwh);
  assert.equal(untouched.monthlyKwh, undefined);

  const applied = applyBillProposal(site, proposal, ["monthlyKwh", "approvedLoadKw"]);
  assert.equal(applied.annualKwh, 5_680_000);
  assert.equal(applied.approvedLoadKw, 1200);
  assert.equal(applied.evidence.hasIntervalMeterData, true);
  assert.equal(applied.emirate, site.emirate); // emirate not confirmed
});

test("a partial year of bills is noted, not proposed", async () => {
  const { extractBill } = await import("../src/engine/intake.ts");
  const bill = "EtihadWE bill\nJAN 12,000 kWh\nFEB 11,000 kWh\nTotal Approved Load 800 kW";
  const proposal = extractBill(bill);
  assert.equal(proposal.utility, "etihadwe");
  assert.ok(!proposal.fields.some((f) => f.key === "monthlyKwh"));
  assert.ok(proposal.notes.length >= 1);
});

test("the assumption register lists every input with provenance", async () => {
  const { plan } = await import("../src/engine/plan.ts");
  const { assumptionRegister, registerSummary } = await import("../src/engine/register.ts");
  const result = plan(makeSite());
  const register = assumptionRegister(result);
  assert.ok(register.length >= 7);
  assert.ok(register.every((entry) => entry.provenance.kind === entry.kind));
  const inputs = register.map((entry) => entry.input);
  assert.ok(inputs.includes("Installed cost"));
  assert.ok(inputs.includes("Utility tariff"));
  assert.ok(inputs.some((i) => i === "Regulatory cap and scheme rules"));
  // Facts sort before assumptions.
  const kinds = register.map((entry) => entry.kind);
  const firstAssumption = kinds.indexOf("assumption");
  assert.ok(kinds.slice(0, firstAssumption).every((k) => k !== "assumption"));
  assert.ok(registerSummary(register).length > 10);
});

test("corporate tax scales net savings when set", async () => {
  const { evaluateFinance } = await import("../src/engine/finance.ts");
  const base = evaluateFinance({
    capexAed: 1_000_000,
    batteryCapexAed: 0,
    installedKw: 500,
    firstYearSavingsAed: 200_000,
    firstYearGenerationKwh: 800_000,
  });
  const taxed = evaluateFinance({
    capexAed: 1_000_000,
    batteryCapexAed: 0,
    installedKw: 500,
    firstYearSavingsAed: 200_000,
    firstYearGenerationKwh: 800_000,
    assumptions: { corporateTaxRate: 0.09 },
  });
  assert.ok(taxed.npvAed < base.npvAed);
  // Year-1 net: (200,000 - 500*55) * 0.91 = 156,975
  assert.ok(Math.abs(taxed.cashflow[0].netAed - 156_975) < 1);
});
