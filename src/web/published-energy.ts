import type { RenewableCase } from "../data/portfolios-uae-multi";
import { MONTHS, solarMonthlyYield } from "../data/uae-monthly-profiles";
import { capacityFactorMonthly, storageCycle } from "../engine/published-energy";
import { esc } from "./format";

const num = (n: number) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 1 }).format(n);
const labels = { solar: "Solar", biogas: "Biogas electricity", wind: "Wind" };
type ScenarioState = { factors: Record<string, number>; enabled: Set<string>; fraction: number };
const states = new Map<string, ScenarioState>();

export function renderPublishedEnergy(root: HTMLElement, site: RenewableCase) {
  const data = site.publishedEnergy!;
  if (!states.has(site.id)) states.set(site.id, {
    factors: Object.fromEntries(data.assets.map(a => [a.source, a.assumedCapacityFactor ?? 0])),
    enabled: new Set(data.assets.map(a => a.source)), fraction: 1,
  });
  const state = states.get(site.id)!;
  root.innerHTML = `<h3>Published project data</h3><p class="note">${esc(site.description)}</p>
    ${site.evidence?.map(e => `<p class="note"><strong>${esc(e.label)}:</strong> ${esc(e.value)} ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ""}</p>`).join("") ?? ""}
    <h4>${data.storage ? "Explore a storage cycle" : "Explore generation assumptions"}</h4>
    <p class="note">${data.storage ? "Energy returned is shown separately from charging energy. No storage discharge is added to renewable generation totals." : "Published capacities remain fixed. Choose sources and adjust capacity factors to test output; these results are scenarios, not recorded production or available site savings."}</p>
    <div class="renewable-controls">
      ${data.assets.map(a => `<div><label><input type="checkbox" data-enable="${a.source}" ${state.enabled.has(a.source) ? "checked" : ""}> ${labels[a.source]} · ${num(a.capacityKw)} ${a.source === "solar" ? "kWp" : "kW"}</label>
      ${a.source !== "solar" ? `<label>Assumed ${a.source} capacity factor (%)<input data-factor="${a.source}" type="number" min="0" max="100" step="any" value="${state.factors[a.source] * 100}"></label>` : `<p class="note">Output uses the UAE solar model, including temperature and dust losses.</p>`}</div>`).join("")}
      ${data.storage ? `<label>Storage discharged per cycle (%)<input data-storage type="number" min="0" max="100" step="any" value="${state.fraction * 100}"></label>` : ""}
    </div><div class="published-scenario" aria-live="polite"></div>
    <p class="note">No project payback is inferred from this output scenario. Metered production, load profiles, contracts and operating costs are needed for an investment assessment.</p>`;
  const update = () => {
    const output = root.querySelector<HTMLElement>(".published-scenario")!;
    if (data.storage) {
      const cycle = storageCycle(data.storage, state.fraction);
      output.innerHTML = `<div class="renewable-stats"><div><span>Delivered per cycle</span><b>${num(cycle.deliveredMwh)} MWh</b></div><div><span>Charging required</span><b>${num(cycle.chargingMwh)} MWh</b></div><div><span>Cycle energy loss</span><b>${num(cycle.lossMwh)} MWh</b></div></div><p class="note">Discharge at ${num(data.storage.powerMw)} MW: ${num(cycle.dischargeHours)} hours. Energy input exceeds energy returned because round-trip efficiency is ${num(data.storage.roundTripEfficiency * 100)}%.</p>`;
      return;
    }
    const series = data.assets.filter(a => state.enabled.has(a.source)).map(a => ({ source: a.source, monthly: a.source === "solar" ? solarMonthlyYield(site.location).map(v => v * a.capacityKw) : capacityFactorMonthly(a.capacityKw, state.factors[a.source]) }));
    const totals = MONTHS.map((_, m) => series.reduce((sum, s) => sum + s.monthly[m], 0));
    const maximum = Math.max(1, ...totals);
    output.innerHTML = `<div class="renewable-stats">${series.map(s => `<div><span>${labels[s.source]} · modeled</span><b>${num(s.monthly.reduce((a, b) => a + b, 0) / 1000)} MWh/year</b></div>`).join("")}<div><span>Combined modeled output</span><b>${num(totals.reduce((a, b) => a + b, 0) / 1000)} MWh/year</b></div></div>
      ${series.length ? `<div class="monthly-chart" role="img" aria-label="Modeled monthly generation; exact values follow">${MONTHS.map((month, m) => `<div class="monthly-column"><div class="monthly-stack">${series.map(s => `<span class="source-${s.source}" style="height:${s.monthly[m] / maximum * 100}%" title="${month} ${labels[s.source]}: ${num(s.monthly[m] / 1000)} MWh"></span>`).join("")}</div><span>${month}</span></div>`).join("")}</div>
      <div class="renewable-legend">${series.map(s => `<span><i class="source-${s.source}"></i>${labels[s.source]}</span>`).join("")}</div>
      <div class="renewable-table-wrap"><table class="payback-table"><caption>Modeled monthly output · MWh</caption><thead><tr><th>Month</th>${series.map(s => `<th>${labels[s.source]}</th>`).join("")}<th>Total</th></tr></thead><tbody>${MONTHS.map((m, i) => `<tr><th>${m}</th>${series.map(s => `<td>${num(s.monthly[i] / 1000)}</td>`).join("")}<td>${num(totals[i] / 1000)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="callout">No sources selected. Enable a source to explore output.</p>`}`;
  };
  root.querySelectorAll<HTMLInputElement>("[data-factor], [data-storage]").forEach(input => {
    const change = () => {
      if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) return;
      if (input.dataset.factor) state.factors[input.dataset.factor] = input.valueAsNumber / 100;
      else state.fraction = input.valueAsNumber / 100;
      update();
    };
    input.addEventListener("input", change);
    input.addEventListener("change", change);
  });
  root.querySelectorAll<HTMLInputElement>("[data-enable]").forEach(input => input.addEventListener("change", () => {
    if (input.checked) state.enabled.add(input.dataset.enable!); else state.enabled.delete(input.dataset.enable!);
    update();
  }));
  update();
}
