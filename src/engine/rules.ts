/**
 * Regulatory constraints on distributed generation, by emirate.
 *
 * This is the module that stops Mizan recommending something a customer cannot
 * legally build. The Dubai rules are the hard ones and they are published; the
 * Abu Dhabi and Northern Emirates rules are partly unpublished and are marked
 * `confidence: "unverified"` so the UI can say so rather than bluff.
 */

import { HYDRO_TURBINE_EFFICIENCY } from "./renewable-combinations";
import type {
  ScreenStatus,
  Emirate,
  Provenance,
  RoofConstruction,
  ScreenResult,
  SiteProfile,
  TechnologyId,
} from "./types";

export type RuleSet = {
  emirate: Emirate;
  scheme: string;
  /** Hard cap on installed PV per plot in kW, if published. */
  plotCapKw: number | null;
  /** True when PV capacity may not exceed the account's Approved Load. */
  cappedByApprovedLoad: boolean;
  groundMountPermitted: boolean;
  exportTreatment: "credit-rollover-indefinite" | "credit-expires-annually" | "unknown";
  /** True when only utility-enrolled contractors may design and install. */
  enrolledContractorRequired: boolean;
  connectionFeeAed: number | null;
  confidence: "published" | "partial" | "unverified";
  provenance: Provenance;
  notes: string[];
};

export const RULE_SETS: Record<Emirate, RuleSet> = {
  dubai: {
    emirate: "dubai",
    scheme: "Shams Dubai (DEWA DRRG)",
    plotCapKw: 2080,
    cappedByApprovedLoad: true,
    groundMountPermitted: false,
    exportTreatment: "credit-rollover-indefinite",
    enrolledContractorRequired: true,
    connectionFeeAed: 1500,
    confidence: "published",
    provenance: {
      kind: "authority",
      label: "DEWA DRRG connection conditions",
      url: "https://www.dewa.gov.ae/en/consumer/solar-community/shams-dubai/shams-dubai-faq",
      asOf: "2026-09-23",
    },
    notes: [
      "Installed capacity may not exceed the sum of Approved Load across the plot's consumption accounts.",
      "Hard ceiling of 2,080 kW per plot, stated as admitting no exceptions.",
      "Ground-mounted systems are not eligible under Shams Dubai; rooftop and building-integrated only.",
      "Surplus export is credited to future bills indefinitely and is never paid out in cash.",
      "Design and installation must be by a DEWA-enrolled DRRG consultant and contractor.",
    ],
  },
  "abu-dhabi": {
    emirate: "abu-dhabi",
    scheme: "DoE Self-Supply Solar and Battery Policy",
    plotCapKw: null,
    cappedByApprovedLoad: true,
    groundMountPermitted: true,
    exportTreatment: "unknown",
    enrolledContractorRequired: true,
    connectionFeeAed: null,
    confidence: "partial",
    provenance: {
      kind: "authority",
      label: "Abu Dhabi DoE self-supply policy",
      url: "https://www.doe.gov.ae",
      asOf: "2026-09-23",
      caveat:
        "Policy effective 5 February 2026. Capacity caps and export compensation are not published in the sources checked; treat sizing here as indicative until the primary document is obtained.",
    },
    notes: [
      "A self-supply scheme exists for businesses as of February 2026.",
      "The scheme name implies export is discouraged; do not model export revenue.",
      "Capacity limits are unconfirmed, so sizing falls back to the site's own approved load.",
    ],
  },
  sharjah: {
    emirate: "sharjah",
    scheme: "SEWA — no scheme confirmed",
    plotCapKw: null,
    cappedByApprovedLoad: true,
    groundMountPermitted: true,
    exportTreatment: "unknown",
    enrolledContractorRequired: true,
    connectionFeeAed: null,
    confidence: "unverified",
    provenance: {
      kind: "authority",
      label: "SEWA",
      asOf: "2026-09-23",
      caveat: "No authoritative distributed-generation scheme found. Confirm with SEWA directly.",
    },
    notes: ["Treat any Sharjah export or net-metering assumption as unverified."],
  },
  ajman: northernEmirates("ajman"),
  "umm-al-quwain": northernEmirates("umm-al-quwain"),
  "ras-al-khaimah": northernEmirates("ras-al-khaimah"),
  fujairah: northernEmirates("fujairah"),
};

function northernEmirates(emirate: Emirate): RuleSet {
  return {
    emirate,
    scheme: "EtihadWE Distributed Solar System",
    plotCapKw: null,
    cappedByApprovedLoad: true,
    groundMountPermitted: true,
    exportTreatment: "credit-expires-annually",
    enrolledContractorRequired: true,
    connectionFeeAed: null,
    confidence: "partial",
    provenance: {
      kind: "authority",
      label: "EtihadWE distributed solar",
      url: "https://en.aletihad.ae/news/uae/4515795/",
      asOf: "2026-09-23",
    },
    notes: [
      "A separate meter is required for the generator.",
      "Surplus credit expires within the same year, unlike Dubai's indefinite rollover.",
      "Municipal structural approval and an EtihadWE-certified contractor are required.",
    ],
  };
}

export type CapResult = {
  /** The largest PV system the rules allow, kW. */
  capKw: number;
  /** Which rule bound it. */
  bindingRule: "approved-load" | "plot-cap" | "none";
  explanation: string;
};

export const regulatoryCap = (site: SiteProfile): CapResult => {
  const rules = RULE_SETS[site.emirate];
  const limits: { kw: number; rule: CapResult["bindingRule"]; text: string }[] = [];

  if (rules.cappedByApprovedLoad && site.approvedLoadKw && site.approvedLoadKw > 0) {
    limits.push({
      kw: site.approvedLoadKw,
      rule: "approved-load",
      text: `${rules.scheme} caps installed capacity at the plot's Approved Load of ${site.approvedLoadKw.toLocaleString()} kW.`,
    });
  }
  if (rules.plotCapKw) {
    limits.push({
      kw: rules.plotCapKw,
      rule: "plot-cap",
      text: `${rules.scheme} sets a hard ceiling of ${rules.plotCapKw.toLocaleString()} kW per plot.`,
    });
  }

  if (limits.length === 0) {
    return {
      capKw: Number.POSITIVE_INFINITY,
      bindingRule: "none",
      explanation:
        "No capacity cap could be applied because the site's Approved Load has not been supplied. Sizing is limited by roof area alone, which will usually overstate what the utility will approve.",
    };
  }

  const binding = limits.reduce((lowest, item) => (item.kw < lowest.kw ? item : lowest));
  return { capKw: binding.kw, bindingRule: binding.rule, explanation: binding.text };
};

// --- roof structure --------------------------------------------------------

/**
 * A ballasted flat-roof array weighs roughly 15 kg per square metre once the
 * concrete blocks holding it down are counted. Plenty of warehouse roofs in the
 * UAE cannot take that, and finding out late is the single most common way a
 * project dies after the financial case already looked good. So the roof is
 * screened before anything is recommended.
 */
export const BALLASTED_ARRAY_LOAD_KG_M2 = 15;
export const RAILED_LIGHTWEIGHT_LOAD_KG_M2 = 7;

export type StructuralVerdict = {
  construction: RoofConstruction;
  /** Rough spare imposed-load capacity in kg/m2, before an engineer checks it. */
  indicativeSpareKgM2: number | null;
  status: ScreenStatus;
  headline: string;
  detail: string;
  /** Mounting the engine should assume for cost and area purposes. */
  recommendedMounting: "ballasted" | "railed-lightweight" | "blocked";
  provenance: Provenance;
};

export const screenStructure = (construction: RoofConstruction = "unknown"): StructuralVerdict => {
  const provenance: Provenance = {
    kind: "assumption",
    label: "Structural screening",
    asOf: "2026-09-23",
    caveat:
      "Indicative only, from roof construction type. No substitute for a structural engineer's assessment of the actual roof.",
  };

  switch (construction) {
    case "concrete":
      return {
        construction,
        indicativeSpareKgM2: 150,
        status: "eligible",
        headline: "Concrete slab, normally fine",
        detail:
          "A reinforced concrete roof usually carries a ballasted array of about 15 kg/m2 without strengthening. An engineer still signs it off, but this rarely stops a project.",
        recommendedMounting: "ballasted",
        provenance,
      };
    case "steel-deck":
      return {
        construction,
        indicativeSpareKgM2: 25,
        status: "needs-evidence",
        headline: "Steel deck, needs a check",
        detail:
          "Profiled metal deck on purlins is the standard warehouse roof and is usually close to the line. Ballast of about 15 kg/m2 is often acceptable between purlins, but purlin spacing and wind uplift decide it. Get the structural drawings before quoting.",
        recommendedMounting: "ballasted",
        provenance,
      };
    case "sandwich-panel":
      return {
        construction,
        indicativeSpareKgM2: 10,
        status: "needs-evidence",
        headline: "Sandwich panel, ballast unlikely",
        detail:
          "Insulated sandwich panels are light and rarely take ballast. A rail system fixed to the structure below at roughly 7 kg/m2 is the usual route, which costs more per kilowatt and needs penetrations sealed to protect the roof warranty.",
        recommendedMounting: "railed-lightweight",
        provenance,
      };
    default:
      return {
        construction: "unknown",
        indicativeSpareKgM2: null,
        status: "needs-evidence",
        headline: "Roof build not stated",
        detail:
          "Nobody has said how this roof is built, so nobody can say whether it takes 15 kg/m2 of ballast. This is the question that most often kills a rooftop project late, so ask it first.",
        recommendedMounting: "ballasted",
        provenance,
      };
  }
};

// --- technology screening --------------------------------------------------

const MODEL_SOURCE: Provenance = {
  kind: "model",
  label: "Mizan screening rules",
  asOf: "2026-09-23",
};

/**
 * Screen every technology against what the site has actually proven and what
 * the emirate permits. The point of keeping the marine and geothermal options
 * in the product is to return a defensible no with a reason, not to imply they
 * are live options in the Gulf.
 */
export const screenTechnologies = (site: SiteProfile, roofAreaM2: number, groundAreaM2: number): ScreenResult[] => {
  const rules = RULE_SETS[site.emirate];
  const evidence = site.evidence;
  const results: ScreenResult[] = [];

  const structure = screenStructure(site.roofConstruction);
  results.push({
    id: "roof-solar",
    label: "Rooftop solar",
    status:
      roofAreaM2 < 200
        ? "not-viable"
        : evidence.hasStructuralReserve
          ? "eligible"
          : structure.status,
    reason:
      roofAreaM2 < 200
        ? "Less than 200 m2 of usable roof was mapped, which cannot carry a worthwhile array."
        : `${Math.round(roofAreaM2).toLocaleString()} m2 of roof mapped. ${structure.headline}.`,
    unblockedBy: evidence.hasStructuralReserve
      ? undefined
      : `${structure.detail} A roof condition and warranty check goes with it.`,
    provenance: MODEL_SOURCE,
  });

  results.push({
    id: "ground-solar",
    label: "Ground-mounted solar",
    status: !rules.groundMountPermitted
      ? "not-permitted"
      : groundAreaM2 < 1000
        ? "not-viable"
        : evidence.hasLandRights
          ? "eligible"
          : "needs-evidence",
    reason: !rules.groundMountPermitted
      ? `${rules.scheme} does not permit ground-mounted systems, so this cannot be connected in ${labelEmirate(site.emirate)} whatever the land area.`
      : groundAreaM2 < 1000
        ? "Less than 1,000 m2 of open land was mapped after setbacks."
        : `${Math.round(groundAreaM2).toLocaleString()} m2 of open land was mapped.`,
    unblockedBy:
      rules.groundMountPermitted && !evidence.hasLandRights
        ? "Lease or title showing the right to build on the parcel, plus easements and drainage."
        : undefined,
    provenance: rules.provenance,
  });

  const wind = evidence.measuredWindMs;
  results.push({
    id: "wind",
    label: "Small wind",
    status: wind === undefined ? "needs-evidence" : wind < 5.5 ? "not-viable" : "eligible",
    reason:
      wind === undefined
        ? "No measured wind speed at hub height has been supplied. Coastal UAE annual means are typically 3 to 4 m/s at 10 m, which is below the economic threshold for small turbines."
        : wind < 5.5
          ? `Measured mean wind of ${wind.toFixed(1)} m/s is below the roughly 5.5 m/s needed for a small turbine to pay back.`
          : `Measured mean wind of ${wind.toFixed(1)} m/s could support a small turbine.`,
    unblockedBy:
      wind === undefined
        ? "Twelve months of mast or LiDAR data at hub height, plus turbulence, aviation and noise clearances."
        : undefined,
    provenance: MODEL_SOURCE,
  });

  const biomass = evidence.contractedBiomassTpd ?? 0;
  results.push({
    id: "biomass",
    label: "Biomass",
    status: biomass >= 1.5 ? "needs-evidence" : "not-viable",
    reason:
      biomass >= 1.5
        ? `${biomass.toFixed(1)} dry tonnes per day of contracted feedstock was declared.`
        : "No contracted feedstock was declared. A map cannot prove a fuel supply, and an uncontracted waste stream is not a resource.",
    unblockedBy:
      biomass >= 1.5
        ? "Signed multi-year feedstock supply, storage and handling design, and an emissions permit path."
        : "A signed feedstock contract stating dry tonnes per day and moisture content.",
    provenance: MODEL_SOURCE,
  });

  const hydro = evidence.hydro;
  const hydroKw = hydro ? 9.81 * hydro.flowCms * hydro.headM * HYDRO_TURBINE_EFFICIENCY : 0;
  results.push({
    id: "hydro",
    label: "Micro hydro",
    status: hydroKw >= 5 ? "needs-evidence" : "not-viable",
    reason:
      hydroKw >= 5
        ? `Declared flow and head give roughly ${Math.round(hydroKw)} kW of hydraulic potential.`
        : "No perennial watercourse with usable head has been declared. The UAE has no perennial rivers, so this is normally a no before any survey.",
    unblockedBy:
      hydroKw >= 5 ? "A flow-duration curve, a surveyed head, and water abstraction rights." : undefined,
    provenance: MODEL_SOURCE,
  });

  const tidal = evidence.tidal;
  const tidalKw = tidal ? (0.5 * 1025 * tidal.sweptAreaM2 * tidal.velocityMs ** 3 * 0.35) / 1000 : 0;
  results.push({
    id: "tidal",
    label: "Tidal stream",
    status: tidalKw >= 10 ? "needs-evidence" : "not-viable",
    reason:
      tidalKw >= 10
        ? `Declared current and swept area give roughly ${Math.round(tidalKw)} kW.`
        : "No measured tidal current has been declared. Gulf tidal streams are generally well under the roughly 2 m/s that tidal turbines need, and output falls with the cube of speed.",
    unblockedBy:
      tidalKw >= 10
        ? "An ADCP current survey, bathymetry, a marine works permit and a cable landing route."
        : undefined,
    provenance: MODEL_SOURCE,
  });

  const geo = evidence.geothermal;
  const geoIndex = geo ? ((geo.gradientCkm - 30) / 35) * (geo.depthM / 1800) : 0;
  results.push({
    id: "geothermal",
    label: "Geothermal",
    status: geoIndex >= 0.45 ? "needs-evidence" : "not-viable",
    reason:
      geoIndex >= 0.45
        ? `Declared gradient and depth suggest a resource worth a feasibility study.`
        : "No measured gradient has been declared. Power generation needs a well above roughly 120 C; shallow UAE gradients suit heating and cooling, not electricity.",
    unblockedBy:
      geoIndex >= 0.45
        ? "A gradient survey or nearby well logs, a drilling risk assessment and a reinjection plan."
        : undefined,
    provenance: MODEL_SOURCE,
  });

  results.push({
    id: "battery",
    label: "Battery storage",
    status: evidence.hasIntervalMeterData ? "eligible" : "needs-evidence",
    reason: evidence.hasIntervalMeterData
      ? "Interval meter data is available, so storage value can be simulated hour by hour."
      : "Without interval meter data, storage value is simulated against a sector load shape rather than this site's real profile.",
    unblockedBy: evidence.hasIntervalMeterData
      ? undefined
      : "Twelve months of 15-minute or hourly consumption data from the utility.",
    provenance: MODEL_SOURCE,
  });

  return results;
};

export const labelEmirate = (emirate: Emirate): string =>
  ({
    dubai: "Dubai",
    "abu-dhabi": "Abu Dhabi",
    sharjah: "Sharjah",
    ajman: "Ajman",
    "umm-al-quwain": "Umm Al Quwain",
    "ras-al-khaimah": "Ras Al Khaimah",
    fujairah: "Fujairah",
  })[emirate];

export const isBuildable = (id: TechnologyId, screens: ScreenResult[]): boolean => {
  const screen = screens.find((item) => item.id === id);
  if (!screen) return false;
  return screen.status === "eligible" || screen.status === "needs-evidence";
};
