import { RENEWABLE_COSTS, UAE_RENEWABLE_CASES, systemsForCase, type RenewableCase } from "../data/portfolios-uae-multi";
import { MONTHS, SOURCE_LABELS, solarMonthlyYield, type RenewableSource } from "../data/uae-monthly-profiles";
import { analyzeRenewableCombination, compareScenarios } from "../engine/renewable-combinations";
import { recommendMix } from "../engine/recommend";
import { RULE_SETS, labelEmirate } from "../engine/rules";
import { nearestWindSite } from "../data/wind-sites";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const number = (n: number) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 1 }).format(n);
const money = (n: number) => `AED ${number(Math.round(n))}`;
const payback = (n: number | null) => n === null ? "—" : `${n.toFixed(1)} years`;
type Selection = { sources: Set<RenewableSource>; capacities: Partial<Record<RenewableSource, number>>; tariff: number; annualKwh: number; costs: Partial<Record<RenewableSource, number>> };
const selections = new Map<string, Selection>();
let exampleId = "sir-bani-yas";

function selectionFor(site: RenewableCase) {
  if (!selections.has(site.id)) selections.set(site.id, { sources: new Set(site.defaultSources), capacities: {}, tariff: site.defaultTariff ?? 0.30, annualKwh: site.annualKwh, costs: {} });
  return selections.get(site.id)!;
}

function configuredSystems(site: RenewableCase, state: Selection) {
  return systemsForCase(site, state.capacities).map(s => ({ ...s, capexAedPerKw: state.costs[s.source] ?? s.capexAedPerKw }));
}

export function renewableAnalysisFor(site: RenewableCase) {
  const state = selectionFor(site);
  return analyzeRenewableCombination(site.name, configuredSystems(site, state).filter(s => state.sources.has(s.source)),
    state.annualKwh, { tariffAedPerKwh: state.tariff });
}

export function renderRenewables(root: HTMLElement, site: RenewableCase, examples = false, onChange?: () => void) {
  const available = systemsForCase(site);
  const state = selectionFor(site);
  const configured = configuredSystems(site, state);
  const selected = configured.filter(s => state.sources.has(s.source));
  const result = analyzeRenewableCombination(site.name, selected, state.annualKwh, { tariffAedPerKwh: state.tariff });
  const stats = result.annualResults;
  const maxMonth = Math.max(1, ...result.monthlyGenerationKwh);

  const recommendation = recommendMix({
    emirate: site.emirate,
    lat: site.location.lat,
    lng: site.location.lng,
    annualKwh: state.annualKwh,
    solarCapKw: site.solarKw,
    approvedLoadKw: site.approvedLoadKw ?? undefined,
    tariffAedPerKwh: state.tariff,
    solarMonthlyKwhPerKw: solarMonthlyYield(site.location),
    solarCapexAedPerKw: site.solarCostPerKw ?? RENEWABLE_COSTS.solar.capexAedPerKw,
    solarOmFraction: RENEWABLE_COSTS.solar.annualOmFraction,
    windCapexAedPerKw: RENEWABLE_COSTS.wind.capexAedPerKw,
    windOmFraction: RENEWABLE_COSTS.wind.annualOmFraction,
    windSiteId: site.windProfile,
    windTurbineId: site.windTurbine,
  });
  const rules = RULE_SETS[site.emirate];
  const comparisons = compareScenarios([
    ...configured.map(s => ({ name: `${SOURCE_LABELS[s.source]} only`, systems: [s] })),
    ...(configured.length > 1 ? [{ name: "All available sources", systems: configured }] : []),
  ], state.annualKwh, { tariffAedPerKwh: state.tariff });
  root.innerHTML = `
    ${examples ? `<label class="renewable-picker">UAE example<select data-case aria-label="UAE example">${UAE_RENEWABLE_CASES.map(s => `<option value="${s.id}" ${s.id === site.id ? "selected" : ""}>${esc(s.name)} · ${esc(s.category)}</option>`).join("")}</select></label>` : ""}
    <h3>${esc(site.name)} · energy mix</h3>
    <p class="note">${esc(site.where)} · ${number(site.annualKwh / 1000)} MWh/year initial comparison load</p>
    <p class="note">${esc(site.description)} ${site.sourceUrl ? `<a href="${esc(site.sourceUrl)}" target="_blank" rel="noopener noreferrer">Published project details ↗</a>` : ""}</p>
    ${site.evidence ? `<details open><summary>Published facts and modeling assumptions</summary>${site.evidence.map(e => `<p class="note"><strong>${esc(e.label)}:</strong> ${esc(e.value)} ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ""}</p>`).join("")}</details>` : ""}
    <div class="rec-card">
      <div class="rec-head"><b>Mizan recommendation</b><span>${esc(labelEmirate(site.emirate))} · ${esc(rules.scheme)}</span></div>
      <div class="rec-mix">${recommendation.mix.length
        ? recommendation.mix.map(m => `<div class="rec-source"><b>${esc(m.detail)}</b><span>${SOURCE_LABELS[m.source]}</span></div>`).join("")
        : `<div class="rec-source"><b>No cost-effective mix found</b><span>every option misses the investment limit at the assumed rate</span></div>`}
        <div class="rec-nums"><span>Output</span><b>${number(recommendation.result.annualResults.totalMwh)} MWh/year</b></div>
        <div class="rec-nums"><span>Net saving</span><b>${money(recommendation.result.financial.netSavingsAed)}/year</b></div>
        <div class="rec-nums"><span>Payback</span><b>${payback(recommendation.result.financial.paybackYears)}</b></div>
        ${recommendation.windCapacityFactor !== null ? `<div class="rec-nums"><span>Wind resource</span><b>${(recommendation.windCapacityFactor * 100).toFixed(0)}% CF</b></div>` : ""}
      </div>
      ${recommendation.mix.length ? `<button type="button" class="rec-apply">Apply recommended mix</button>` : ""}
      <p class="note">${esc(recommendation.solarCapNote)}</p>
      ${recommendation.legal.map(item => `<p class="note rec-legal"><b class="${item.status === "eligible" ? "is-eligible" : item.status === "needs-evidence" ? "is-evidence" : "is-blocked"}">${item.status === "eligible" ? "✓" : item.status === "needs-evidence" ? "!" : "✕"}</b>${esc(item.text)}</p>`).join("")}
      ${recommendation.rejected.map(r => `<p class="note rec-rejected"><strong>Ruled out:</strong> ${esc(r)}</p>`).join("")}
      ${recommendation.evidenceNeeded.length ? `<details><summary>What is still needed before building</summary>${recommendation.evidenceNeeded.map(e => `<p class="note">${esc(e)}</p>`).join("")}</details>` : ""}
    </div>
    <div class="energy-toggles" role="group" aria-label="Energy sources">
      ${(Object.keys(SOURCE_LABELS) as RenewableSource[]).map(source => {
        const supported = available.some(s => s.source === source);
        const reason = source === "geothermal" ? "No proven subsurface electricity resource supplied" : source === "hydro" ? "No measured head and flow supplied" : source === "wind" ? "No site wind assessment supplied" : "No solar capacity configured";
        return `<button type="button" class="energy-toggle source-${source}" data-source="${source}" aria-pressed="${supported && state.sources.has(source)}" ${supported ? "" : `disabled title="${reason}"`}>${SOURCE_LABELS[source]}${supported ? "" : " · no data"}</button>`;
      }).join("")}
    </div>
    <p class="note">Geothermal electricity needs proven temperature, depth and flow; direct-use heat is a separate assessment. Hydro needs an eligible water resource. Hatta pumped storage is not counted as a new energy source.</p>
    <div class="renewable-controls">
      ${configured.map(s => `<label>${SOURCE_LABELS[s.source]} capacity (${s.source === "solar" ? "kWp" : "kW"})<input data-capacity="${s.source}" type="number" min="0" max="${available.find(a => a.source === s.source)!.capacityKw}" step="any" value="${s.capacityKw}" ${state.sources.has(s.source) ? "" : "disabled"}></label>`).join("")}
      ${configured.map(s => `<label>${SOURCE_LABELS[s.source]} assumed cost (AED/kW)<input data-cost="${s.source}" type="number" min="1" step="any" value="${s.capexAedPerKw}"></label>`).join("")}
      <label>Scenario annual consumption (kWh)<input data-load type="number" min="0" step="any" value="${state.annualKwh}"></label>
      <label>Assumed avoided rate (AED/kWh)<input data-rate type="number" min="0" max="2" step="0.01" value="${state.tariff}"></label>
    </div>
    <p class="note renewable-cost-note">Capacity can be reduced from the example design. Costs are assumptions: ${configured.map(s => `${SOURCE_LABELS[s.source]} ${money(s.capexAedPerKw)}/kW, ${(s.annualOmFraction * 100).toFixed(1)}% annual O&M`).join("; ") || "no buildable sources configured"}.${configured.some(s => s.source === "wind") ? ` Wind uses a flat assumed ${(configured.find(s => s.source === "wind")!.monthlyKwhPerKw.reduce((a, b) => a + b, 0) / 8760 * 100).toFixed(0)}% capacity factor, not a measured seasonal pattern.` : ""}</p>
    <div aria-live="polite" class="renewable-results">
    ${selected.length ? `
      <div class="renewable-stats">
        <div><span>Annual output</span><b>${number(stats.totalMwh)} MWh</b></div>
        <div><span>Net saving / year</span><b>${money(result.financial.netSavingsAed)}</b></div>
        <div><span>Simple payback estimate</span><b>${payback(result.financial.paybackYears)}</b></div>
      </div>
      <div class="renewable-stats seasonal-stats">
        <div><span>Load coverage ceiling</span><b>${stats.loadCoveragePercent === null ? "—" : `${stats.loadCoveragePercent.toFixed(1)}%`}</b></div>
        <div><span>Stability score</span><b>${result.complementarity.stabilityScore === null ? "—" : `${result.complementarity.stabilityScore}/100`}</b></div>
        <div><span>Peak offset</span><b>${result.complementarity.peakOffsetMonths === null ? "Not established" : `${result.complementarity.peakOffsetMonths} months`}</b></div>
      </div>
      <p class="note">Generation / annual load: ${stats.generationToLoadPercent === null ? "—" : `${stats.generationToLoadPercent.toFixed(1)}%`}. Uncredited surplus: ${number(stats.surplusKwh / 1000)} MWh.</p>
      <h4>Monthly generation · MWh</h4>
      <div class="monthly-chart" role="img" aria-label="Monthly generation by energy source; exact values in the table below">
        ${MONTHS.map((month, m) => `<div class="monthly-column"><div class="monthly-stack">${result.bySource.map(s => `<span class="source-${s.source}" style="height:${s.monthlyKwh[m] / maxMonth * 100}%" title="${month} ${SOURCE_LABELS[s.source]}: ${number(s.monthlyKwh[m] / 1000)} MWh"></span>`).join("")}</div><span>${month}</span></div>`).join("")}
      </div>
      <div class="renewable-legend">${result.bySource.map(s => `<span><i class="source-${s.source}"></i>${SOURCE_LABELS[s.source]}</span>`).join("")}</div>
      <details><summary>Monthly values and seasonal stability</summary>
        <div class="renewable-table-wrap"><table class="payback-table"><caption>Generated energy (MWh)</caption><thead><tr><th>Month</th>${result.bySource.map(s => `<th>${SOURCE_LABELS[s.source]}</th>`).join("")}<th>Total</th></tr></thead><tbody>${MONTHS.map((m, i) => `<tr><th>${m}</th>${result.bySource.map(s => `<td>${number(s.monthlyKwh[i] / 1000)}</td>`).join("")}<td>${number(result.monthlyGenerationKwh[i] / 1000)}</td></tr>`).join("")}</tbody></table></div>
        <p class="note">Seasonal stability: ${result.complementarity.stabilityScore ?? "—"}/100, calculated from the variation in daily-average monthly output. Peak offset: ${result.complementarity.peakOffsetMonths === null ? "not established" : `${result.complementarity.peakOffsetMonths} months`}. Neither metric measures hourly reliability or storage requirements.</p>
      </details>
      <h4>Selected mix · financial estimate</h4>
      <div class="renewable-table-wrap"><table class="payback-table"><caption>Shared savings allocated by each source’s monthly generation</caption><thead><tr><th>Source</th><th>Build cost</th><th>Net saving / year</th><th>Payback</th></tr></thead><tbody>
        ${result.bySource.map(s => `<tr><th>${SOURCE_LABELS[s.source]}</th><td>${money(s.financial.capexAed)}</td><td>${money(s.financial.netSavingsAed)}</td><td>${payback(s.financial.paybackYears)}</td></tr>`).join("")}
        <tr><th>Total</th><td>${money(result.financial.capexAed)}</td><td>${money(result.financial.netSavingsAed)}</td><td>${payback(result.financial.paybackYears)}</td></tr>
      </tbody></table></div>
      <p class="note">Net saving deducts annual O&M. Simple payback excludes financing, degradation, tax and replacements; it is an optimistic screening estimate.</p>
      <ul class="renewable-notes">${result.recommendations.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
    ` : `<p class="callout">No sources selected. Select an available source to calculate generation and savings.</p>`}
    </div>
    <details class="renewable-comparisons"><summary>Compare source combinations</summary><div class="renewable-table-wrap"><table class="payback-table"><caption>Independent alternatives at the capacities entered above</caption><thead><tr><th>Scenario</th><th>MWh/year</th><th>Net saving / year</th><th>Payback</th></tr></thead><tbody>${comparisons.map(r => `<tr><th>${esc(r.name)}</th><td>${number(r.annualResults.totalMwh)}</td><td>${money(r.financial.netSavingsAed)}</td><td>${payback(r.financial.paybackYears)}</td></tr>`).join("")}</tbody></table></div></details>
    <p class="note">${site.solarAnnualKwh ? "Solar annual total: published approximate yield, distributed using the UAE monthly model. " : ""}Solar: existing UAE model fitted to bundled PVGIS SARAH3 2018–2022 monthly data, including temperature and dust losses. Wind and hydro: explicitly assumed resource inputs. <a href="https://re.jrc.ec.europa.eu/pvg_tools/en/" target="_blank" rel="noopener noreferrer">PVGIS ↗</a> · <a href="https://www.dewa.gov.ae/en/about-us/strategic-initiatives/hatta-project" target="_blank" rel="noopener noreferrer">Hatta storage ↗</a></p>`;

  const rerender = (selector: string) => {
    renderRenewables(root, site, examples, onChange);
    onChange?.();
    root.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  };
  root.querySelector<HTMLButtonElement>(".rec-apply")?.addEventListener("click", () => {
    state.sources = new Set(recommendation.mix.map(m => m.source));
    for (const m of recommendation.mix) {
      state.capacities[m.source] = m.capacityKw;
      if (m.source === "wind" && !site.windProfile) {
        // Modelled climate now exists for every configured site, so a
        // recommendation can inject wind even where the example had none.
        site.windKw = m.capacityKw;
        site.windProfile = nearestWindSite(site.location.lat, site.location.lng).id;
        site.windTurbine = m.turbineId ?? "mid-900";
      }
    }
    rerender(".rec-card");
  });
  root.querySelector<HTMLSelectElement>("[data-case]")?.addEventListener("change", e => {
    exampleId = (e.target as HTMLSelectElement).value;
    renderRenewables(root, UAE_RENEWABLE_CASES.find(s => s.id === exampleId)!, true);
    root.querySelector<HTMLElement>("[data-case]")?.focus({ preventScroll: true });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-source]").forEach(button => button.addEventListener("click", () => {
    const source = button.dataset.source as RenewableSource;
    if (state.sources.has(source)) state.sources.delete(source); else state.sources.add(source);
    rerender(`[data-source="${source}"]`);
  }));
  root.querySelectorAll<HTMLInputElement>("[data-capacity], [data-rate], [data-cost], [data-load]").forEach(input => {
    const update = (event: Event) => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || !input.checkValidity()) {
        if (event.type === "change") input.reportValidity();
        return;
      }
      const source = input.dataset.capacity as RenewableSource | undefined;
      if (source) state.capacities[source] = value;
      else if (input.dataset.cost) state.costs[input.dataset.cost as RenewableSource] = value;
      else if (input.hasAttribute("data-load")) state.annualKwh = value;
      else state.tariff = value;
      // Keep the active input mounted so typing decimals, tabbing and keyboard
      // edits work. Replace only calculated outputs, preserving disclosure state.
      const updated = document.createElement("div");
      renderRenewables(updated, site, examples);
      for (const selector of [".renewable-results", ".renewable-comparisons", ".renewable-cost-note"]) {
        const old = root.querySelector<HTMLElement>(selector)!;
        const next = updated.querySelector<HTMLElement>(selector)!;
        const beforeDetails = old.matches("details") ? [old] : [...old.querySelectorAll("details")];
        const afterDetails = next.matches("details") ? [next] : [...next.querySelectorAll("details")];
        beforeDetails.forEach((detail, i) => { if (afterDetails[i]) (afterDetails[i] as HTMLDetailsElement).open = (detail as HTMLDetailsElement).open; });
        old.replaceWith(next);
      }
      onChange?.();
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });
}

export function openRenewableExamples(siteId?: string) {
  if (siteId && UAE_RENEWABLE_CASES.some(s => s.id === siteId)) exampleId = siteId;
  const dialog = document.getElementById("renewable-dialog") as HTMLDialogElement;
  renderRenewables(document.getElementById("renewable-examples")!, UAE_RENEWABLE_CASES.find(s => s.id === exampleId)!, true);
  dialog.showModal();
}
