/**
 * Mizan — the app.
 *
 * Three columns, and the order is the argument. On the left, a portfolio of
 * real buildings with a verdict against each. In the middle, the building
 * itself under satellite imagery with the array drawn on it. On the right, the
 * answer, and under every number the chain that produced it.
 *
 * It opens on a portfolio that is already there. Nobody arriving at this for
 * the first time has an electricity account or a roof survey to hand, and a
 * tool that shows nothing until they do is a tool nobody sees working.
 */

import { metresToLngLat, plantPositions, type PackResult, type PolygonM } from "../engine/packing";
import { SECTOR_LABELS } from "../engine/load";
import { analyzeRoof } from "../engine/analyze";
import { type PlanResult } from "../engine/plan";
import { buildReport } from "../engine/report";
import { siteReportPdf } from "./pdf-report";
import { RULE_SETS, labelEmirate } from "../engine/rules";
import { DEFAULT_PACK } from "../engine/packing";
import { DEFAULT_USABLE_AREA } from "../engine/capacity";
import { DEFAULT_ROOF_TILT_DEG, ENGINE_VALIDATION, DEFAULT_PV_LOSSES, meanSoilingLoss, simulateArray } from "../engine/pv";
import { CLEARNESS_FIT, type WeatherYear } from "../engine/solar";
import {
  buildSkyEnergy,
  neighbourObstructions,
  obstructionShading,
  rowShading,
  thinRows,
  type ObstructionShading,
  type ShadingResult,
} from "../engine/shading";
import { DESIGN_TEMPERATURES, MODULES, chooseInverter, designElectrical, type ElectricalDesign } from "../engine/electrical";
import type { SiteProfile } from "../engine/types";
import { drawMap, sceneBuildings, shadingScale, type MapView, type Scene, type SceneBuilding } from "./map";
import { basemapCredit, tileLayer, type Basemap } from "./tiles";
import { PORTFOLIOS, GLOSSARY, type Portfolio, type PortfolioSite } from "../data/portfolios";
import jafza from "../data/osm-jafza.json";
import dic from "../data/osm-dic.json";
import businessBay from "../data/osm-business-bay.json";
import { openRenewableExamples, renderRenewables } from "./renewables";
import { openCustomSiteFlow } from "./custom-site";
import { solarMonthlyYield } from "../data/uae-monthly-profiles";
import { RENEWABLE_PORTFOLIOS, type RenewablePortfolio } from "../data/renewable-portfolios";
import { renderRenewableWorkspace } from "./renewable-workspace";
import { computeSite, latLngOfSite, type Outcome } from "./site-compute";
import { assumptionRegister, registerSummary } from "../engine/register";
import EngineWorker from "./engine.worker.ts?worker&inline";

// --- formatting -------------------------------------------------------------

import { aed, esc, kwh, num, pct } from "./format";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// --- scenes -----------------------------------------------------------------

const SCENES: Record<string, Scene> = {
  jafza: { ...(jafza as unknown as Scene), label: "Jebel Ali Free Zone", area: "Jebel Ali Free Zone, Dubai" },
  dic: { ...(dic as unknown as Scene), label: "Dubai Industrial City", area: "Dubai Industrial City" },
  "business-bay": { ...(businessBay as unknown as Scene), label: "Business Bay", area: "Business Bay, Dubai" },
};
const sceneCache = new Map<string, SceneBuilding[]>();
const buildingsFor = (id: string): SceneBuilding[] => {
  if (!sceneCache.has(id)) sceneCache.set(id, sceneBuildings(SCENES[id]));
  return sceneCache.get(id)!;
};

const latLngOf = (site: PortfolioSite) =>
  latLngOfSite(site, buildingsFor(site.sceneId), SCENES[site.sceneId].o);

// --- running one site -------------------------------------------------------

const outcomes = new Map<string, Outcome>();

/** A site whose computation threw, shown as a stop rather than left pending. */
type Failure = Pick<Outcome, "status" | "headline" | "reason">;

const failures = new Map<string, Failure>();

const failureFor = (error: unknown): Failure => ({
  status: "stop",
  headline: "Could not be worked out",
  reason: `The screening for this site failed: ${error instanceof Error ? error.message : String(error)}`,
});

/**
 * Site work runs in a worker when the browser supports one, so packing a
 * portfolio does not freeze the map. `?worker&inline` keeps the single-file
 * page build self-contained; where a worker cannot start, the same code runs
 * on the main thread one site at a time.
 */
let engineWorker: Worker | null = null;
try {
  engineWorker = new EngineWorker();
} catch {
  engineWorker = null;
}

const inflight = new Set<string>();

if (engineWorker) {
  engineWorker.onmessage = (
    event: MessageEvent<{
      portfolioId: string;
      siteId: string;
      outcome?: Outcome;
      error?: string;
    }>,
  ) => {
    const { portfolioId, siteId, outcome, error } = event.data;
    inflight.delete(siteId);
    if (portfolioId !== portfolio.id || renewablePortfolio) return;
    if (error) {
      console.error("site failed", siteId, error);
      failures.set(siteId, failureFor(error));
    } else if (outcome) {
      outcomes.set(siteId, outcome);
      failures.delete(siteId);
    }
    if (siteId === activeSiteId) render();
    else renderRail();
  };
}

/** Compute one site synchronously on the main thread — the no-worker path. */
const runSite = (site: PortfolioSite): Outcome => {
  const cached = outcomes.get(site.id);
  if (cached) return cached;
  const hurdleYears =
    PORTFOLIOS.find((p) => p.sites.some((x) => x.id === site.id))?.hurdleYears ??
    portfolio.hurdleYears;
  const outcome = computeSite(site, buildingsFor(site.sceneId), SCENES[site.sceneId].o, hurdleYears);
  outcomes.set(site.id, outcome);
  return outcome;
};


// --- state ------------------------------------------------------------------

let portfolio: Portfolio = PORTFOLIOS[0];
let activeSiteId = portfolio.sites[0].id;
let view: MapView = "roof";
let basemap: Basemap = "satellite";
let renewablePortfolio: RenewablePortfolio | null = null;
let renewableSiteId = "";

const activeSite = (): PortfolioSite =>
  portfolio.sites.find((s) => s.id === activeSiteId) ?? portfolio.sites[0];

// --- the rail ---------------------------------------------------------------

const renderRail = () => {
  if (renewablePortfolio) return;
  byId("portfolio-question").innerHTML =
    `“${esc(portfolio.question)}”<br><span style="color:var(--faint)">Approves anything paying back inside ${portfolio.hurdleYears} years.</span>`;
  const list = byId("site-list");
  list.innerHTML = portfolio.sites
    .map((site) => {
      const done = outcomes.get(site.id) ?? failures.get(site.id);
      const cls = done ? `is-${done.status}` : "";
      const line = done
        ? `<div class="site-result ${done.status === "good" ? "" : `is-${done.status}`}">${esc(done.headline)}</div>`
        : `<div class="site-pending">working it out…</div>`;
      return `<li><button type="button" class="site" data-site="${site.id}" aria-current="${site.id === activeSiteId}">
        <span class="dot ${cls}"></span>
        <span>
          <span class="site-name">${esc(site.name)}</span>
          <div class="site-where">${esc(site.where)}</div>
          ${line}
        </span>
      </button></li>`;
    })
    .join("");
  for (const button of list.querySelectorAll<HTMLButtonElement>("[data-site]")) {
    button.addEventListener("click", () => {
      activeSiteId = button.dataset.site!;
      render();
    });
  }

  const tally = { good: 0, warn: 0, stop: 0 };
  for (const site of portfolio.sites) {
    const done = outcomes.get(site.id) ?? failures.get(site.id);
    if (done) tally[done.status] += 1;
  }
  byId("tally-good").textContent = String(tally.good);
  byId("tally-warn").textContent = String(tally.warn);
  byId("tally-stop").textContent = String(tally.stop);
};

// --- the map ----------------------------------------------------------------

const drawStage = (site: PortfolioSite, outcome: Outcome | undefined) => {
  const scene = SCENES[site.sceneId];
  byId("stage-title").textContent = site.name;
  byId("stage-where").textContent = `${site.where} · ${site.note}`;

  const buildings = buildingsFor(site.sceneId);
  const best = outcome?.result.best;
  const fillShare = outcome && outcome.packed.kwp > 0 ? (best?.sizing.roofSolarKwp ?? 0) / outcome.packed.kwp : 0;

  const box = drawMap(byId("map"), {
    scene,
    buildings,
    selected: site.buildingIndex,
    view,
    latitude: scene.o[1],
    layout: best?.sizing.layout ?? "south",
    fillShare,
    batteryKwh: best?.battery?.capacityKwh ?? 0,
    design: outcome?.design ?? null,
    shading: outcome?.shading ?? null,
    blocked: outcome?.blocked ?? null,
    roofHeightM: site.roofHeightM ?? buildings[site.buildingIndex].heightM,
    onSelect: () => {},
  });
  byId("map").prepend(tileLayer({ x: box.x, y: box.y, w: box.w, h: box.h, origin: scene.o }, basemap));
  byId("map-attribution").textContent = basemapCredit(basemap);

  const wiring = view === "wiring" && outcome?.design;
  const shaded = view === "shading" && outcome?.shading;
  byId("legend-roof").hidden = Boolean(wiring || shaded);
  byId("legend-wiring").hidden = !wiring;
  byId("legend-shading").hidden = !shaded;

  if (shaded) {
    const scale = shadingScale();
    byId("shade-worst").textContent = `worst panel loses ${pct(scale.worst)}`;
    byId("shade-scale-note").textContent =
      scale.worst < 0.02 ? "The scale runs to the worst panel here, and here that is barely anything." : "";
  }

  const captions: Record<string, string> = {
    area: `${scene.area}. Every outline is a building mapped in OpenStreetMap; this site is the one picked out.`,
    roof: outcome
      ? `${num.format(outcome.packed.moduleCount)} panels fit inside this outline after a 1.5 m edge setback and a 30% allowance for plant, skylights and walkways. ${num.format(Math.round(fillShare * outcome.packed.moduleCount))} are drawn. ${outcome.result.best?.bindingExplanation ?? ""}`
      : failures.has(site.id) ? "This site could not be worked out." : "Laying out the array…",
    wiring: outcome?.design
      ? `Each coloured line is one string of ${outcome.design.sizing.modulesPerString} panels wired in series, taking every other panel out along the row and picking up the rest on the way back, so both ends finish together. Dashed lines are the cable back to the inverters.`
      : "No array to wire here.",
    shading: outcome?.blocked && outcome.blocked.taller > 0
      ? "Panels coloured by how much of the year's direct sunlight they lose. Blue buildings stand above this roof — darker means higher — and the orange is the shadow they throw."
      : "Panels coloured by how much of the year's sunlight they lose to the row in front. Pale rows have a double gap ahead of them and catch almost nothing.",
  };
  byId("map-caption").textContent = captions[view] ?? "";

  for (const button of byId("views").querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  byId("base-sat").setAttribute("aria-pressed", String(basemap === "satellite"));
  byId("base-map").setAttribute("aria-pressed", String(basemap === "streets"));
};

// --- the answer -------------------------------------------------------------

const step = (label: string, value: string, cls = "") =>
  `<li class="step ${cls}"><span>${label}</span><b>${value}</b></li>`;
const note = (text: string) => `<li class="step-note">${text}</li>`;

const working = (site: PortfolioSite, outcome: Outcome): string => {
  const { result, packed } = outcome;
  const best = result.best;
  const context = result.context;
  if (!best) return "";

  const layout = best.sizing.layout;
  const installed = best.sizing.roofSolarKwp;
  const modules = Math.round((installed * 1000) / DEFAULT_PACK.moduleWatts);
  const yieldPerKw = context.specificYield[layout];
  const capBinds = context.cap.capKw < packed.kwp - 1;

  // A one-kWp run purely to show the loss stack with real percentages.
  const unit = simulateArray(
    context.site.location,
    context.weather,
    { kwp: 1, tiltDeg: DEFAULT_ROOF_TILT_DEG, azimuthDeg: 0, mounting: "roof-flat", dcAcRatio: 1.2 },
  );
  const soiling = meanSoilingLoss(DEFAULT_PV_LOSSES);
  const heat = unit.lossBreakdown.find((l) => l.label.startsWith("Heat"))?.fraction ?? 0;
  const systemLossLabels = ["DC wiring and mismatch", "Inverter conversion", "Availability", "Nameplate, part-load and mismatch"];
  const systemLoss =
    1 -
    unit.lossBreakdown
      .filter((l) => systemLossLabels.includes(l.label))
      .reduce((kept, l) => kept * (1 - l.fraction), 1);
  const roofAllowance = DEFAULT_USABLE_AREA.roofObstructionAllowance;

  const size = [
    step("Roof outline, from OpenStreetMap", `${num.format(context.roofAreaM2)} m²`),
    step("Less a 1.5 m setback at every edge", `${num.format(packed.netAreaM2)} m²`),
    note("Kept clear for access and wind uplift, measured in from each edge rather than shrunk towards the middle."),
    step(`Less ${pct(roofAllowance, 0)} for plant, skylights, walkways`, `${num.format(Math.round(packed.netAreaM2 * (1 - roofAllowance)))} m²`),
    step(`Panels that fit, laid ${layout === "east-west" ? "east–west" : "facing south"}`, `${num.format(packed.moduleCount)}`),
    note(`1.134 × 2.278 m panels at ${DEFAULT_ROOF_TILT_DEG}° tilt, rows spaced to clear each other's shadow at midday in December.`),
    step("The roof could hold", `${num.format(packed.kwp)} kW`),
    capBinds
      ? step(context.cap.bindingRule === "approved-load" ? "Approved Load caps it at" : "Scheme cap", `${num.format(context.cap.capKw)} kW`, "is-cap")
      : "",
    step("Installed", `${num.format(installed)} kW · ${num.format(modules)} panels`, "is-total"),
  ].join("");

  const output = [
    step("Sunlight on the ground here", `${num.format(Math.round(unit.annualKwh / (1 - 0) / 1))} —`),
    step("Panel yield, after every loss below", `${num.format(yieldPerKw)} kWh per kW`),
    note("Losses applied hour by hour, not as one lump:"),
    step("Dust between cleans", `−${pct(soiling)}`),
    note("Gulf dust on a 21-day cleaning cycle, which is why this is not the token 2% used elsewhere."),
    step("Heat and weak light on the panels", `−${pct(heat)}`),
    note("Huld (2011) efficiency, with roof-mounted cooling and wind reduced to what reaches a panel rather than what a met mast at ten metres sees."),
    step("Shadow of the row in front", `−${pct(outcome.shading?.electricalArrayLoss ?? 0, 2)}`),
    outcome.blocked && outcome.blocked.taller > 0
      ? step("Shadow of the buildings around it", `−${pct(outcome.blocked.arrayLossOfPoa)}`, "is-cap")
      : "",
    step("Inverter, wiring, availability, mismatch", `−${pct(systemLoss)}`),
    step("Generated in year one", kwh(best.simulation.generationKwh), "is-total"),
  ].join("");

  const tariff = context.tariff;
  const money = [
    step("Used on site as it is generated", kwh(best.simulation.selfConsumedKwh)),
    note("Matched hour against hour to this sector's load shape, not assumed as a flat share."),
    step("Exported to the grid", kwh(best.simulation.exportedKwh)),
    note("Under Shams Dubai exported units are credited against later bills and never paid out in cash, so they are worth the tariff only if the site uses them back."),
    tariff
      ? step(
          `${tariff.utility} ${tariff.customerClass} tariff, all in`,
          `AED ${(context.baselineBillAed / Math.max(1, context.site.annualKwh)).toFixed(3)}/kWh`,
        )
      : "",
    step("Bill before solar", aed(context.baselineBillAed)),
    step("Saved in year one", aed(best.finance.firstYearSavingsAed), "is-total"),
  ].join("");

  const payback = best.finance.simplePaybackYears;
  const cash = [
    ...best.capex.lines.map((line) => step(line.label, aed(line.aed))),
    step("Total to build", aed(best.capex.totalAed), "is-total"),
    step("Cost per kW installed", `AED ${num.format(Math.round(best.capex.totalAed / installed))}`),
    step("Pays back in", payback === null ? "never" : `${payback.toFixed(1)} years`, "is-total"),
    step("Return over 25 years", best.finance.irr === null ? "—" : `${pct(best.finance.irr, 1)} IRR`),
    step("Cost of the power it makes", `AED ${best.finance.lcoeAedPerKwh.toFixed(3)}/kWh`),
    note("Against a tariff that is already higher than that, which is the whole reason this pays."),
  ].join("");

  const section = (title: string, sub: string, body: string, open = false) =>
    `<details class="work"${open ? " open" : ""}>
      <summary><b>${title}</b> <span style="color:var(--faint)">${sub}</span></summary>
      <ul class="steps">${body}</ul>
    </details>`;

  return [
    section("System size", "roof → panels → cap", size, true),
    section("Annual output", "sunlight → losses → kWh", output),
    section("What it saves", "kWh → tariff → dirhams", money),
    section("Cost and payback", "capex → years", cash),
  ].join("");
};

const inputRow = (label: string, value: string, source: string, chip: string, termKey?: string) => `
  <div class="fact-row">
    <div>
      <div class="fact-label">${termKey ? `<button type="button" data-term="${termKey}">${label}</button>` : label}</div>
      <div class="fact-src"><span class="chip ${chip}">${source}</span></div>
    </div>
    <div class="fact-value">${value}</div>
  </div>`;

const renderPanel = (site: PortfolioSite, outcome: Outcome | undefined) => {
  if (!outcome) {
    const failed = failures.get(site.id);
    byId("renewable-site").innerHTML = "";
    byId("verdict").innerHTML = failed
      ? `<div class="verdict">
          <span class="dot is-${failed.status}"></span>
          <div class="verdict-text">
            <b>${esc(failed.headline)}</b>
            <p>${esc(failed.reason)}</p>
          </div>
        </div>`
      : `<p class="note">Running the numbers for this site…</p>`;
    byId("kpis").innerHTML = "";
    byId("working").innerHTML = "";
    byId("inputs").innerHTML = "";
    byId("register").innerHTML = "";
    byId("register-summary").textContent = "";
    byId("trust").innerHTML = "";
    byId("report-block").hidden = true;
    return;
  }
  const { result } = outcome;
  const best = result.best;
  const context = result.context;

  const monthlySolar = solarMonthlyYield(context.site.location);
  const modelYield = monthlySolar.reduce((a, b) => a + b, 0);
  const installedSolar = best?.sizing.roofSolarKwp ?? 0;
  const siteYield = installedSolar > 0 && best ? best.simulation.generationKwh / installedSolar : 0;
  renderRenewables(byId("renewable-site"), {
    id: site.id, name: site.name, where: site.where, emirate: site.emirate, location: context.site.location,
    annualKwh: site.annualKwh, approvedLoadKw: site.approvedLoadKw, category: "Portfolio screening", solarKw: installedSolar,
    solarMonthly: monthlySolar.map(v => modelYield > 0 ? v * siteYield / modelYield : 0),
    windKw: site.sceneId === "jafza" ? 100 : undefined,
    windProfile: site.sceneId === "jafza" ? "jebel-ali" : undefined,
    defaultSources: installedSolar > 0 ? ["solar"] : [],
    description: "Solar capacity follows this roof’s screening result; monthly solar output is scaled to its annual shading-adjusted yield. The optional Jebel Ali wind case is a hypothetical 100 kW land-based sensitivity, subject to measurements, siting and connection approval. This comparison does not change the rooftop verdict or map.",
  });

  byId("verdict").innerHTML = `
    <div class="verdict">
      <span class="dot is-${outcome.status}"></span>
      <div class="verdict-text">
        <b>${esc(outcome.headline)}</b>
        <p>${esc(outcome.reason)}</p>
      </div>
    </div>`;

  byId("kpis").innerHTML = best
    ? `
      <div class="kpi is-sun"><span>System</span><b>${num.format(best.sizing.roofSolarKwp)} kW</b><em>${num.format(Math.round((best.sizing.roofSolarKwp * 1000) / DEFAULT_PACK.moduleWatts))} panels</em></div>
      <div class="kpi is-good"><span>Year one saving</span><b>${aed(best.finance.firstYearSavingsAed)}</b><em>off a ${aed(context.baselineBillAed)} bill</em></div>
      <div class="kpi"><span>Pays back in</span><b>${best.finance.simplePaybackYears?.toFixed(1) ?? "—"} yrs</b><em>${best.finance.irr ? `${pct(best.finance.irr, 0)} over 25 years` : ""}</em></div>
      <div class="kpi"><span>Of its own power</span><b>${best.renewableShare.toFixed(0)}%</b><em>${kwh(best.simulation.generationKwh)} a year</em></div>`
    : `<div class="kpi" style="grid-column: span 2"><span>Recommended system</span><b>none</b><em>${esc(outcome.reason.slice(0, 80))}</em></div>`;

  byId("working").innerHTML = best
    ? working(site, outcome)
    : `<p class="note">Nothing is recommended here, so there is no sizing to show. The reason is above and the inputs behind it are below.</p>`;

  const structure = context.structure;
  const tariff = context.tariff;
  byId("inputs").innerHTML = [
    inputRow("What the building does", SECTOR_LABELS[site.sector], "Typical for sector", "is-assumed", "sector"),
    inputRow("Annual consumption", kwh(site.annualKwh), "Typical for sector", "is-assumed", "annualKwh"),
    inputRow("Approved Load", `${num.format(site.approvedLoadKw)} kW`, "Account", "is-authority", "approvedLoad"),
    inputRow("How the roof is built", structure.construction.replace("-", " "), site.roofConstruction === "unknown" ? "Not stated" : "Stated", site.roofConstruction === "unknown" ? "is-assumed" : "", "roofConstruction"),
    inputRow("Roof height", site.roofHeightM ? `${site.roofHeightM} m` : "not known", site.roofHeightM ? "Stated" : "Not mapped", site.roofHeightM ? "" : "is-assumed", "roofHeight"),
    inputRow("Roof outline", `${num.format(context.roofAreaM2)} m²`, "OpenStreetMap", "is-measured"),
    inputRow(
      "Tariff",
      tariff ? `${tariff.utility} ${tariff.customerClass}` : "—",
      tariff?.provenance.asOf ? `Published ${tariff.provenance.asOf}` : "—",
      "is-authority",
      "tariff",
    ),
    inputRow("Scheme", RULE_SETS[site.emirate].scheme, labelEmirate(site.emirate), "is-authority"),
  ].join("");

  for (const button of byId("inputs").querySelectorAll<HTMLButtonElement>("[data-term]")) {
    button.addEventListener("click", () => openTerm(button.dataset.term!));
  }

  const register = assumptionRegister(outcome.result);
  byId("register-summary").textContent = registerSummary(register);
  byId("register").innerHTML = register
    .map((entry) => {
      const chip =
        entry.kind === "authority"
          ? "is-authority"
          : entry.kind === "assumption" || entry.kind === "model"
            ? "is-assumed"
            : "is-measured";
      const detail = [
        entry.provenance.label,
        entry.provenance.asOf ? `as of ${entry.provenance.asOf}` : null,
        entry.provenance.caveat,
        entry.swingAed ? `moves NPV by up to ${aed(entry.swingAed)}` : null,
        entry.howToResolve,
      ]
        .filter(Boolean)
        .join(" — ");
      return `<div class="register-row">
        <div class="register-head">
          <div class="fact-label">${esc(entry.input)}</div>
          <div class="fact-value">${esc(entry.value)}</div>
        </div>
        <div class="fact-src"><span class="chip ${chip}">${esc(entry.kind)}</span> ${esc(detail)}</div>
      </div>`;
    })
    .join("");

  const weatherNote = {
    "modelled-clear-sky":
      "This site is using the fitted model rather than a measured year for its exact coordinates: PVGIS refuses requests made straight from a browser, so a measured year arrives only when the local server is running.",
    "nasa-power-climatology":
      "This site's weather year is the NASA POWER 20-year climatology at the nearest half-degree grid point, blended with measured monthly irradiation — a typical year, not a metered one.",
    "pvgis-tmy": "Measured typical year for these coordinates, straight from PVGIS.",
  }[context.weather.source];
  byId("trust").innerHTML = `
    <div class="callout is-good">
      <b>Checked against PVGIS.</b> The sunlight model is fitted to five-year measurements at
      ${CLEARNESS_FIT.siteCount} points across the UAE. Run against PVGIS's own PV model at
      ${ENGINE_VALIDATION.sites} of them, annual output agrees to
      ${pct(ENGINE_VALIDATION.yieldMeanAbsError)} on average with no bias either way.
    </div>
    <p class="note">
      ${weatherNote}
      No real UAE system's metered output has been compared against this engine, and nothing here claims otherwise.
    </p>
    <p class="note">
      Roof outlines are community-mapped and are not title plans. Consumption and account figures
      in these example portfolios are typical for the sector, not one company's real meter data.
      Before money is spent: have the roof structure assessed, pull interval meter data and
      confirm the approved load on the account.
    </p>`;

  byId("report-block").hidden = false;
  const download = byId<HTMLButtonElement>("report-download");
  download.onclick = () => downloadReport(site, outcome);
  byId<HTMLButtonElement>("report-pdf").onclick = () => downloadPdf(site, outcome);
};

const siteReport = (outcome: Outcome) =>
  buildReport({
    site: outcome.profile,
    result: outcome.result,
    verdict: { status: outcome.status, headline: outcome.headline, reason: outcome.reason },
    packedKwp: outcome.packed.kwp,
    packedModuleCount: outcome.packed.moduleCount,
    rowShadingLoss: outcome.shading?.electricalArrayLoss ?? null,
    obstructionLoss: outcome.blocked?.arrayLossOfPoa ?? null,
    designWarnings: outcome.design?.warnings ?? [],
  });

const saveFile = (bytes: BlobPart, type: string, name: string) => {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadReport = (site: PortfolioSite, outcome: Outcome) => {
  const report = siteReport(outcome);
  saveFile(
    JSON.stringify(report, null, 2),
    "application/json",
    `mizan-report-${site.id}-${report.generatedAt.slice(0, 10)}.json`,
  );
};

const downloadPdf = async (site: PortfolioSite, outcome: Outcome) => {
  const report = siteReport(outcome);
  const best = outcome.result.best;
  // Monthly generation for the recommended array: the location's monthly
  // yield shape scaled to the modelled annual output — same scaling the
  // on-screen energy-mix panel uses.
  const monthlyKwh = best
    ? solarMonthlyYield(report.site.location).map(
        (perKw) =>
          (perKw * best.simulation.generationKwh) /
          Math.max(1, solarMonthlyYield(report.site.location).reduce((a, b) => a + b, 0)),
      )
    : null;
  const bytes = await siteReportPdf({
    report,
    monthlyKwh,
    cashflowCumulativeAed: best ? best.finance.cashflow.map((year) => year.cumulativeAed) : null,
  });
  saveFile(
    bytes.slice().buffer as ArrayBuffer,
    "application/pdf",
    `mizan-report-${site.id}-${report.generatedAt.slice(0, 10)}.pdf`,
  );
};

// --- sheets -----------------------------------------------------------------

const openTerm = (key: string) => {
  const entry = GLOSSARY[key];
  if (!entry) return;
  byId("term-title").textContent = entry.term;
  byId("term-body").innerHTML = `
    <p>${esc(entry.plain)}</p>
    <h3>Why it decides the answer</h3>
    <p>${esc(entry.whyItMatters)}</p>`;
  byId("term-scrim").hidden = false;
};

const ABOUT = `
  <h3>Multi-source portfolios</h3>
  <p>The portfolio picker includes inland solar, coastal solar and wind, wind-only,
  and seasonal solar and hydro examples. Select a site and toggle its sources to
  update generation, monthly charts, load coverage and financial comparisons.
  Sites without surveyed geometry use regional location maps. Resource and cost
  assumptions are labelled beside the analysis.</p>
  <h3>The problem</h3>
  <p>An operator with a dozen buildings cannot get a straight answer about which of them are
  worth putting solar on. Installers quote one site at a time and every quote says yes. Nothing
  tells them which buildings to leave alone, and why.</p>

  <h3>What this does</h3>
  <p>It takes a portfolio of real buildings and screens each one: how much fits on the roof,
  what rule caps it, what it would generate against that building's own pattern of use, what
  that saves at the right tariff, and whether it pays back. Then it ranks them and names what
  stops the rest.</p>

  <h3>What it runs on</h3>
  <div class="flow">
    <div><b>Roof outline</b><span>OpenStreetMap footprints, real geometry</span></div>
    <div><b>Sunlight</b><span>Fitted to PVGIS at 32 UAE points</span><em>±1.9%</em></div>
    <div><b>Panel layout</b><span>Rows packed inside the real outline</span></div>
    <div><b>Losses</b><span>Heat, dust, shading, wiring, hour by hour</span></div>
    <div><b>Load shape</b><span>8,760 hours for the sector</span></div>
    <div><b>Tariff</b><span>DEWA and ADDC slabs, dated</span></div>
    <div><b>Scheme rules</b><span>Shams Dubai, Abu Dhabi DoE</span></div>
    <div><b>Finance</b><span>Payback, IRR, NPV, LCOE</span></div>
  </div>

  <h3>Why it is not a spreadsheet</h3>
  <p>Three things a spreadsheet will not tell you. <b>The roof</b>: panels are packed inside the
  actual outline with real setbacks, so the capacity is a count of panels that fit rather than an
  area times a coverage factor. <b>The wiring</b>: string length is pinned between the coldest
  morning and the hottest afternoon here, which is a different answer from the one a European
  design gives. <b>The shadows</b>: rows shade each other early and late, and the buildings next
  door shade the roof, both computed hour by hour from this site's own sun.</p>

  <h3>What stops a project</h3>
  <p>In the UAE it is usually not the roof. It is the Approved Load on the electricity account,
  which Shams Dubai will not let you exceed whatever the roof could hold. After that it is how
  the roof is built — insulated sandwich panel rarely takes the extra weight — and then whether
  the building uses enough power in daylight to be worth covering at all.</p>

  <h3>How far it can be trusted</h3>
  <p>Annual output agrees with PVGIS's own PV model to 1.1% on average across 16 UAE coordinates,
  with no bias in either direction, measured by fitting on fifteen sites and scoring the sixteenth.
  That is agreement with a well-validated model, not with a real system's meter. Every figure on
  screen carries where it came from, and the ones that are assumptions say so.</p>`;

// --- render -----------------------------------------------------------------

const render = () => {
  if (renewablePortfolio) {
    const site = renewablePortfolio.sites.find(s => s.id === renewableSiteId) ?? renewablePortfolio.sites[0];
    renderRenewableWorkspace(renewablePortfolio, site, basemap, id => { renewableSiteId = id; render(); });
    return;
  }
  byId("views").hidden = false;
  byId("working-block").hidden = false;
  byId("inputs-help").hidden = false;
  byId("rail-evidence-note").textContent = "Every site below is a real building outline from OpenStreetMap. Consumption and account figures are typical for the sector.";
  byId("renewable-site").parentElement!.querySelector("summary")!.textContent = "Explore this site’s energy mix";
  const site = activeSite();
  const outcome = outcomes.get(site.id);
  renderRail();
  drawStage(site, outcome);
  renderPanel(site, outcome);
};

/**
 * Work the portfolio out one site at a time, letting the page paint between
 * each. A full site is most of a second, so doing all of them before the first
 * paint would mean staring at nothing; this way the rail fills in visibly.
 */
const computeAll = () => {
  const requestedPortfolio = portfolio;
  const queue = [...portfolio.sites].sort((a, b) => (a.id === activeSiteId ? -1 : b.id === activeSiteId ? 1 : 0));

  if (engineWorker) {
    for (const site of queue) {
      if (outcomes.has(site.id) || failures.has(site.id) || inflight.has(site.id)) continue;
      inflight.add(site.id);
      engineWorker.postMessage({
        portfolioId: requestedPortfolio.id,
        hurdleYears: requestedPortfolio.hurdleYears,
        sceneOrigin: SCENES[site.sceneId].o,
        buildings: buildingsFor(site.sceneId),
        site,
      });
    }
    return;
  }

  let index = 0;
  const next = () => {
    if (renewablePortfolio || portfolio !== requestedPortfolio) return;
    if (index >= queue.length) return;
    const site = queue[index];
    index += 1;
    try {
      runSite(site);
      failures.delete(site.id);
    } catch (error) {
      console.error("site failed", site.id, error);
      failures.set(site.id, failureFor(error));
    }
    if (site.id === activeSiteId) render();
    else renderRail();
    setTimeout(next, 0);
  };
  setTimeout(next, 0);
};

const switchPortfolio = (id: string) => {
  renewablePortfolio = RENEWABLE_PORTFOLIOS.find(p => p.id === id) ?? null;
  if (renewablePortfolio) {
    renewableSiteId = renewablePortfolio.sites[0].id;
    byId("picker-name").textContent = renewablePortfolio.name;
    byId("picker-count").textContent = `${renewablePortfolio.sites.length} sites`;
    render();
    return;
  }
  portfolio = PORTFOLIOS.find((p) => p.id === id) ?? PORTFOLIOS[0];
  activeSiteId = portfolio.sites[0].id;
  byId("picker-name").textContent = portfolio.name;
  byId("picker-count").textContent = `${portfolio.sites.length} sites`;
  render();
  computeAll();
};

const boot = () => {
  byId("open-renewables").addEventListener("click", () => openRenewableExamples());
  byId("site-renewable-examples").addEventListener("click", () => openRenewableExamples());
  byId("analyze-own").addEventListener("click", () => openCustomSiteFlow((site) => openRenewableExamples(site.id)));
  byId("renewable-close").addEventListener("click", () => (byId("renewable-dialog") as HTMLDialogElement).close());
  const menu = byId("picker-menu");
  menu.innerHTML = [...RENEWABLE_PORTFOLIOS, ...PORTFOLIOS].map(
    (p) => `<button type="button" data-portfolio="${p.id}"><b>${esc(p.name)}</b><span>${esc(p.kind)} · ${p.sites.length} sites</span></button>`,
  ).join("");
  for (const button of menu.querySelectorAll<HTMLButtonElement>("[data-portfolio]")) {
    button.addEventListener("click", () => {
      menu.hidden = true;
      byId("picker-btn").setAttribute("aria-expanded", "false");
      switchPortfolio(button.dataset.portfolio!);
    });
  }
  byId("picker-btn").addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    byId("picker-btn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest(".picker")) {
      menu.hidden = true;
      byId("picker-btn").setAttribute("aria-expanded", "false");
    }
  });

  for (const button of byId("views").querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.addEventListener("click", () => {
      view = button.dataset.view as MapView;
      render();
    });
  }
  byId("base-sat").addEventListener("click", () => { basemap = "satellite"; render(); });
  byId("base-map").addEventListener("click", () => { basemap = "streets"; render(); });

  byId("about-body").innerHTML = ABOUT;
  byId("open-about").addEventListener("click", () => { byId("about-scrim").hidden = false; });
  const close = () => { byId("about-scrim").hidden = true; byId("term-scrim").hidden = true; };
  byId("about-close").addEventListener("click", close);
  byId("term-close").addEventListener("click", close);
  for (const id of ["about-scrim", "term-scrim"]) {
    byId(id).addEventListener("click", (event) => { if (event.target === byId(id)) close(); });
  }
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

  window.addEventListener("resize", () => render());

  switchPortfolio(RENEWABLE_PORTFOLIOS[0].id);
};

boot();
