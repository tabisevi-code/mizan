import assert from "node:assert/strict";
import test from "node:test";

import { analyzeRoof } from "../src/engine/analyze.ts";
import { DEFAULT_BATTERY, simulateDispatch } from "../src/engine/battery.ts";
import { MONTH_HOURS, MONTH_OF_HOUR, dayOfWeekIndex, monthOfHour } from "../src/engine/calendar.ts";
import {
  DESIGN_TEMPERATURES,
  designElectrical,
  INVERTERS,
  MODULES,
  sizeString,
} from "../src/engine/electrical.ts";
import { buildLoadProfile } from "../src/engine/load.ts";
import {
  polygonAreaM2,
  shrinkPolygon,
  type PanelRow,
  type PolygonM,
} from "../src/engine/packing.ts";
import { plan } from "../src/engine/plan.ts";
import { DEFAULT_PV_LOSSES, simulateArray } from "../src/engine/pv.ts";
import { buildReport } from "../src/engine/report.ts";
import { siteReportPdf } from "../src/web/pdf-report.ts";
import { neighbourObstructions, shadingCurve } from "../src/engine/shading.ts";
import {
  buildSolarYear,
  modelledWeatherYear,
  solarPosition,
  transpose,
} from "../src/engine/solar.ts";
import { inToUPeak, selectTariff, TARIFFS } from "../src/engine/tariff.ts";
import { HOURS_PER_YEAR, newSeries, type SiteProfile } from "../src/engine/types.ts";

const JEBEL_ALI = { lat: 25.0118, lng: 55.0877 };

const emptyEvidence = {
  hasRoofSurvey: false,
  hasStructuralReserve: false,
  hasLandRights: false,
  hasIntervalMeterData: false,
  hasApprovedLoadLetter: false,
};

function makeSite(overrides: Partial<SiteProfile>): SiteProfile {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((JEBEL_ALI.lat * Math.PI) / 180);
  const dLat = 50 / mPerDegLat;
  const dLng = 100 / mPerDegLng;
  return {
    siteName: "Test site",
    emirate: "dubai",
    customerClass: "industrial",
    sector: "warehouse",
    location: JEBEL_ALI,
    annualKwh: 5_000_000,
    approvedLoadKw: 1200,
    roofRings: [
      [
        [JEBEL_ALI.lng - dLng, JEBEL_ALI.lat - dLat],
        [JEBEL_ALI.lng + dLng, JEBEL_ALI.lat - dLat],
        [JEBEL_ALI.lng + dLng, JEBEL_ALI.lat + dLat],
        [JEBEL_ALI.lng - dLng, JEBEL_ALI.lat + dLat],
      ],
    ],
    evidence: { ...emptyEvidence },
    ...overrides,
  };
}

// --- shared calendar -------------------------------------------------------

test("month boundaries land exactly where the calendar says", () => {
  assert.equal(monthOfHour(0), 0);
  assert.equal(monthOfHour(31 * 24 - 1), 0, "hour 743 is still January");
  assert.equal(monthOfHour(31 * 24), 1, "hour 744 opens February");
  assert.equal(monthOfHour(HOURS_PER_YEAR - 1), 11);
  assert.equal(MONTH_HOURS.reduce((a, b) => a + b, 0), HOURS_PER_YEAR);
  for (const hour of [0, 744, 1416, 4344, 8759]) {
    assert.equal(MONTH_OF_HOUR[hour], monthOfHour(hour));
  }
});

test("the reference year starts on a Thursday", () => {
  assert.equal(dayOfWeekIndex(0), 4, "1 January is a Thursday");
  assert.equal(dayOfWeekIndex(24), 5, "2 January is a Friday");
  assert.equal(dayOfWeekIndex(48), 6, "3 January is a Saturday");
  assert.equal(dayOfWeekIndex(72), 0, "4 January is a Sunday");
});

test("the UAE weekend is Saturday and Sunday, with Friday afternoon off", () => {
  // Office is the clearest weekday/weekend contrast in the shape table.
  const load = buildLoadProfile({ sector: "office", annualKwh: 1_000_000 });
  const kw = load.hourlyKw;
  const friday10 = 24 + 10;
  const friday14 = 24 + 14;
  const saturday12 = 48 + 12;
  const monday12 = 96 + 12;
  assert.ok(kw[saturday12] < kw[monday12] * 0.6, "Saturday midday should be well below Monday midday");
  assert.ok(kw[friday14] < kw[friday10] * 0.6, "Friday afternoon should wind down like a weekend");
  assert.ok(kw[friday10] > kw[saturday12] * 1.5, "Friday morning is still a working morning");
});

// --- irradiance sanity ------------------------------------------------------

test("a bright low-sun hour cannot inflate DNI past the extraterrestrial normal", () => {
  // Find a low-sun hour and point a steep collector straight at it: at 13-16
  // degrees of altitude, 500 W/m2 of horizontal irradiance divided by
  // cos(zenith) implies a DNI near 1,800 W/m2 — impossible, so it is capped
  // at the extraterrestrial normal (~1,370). Unclamped, the beam term alone
  // would put over 2,100 W/m2 on this panel.
  const sun = buildSolarYear(JEBEL_ALI).position;
  let hour = -1;
  for (let h = 0; h < HOURS_PER_YEAR; h += 1) {
    if (sun[h].altitudeDeg > 8 && sun[h].altitudeDeg < 16) {
      hour = h;
      break;
    }
  }
  assert.ok(hour > 0, "expected a low-sun daylight hour");
  const dayOfYear = Math.floor(hour / 24) + 1;
  const result = transpose(500, dayOfYear, sun[hour], 60, sun[hour].azimuthDeg);
  assert.ok(Number.isFinite(result.poaWm2));
  assert.ok(
    result.poaWm2 < 2000,
    `a capped DNI cannot drive ${Math.round(result.poaWm2)} W/m2 onto the panel`,
  );
});

// --- electrical design -------------------------------------------------------

test("string sizing flags a working voltage above the MPPT window", () => {
  const temperatures = DESIGN_TEMPERATURES["dubai"];
  const module = MODULES[0];
  // The same inverter with a narrowed tracker window: the string still meets
  // the absolute Voc limit and the hot minimum, but on a cold morning its
  // working point sits above what the tracker will follow.
  const narrow = { ...INVERTERS[1], mpptMaxV: 700 };
  const sizing = sizeString(module, narrow, temperatures);
  assert.ok(sizing.feasible, "the string is still buildable; this is a note, not a refusal");
  assert.ok(sizing.stringVmpColdV > narrow.mpptMaxV);
  assert.ok(
    sizing.notes.some((note) => note.includes("maximum-power point")),
    "expected a note explaining the cold working point exceeds the tracker window",
  );
  const standard = sizeString(module, INVERTERS[1], temperatures);
  assert.ok(!standard.notes.some((note) => note.includes("maximum-power point")));
});

test("a tracker input never parallels strings of different lengths", () => {
  const module = MODULES[0];
  const inverter = INVERTERS[1];
  const temperatures = DESIGN_TEMPERATURES["dubai"];
  const sizing = sizeString(module, inverter, temperatures);
  const n = sizing.modulesPerString;
  const short = sizing.minModulesPerString;
  assert.ok(short < n, "test needs a legal short string");

  // Two rows laid end-to-start so the snaking sequence stays one stretch;
  // the second row leaves a remainder that is just long enough to wire.
  const mw = module.widthM;
  const rows: PanelRow[] = [
    { x: 0, y: 0, w: n * mw, h: 1.134, modules: n },
    { x: -short * mw, y: 3, w: (n + short) * mw, h: 1.134, modules: n + short },
  ];
  const design = designElectrical({
    rows,
    module,
    inverter,
    temperatures,
    plantAt: [0, 0],
  });

  assert.ok(
    design.strings.some((run) => run.modules.length === short),
    "expected the layout to produce a short string",
  );
  const inputs = new Map<string, number>();
  for (const run of design.strings) {
    const key = `${run.inverter}:${run.mppt}`;
    const seen = inputs.get(key);
    if (seen !== undefined) {
      assert.equal(seen, run.modules.length, `input ${key} mixes ${seen} and ${run.modules.length} panels`);
    } else {
      inputs.set(key, run.modules.length);
    }
  }
});

// --- tariff selection --------------------------------------------------------

test("ADDC over-1-MW band follows the contracted load, not the smoothed peak", () => {
  const big = selectTariff({ emirate: "abu-dhabi", customerClass: "industrial", peakDemandKw: 1500 });
  assert.equal(big?.id, "addc-industrial-over-1mw");
  const small = selectTariff({ emirate: "abu-dhabi", customerClass: "industrial", peakDemandKw: 500 });
  assert.equal(small?.id, "addc-industrial-sub-1mw");

  // Same site: modelled peak stays under 1 MW but the contracted load does
  // not. The connection agreement is what ADDC bills against.
  const site = makeSite({ emirate: "abu-dhabi", annualKwh: 2_000_000, approvedLoadKw: 1500 });
  const result = plan(site);
  assert.equal(result.context.tariff?.id, "addc-industrial-over-1mw");
});

test("every emirate prices a kWh, so no plan comes back unavailable for want of a tariff", () => {
  for (const emirate of ["sharjah", "ajman", "fujairah", "ras-al-khaimah", "umm-al-quwain"] as const) {
    const result = plan(makeSite({ emirate }));
    assert.equal(result.planUnavailableReason, undefined, emirate);
    assert.ok(result.context.tariff, `${emirate} must resolve a tariff`);
    assert.ok(result.options.length > 0, `${emirate} must produce options`);
  }
});

test("a battery holds charge back ahead of a TOU peak window", () => {
  const touTariff = TARIFFS.find((tariff) => tariff.timeOfUse !== null);
  assert.ok(touTariff, "expected at least one TOU tariff in the table");

  // A July day: charge on morning surplus, then run a deficit through the
  // three-hour run-up to the 10:00 peak window and through the window itself.
  const dayStart = 200 * 24;
  assert.ok(inToUPeak(touTariff!, dayStart + 12), "test needs a July midday inside the peak window");
  const generation = newSeries();
  const load = newSeries();
  for (let h = 0; h < 7; h += 1) generation[dayStart + h] = 100;
  for (let h = 7; h < 14; h += 1) load[dayStart + h] = 100;

  const battery = { ...DEFAULT_BATTERY, capacityKwh: 200, powerKw: 200 };
  const withTou = simulateDispatch(generation, load, battery, touTariff);
  const withoutTou = simulateDispatch(generation, load, battery, null);

  // Hours 7-9 sit in the lookahead: without a tariff the battery drains into
  // them, with one it keeps half its usable capacity for the peak.
  assert.ok(
    withTou.hourly.batterySoc[dayStart + 9] > withoutTou.hourly.batterySoc[dayStart + 9] + 50,
    `held-back soc was ${withTou.hourly.batterySoc[dayStart + 9]} vs ${withoutTou.hourly.batterySoc[dayStart + 9]}`,
  );
  // The held charge then serves the peak itself.
  assert.ok(
    withTou.hourly.imported[dayStart + 10] < withoutTou.hourly.imported[dayStart + 10],
    "the reserved energy should cut the peak import",
  );
});

// --- geometry ---------------------------------------------------------------

test("shrinkPolygon tolerates repeated vertices and both windings", () => {
  const clean: PolygonM = [
    [0, 0],
    [100, 0],
    [100, 50],
    [0, 50],
  ];
  const withDegenerate: PolygonM = [
    [0, 0],
    [50, 0],
    [50, 0], // a duplicated vertex, common in traced outlines
    [100, 0],
    [100, 50],
    [0, 50],
  ];
  const shrunk = shrinkPolygon(withDegenerate, 2);
  for (const [x, y] of shrunk) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), "shrunk vertex must be finite");
  }
  // Degenerate edges are dropped, but the resulting shape must be the same
  // setback the clean outline produces — the misaligned mitre check used to
  // measure reach against the wrong corner and clip real corners.
  const area = polygonAreaM2(shrunk);
  const cleanArea = polygonAreaM2(shrinkPolygon(clean, 2));
  assert.ok(area > 0 && area < polygonAreaM2(withDegenerate), `shrunk area was ${area}`);
  assert.ok(Math.abs(area - cleanArea) < 1, `degenerate vertex changed the result: ${area} vs ${cleanArea}`);

  const cw: PolygonM = [
    [0, 0],
    [0, 50],
    [100, 50],
    [100, 0],
  ];
  const ccw: PolygonM = [
    [0, 0],
    [100, 0],
    [100, 50],
    [0, 50],
  ];
  const a = polygonAreaM2(shrinkPolygon(cw, 2));
  const b = polygonAreaM2(shrinkPolygon(ccw, 2));
  assert.ok(Math.abs(a - b) < 1, `winding changed the setback: ${a} vs ${b}`);
});

test("neighbour culling uses distance to the edge, not only the vertices", () => {
  const centre: [number, number] = [0, 0];
  // A district-scale footprint whose vertices are all 700 m away but which
  // encloses the roof: vertex-distance culling would drop it entirely.
  const enclosing: PolygonM = [
    [-500, -500],
    [500, -500],
    [500, 500],
    [-500, 500],
  ];
  const { obstructions, considered } = neighbourObstructions(
    [{ ring: enclosing, heightM: 50, label: "podium" }],
    10,
    400,
    centre,
  );
  assert.equal(considered, 1, "the enclosing building must survive the reach filter");
  assert.equal(obstructions.length, 1, "and it stands 40 m proud, so it obstructs");

  const farAway: PolygonM = [
    [600, 600],
    [620, 600],
    [620, 620],
    [600, 620],
  ];
  const res = neighbourObstructions(
    [{ ring: farAway, heightM: 50, label: "far shed" }],
    10,
    400,
    centre,
  );
  assert.equal(res.considered, 0, "a genuinely distant building is still culled");
});

// --- cached solar year --------------------------------------------------------

test("a precomputed solar year gives identical simulation and shading output", () => {
  const weather = modelledWeatherYear(JEBEL_ALI);
  const sun = buildSolarYear(JEBEL_ALI);
  const spec = { kwp: 500, tiltDeg: 10, azimuthDeg: 0, mounting: "roof-flat" as const, dcAcRatio: 1.2 };

  const uncached = simulateArray(JEBEL_ALI, weather, spec, DEFAULT_PV_LOSSES);
  const cached = simulateArray(JEBEL_ALI, weather, spec, DEFAULT_PV_LOSSES, 0, sun);
  assert.deepEqual(cached.hourlyAcKw, uncached.hourlyAcKw);
  assert.equal(cached.annualKwh, uncached.annualKwh);

  const square: PolygonM = [
    [0, 0],
    [80, 0],
    [80, 60],
    [0, 60],
  ];
  const rows: PanelRow[] = [];
  for (let i = 0; i < 5; i += 1) {
    rows.push({ x: 5, y: 5 + i * 8, w: 70, h: 2.3, modules: 40 });
  }
  void square;
  const options = { tiltDeg: 10, azimuthDeg: 0, moduleLengthM: 2.3, moduleWidthM: 1.1, albedo: 0.15 };
  const curveUncached = shadingCurve(rows, JEBEL_ALI, weather, options);
  const curveCached = shadingCurve(rows, JEBEL_ALI, weather, options, undefined, sun);
  assert.deepEqual(curveCached, curveUncached);

  const site = makeSite({});
  const planUncached = plan(site, weather);
  const planCached = plan(site, weather, undefined, undefined, sun);
  assert.equal(planCached.best?.finance.npvAed, planUncached.best?.finance.npvAed);
});

// --- the shared facade --------------------------------------------------------

test("analyzeRoof packs, shades and plans in one pass", () => {
  const roof: PolygonM = [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ];
  const analysis = analyzeRoof({ site: makeSite({}), polygon: roof });
  assert.ok(analysis.packed.south.moduleCount > 0, "the roof should take rows");
  assert.ok(analysis.packed.south.kwp > 0);
  assert.ok(analysis.override.south.shadingCurve.length > 0, "a shading curve ships with the capacity");
  assert.ok(analysis.plan.best, "the plan should contain a buildable option");
  assert.ok(
    analysis.plan.best!.sizing.roofSolarKwp <=
      Math.max(analysis.packed.south.kwp, analysis.packed["east-west"].kwp) + 1e-6,
    "the recommendation cannot exceed what physically packed",
  );
});

test("analyzeRoof folds caller-supplied obstruction loss into the shading curve", () => {
  const roof: PolygonM = [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ];
  const extra = 0.1;
  const analysis = analyzeRoof({
    site: makeSite({}),
    polygon: roof,
    additionalPoaLoss: () => extra,
  });
  const bare = analyzeRoof({ site: makeSite({}), polygon: roof });
  const atFull = (curve: { fill: number; loss: number }[]) =>
    curve.find((point) => point.fill === 1)?.loss ?? 0;
  const combined = atFull(analysis.override.south.shadingCurve);
  const rowOnly = atFull(bare.override.south.shadingCurve);
  assert.ok(combined > rowOnly, "the obstruction loss must lift the curve");
  assert.ok(
    Math.abs(combined - (1 - (1 - rowOnly) * (1 - extra))) < 1e-9,
    "losses combine multiplicatively",
  );
});

// --- the downloadable report --------------------------------------------------

const reportFor = (site: SiteProfile) => {
  const roof: PolygonM = [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ];
  const analysis = analyzeRoof({ site, polygon: roof });
  return buildReport({
    site,
    result: analysis.plan,
    verdict: { status: "good", headline: "Build it", reason: "test" },
    packedKwp: analysis.packed.south.kwp,
    packedModuleCount: analysis.packed.south.moduleCount,
    rowShadingLoss: 0.02,
    obstructionLoss: null,
    designWarnings: [],
    generatedAt: "2026-09-25T00:00:00.000Z",
  });
};

test("a viable site produces a structured report with ordered, beneficial actions", () => {
  const report = reportFor(makeSite({}));
  assert.ok(report.recommendation, "a buildable site must carry a recommendation");
  assert.ok(report.recommendation!.moduleCount > 0);
  assert.ok(report.recommendation!.capexAed > 0);
  assert.ok(report.actions.length >= 3, "evidence, tender and scheme steps at minimum");
  for (const step of report.actions) {
    assert.ok(step.action.length > 10, "every step says what to do");
    assert.ok(step.benefit.length > 10, `step "${step.action}" must say what acting is worth`);
    assert.ok(["low", "medium", "high"].includes(step.effort));
  }
  // Ordered, no gaps.
  report.actions.forEach((step, index) => assert.equal(step.order, index + 1));
  // The site has no meter data, so that evidence step must come first.
  assert.ok(report.actions[0].action.toLowerCase().includes("meter"));
  // And it must survive a round trip as pure data.
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
});

test("a capped site lists raising the connected load as a step with a kWp benefit", () => {
  // 500 kW connected load against a roof that packs ~690 kWp. Under DRRG v4.1
  // the slabs allow 325 kW, so the connection — not the roof — binds.
  const report = reportFor(makeSite({ approvedLoadKw: 500, annualKwh: 3_000_000 }));
  assert.equal(report.recommendation?.bindingConstraint, "tcl-slab");
  const raise = report.actions.find((step) => step.action.includes("connected load"));
  assert.ok(raise, "expected an approved-load step");
  assert.ok((raise!.benefitKwp ?? 0) > 0, "the step must quantify what it unlocks");
});

test("a Sharjah site is priced under SEWA and gets a real recommendation", () => {
  const report = reportFor(makeSite({ emirate: "sharjah" }));
  assert.equal(report.planUnavailableReason, undefined);
  assert.ok(report.recommendation, "SEWA tariff makes the plan buildable");
  assert.ok(report.actions.length > 0);
});

// --- the PDF ------------------------------------------------------------------

const pdfFor = async (site: SiteProfile) => {
  const report = reportFor(site);
  return siteReportPdf({
    report,
    monthlyKwh: new Array(12).fill(1000),
    cashflowCumulativeAed: [-100, -50, 0, 50, 100],
  });
};

test("the PDF is a well-formed document", async () => {
  const bytes = await pdfFor(makeSite({}));
  const text = new TextDecoder("latin1").decode(bytes);
  assert.ok(text.startsWith("%PDF-"), "must open with a PDF header");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "must close cleanly");
  assert.ok(bytes.length > 5000, "an empty PDF is a broken PDF");
  // Two pages of content, at minimum.
  const pageCount = (text.match(/\/Type \/Page[^s]/g) ?? []).length;
  assert.ok(pageCount >= 2, `expected at least 2 pages, found ${pageCount}`);
});

test("the PDF carries the report with distinct, aligned alternative columns", async () => {
  const bytes = await pdfFor(makeSite({}));
  const text = new TextDecoder("latin1").decode(bytes);
  for (const probe of ["What to do next", "Benefit:", "page 2 of", "Test site"]) {
    assert.ok(text.includes(probe), `expected "${probe}" in the PDF`);
  }
  const entries = [...text.matchAll(/([-\d.]+) ([-\d.]+) Td\n\((.*?)\) Tj/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
    label: match[3],
  }));
  const start = entries.findIndex((entry) => entry.label === "SIZE");
  assert.ok(start >= 0, "alternatives table must be present");
  const headers = entries.slice(start, start + 5);
  assert.deepEqual(headers.map((entry) => entry.label), ["SIZE", "BATTERY", "COST TO BUILD", "PAYBACK", "25-YR VALUE"]);
  const table = entries.slice(start, start + 25);
  assert.equal(table.length, 25, "five headers and four rows of five cells");
  table.forEach((entry, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    assert.ok(Math.abs(entry.x - (52 + column * 99.856)) < 0.01, `row ${row}, column ${column} must have its own x position`);
    assert.ok(Math.abs(entry.y - (headers[0].y - row * 16)) < 0.01, `row ${row} cells must share a baseline`);
  });
});

// --- weather source through the facade -----------------------------------------

test("analyzeRoof plans against the measured-climatology year, not the clear-sky model", () => {
  const roof: PolygonM = [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ];
  const analysis = analyzeRoof({ site: makeSite({}), polygon: roof });
  assert.equal(analysis.weather.source, "nasa-power-climatology");
  assert.equal(analysis.plan.context.weather.source, "nasa-power-climatology");
});
