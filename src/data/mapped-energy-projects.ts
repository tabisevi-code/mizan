import type { RenewablePortfolio } from "./renewable-portfolios";
import { PUBLISHED_WAREHOUSES } from "./published-warehouses";
import { UAE_WIND_SOURCE } from "./portfolios-uae-multi";
import rawabi from "./geometry/rawabi.json";
import halah from "./geometry/halah.json";
import hatta from "./geometry/hatta.json";

const rawabiSource = "https://alrawabidairy.com/sustainability/";
const hattaSource = "https://www.dewa.gov.ae/en/about-us/strategic-initiatives/hatta-project";
const financialEvidence = { label: "Investment assessment", value: "Published capacity is not an investment return. Project revenue contracts, operating costs and annual metered output are not available here. Payback is unassessed; these cases have not been classified as passing the investment limit." };

export const MAPPED_ENERGY_PROJECTS: RenewablePortfolio = {
  id: "mapped-energy", name: "Mapped UAE Energy Projects", kind: "Named companies · solar, biogas, wind and storage", hurdleYears: 5,
  question: "Explore named installations and their mapped assets. Published specifications are separated from output scenarios; non-solar project paybacks remain unassessed.",
  sites: [
    { ...PUBLISHED_WAREHOUSES.sites[0], id: "mapped-aramex" },
    {
      id: "mapped-rawabi", name: "Al Rawabi · solar + biogas", where: "Al Khawaneej, Dubai", emirate: "dubai", location: { lat: 25.2170472, lng: 55.5290987 },
      category: "Published solar + biogas CHP", solarKw: 1000, annualKwh: 0, approvedLoadKw: null, defaultSources: ["solar"], sourceUrl: rawabiSource,
      description: "Al Rawabi reports a 1 MW solar installation and a 1.3 MW biogas plant established in 2021. These are company-reported capacities, not annual production measurements.",
      mapGeometry: rawabi,
      mapNote: "Named Al Rawabi Farm point from OpenStreetMap. Grey outlines are nearby mapped buildings; their operator is unverified. The biogas generators, digesters and solar-equipped roofs have not been individually geolocated. This is a company-location map, not an equipment survey.",
      publishedEnergy: {
        assets: [{ source: "solar", capacityKw: 1000 }, { source: "biogas", capacityKw: 1300, assumedCapacityFactor: 0.80 }],
        metrics: [{ label: "Solar capacity", value: "1 MW" }, { label: "Biogas electrical capacity", value: "1.3 MW" }, { label: "Waste treatment capacity", value: "Up to 200 t/day" }, { label: "Biogas established", value: "2021" }],
      },
      evidence: [
        { label: "Company specifications", value: "The sustainability page reports solar PV, biogas capacity and organic waste throughput. Waste throughput is not electricity output.", url: rawabiSource },
        { label: "Licensed electricity generation", value: "RSB licence EG-03/2019 authorizes a biogas combined heat and power plant up to 1.3 MWac in Al Khawaneej Area 3, with electricity delivered into the licensee's system.", url: "https://rsbdubai.gov.ae/wp-content/uploads/2020/06/EG-03-2019-Al-Rawabi-Dairy-Co_web.pdf" },
        { label: "Map provenance", value: "OpenStreetMap company point and contextual buildings retrieved 24 September 2026. Click an outline to inspect its map record.", url: "https://www.openstreetmap.org/node/3412128385" },
        { label: "Output scenarios", value: "Solar uses the existing UAE weather/loss model. Biogas starts at an assumed 80% annual capacity factor; change this below. Neither curve is metered output. CHP heat is excluded from electricity totals." },
        financialEvidence,
      ],
    },
    {
      id: "mapped-halah", name: "Masdar · Al Halah wind", where: "Al Halah, Fujairah", emirate: "fujairah", location: { lat: 25.4975118, lng: 56.1519331 },
      category: "Published wind installation", solarKw: 0, annualKwh: 0, approvedLoadKw: null, defaultSources: [], sourceUrl: UAE_WIND_SOURCE,
      description: "Masdar's October 2023 UAE Wind Program announcement identifies 4.5 MW at Al Halah. The mapped turbine is tagged with the same operator and capacity.",
      mapGeometry: halah, mapNote: "OpenStreetMap turbine point, tagged Masdar and 4.5 MW. The symbol marks the mapped turbine location; it does not represent a building or a surveyed rotor footprint.",
      publishedEnergy: { assets: [{ source: "wind", capacityKw: 4500, assumedCapacityFactor: 0.18 }], metrics: [{ label: "Wind capacity", value: "4.5 MW" }, { label: "Developer", value: "Masdar" }, { label: "Program inaugurated", value: "October 2023" }, { label: "Annual metered output", value: "Not supplied" }] },
      evidence: [
        { label: "Published project capacity", value: "Al Halah is the Fujairah installation in the 103.5 MW UAE Wind Program. The program total is not this site's capacity.", url: UAE_WIND_SOURCE },
        { label: "Mapped turbine", value: "OSM node 11361504560 identifies a wind turbine, Masdar as operator and 4.5 MW electrical output. Retrieved 24 September 2026.", url: "https://www.openstreetmap.org/node/11361504560" },
        { label: "Output scenario", value: "The adjustable 18% capacity factor is an assumption, not a measured site yield. Monthly energy varies only with month length; no measured seasonal pattern is available." },
        financialEvidence,
      ],
    },
    {
      id: "mapped-hatta", name: "DEWA · Hatta pumped storage", where: "Hatta, Dubai", emirate: "dubai", location: { lat: 24.78, lng: 56.1149 },
      category: "Hydroelectric storage · not new generation", solarKw: 0, annualKwh: 0, approvedLoadKw: null, defaultSources: [], sourceUrl: hattaSource,
      description: "DEWA publishes 250 MW discharge power, 1,500 MWh storage and 78.9% round-trip efficiency. Pumping consumes electricity; this installation shifts energy rather than creating a new renewable energy supply.",
      mapGeometry: hatta, mapNote: "Mapped shoreline of Hatta's lower reservoir. This outline is a water body, not the upper reservoir, underground powerhouse or full project boundary. Reservoir levels and shoreline can change.",
      publishedEnergy: { assets: [], storage: { powerMw: 250, energyMwh: 1500, roundTripEfficiency: 0.789 }, metrics: [{ label: "Discharge power", value: "250 MW" }, { label: "Storage capacity", value: "1,500 MWh" }, { label: "Round-trip efficiency", value: "78.9%" }, { label: "Published investment", value: "≈ AED 1.42bn" }] },
      evidence: [
        { label: "DEWA design specifications", value: "Power, storage, efficiency and investment are published project specifications. The calculator assumes the published storage figure is deliverable energy.", url: hattaSource },
        { label: "Dated project status", value: "DEWA's 26 January 2026 update described operational reliability verification, expected to finish in Q1 2026. That forecast is not treated here as confirmation of commercial operation.", url: "https://www.dewa.gov.ae/en/about-us/media-publications/latest-news/2026/1/dewas-projects-strengthen" },
        { label: "Mapped water body", value: "OSM way 863817702 is the lower Hatta reservoir. Retrieved 24 September 2026.", url: "https://www.openstreetmap.org/way/863817702" },
        financialEvidence,
      ],
    },
  ],
};
