import { solarMonthlyYield, windMonthlyKwhPerKw, type RenewableSource } from "./uae-monthly-profiles";
import { hydroMonthlyYield, type RenewableSystem } from "../engine/renewable-combinations";
import type { Emirate, LatLng } from "../engine/types";
import type { ProjectMap, PublishedEnergy } from "./mapped-project-types";

export const UAE_WIND_SOURCE = "https://masdar.ae/en/news/newsroom/khaled-bin-mohamed-bin-zayed-inaugurates-uae-wind-program";

export type RenewableCase = {
  id: string; name: string; where: string; location: LatLng; annualKwh: number;
  emirate: Emirate;
  description: string; category: string; solarKw: number; windKw?: number; windProfile?: string;
  /** The site's utility-approved load, kW — from a bill or account figure; null = not supplied. */
  approvedLoadKw?: number | null;
  /** Turbine archetype the site's windKw is modelled with; default mid-900. */
  windTurbine?: string;
  hydro?: { capacityKw: number; headM: number; flowCms: number[] };
  defaultSources: RenewableSource[]; sourceUrl?: string;
  solarMonthly?: number[];
  solarAnnualKwh?: number;
  defaultTariff?: number;
  solarCostPerKw?: number;
  evidence?: { label: string; value: string; url?: string }[];
  mapGeometry?: ProjectMap;
  mapNote?: string;
  publishedEnergy?: PublishedEnergy;
};
const example = (id: string, name: string, where: string, emirate: Emirate, lat: number, lng: number, solarKw: number, annualKwh: number,
  windKw = 0, windProfile?: string): RenewableCase => ({
  id, name, where, emirate, location: { lat, lng }, solarKw, annualKwh, windKw, windProfile,
  category: windKw ? "Solar + wind" : "Solar only",
  defaultSources: windKw ? ["solar", "wind"] : ["solar"],
  description: "Illustrative operator at a real UAE location. Load, capacity and cost are screening assumptions; wind output is modelled from the Global Wind Atlas and ERA5 climate at the site's coordinates, not a mast survey.",
});

export const UAE_RENEWABLE_CASES: RenewableCase[] = [
  example("dic-solar", "DIC parts manufacturer", "Dubai Industrial City", "dubai", 24.91, 55.15, 1000, 3_000_000),
  example("sharjah-solar", "Sharjah packaging works", "Sharjah industrial area", "sharjah", 25.35, 55.43, 500, 1_800_000),
  example("ajman-solar", "Ajman distribution hub", "Ajman", "ajman", 25.41, 55.44, 300, 1_000_000),
  example("uaq-solar", "Umm Al Quwain cold store", "Umm Al Quwain", "umm-al-quwain", 25.56, 55.55, 400, 1_500_000),
  example("jebel-ali-mix", "Jebel Ali logistics yard", "Jebel Ali, Dubai", "dubai", 25.0118, 55.0877, 1000, 4_000_000, 500, "jebel-ali"),
  example("ruwais-mix", "Ruwais process facility", "Ruwais, Abu Dhabi", "abu-dhabi", 24.11, 52.73, 5000, 12_000_000, 3000, "ruwais"),
  example("madinat-zayed-mix", "Madinat Zayed agro-processing", "Madinat Zayed, Abu Dhabi", "abu-dhabi", 23.65, 53.71, 800, 2_500_000, 900, "madinat-zayed"),
  example("fujairah-mix", "Fujairah materials plant", "Fujairah", "fujairah", 25.12, 56.33, 1000, 5_000_000, 500, "fujairah"),
  example("khorfakkan-mix", "Khor Fakkan port services", "Khor Fakkan, Sharjah", "sharjah", 25.34, 56.35, 500, 2_000_000, 300, "khorfakkan"),
  example("rak-mix", "RAK ceramics workshop", "Ras Al Khaimah", "ras-al-khaimah", 25.79, 55.95, 1000, 4_000_000, 500, "ras-al-khaimah"),
  {
    ...example("sir-bani-yas", "Masdar · Sir Bani Yas", "Sir Bani Yas, Abu Dhabi", "abu-dhabi", 24.32, 52.60, 14000, 120_000_000, 45000, "sir-bani-yas"),
    windTurbine: "utility-4500",
    category: "Published solar + wind", sourceUrl: UAE_WIND_SOURCE,
    description: "Masdar reports 14 MWp solar and 45 MW wind here (2023). Capacities are published; generation, comparison load, costs and tariff below are assumptions, not project financials. Solar uses a generic rooftop-loss model at regional coordinates.",
  },
  {
    ...example("delma", "Masdar · Delma wind", "Delma Island, Abu Dhabi", "abu-dhabi", 24.50, 52.31, 0, 60_000_000, 27000, "delma"),
    windTurbine: "utility-4500",
    category: "Published wind only", defaultSources: ["wind"], sourceUrl: UAE_WIND_SOURCE,
    description: "Masdar reports a 27 MW wind installation at Delma (2023). Output, comparison load and financial inputs are illustrative; published capacity does not establish a site's capacity factor.",
  },
  {
    ...example("jais-wind", "Jebel Jais research scenario", "Jebel Jais, Ras Al Khaimah", "ras-al-khaimah", 25.95, 56.13, 0, 1_000_000, 300, "jebel-jais"),
    windTurbine: "utility-2000",
    category: "Wind only · hypothetical", defaultSources: ["wind"],
    description: "A sensitivity case, not a proposed or verified wind project. Elevation alone cannot establish wind yield; terrain, protected land, access and hub-height measurements need assessment.",
  },
  {
    ...example("sila-wind", "Masdar · Sila wind", "Al Sila, Abu Dhabi", "abu-dhabi", 24.05, 51.60, 0, 50_000_000, 24000, "sila"),
    windTurbine: "utility-4500",
    category: "Published wind only", defaultSources: ["wind"], sourceUrl: UAE_WIND_SOURCE,
    description: "Sila is one of the four UAE Wind Program sites (2023). The 24 MW figure is Masdar's published program capacity share; modelled yield uses the Atlas ridge-level climate, not metered output.",
  },
  {
    ...example("wadi-ham", "Wadi Ham water facility", "Wadi Ham, Fujairah", "fujairah", 25.15, 56.25, 200, 700_000),
    category: "Solar + hydro · hypothetical", defaultSources: ["solar", "hydro"],
    hydro: { capacityKw: 10, headM: 12, flowCms: [0.04, 0.03, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0.02] },
    description: "Hypothetical recoverable flow through an existing water facility: 12 m head, 65% efficiency, Jan/Feb/Mar/Dec flows of 0.04/0.03/0.01/0.02 m³/s. These are sensitivity inputs, not measured wadi flows. Seasonal natural runoff is not firm generation.",
  },
];

/** Generic screening costs in AED/kW and annual O&M as a share of capex.
 * Explicit assumptions, not UAE vendor quotations or published project costs. */
export const RENEWABLE_COSTS = {
  solar: { capexAedPerKw: 3000, annualOmFraction: 0.015 },
  wind: { capexAedPerKw: 6500, annualOmFraction: 0.03 },
  hydro: { capexAedPerKw: 12000, annualOmFraction: 0.04 },
  geothermal: { capexAedPerKw: 20000, annualOmFraction: 0.04 },
};

export function systemsForCase(site: RenewableCase, capacities: Partial<Record<RenewableSource, number>> = {}): RenewableSystem[] {
  const systems: RenewableSystem[] = [];
  if (site.solarKw > 0) systems.push({ source: "solar", capacityKw: site.solarKw,
    monthlyKwhPerKw: solarYieldFor(site), ...RENEWABLE_COSTS.solar, capexAedPerKw: site.solarCostPerKw ?? RENEWABLE_COSTS.solar.capexAedPerKw });
  if (site.windKw && site.windProfile) {
    systems.push({ source: "wind", capacityKw: site.windKw, monthlyKwhPerKw: windMonthlyKwhPerKw(site.windProfile, site.windTurbine ?? "mid-900"), ...RENEWABLE_COSTS.wind });
  }
  if (site.hydro) systems.push({ source: "hydro", capacityKw: site.hydro.capacityKw,
    monthlyKwhPerKw: hydroMonthlyYield(site.hydro.capacityKw, site.hydro.headM, site.hydro.flowCms), ...RENEWABLE_COSTS.hydro });
  return systems.map(system => {
    const capacityKw = capacities[system.source] ?? system.capacityKw;
    return { ...system, capacityKw,
      monthlyKwhPerKw: system.source === "hydro" && site.hydro
        ? hydroMonthlyYield(capacityKw, site.hydro.headM, site.hydro.flowCms)
        : system.monthlyKwhPerKw };
  });
}

function solarYieldFor(site: RenewableCase): number[] {
  const shape = site.solarMonthly ?? solarMonthlyYield(site.location);
  if (site.solarAnnualKwh === undefined) return shape;
  const total = shape.reduce((a, b) => a + b, 0);
  return shape.map(v => v / total * site.solarAnnualKwh! / site.solarKw);
}
