import type { RenewablePortfolio } from "./renewable-portfolios";
import aramexGeometry from "./geometry/aramex.json";

const aramex = "https://www2.aramex.com/ae/en/media-details/news/news-details?contentId=11826288-b3f2-659d-9310-ff0000e7fe0c&module=stories&page=16";
const ikea = "https://www.alecenergy.ae/project/shaper-house";
const shared = [
  { label: "Cost benchmark · assumption", value: "AED 2,500/kWp: midpoint of MCC's AED 2,400–2,600/kW rooftop benchmark in real 2024 prices (report p. 13). Not either project's capex or a current quote; replace with a supplier offer.", url: "https://www.ipfa.org/wp-content/uploads/2025/01/Solar-report-from-MCC.pdf" },
  { label: "Avoided rate · dated scenario", value: "AED 0.44/kWh = DEWA top slab 0.38 + September 2026 fuel surcharge 0.06, excluding VAT. Assumes avoided units remain in the top slab and this fuel rate persists; reduce for lower-slab consumption or discounted contracts.", url: "https://www.dewa.gov.ae/en/consumer/billing/slab-tariff" },
  { label: "O&M · assumption", value: "1.5% of capex annually. No operator maintenance costs published in the linked sources." },
  { label: "Evidence checked", value: "24 September 2026. Existing installations used as comparison cases, not available properties or confirmed new investment opportunities. Actual payback, approved load and interval meter data remain unverified." },
];

export const PUBLISHED_WAREHOUSES: RenewablePortfolio = {
  id: "published-warehouses", name: "Published UAE Warehouses", kind: "Real projects · editable financial scenarios", hurdleYears: 5,
  question: "How do published warehouse installations perform against the same five-year limit using transparent cost and tariff assumptions?",
  sites: [
    {
      id: "published-aramex", name: "Aramex · Dubai Logistics City", where: "Dubai Logistics City", emirate: "dubai", location: { lat: 24.9077, lng: 55.1110 },
      mapGeometry: aramexGeometry,
      mapNote: "OpenStreetMap's named Aramex warehouse footprint (way 307805557). The outline locates the building; it does not verify which roof sections carry the published solar installation or show a surveyed panel layout. Retrieved 24 September 2026.",
      category: "Published capacity + annual yield", solarKw: 3200, solarAnnualKwh: 5_000_000, annualKwh: 5_000_000 / 0.60,
      approvedLoadKw: null, defaultSources: ["solar"], defaultTariff: 0.44, solarCostPerKw: 2500, sourceUrl: aramex,
      description: "Existing Aramex warehouse installation. Published capacity and approximate annual yield anchor this scenario; payback is modeled, not Aramex's reported investment return. Monthly generation is a modeled distribution of the published annual yield.",
      evidence: [
        { label: "Published installation", value: "3.2 MW solar, approximately 5 GWh/year, 9,000 panels and 38,000 m² roof area. Aramex's announcement forecasts 60% of facility electricity supplied by solar.", url: aramex },
        { label: "Consumption · derived estimate", value: "8.33 GWh/year = published approximate 5 GWh / forecast 60%. Not a meter reading. Uniform monthly power demand is assumed; replace with actual consumption." },
        ...shared,
      ],
    },
    {
      id: "published-ikea", name: "IKEA Supply · DWC warehouse", where: "Dubai World Central Free Zone", emirate: "dubai", location: { lat: 24.89, lng: 55.10 },
      category: "Published capacity · modeled yield", solarKw: 3000, annualKwh: 8_000_000,
      approvedLoadKw: null, defaultSources: ["solar"], defaultTariff: 0.44, solarCostPerKw: 2500, sourceUrl: ikea,
      description: "ALEC Energy documents the warehouse's 3 MWp system completed in 2021. Output and consumption below are screening assumptions; neither generation nor financial performance is claimed as IKEA operating data.",
      evidence: [
        { label: "Published installation", value: "3 MWp grid-connected warehouse solar system, completed in 2021. ALEC lists SunPower modules, SMA inverters and robotic cleaning.", url: ikea },
        { label: "Generation · modeled", value: "Existing UAE solar model at approximate DWC coordinates, including temperature and dust losses; no published annual yield in this project source." },
        { label: "Consumption · assumption", value: "8 GWh/year comparison load with uniform power demand. Not IKEA's metered consumption; edit below to assess lower usage." },
        ...shared,
      ],
    },
  ],
};
