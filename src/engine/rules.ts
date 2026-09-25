/**
 * Regulatory constraints on distributed generation, by emirate.
 *
 * This is the module that stops Mizan recommending something a customer cannot
 * legally build. The Dubai rules are the hard ones and they are published; the
 * Abu Dhabi and Northern Emirates rules are partly unpublished and are marked
 * `confidence: "unverified"` so the UI can say so rather than bluff.
 */

import type {
  ScreenStatus,
  Emirate,
  Provenance,
  RoofConstruction,
  ScreenResult,
  SiteProfile,
  TechnologyId,
} from "./types";
import { nearestWindSite, siteDistanceKm } from "../data/wind-sites";
import { windYield, WIND_CLIMATE_META, type WindYield } from "./wind";

export type RuleSet = {
  emirate: Emirate;
  scheme: string;
  /** Hard cap on installed PV per plot in kW, if published. */
  plotCapKw: number | null;
  /** True when PV capacity is bounded by the account's Approved Load (or a published fraction of it). */
  cappedByApprovedLoad: boolean;
  /** Fraction of Approved Load a unit may connect, where the scheme publishes one (EtihadWE: 10%). */
  approvedLoadFraction?: number;
  groundMountPermitted: boolean;
  exportTreatment: "credit-rollover-indefinite" | "credit-expires-annually" | "unknown";
  /** True when only utility-enrolled contractors may design and install. */
  enrolledContractorRequired: boolean;
  connectionFeeAed: number | null;
  /** Published connection path for technologies other than solar PV. "none" means none is published. */
  nonSolarScheme: string;
  confidence: "published" | "partial" | "unverified";
  provenance: Provenance;
  notes: string[];
};

export const RULE_SETS: Record<Emirate, RuleSet> = {
  dubai: {
    emirate: "dubai",
    scheme: "Shams Dubai (DEWA DRRG v4.1)",
    plotCapKw: 1000,
    cappedByApprovedLoad: true,
    groundMountPermitted: false,
    exportTreatment: "credit-rollover-indefinite",
    enrolledContractorRequired: true,
    connectionFeeAed: 1500,
    nonSolarScheme: "none",
    confidence: "published",
    provenance: {
      kind: "authority",
      label: "DEWA DRRG Connection Conditions v4.1 (Nov 2025)",
      url: "https://www.dewa.gov.ae/-/media/Files/DRRG2025/DEWA-DRRG-Connection-Conditions_EN_V4-1_20251127.ashx",
      asOf: "2026-09-25",
    },
    notes: [
      "Installed capacity is bounded by the tiered Total Connected Load table in v4.1: 100% of the first 100 kW, 75% of the next 100, 50% of 200-400, 25% of 400-600 and 5% above, which tops out at 1,000 kW of DRRG contribution per plot.",
      "Ground-mounted systems are not eligible under Shams Dubai; rooftop and building-integrated only.",
      "Surplus export is credited to future bills indefinitely and is never paid out in cash.",
      "Design and installation must be by a DEWA-enrolled DRRG consultant and contractor, and DEWA design approval is required in all cases.",
      "Third-party off-grid generation in Dubai is not permitted except emergency backup systems or exceptional cases with prior written DEWA approval (Law 27/2021, Resolution 46/2014).",
      "The published scheme covers solar PV only; wind, biogas and other generation require a bespoke RSB generation licence, as Al Rawabi's EG-03/2019 shows.",
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
    nonSolarScheme: "DoE self-supply licence framework (bespoke)",
    confidence: "partial",
    provenance: {
      kind: "authority",
      label: "DoE/ED/G04/005 self-supply policy",
      url: "https://www.doe.gov.ae/-/media/Project/DOE/Department-Of-Energy/Media-Center-Publications/2026/Feb/PV-and-Battery-Energy-Storage-Systems-For-Self-Supply-Policy.pdf",
      asOf: "2026-09-25",
      caveat:
        "Primary policy obtained (effective 5 February 2026). Capacity caps and network-connection technical standards are deferred to implementing instruments the DoE has not yet published, so sizing remains indicative.",
    },
    notes: [
      "Self-supply requires a Self-Supply Licence under Abu Dhabi Law No. 2 of 1998; the licensing guide is DoE/ED/P04/005.",
      "The policy does not permit net metering, cross-plot electricity sales or private-wire arrangements unless explicitly authorised by the DoE. Export is metered separately and allowed only if expressly authorised, licensed and approved.",
      "New self-supply licences for industrial consumers are paused until the Self-Supply Committee's threshold and framework are approved; large consumers are assessed case-by-case.",
      "Do not model export revenue; treat exported energy as uncompensated unless a DoE authorisation is evidenced.",
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
    nonSolarScheme: "none published",
    confidence: "unverified",
    provenance: {
      kind: "authority",
      label: "SEWA + Federal Decree-Law 17/2022",
      url: "https://uaelegislation.gov.ae/en/legislations/1567",
      asOf: "2026-09-25",
      caveat:
        "Federal Decree-Law 17/2022 obliges every distribution utility to accept distributed renewable connections under MoEI rules, but SEWA's own published customer scheme was not found. Confirm with SEWA directly.",
    },
    notes: [
      "Federal Decree-Law 17/2022 (effective 28 October 2022) applies to all producers, including free zones.",
      "Treat any Sharjah export or net-metering assumption as unverified until SEWA publishes its process.",
    ],
  },
  ajman: northernEmirates("ajman"),
  "umm-al-quwain": northernEmirates("umm-al-quwain"),
  "ras-al-khaimah": northernEmirates("ras-al-khaimah"),
  fujairah: northernEmirates("fujairah"),
};

function northernEmirates(emirate: Emirate): RuleSet {
  return {
    emirate,
    scheme: "EtihadWE DER connection (MoEI decision, Nov 2024)",
    plotCapKw: 1000,
    cappedByApprovedLoad: true,
    approvedLoadFraction: 0.1,
    groundMountPermitted: true,
    exportTreatment: "credit-expires-annually",
    enrolledContractorRequired: true,
    connectionFeeAed: null,
    nonSolarScheme: "same DER framework (renewable production units)",
    confidence: "partial",
    provenance: {
      kind: "authority",
      label: "Federal Decree-Law 17/2022 + MoEI ministerial decision (Nov 2024)",
      url: "https://uaelegislation.gov.ae/en/legislations/1567",
      asOf: "2026-09-25",
      caveat:
        "The 10%-of-approved-load and 1 MW-per-unit figures are reported from the MoEI ministerial decision in press coverage; the decision text itself was not obtained. Confirm the exact cap with EtihadWE.",
    },
    notes: [
      "Distributed renewable units may connect up to 10% of the account's approved electric load, capped at 1 MW per unit.",
      "Eligible customer classes: residential, agricultural (non-commercial buildings) and industrial customers not already on an industrial support initiative.",
      "Two meters: one for export to the EtihadWE network, one for import. Monthly netting; surplus credit offsets bills within the same year. No cash compensation for exported electricity.",
      "A licensed consultant and installer, EtihadWE approval, a signed connection agreement, and building/rooftop approval from the relevant authority are all required before installation.",
    ],
  };
}

/**
 * The tiered Total Connected Load table from DEWA DRRG Connection Conditions
 * v4.1: the permitted DRRG contribution is 100% of the first 100 kW of TCL,
 * 75% of the next 100 kW, 50% of 200-400, 25% of 400-600 and 5% beyond,
 * topping out at 1,000 kW.
 */
export const dubaiTclContributionKw = (totalConnectedLoadKw: number): number => {
  if (!Number.isFinite(totalConnectedLoadKw) || totalConnectedLoadKw <= 0) return 0;
  const slabs: [number, number][] = [[100, 1], [100, 0.75], [200, 0.5], [200, 0.25], [Infinity, 0.05]];
  let remaining = totalConnectedLoadKw;
  let contribution = 0;
  for (const [width, share] of slabs) {
    const take = Math.min(width, remaining);
    contribution += take * share;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return contribution;
};

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
    if (site.emirate === "dubai") {
      limits.push({
        kw: dubaiTclContributionKw(site.approvedLoadKw),
        rule: "approved-load",
        text: `${rules.scheme} permits a DRRG contribution of ${Math.round(dubaiTclContributionKw(site.approvedLoadKw)).toLocaleString()} kW against a Total Connected Load of ${site.approvedLoadKw.toLocaleString()} kW, per the tiered table.`,
      });
    } else {
      const fraction = rules.approvedLoadFraction ?? 1;
      limits.push({
        kw: fraction * site.approvedLoadKw,
        rule: "approved-load",
        text:
          fraction === 1
            ? `${rules.scheme} caps installed capacity at the plot's Approved Load of ${site.approvedLoadKw.toLocaleString()} kW.`
            : `${rules.scheme} permits up to ${Math.round(fraction * 100)}% of the plot's Approved Load of ${site.approvedLoadKw.toLocaleString()} kW.`,
      });
    }
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
  const nearest = nearestWindSite(site.location.lat, site.location.lng);
  let modelled: WindYield | null = null;
  try {
    modelled = windYield(nearest.id, "small-100");
  } catch {
    modelled = null;
  }
  const modelledCf = modelled ? modelled.capacityFactor : null;
  const windStatus: ScreenStatus =
    wind !== undefined
      ? wind < 5.5
        ? "not-viable"
        : "eligible"
      : modelledCf === null
        ? "needs-evidence"
        : modelledCf < 0.12
          ? "not-viable"
          : "needs-evidence";
  const climateProvenance: Provenance = {
    kind: "dataset",
    label: `Global Wind Atlas + ERA5 at ${nearest.name}`,
    url: "https://globalwindatlas.info/",
    asOf: WIND_CLIMATE_META.retrieved,
    caveat:
      "Gridded models at the nearest climate point, not a site mast. Orographic and micro-siting effects at the parcel itself are unresolved.",
  };
  results.push({
    id: "wind",
    label: "Small wind",
    status: windStatus,
    reason:
      wind !== undefined
        ? wind < 5.5
          ? `Measured mean wind of ${wind.toFixed(1)} m/s is below the roughly 5.5 m/s needed for a small turbine to pay back.`
          : `Measured mean wind of ${wind.toFixed(1)} m/s could support a small turbine.`
        : modelled !== null
          ? `No site mast data. The nearest climate point (${nearest.name}, ${Math.round(siteDistanceKm(site.location, nearest))} km away) models a 100 kW machine at ${Math.round(modelled.capacityFactor * 100)}% capacity factor — ${modelled.capacityFactor < 0.18 ? "below the range where small wind usually beats solar on cost" : "worth a measurement campaign"}. ${RULE_SETS[site.emirate].nonSolarScheme === "none" ? "Dubai's published distributed scheme covers solar only; wind needs a bespoke RSB generation licence." : ""}`
          : "No measured wind speed at hub height has been supplied, and no climate grid point is configured near this site.",
    unblockedBy:
      windStatus === "needs-evidence"
        ? "Twelve months of mast or LiDAR data at hub height, plus turbulence, aviation (GCAA) and noise clearances."
        : undefined,
    provenance: modelled !== null && wind === undefined ? climateProvenance : MODEL_SOURCE,
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
  const hydroKw = hydro ? 9.81 * hydro.flowCms * hydro.headM * 0.68 : 0;
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
