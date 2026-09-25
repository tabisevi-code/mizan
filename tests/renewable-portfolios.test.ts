// @ts-expect-error Node type declarations are not available in this project.
import assert from "node:assert/strict";
// @ts-expect-error Node type declarations are not available in this project.
import test from "node:test";
import { RENEWABLE_PORTFOLIOS } from "../src/data/renewable-portfolios.ts";
import { PORTFOLIOS } from "../src/data/portfolios.ts";
import { systemsForCase } from "../src/data/portfolios-uae-multi.ts";
import { analyzeRenewableCombination } from "../src/engine/renewable-combinations.ts";
import { windYield } from "../src/engine/wind.ts";

test("all four supplied portfolios have unique reachable sites and complete resource inputs", () => {
  assert.deepEqual(RENEWABLE_PORTFOLIOS.filter(p => !["mapped-energy", "published-warehouses"].includes(p.id)).map(p => p.id), ["solar-only", "solar-wind", "wind-only", "solar-microhydro"]);
  assert.deepEqual(RENEWABLE_PORTFOLIOS.filter(p => !["mapped-energy", "published-warehouses"].includes(p.id)).map(p => p.sites.length), [3, 6, 1, 2]);
  const ids = [...PORTFOLIOS.flatMap(p => p.sites), ...RENEWABLE_PORTFOLIOS.flatMap(p => p.sites)].map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const portfolio of RENEWABLE_PORTFOLIOS) for (const site of portfolio.sites) {
    assert.ok(site.location.lat > 22 && site.location.lat < 27);
    assert.ok(site.location.lng > 51 && site.location.lng < 57);
    if (site.approvedLoadKw !== null) assert.ok(site.solarKw <= site.approvedLoadKw);
    if (site.publishedEnergy) continue;
    const systems = systemsForCase(site);
    assert.deepEqual(new Set(systems.map(s => s.source)), new Set(site.defaultSources));
    const result = analyzeRenewableCombination(site.name, systems, site.annualKwh);
    assert.ok(result.annualResults.totalMwh > 0);
    assert.ok(Number.isFinite(result.financial.netSavingsAed));
    assert.ok(result.annualResults.loadCoveragePercent! <= 100 + 1e-8);
  }
});

test("wind-only starts with wind and uses the modelled site climate", () => {
  const site = RENEWABLE_PORTFOLIOS.find(p => p.id === "wind-only")!.sites[0];
  assert.deepEqual(site.defaultSources, ["wind"]);
  assert.equal(site.solarKw, 0);
  const r = analyzeRenewableCombination(site.name, systemsForCase(site), site.annualKwh);
  assert.equal(r.bySource.length, 1);
  const expected = site.windKw! * windYield(site.windProfile!, site.windTurbine ?? "mid-900").annualKwhPerKw / 1000;
  assert.ok(Math.abs(r.annualResults.totalMwh - expected) < 1e-8);
  // A ridgeline scenario should model well above the flat 20% placeholder CF it replaced.
  assert.ok(windYield(site.windProfile!, site.windTurbine ?? "mid-900").capacityFactor > 0.22);
});

test("seasonal portfolios generate through the water model and use distinct state IDs", () => {
  const sites = RENEWABLE_PORTFOLIOS.find(p => p.id === "solar-microhydro")!.sites;
  assert.notEqual(sites[0].id, sites[1].id);
  for (const site of sites) {
    const hydro = systemsForCase(site).find(s => s.source === "hydro")!;
    assert.ok(hydro.monthlyKwhPerKw[0] > 0);
    assert.equal(hydro.monthlyKwhPerKw[6], 0);
  }
});


test("published warehouse scenarios clear unchanged hurdle with explicit evidence and remain sensitive to costs", () => {
  const p = RENEWABLE_PORTFOLIOS.find(p => p.id === "published-warehouses")!;
  assert.equal(p.id, "published-warehouses");
  assert.equal(p.hurdleYears, 5);
  for (const site of p.sites) {
    assert.ok(site.evidence!.length >= 6);
    assert.equal(site.approvedLoadKw, null);
    const systems = systemsForCase(site);
    const options = { tariffAedPerKwh: site.defaultTariff };
    const r = analyzeRenewableCombination(site.name, systems, site.annualKwh, options);
    assert.ok(r.financial.paybackYears! < p.hurdleYears);
    const expensive = analyzeRenewableCombination(site.name, systems.map(s => ({ ...s, capexAedPerKw: 5000 })), site.annualKwh, options);
    assert.ok(expensive.financial.paybackYears! > p.hurdleYears);
    const noLoad = analyzeRenewableCombination(site.name, systems, 0, options);
    assert.equal(noLoad.financial.paybackYears, null);
  }
  const aramex = p.sites[0];
  const r = analyzeRenewableCombination(aramex.name, systemsForCase(aramex), aramex.annualKwh);
  assert.ok(Math.abs(r.annualResults.totalMwh - 5000) < 1e-8);
  const half = analyzeRenewableCombination(aramex.name, systemsForCase(aramex, { solar: 1600 }), aramex.annualKwh);
  assert.ok(Math.abs(half.annualResults.totalMwh - 2500) < 1e-8);
});
