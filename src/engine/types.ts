/**
 * Mizan engine — shared types.
 *
 * Design rule for this whole engine: every number that reaches the UI carries
 * its provenance. A figure is either measured (user evidence), fetched from a
 * named public dataset, published by a named authority, or an assumption.
 * Nothing is allowed to be an unattributed constant.
 */

export type SourceKind =
  | "user-evidence" // uploaded or typed by the operator
  | "dataset" // fetched from a public dataset (PVGIS, NASA POWER, OSM)
  | "authority" // published by DEWA / DoE / ADDC and dated
  | "model" // computed by this engine from first principles
  | "assumption"; // an industry convention we cannot cite

export type Provenance = {
  kind: SourceKind;
  /** Short label shown on the evidence chip, e.g. "PVGIS SARAH3" or "DEWA tariff". */
  label: string;
  /** URL of the source document where one exists. */
  url?: string;
  /** Date the source was published or retrieved, ISO yyyy-mm-dd. */
  asOf?: string;
  /** Anything the reader must know before trusting the number. */
  caveat?: string;
};

export type Tracked<T = number> = {
  value: T;
  unit: string;
  provenance: Provenance;
};

export const track = <T>(value: T, unit: string, provenance: Provenance): Tracked<T> => ({
  value,
  unit,
  provenance,
});

// --- geography -------------------------------------------------------------

export type Emirate =
  | "dubai"
  | "abu-dhabi"
  | "sharjah"
  | "ajman"
  | "umm-al-quwain"
  | "ras-al-khaimah"
  | "fujairah";

export type LatLng = { lat: number; lng: number };

/** A polygon ring in [lng, lat] order, first point not repeated. */
export type Ring = [number, number][];

// --- site ------------------------------------------------------------------

export type CustomerClass = "commercial" | "industrial";

export type SectorArchetype =
  | "warehouse" // ambient logistics shed, lighting + some HVAC
  | "cold-store" // refrigerated, flat round-the-clock load
  | "factory-2shift" // manufacturing, two shifts
  | "factory-24h"
  | "office"
  | "retail"
  | "data-hall";

export type SiteProfile = {
  /** Whatever the operator calls this site. Never a placeholder company. */
  siteName: string;
  organisation?: string;
  emirate: Emirate;
  customerClass: CustomerClass;
  sector: SectorArchetype;
  location: LatLng;
  /** Annual consumption in kWh. Prefer 12 monthly readings when available. */
  annualKwh: number;
  /** Optional 12 monthly kWh readings, Jan..Dec, from real bills. */
  monthlyKwh?: number[];
  /**
   * Approved Load / contracted capacity in kW as shown on the DEWA account.
   * This is the binding regulatory input for Shams Dubai sizing.
   */
  approvedLoadKw?: number;
  /** Roof polygons in [lng, lat]; area is derived, never typed. */
  roofRings?: Ring[];
  /** Open land polygons available for ground mount, [lng, lat]. */
  groundRings?: Ring[];
  /** Capex ceiling in AED, if the customer has one. */
  budgetAed?: number;
  /**
   * Fraction of annual consumption the renewable mix must cover, 0 to 1.
   * When set, the planner checks whether any buildable option reaches it and
   * reports the binding constraint and shortfall when none does.
   */
  energyTargetShare?: number;
  /**
   * How the roof is built. This is the most common reason a UAE rooftop
   * project dies after the numbers already looked good, so it is screened
   * before anything is recommended.
   */
  roofConstruction?: RoofConstruction;
  evidence: EvidenceLedger;
};

export type RoofConstruction =
  | "concrete" // reinforced concrete slab, usually plenty of spare capacity
  | "steel-deck" // profiled metal deck on steel purlins, the common warehouse roof
  | "sandwich-panel" // insulated panel, light and rarely able to take ballast
  | "unknown";

/** What the operator has actually proven, as opposed to assumed. */
export type EvidenceLedger = {
  hasRoofSurvey: boolean;
  hasStructuralReserve: boolean;
  hasLandRights: boolean;
  hasIntervalMeterData: boolean;
  hasApprovedLoadLetter: boolean;
  /** Measured mean wind speed at hub height, m/s, from a mast or LiDAR. */
  measuredWindMs?: number;
  /** Contracted feedstock, dry tonnes per day. */
  contractedBiomassTpd?: number;
  /** Measured flow and head for micro hydro. */
  hydro?: { flowCms: number; headM: number };
  /** ADCP-measured tidal current speed, m/s, and swept area. */
  tidal?: { velocityMs: number; sweptAreaM2: number };
  /** Measured geothermal gradient in C/km and drillable depth in m. */
  geothermal?: { gradientCkm: number; depthM: number };
};

// --- technologies ----------------------------------------------------------

export type TechnologyId =
  | "roof-solar"
  | "ground-solar"
  | "wind"
  | "biomass"
  | "hydro"
  | "tidal"
  | "geothermal"
  | "battery";

/**
 * Generation sources the monthly energy-mix path can combine. Narrower than
 * TechnologyId: the monthly model only handles sources with a monthly yield
 * profile, and biogas/tidal sit outside it today.
 */
export type RenewableSource = "solar" | "wind" | "hydro" | "geothermal";

export type ScreenStatus =
  | "eligible" // physically and legally usable with what we know
  | "needs-evidence" // could work, but a named measurement is missing
  | "not-permitted" // a regulator forbids it here
  | "not-viable"; // the resource is not there

export type ScreenResult = {
  id: TechnologyId;
  label: string;
  status: ScreenStatus;
  /** One sentence a non-engineer can act on. */
  reason: string;
  /** What would have to be measured or obtained to move this to eligible. */
  unblockedBy?: string;
  provenance: Provenance;
};

// --- simulation ------------------------------------------------------------

/** 8760 hourly values, index 0 = 1 Jan 00:00 local standard time. */
export type HourlySeries = Float64Array;

export type YieldSource = "pvgis-tmy" | "modelled-clear-sky";

export type PvArraySpec = {
  kwp: number;
  tiltDeg: number;
  /** 0 = south, 90 = west, -90 = east. */
  azimuthDeg: number;
  mounting: "roof-flat" | "roof-pitched" | "ground";
  /** DC to AC ratio; clipping is modelled. */
  dcAcRatio: number;
};

export type SimulationResult = {
  generationKwh: number;
  selfConsumedKwh: number;
  exportedKwh: number;
  importedKwh: number;
  batteryThroughputKwh: number;
  batteryCycles: number;
  /** Energy lost to round-trip inefficiency over the year, kWh. */
  batteryLossKwh: number;
  /** Energy still stored at the end of the year, kWh. */
  batteryStoredKwh: number;
  peakImportKw: number;
  hourly: {
    generation: HourlySeries;
    load: HourlySeries;
    imported: HourlySeries;
    exported: HourlySeries;
    batterySoc: HourlySeries;
  };
};

export const HOURS_PER_YEAR = 8760;

export const newSeries = (): HourlySeries => new Float64Array(HOURS_PER_YEAR);

export const sum = (series: HourlySeries): number => {
  let total = 0;
  for (let i = 0; i < series.length; i += 1) total += series[i];
  return total;
};
