import type { RenewablePortfolio, RenewablePortfolioSite } from "../data/renewable-portfolios";
import { renderProjectMap } from "./project-map";
import { renderPublishedEnergy } from "./published-energy";
import { SOURCE_LABELS } from "../data/uae-monthly-profiles";
import { basemapCredit, tileLayer, type Basemap } from "./tiles";
import { renderRenewables, renewableAnalysisFor } from "./renewables";
import { esc } from "./format";

const el = (id: string) => document.getElementById(id)!;
const num = (n: number) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 1 }).format(n);
const money = (n: number) => `AED ${num(Math.round(n))}`;

function verdict(site: RenewablePortfolioSite, hurdle: number) {
  const result = renewableAnalysisFor(site);
  if (site.publishedEnergy) return { result, status: "warn" as const, headline: `${site.category} · payback unassessed` };
  const payback = result.financial.paybackYears;
  const empty = result.bySource.length === 0 || result.annualResults.totalMwh === 0;
  const status: "stop" | "warn" | "good" = empty || payback === null || payback > hurdle ? "stop" : site.evidence ? "good" : "warn";
  const headline = empty ? "No generation selected" : payback === null ? "No positive net saving" : `${payback.toFixed(1)} years · ${payback > hurdle ? "past investment limit" : site.evidence ? `within ${hurdle}-year screen (model)` : "needs resource evidence"}`;
  return { result, status, headline };
}

export function renderRenewableWorkspace(portfolio: RenewablePortfolio, site: RenewablePortfolioSite, basemap: Basemap,
  onSelect: (id: string) => void) {
  el("portfolio-question").textContent = `${portfolio.question} Investment limit: ${portfolio.hurdleYears} years.`;
  el("rail-evidence-note").textContent = site.mapGeometry ? "Named companies with sourced energy data and stored map geometry. Asset locations and mapping limitations are stated per site. Unknown paybacks remain unassessed." : site.evidence ? "Real installations with linked published facts. Financial results are editable scenarios, not audited operator returns. Locations are approximate." : "Illustrative UAE operators and regional locations. Resource, load and cost assumptions are labelled; no surveyed building outline is supplied for these scenarios.";
  el("stage-title").textContent = site.name;
  el("stage-where").textContent = `${site.where} · ${site.category}`;
  el("views").hidden = true;
  for (const id of ["legend-roof", "legend-wiring", "legend-shading"]) el(id).hidden = true;
  el("base-sat").setAttribute("aria-pressed", String(basemap === "satellite"));
  el("base-map").setAttribute("aria-pressed", String(basemap === "streets"));
  const map = el("map");
  if (site.mapGeometry) {
    renderProjectMap(map, site.mapGeometry, basemap);
    el("map-caption").textContent = site.mapNote ?? "Mapped project geometry; click a feature to inspect its source.";
    el("map-attribution").textContent = `${basemapCredit(basemap)} · Geometry retrieved ${site.mapGeometry.retrieved}`;
  } else {
    map.replaceChildren(tileLayer({ x: -2000, y: -1250, w: 4000, h: 2500, origin: [site.location.lng, site.location.lat] }, basemap));
    const marker = document.createElement("div");
    marker.className = "renewable-location";
    marker.innerHTML = `<span class="location-dot"></span><b>${esc(site.where)}</b><span>Approximate regional location</span><span>${site.location.lat.toFixed(4)}° N, ${site.location.lng.toFixed(4)}° E</span>`;
    map.append(marker);
    el("map-caption").textContent = "Location context only. No footprint or surveyed turbine/water installation is available for this example, so rooftop layouts, wiring and shadows are not shown.";
    el("map-attribution").textContent = basemapCredit(basemap).replace(" · Outlines: OpenStreetMap, ODbL", "");
  }
  if (map.parentElement) map.parentElement.style.aspectRatio = "1.6";

  const refreshSummary = () => {
    const tally = { good: 0, warn: 0, stop: 0 };
    el("site-list").innerHTML = portfolio.sites.map(s => {
      const v = verdict(s, portfolio.hurdleYears);
      tally[v.status] += 1;
      return `<li><button type="button" class="site" data-site="${s.id}" aria-current="${s.id === site.id}"><span class="dot is-${v.status}"></span><span><span class="site-name">${esc(s.name)}</span><span class="site-where">${esc(s.where)}</span><span class="site-result is-${v.status}">${esc(v.headline)}</span></span></button></li>`;
    }).join("");
    el("site-list").querySelectorAll<HTMLButtonElement>("[data-site]").forEach(button => button.addEventListener("click", () => onSelect(button.dataset.site!)));
    for (const status of ["good", "warn", "stop"] as const) el(`tally-${status}`).textContent = String(tally[status]);
    if (site.publishedEnergy) {
      el("verdict").innerHTML = `<div class="verdict"><span class="dot is-warn"></span><div class="verdict-text"><b>Published project · payback unassessed</b><p>Capacity and asset data are sourced. Output scenarios below do not establish an investment return.</p></div></div>`;
      el("kpis").innerHTML = site.publishedEnergy.metrics.map(m => `<div class="kpi"><span>${esc(m.label)}</span><b>${esc(m.value)}</b><em>published specification</em></div>`).join("");
      return;
    }
    const { result, status, headline } = verdict(site, portfolio.hurdleYears);
    const capacity = result.bySource.map(s => `${num(s.capacityKw)} ${s.source === "solar" ? "kWp" : "kW"} ${SOURCE_LABELS[s.source]}`).join(" + ") || "No sources";
    el("verdict").innerHTML = `<div class="verdict"><span class="dot is-${status}"></span><div class="verdict-text"><b>${esc(headline)}</b><p>Selected mix: ${esc(capacity)}. Estimates use the resource and cost assumptions below; this is not an approved installation.</p></div></div>`;
    el("kpis").innerHTML = `
      <div class="kpi is-sun"><span>Annual generation</span><b>${num(result.annualResults.totalMwh)} MWh</b><em>${esc(capacity)}</em></div>
      <div class="kpi"><span>Net annual saving</span><b>${money(result.financial.netSavingsAed)}</b><em>after assumed annual O&M</em></div>
      <div class="kpi"><span>Simple payback</span><b>${result.financial.paybackYears?.toFixed(1) ?? "—"} yrs</b><em>${portfolio.hurdleYears}-year investment limit</em></div>
      <div class="kpi"><span>Load coverage ceiling</span><b>${result.annualResults.loadCoveragePercent?.toFixed(1) ?? "—"}%</b><em>monthly matching, not autonomy</em></div>`;
  };
  refreshSummary();
  // Match the supplied page's inline, expanded analysis, even when no source is selected.
  const section = el("renewable-site").parentElement as HTMLDetailsElement;
  section.open = true;
  section.querySelector("summary")!.textContent = "Multi-Source Renewable Analysis";
  if (site.publishedEnergy) renderPublishedEnergy(el("renewable-site"), site);
  else renderRenewables(el("renewable-site"), site, false, refreshSummary);
  el("working-block").hidden = true;
  el("inputs-help").hidden = true;
  if (site.publishedEnergy) {
    section.querySelector("summary")!.textContent = "Published energy data & interactive scenarios";
    el("inputs").innerHTML = `<div class="fact-row"><span>Project financials</span><b>Not assessed</b></div><div class="fact-row"><span>Map data</span><b>OpenStreetMap · 24 Sep 2026</b></div>`;
    el("trust").innerHTML = `<p class="note">${esc(site.mapNote ?? "")}</p><p class="note">Published capacity is separated from modeled energy. Storage is not counted as new generation. No company consumption or payback has been invented.</p>`;
    return;
  }
  el("inputs").innerHTML = `
    <div class="fact-row"><span>Initial annual consumption · scenario</span><b>${num(site.annualKwh / 1000)} MWh</b></div>
    <div class="fact-row"><span>Approved load${site.approvedLoadKw === null ? "" : " · assumed"}</span><b>${site.approvedLoadKw === null ? "Not published" : `${num(site.approvedLoadKw)} kW`}</b></div>
    <div class="fact-row"><span>Solar design ceiling</span><b>${num(site.solarKw)} kWp</b></div>
    <div class="fact-row"><span>Location evidence</span><b>${site.mapGeometry ? "Mapped footprint" : "Regional coordinates"}</b></div>`;
  el("trust").innerHTML = `<p class="note">${esc(site.description)}</p><p class="note">Solar uses the existing UAE temperature and dust model. Wind capacity factors and hydro flows are sensitivity assumptions. No export revenue is included. Monthly matching can overestimate savings until interval data is available. Regional coordinates do not establish land rights, roof area or connection permission.</p>`;
}
