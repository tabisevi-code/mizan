// @ts-expect-error Node.js type definitions are not included in this project.
import assert from "node:assert/strict";
// @ts-expect-error Node.js type definitions are not included in this project.
import test from "node:test";
import { analyzeRenewableCombination, analyzeComplementarity, calculateFinancial, compareScenarios, hydroMonthlyYield, type RenewableSystem } from "../src/engine/renewable-combinations.ts";
import { MONTH_HOURS, getMonthlyProfile, solarMonthlyYield } from "../src/data/uae-monthly-profiles.ts";
import { UAE_RENEWABLE_CASES, systemsForCase } from "../src/data/portfolios-uae-multi.ts";
import { simulateArray, DEFAULT_ROOF_TILT_DEG } from "../src/engine/pv.ts";
import { modelledWeatherYear } from "../src/engine/solar.ts";

const sum = (a: number[]) => a.reduce((a, b) => a + b, 0);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const system = (source: RenewableSystem["source"], capacityKw = 100): RenewableSystem => ({
  source, capacityKw, monthlyKwhPerKw: MONTH_HOURS.map(h => h * 0.2), capexAedPerKw: 3000, annualOmFraction: 0.02,
});

test("monthly solar conserves existing temperature/loss-adjusted PV output and varies by location", () => {
  const location = { lat: 24.11, lng: 52.73 };
  const monthly = solarMonthlyYield(location);
  const pv = simulateArray(location, modelledWeatherYear(location), { kwp: 1, tiltDeg: DEFAULT_ROOF_TILT_DEG, azimuthDeg: 0, mounting: "roof-flat", dcAcRatio: 1.2 });
  near(sum(monthly), pv.annualKwh);
  assert.notDeepEqual(monthly, solarMonthlyYield({ lat: 25.41, lng: 55.44 }));
  monthly[0] = -1;
  assert.ok(solarMonthlyYield(location)[0] > 0, "cached data is immutable to callers");
});

test("combined systems share a single load and cannot double count bill savings", () => {
  const r = analyzeRenewableCombination("Excess", [system("solar"), system("wind")], 12000, { tariffAedPerKwh: 0.4 });
  near(r.financial.grossSavingsAed, 4800);
  near(sum(r.bySource.map(s => s.financial.grossSavingsAed)), 4800);
  near(r.annualResults.loadCoveragePercent!, 100);
  assert.ok(r.annualResults.generationToLoadPercent! > 100);
  near(r.annualResults.surplusKwh, r.annualResults.totalMwh * 1000 - 12000);
  near(r.financial.netSavingsAed, r.financial.grossSavingsAed - r.financial.annualOmAed);
  assert.equal(r.financial.paybackYears, null, "negative net cashflow does not pay back");
});

test("monthly load matching respects seasonal mismatch even if annual totals match", () => {
  const solar = { ...system("solar", 1), monthlyKwhPerKw: [100, ...Array(11).fill(0)] };
  const load = [0, 100, ...Array(10).fill(0)];
  const r = analyzeRenewableCombination("Seasonal", [solar], 100, { monthlyLoadKwh: load });
  assert.equal(r.financial.grossSavingsAed, 0);
  assert.equal(r.annualResults.generationToLoadPercent, 100);
  assert.equal(r.annualResults.loadCoveragePercent, 0);
});

test("physical hydro uses head, flow, efficiency, month length and turbine cap", () => {
  const flows = [0.1, 100, ...Array(10).fill(0)];
  const yields = hydroMonthlyYield(10, 12, flows, 0.65);
  near(yields[0] * 10, 9.81 * 0.1 * 12 * 0.65 * 744);
  near(yields[1], 672);
  assert.equal(sum(yields.slice(2)), 0);
  assert.deepEqual(hydroMonthlyYield(0, 12, flows), Array(12).fill(0));
});

test("empty systems, zero load and unprofitable systems have finite honest outputs", () => {
  const empty = analyzeRenewableCombination("None", [], 0);
  assert.equal(empty.financial.paybackYears, null);
  assert.equal(empty.annualResults.loadCoveragePercent, null);
  assert.equal(empty.complementarity.stabilityScore, null);
  assert.equal(empty.annualResults.totalMwh, 0);
  const zero = analyzeRenewableCombination("No load", [system("wind")], 0);
  assert.equal(zero.financial.grossSavingsAed, 0);
  assert.equal(calculateFinancial(100, 0, 5).paybackYears, null);
  near(calculateFinancial(100, 25, 5).paybackYears!, 5);
});

test("flat wind assumptions cannot fabricate a seasonal peak offset", () => {
  const r = analyzeComplementarity([MONTH_HOURS.map(h => h * 0.2)]);
  assert.equal(r.stabilityScore, 100);
  assert.equal(r.peakOffsetMonths, null);
  const complementary = analyzeComplementarity([
    MONTH_HOURS.map((h, m) => h * (m < 6 ? 1 : 0)),
    MONTH_HOURS.map((h, m) => h * (m >= 6 ? 1 : 0)),
  ]);
  assert.equal(complementary.stabilityScore, 100);
  assert.equal(complementary.peakOffsetMonths, 6);
});

test("reducing a hydro turbine rating preserves flow-limited output until the rating binds", () => {
  const site = UAE_RENEWABLE_CASES.find(s => s.id === "wadi-ham")!;
  const energy = (kw: number) => {
    const s = systemsForCase(site, { hydro: kw }).find(s => s.source === "hydro")!;
    return sum(s.monthlyKwhPerKw) * s.capacityKw;
  };
  near(energy(10), energy(5));
  assert.ok(energy(1) < energy(5));
  assert.equal(energy(0), 0);
});

test("rejects invalid input instead of silently using another UAE location", () => {
  assert.throws(() => getMonthlyProfile("wind", "unknown"));
  near(sum(getMonthlyProfile("wind", "ruwais")), 1);
  for (const bad of [-1, NaN, Infinity]) {
    assert.throws(() => analyzeRenewableCombination("Bad", [system("wind", bad)], 100));
    assert.throws(() => analyzeRenewableCombination("Bad", [], bad));
  }
  assert.throws(() => analyzeRenewableCombination("Bad", [{ ...system("wind"), monthlyKwhPerKw: [1] }], 100));
  assert.throws(() => analyzeRenewableCombination("Bad", [{ ...system("wind"), monthlyKwhPerKw: Array(12).fill(900) }], 100));
  assert.throws(() => analyzeRenewableCombination("Bad", [system("wind"), system("wind")], 100));
  assert.throws(() => analyzeRenewableCombination("Bad", [], 100, { monthlyLoadKwh: Array(12).fill(1) }));
  assert.throws(() => hydroMonthlyYield(10, 10, Array(12).fill(1), 1.1));
});

test("all UAE examples conserve energy; comparisons use independent scenarios", () => {
  assert.equal(new Set(UAE_RENEWABLE_CASES.map(s => s.id)).size, 15);
  for (const site of UAE_RENEWABLE_CASES) {
    const systems = systemsForCase(site);
    const r = analyzeRenewableCombination(site.name, systems, site.annualKwh);
    near(sum(r.monthlyGenerationKwh), sum(r.bySource.map(s => s.annualKwh)));
    assert.ok(r.annualResults.loadCoveragePercent! <= 100 + 1e-8);
    assert.ok(r.bySource.every(s => Number.isFinite(s.annualKwh)));
    const comparisons = compareScenarios(systems.map(s => ({ name: s.source, systems: [s] })), site.annualKwh);
    assert.equal(comparisons.length, systems.length);
  }
  assert.deepEqual(systemsForCase(UAE_RENEWABLE_CASES.find(s => s.id === "delma")!).map(s => s.source), ["wind"]);
});
