/**
 * Seams between the three merged Mizan versions: the document extractor and
 * custom-site flow (Version A), the Atlas/ERA5 wind model (A) against the
 * NASA POWER resource layer (B), and the one regulatory-cap formula every
 * planner must share.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { extractFields, mergeDocuments } from "../src/engine/extract.ts";
import { recommendMix } from "../src/engine/recommend.ts";
import {
  RULE_SETS,
  SCREEN_THRESHOLDS,
  modelledWind,
  regulatoryCap,
  regulatoryCapFor,
  screenTechnologies,
} from "../src/engine/rules.ts";
import { TURBINES, windYield } from "../src/engine/wind.ts";
import { WIND_SITES, nearestWindSite, siteDistanceKm } from "../src/engine/wind-sites.ts";
import type { SiteProfile } from "../src/engine/types.ts";

const emptyEvidence = {
  hasRoofSurvey: false,
  hasStructuralReserve: false,
  hasLandRights: false,
  hasIntervalMeterData: false,
  hasApprovedLoadLetter: false,
};

const site = (overrides: Partial<SiteProfile>): SiteProfile => ({
  siteName: "Seam test",
  emirate: "sharjah",
  customerClass: "commercial",
  sector: "warehouse",
  location: { lat: 25.3128, lng: 55.4701 },
  annualKwh: 2_000_000,
  approvedLoadKw: 800,
  roofRings: [],
  evidence: { ...emptyEvidence },
  ...overrides,
});

// --- one regulatory cap ----------------------------------------------------

test("the roof planner and the mix recommender read the same connection cap", () => {
  for (const [emirate, approved] of [["dubai", 600], ["dubai", 1200], ["sharjah", 800], ["ajman", 2000], ["abu-dhabi", 900]] as const) {
    const fromSite = regulatoryCap(site({ emirate, approvedLoadKw: approved }));
    const fromFacts = regulatoryCapFor(emirate, approved);
    assert.equal(fromFacts.capKw, fromSite.capKw);
    assert.equal(fromFacts.bindingRule, fromSite.bindingRule);
  }
  assert.equal(regulatoryCapFor("dubai", 600).capKw, 325);
});

test("EtihadWE permits 10% of approved load, and says the figure needs confirming", () => {
  const cap = regulatoryCapFor("ajman", 2000);
  assert.equal(cap.capKw, 200);
  assert.equal(cap.bindingRule, "approved-load");
  assert.match(cap.explanation, /10%/);
  assert.equal(regulatoryCapFor("ajman", 20_000).capKw, 1000, "the 1 MW per-unit ceiling binds first");
  assert.equal(RULE_SETS.ajman.confidence, "partial");
  assert.match(RULE_SETS.ajman.provenance.caveat ?? "", /press|confirm/i);
});

test("recommendMix never offers more solar than the shared cap allows", () => {
  const rec = recommendMix({
    emirate: "ajman",
    lat: 25.4052,
    lng: 55.47,
    annualKwh: 3_000_000,
    solarCapKw: 1500,
    approvedLoadKw: 2000,
    tariffAedPerKwh: 0.38,
    solarMonthlyKwhPerKw: Array(12).fill(140),
    solarCapexAedPerKw: 2800,
    solarOmFraction: 0.012,
    windCapexAedPerKw: 6500,
    windOmFraction: 0.03,
  });
  assert.equal(rec.solarCapKw, 200);
  assert.equal(rec.solarCapNote, regulatoryCapFor("ajman", 2000).explanation);
  const solar = rec.mix.find((m) => m.source === "solar");
  assert.ok(!solar || solar.capacityKw <= 200 + 1e-9);
});

// --- wind: two datasets, one screen ----------------------------------------

test("the Atlas/ERA5 wind model yields a finite monthly series and a screening-grade CF", () => {
  for (const id of ["jebel-ali", "hatta", "khorfakkan", "sila"]) {
    const y = windYield(id, "mid-900");
    assert.equal(y.monthlyKwhPerKw.length, 12);
    assert.ok(y.monthlyKwhPerKw.every((v) => Number.isFinite(v) && v >= 0));
    assert.ok(Math.abs(y.monthlyKwhPerKw.reduce((a, b) => a + b, 0) - y.annualKwhPerKw) < 1e-6);
    assert.ok(y.capacityFactor > 0 && y.capacityFactor < 0.6, `${id}: ${y.capacityFactor}`);
    assert.ok(y.meanAirDensity < 1.225, "Gulf heat lowers density below the ISA reference");
  }
  assert.ok(windYield("hatta", "mid-900").capacityFactor > windYield("business-bay", "mid-900").capacityFactor);
  assert.throws(() => windYield("nowhere", "mid-900"), /No wind climate/);
  assert.ok(TURBINES["small-100"].ratedKw === 100);
});

test("wind screening uses the nearest climate point when one is in reach, else the NASA grid", () => {
  const near = site({ location: { lat: 25.3128, lng: 55.4701 } });
  const modelledNear = modelledWind(near);
  assert.ok(modelledNear);
  assert.match(modelledNear.provenance.label, /Global Wind Atlas/);
  assert.ok(modelledNear.hubSpeedMs !== null && modelledNear.hubSpeedMs > 0);

  const far = { lat: 23.3, lng: 52.3 };
  assert.ok(siteDistanceKm(far, nearestWindSite(far.lat, far.lng)) > SCREEN_THRESHOLDS.windClimatePointReachKm);
  const modelledFar = modelledWind(site({ location: far }));
  assert.ok(modelledFar);
  assert.match(modelledFar.provenance.label, /NASA POWER/);
  assert.equal(modelledFar.hubSpeedMs, null);
});

test("without a mast the wind screen is a labelled model, never 'eligible'", () => {
  const screened = screenTechnologies(site({}), 5000, 0);
  const wind = screened.find((r) => r.id === "wind")!;
  assert.notEqual(wind.status, "eligible");
  assert.equal(wind.provenance.kind, "dataset");
  assert.match(wind.reason, /No site mast data/);
  if (wind.status === "needs-evidence") assert.match(wind.unblockedBy ?? "", /mast or LiDAR/);

  const measured = screenTechnologies(site({ evidence: { ...emptyEvidence, measuredWindMs: 6.5 } }), 5000, 0).find((r) => r.id === "wind")!;
  assert.equal(measured.status, "eligible");
  assert.equal(measured.provenance.kind, "model");
});

test("every configured wind climate point has a fitted climate", () => {
  for (const point of WIND_SITES) {
    assert.doesNotThrow(() => windYield(point.id, "mid-900"), point.id);
  }
});

// --- document extraction ---------------------------------------------------

const BILL = `DEWA Electricity Statement
Account name: Gulf Cold Store LLC
Premises address: Plot 12, Dubai Industrial City, Dubai
Annual consumption: 1,850,400 kWh
Approved load: 950 kW
Roof area: 6,200 m2
Building type: cold storage`;

test("a text bill yields found fields with page provenance", () => {
  const doc = extractFields("bill.txt", [BILL]);
  const byKey = Object.fromEntries(doc.fields.map((f) => [f.key, f]));
  assert.equal(byKey.name.value, "Gulf Cold Store LLC");
  assert.equal(byKey.name.status, "found");
  assert.equal(byKey.emirate.value, "dubai");
  assert.equal(byKey.annualKwh.value, "1850400");
  assert.equal(byKey.approvedLoadKw.value, "950");
  assert.equal(byKey.approvedLoadKw.status, "found");
  assert.equal(byKey.roofAreaM2.value, "6200");
  assert.match(byKey.annualKwh.source, /bill\.txt/);
});

test("unit ambiguity is surfaced for confirmation rather than silently converted", () => {
  const doc = extractFields("survey.txt", ["Connected load: 1.2 MW\nRoof area: 50,000 sq ft\nSharjah"]);
  const byKey = Object.fromEntries(doc.fields.map((f) => [f.key, f]));
  assert.equal(byKey.approvedLoadKw.value, "1200");
  assert.equal(byKey.approvedLoadKw.status, "needs-confirmation");
  assert.equal(byKey.roofAreaM2.value, String(Math.round(50_000 / 10.7639)));
  assert.equal(byKey.roofAreaM2.status, "needs-confirmation");
  assert.equal(byKey.emirate.value, "sharjah");
});

test("an empty or irrelevant document reports not-found, never a guess", () => {
  const doc = extractFields("blank.txt", [""]);
  assert.ok(doc.fields.every((f) => f.status === "not-found"));
  assert.ok(doc.fields.every((f) => f.value === ""));
});

test("conflicting values across documents are kept visible as a conflict", () => {
  const a = extractFields("jan.txt", ["Annual consumption: 1,000,000 kWh\nDubai"]);
  const b = extractFields("feb.txt", ["Annual consumption: 1,200,000 kWh\nDubai"]);
  const merged = mergeDocuments([a, b]);
  const annual = merged.find((f) => f.key === "annualKwh")!;
  assert.equal(annual.status, "needs-confirmation");
  assert.equal(annual.alternatives.length, 1);
  assert.match(annual.note ?? "", /Conflict/);
  const emirate = merged.find((f) => f.key === "emirate")!;
  assert.equal(emirate.status, "found");
  assert.equal(emirate.alternatives.length, 0);
});

const MONTHS = "Jan 100 kWh Feb 100 kWh Mar 100 kWh Apr 100 kWh May 100 kWh Jun 100 kWh Jul 100 kWh Aug 100 kWh Sep 100 kWh Oct 100 kWh Nov 100 kWh Dec 100 kWh";

test("annual figure that disagrees with the twelve monthly figures is flagged for confirmation", () => {
  const doc = extractFields("bill.txt", [`Annual consumption: 1,500 kWh\nMonthly consumption (kWh): ${MONTHS}\nDubai`]);
  const byKey = Object.fromEntries(doc.fields.map((f) => [f.key, f]));
  assert.equal(byKey.annualKwh.status, "needs-confirmation");
  assert.match(byKey.annualKwh.note ?? "", /sum to 1,200 kWh, not 1,500 kWh/);
  assert.equal(byKey.monthlyKwh.status, "needs-confirmation");

  const consistent = extractFields("bill.txt", [`Annual consumption: 1,200 kWh\nMonthly consumption (kWh): ${MONTHS}\nDubai`]);
  const ok = Object.fromEntries(consistent.fields.map((f) => [f.key, f]));
  assert.equal(ok.annualKwh.status, "found");
  assert.equal(ok.monthlyKwh.status, "found");
});

test("the shipped demo statement is internally consistent", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync("scripts/gen-demo-doc.mjs", "utf8"));
  const annual = Number(src.match(/Annual electricity consumption: ([\d,]+) kWh/)![1].replace(/,/g, ""));
  const monthly = [...src.matchAll(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([\d,]+) kWh/g)].map((m) => Number(m[1].replace(/,/g, "")));
  assert.equal(monthly.length, 12);
  assert.equal(monthly.reduce((a, b) => a + b, 0), annual);
});
