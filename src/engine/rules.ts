/**
 * Regulatory constraints on distributed generation, by emirate.
 *
 * This is the module that stops Mizan recommending something a customer cannot
 * legally build. The Dubai rules are the hard ones and they are published; the
 * Abu Dhabi and Northern Emirates rules are partly unpublished and are marked
 * `confidence: "unverified"` so the UI can say so rather than bluff.
 */

import { HYDRO_TURBINE_EFFICIENCY } from "./renewable-combinations";
import { windMonthlyKwhPerKw } from "./resource";
import { nearestWindSite, siteDistanceKm } from "./wind-sites";
import { WIND_CLIMATE_META, windYield } from "./wind";
import type {
  ScreenStatus,
  Emirate,
  Provenance,
  RoofConstruction,
  ScreenResult,
  SiteProfile,
  TechnologyId,
} from "./types";

export type TclSlab = {
  /** Upper bound of Total Connected Load covered by this slab, in kW. */
  upToKw: number;
  /** Fraction of TCL within this slab that renewable capacity may equal. */
  share: number;
};

export type RuleSet = {
  emirate: Emirate;
  scheme: string;
  /** Hard cap on installed PV per plot in kW, if published. */
  plotCapKw: number | null;
  /**
   * Sliding share of Total Connected Load that connected capacity may equal,
   * as a slab schedule. Dubai's DRRG v4.1 uses this instead of a flat
   * approved-load limit; the schedule is cumulative and reaches its published
   * ceiling of 1,000 kW near 14.1 MW of connected load.
   */
  tclSlabs?: TclSlab[];
  /** True when PV capacity is bounded by the account's Approved Load (or a published fraction of it). */
  cappedByApprovedLoad: boolean;
  /** Fraction of Approved Load a unit may connect, where the scheme publishes one (EtihadWE: 10%). */
  approvedLoadFraction?: number;
  groundMountPermitted: boolean;
  /**
   * True when the emirate's electricity law reserves generation to the
   * utility, so an off-grid or private-wire answer is prohibited without
   * written approval. Dubai Law 27 of 2021, restated in DRRG v4.1.
   */
  offGridProhibited: boolean;
  exportTreatment:
    | "credit-rollover-indefinite"
    | "credit-expires-annually"
    | "none"
    | "unknown";
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
    tclSlabs: [
      { upToKw: 100, share: 1 },
      { upToKw: 200, share: 0.75 },
      { upToKw: 400, share: 0.5 },
      { upToKw: 600, share: 0.25 },
      { upToKw: Infinity, share: 0.05 },
    ],
    cappedByApprovedLoad: false,
    groundMountPermitted: false,
    offGridProhibited: true,
    exportTreatment: "credit-rollover-indefinite",
    enrolledContractorRequired: true,
    connectionFeeAed: 1500,
    nonSolarScheme: "none",
    confidence: "published",
    provenance: {
      kind: "authority",
      label: "DEWA DRRG connection conditions v4.1",
      url: "https://www.dewa.gov.ae/-/media/Files/DRRG2025/DEWA-DRRG-Connection-Conditions_EN_V4-1_20251127.ashx",
      asOf: "2026-09-25",
    },
    notes: [
      "Connected capacity is a sliding share of the plot's Total Connected Load: 100% of the first 100 kW, then 75%, 50%, 25% and 5% of successive slabs, topping out at 1,000 kW per plot.",
      "A 600 kW connected load therefore admits 325 kW, not 600 kW; the old flat approved-load cap overstated what can be built.",
      "Ground-mounted systems are not eligible under Shams Dubai; rooftop and building-integrated only.",
      "Surplus export is credited to future bills indefinitely and is never paid out in cash.",
      "Third-party off-grid generation is prohibited in Dubai under Law 27 of 2021 except backup plant and written exceptions.",
      "An annual connection cap applies across the emirate, so approval also depends on capacity left in the year's queue.",
      "Design and installation must be by a DEWA-enrolled DRRG consultant and contractor, and DEWA design approval is required in all cases.",
      "The published scheme covers solar PV only; wind, biogas and other generation require a bespoke RSB generation licence, as Al Rawabi's EG-03/2019 shows.",
    ],
  },
  "abu-dhabi": {
    emirate: "abu-dhabi",
    scheme: "DoE Self-Supply Solar and Battery Policy",
    plotCapKw: null,
    cappedByApprovedLoad: true,
    groundMountPermitted: true,
    offGridProhibited: false,
    exportTreatment: "none",
    enrolledContractorRequired: true,
    connectionFeeAed: null,
    nonSolarScheme: "DoE self-supply licence framework (bespoke)",
    confidence: "partial",
    provenance: {
      kind: "authority",
      label: "Abu Dhabi DoE self-supply policy DoE/ED/G04/005 (Resolution 20 of 2026)",
      url: "https://www.doe.gov.ae/-/media/Project/DOE/Department-Of-Energy/Media-Center-Publications/2026/Feb/PV-and-Battery-Energy-Storage-Systems-For-Self-Supply-Policy.pdf",
      asOf: "2026-09-25",
      caveat:
        "Policy effective 5 February 2026. The policy text states that net metering is not permitted unless explicitly authorised by the DoE, so exports earn nothing. Capacity caps are set in the implementing instruments, not the policy; sizing here falls back to the site's own approved load.",
    },
    notes: [
      "Distributed PV and PV-plus-battery self-supply is permitted for businesses under Executive Council Resolution 20 of 2026.",
      "Net metering, cross-plot sales and private wires are not permitted unless the DoE explicitly authorises them, so no export credit is modelled.",
      "Capacity limits are set by implementing instruments rather than the policy itself; sizing falls back to the site's own approved load.",
      "Self-supply requires a Self-Supply Licence under Abu Dhabi Law No. 2 of 1998; the licensing guide is DoE/ED/P04/005.",
      "New self-supply licences for industrial consumers are paused until the Self-Supply Committee's threshold and framework are approved; large consumers are assessed case-by-case.",
    ],
  },
  sharjah: {
    emirate: "sharjah",
    scheme: "SEWA — no scheme confirmed",
    plotCapKw: null,
    cappedByApprovedLoad: true,
    groundMountPermitted: true,
    offGridProhibited: false,
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
    offGridProhibited: false,
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
        "The 10%-of-approved-load and 1 MW-per-unit figures are reported from the MoEI ministerial decision in press coverage (Aletihad, Nov 2024); the decision text itself was not obtained. Confirm the exact cap with EtihadWE.",
    },
    notes: [
      "Distributed renewable units may connect up to 10% of the account's approved electric load, capped at 1 MW per unit.",
      "Eligible customer classes: residential, agricultural (non-commercial buildings) and industrial customers not already on an industrial support initiative.",
      "Two meters: one for export to the EtihadWE network, one for import. Monthly netting; surplus credit offsets bills within the same year. No cash compensation for exported electricity.",
      "A licensed consultant and installer, EtihadWE approval, a signed connection agreement, and building/rooftop approval from the relevant authority are all required before installation.",
    ],
  };
}

export type CapResult = {
  /** The largest PV system the rules allow, kW. */
  capKw: number;
  /** Which rule bound it. */
  bindingRule: "approved-load" | "tcl-slab" | "plot-cap" | "none";
  explanation: string;
};

/**
 * DEWA DRRG v4.1 section 2.2: connected renewable capacity is a sliding share
 * of the plot's Total Connected Load. The table reads 100% of the first
 * 100 kW, 75% of the next 100, 50% of 200 to 400, 25% of 400 to 600 and 5% of
 * everything above, with a stated maximum of 1,000 kW. The cumulative formula
 * reaches 1,000 kW at roughly 14.1 MW of connected load, which is far past any
 * site this tool screens, so the 1,000 kW figure is applied as the ceiling.
 */
export const tclSlabCapKw = (totalConnectedLoadKw: number, slabs: TclSlab[]): number => {
  let allowed = 0;
  let floor = 0;
  for (const slab of slabs) {
    const width = Math.min(totalConnectedLoadKw, slab.upToKw) - floor;
    if (width > 0) allowed += width * slab.share;
    floor = slab.upToKw;
  }
  return allowed;
};

export const regulatoryCap = (site: SiteProfile): CapResult =>
  regulatoryCapFor(site.emirate, site.approvedLoadKw ?? null);

/**
 * The same cap from the two facts it actually depends on, so every planner in
 * the app (the roof planner, the mix recommender, the custom-site flow) reads
 * the connection limit from one formula.
 */
export const regulatoryCapFor = (emirate: Emirate, approvedLoadKw: number | null): CapResult => {
  const rules = RULE_SETS[emirate];
  const limits: { kw: number; rule: CapResult["bindingRule"]; text: string }[] = [];
  const approved = approvedLoadKw !== null && Number.isFinite(approvedLoadKw) && approvedLoadKw > 0 ? approvedLoadKw : null;

  // The site's single approved-load figure stands in for the plot's Total
  // Connected Load: a multi-account plot's true TCL is the sum across every
  // consumption account, so this is conservative where several accounts exist.
  if (rules.tclSlabs && approved !== null) {
    limits.push({
      kw: Math.min(rules.plotCapKw ?? Infinity, tclSlabCapKw(approved, rules.tclSlabs)),
      rule: "tcl-slab",
      text: `${rules.scheme} allows a sliding share of Total Connected Load — on a TCL of ${approved.toLocaleString()} kW that is ${Math.round(tclSlabCapKw(approved, rules.tclSlabs)).toLocaleString()} kW.`,
    });
  } else if (rules.cappedByApprovedLoad && approved !== null) {
    const fraction = rules.approvedLoadFraction ?? 1;
    limits.push({
      kw: fraction * approved,
      rule: "approved-load",
      text:
        fraction === 1
          ? `${rules.scheme} caps installed capacity at the plot's Approved Load of ${approved.toLocaleString()} kW.`
          : `${rules.scheme} permits up to ${Math.round(fraction * 100)}% of the plot's Approved Load of ${approved.toLocaleString()} kW, i.e. ${Math.round(fraction * approved).toLocaleString()} kW.`,
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
 * The bars a technology has to clear before it is even worth an evidence call.
 * Each is the roughest defensible figure for the Gulf; challenge them with a
 * source before tightening them.
 */
export const SCREEN_THRESHOLDS = {
  /** Usable roof area below which no worthwhile array fits, m2. */
  minRoofAreaM2: 200,
  /** Open land below which a ground mount is not worth connecting, m2. */
  minGroundAreaM2: 1000,
  /** Annual mean wind at hub height for a small turbine to pay back, m/s. */
  viableWindMs: 5.5,
  /** Contracted feedstock that makes biomass worth an evidence call, dry t/day. */
  biomassFeedstockTpd: 1.5,
  /** Hydraulic potential that makes a flow survey worth commissioning, kW. */
  hydroPotentialKw: 5,
  /** Tidal stream potential that makes an ADCP survey worth it, kW. */
  tidalPotentialKw: 10,
  /** Combined gradient/depth index for geothermal electricity. */
  geothermalIndex: 0.45,
  /** Modelled capacity factor below which small wind is screened out without a mast. */
  minModelledWindCf: 0.12,
  /** Modelled capacity factor above which a measurement campaign is worth paying for. */
  campaignWindCf: 0.18,
  /**
   * How far a Global Wind Atlas climate point may be from the site before the
   * coarser NASA POWER grid is used instead: a 3 km Atlas pixel 40 km away in
   * different terrain says nothing about the parcel.
   */
  windClimatePointReachKm: 40,
};

export type ModelledWind = {
  capacityFactor: number;
  hubSpeedMs: number | null;
  provenance: Provenance;
  detail: string;
};

/**
 * The best wind estimate the committed datasets allow without a mast. Inside
 * reach of a configured Atlas/ERA5 climate point that model runs a 100 kW
 * machine through the fitted monthly Weibull; elsewhere the NASA POWER 50 m
 * monthly means go through the generic Rayleigh curve. The provenance says
 * which, and both are labelled as models.
 */
export const modelledWind = (site: SiteProfile): ModelledWind | null => {
  const nearest = nearestWindSite(site.location.lat, site.location.lng);
  const distanceKm = siteDistanceKm(site.location, nearest);
  if (distanceKm <= SCREEN_THRESHOLDS.windClimatePointReachKm) {
    try {
      const modelled = windYield(nearest.id, "small-100");
      return {
        capacityFactor: modelled.capacityFactor,
        hubSpeedMs: modelled.hubSpeedMs,
        detail: `the nearest climate point (${nearest.name}, ${Math.round(distanceKm)} km away) models a 100 kW machine at ${Math.round(modelled.capacityFactor * 100)}% capacity factor`,
        provenance: {
          kind: "dataset",
          label: `Global Wind Atlas + ERA5 at ${nearest.name}`,
          url: "https://globalwindatlas.info/",
          asOf: WIND_CLIMATE_META.retrieved,
          caveat:
            "Gridded models at the nearest climate point, not a site mast. Orographic and micro-siting effects at the parcel itself are unresolved.",
        },
      };
    } catch {
      // fall through to the resource grid
    }
  }
  try {
    const monthly = windMonthlyKwhPerKw(site.location, 30);
    const annual = monthly.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(annual)) return null;
    const capacityFactor = annual / 8760;
    return {
      capacityFactor,
      hubSpeedMs: null,
      detail: `the NASA POWER 50 m climatology at the nearest grid point models a small turbine at ${Math.round(capacityFactor * 100)}% capacity factor`,
      provenance: {
        kind: "dataset",
        label: "NASA POWER 50 m wind climatology, Rayleigh capacity factor",
        url: "https://power.larc.nasa.gov/",
        caveat:
          "Half-degree reanalysis at the nearest grid point run through a generic small-turbine curve. A screening number, not a resource assessment.",
      },
    };
  } catch {
    return null;
  }
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
      roofAreaM2 < SCREEN_THRESHOLDS.minRoofAreaM2
        ? "not-viable"
        : evidence.hasStructuralReserve
          ? "eligible"
          : structure.status,
    reason:
      roofAreaM2 < SCREEN_THRESHOLDS.minRoofAreaM2
        ? `Less than ${SCREEN_THRESHOLDS.minRoofAreaM2} m2 of usable roof was mapped, which cannot carry a worthwhile array.`
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
      : groundAreaM2 < SCREEN_THRESHOLDS.minGroundAreaM2
        ? "not-viable"
        : evidence.hasLandRights
          ? "eligible"
          : "needs-evidence",
    reason: !rules.groundMountPermitted
      ? `${rules.scheme} does not permit ground-mounted systems, so this cannot be connected in ${labelEmirate(site.emirate)} whatever the land area.`
      : groundAreaM2 < SCREEN_THRESHOLDS.minGroundAreaM2
        ? `Less than ${SCREEN_THRESHOLDS.minGroundAreaM2.toLocaleString()} m2 of open land was mapped after setbacks.`
        : `${Math.round(groundAreaM2).toLocaleString()} m2 of open land was mapped.`,
    unblockedBy:
      rules.groundMountPermitted && !evidence.hasLandRights
        ? "Lease or title showing the right to build on the parcel, plus easements and drainage."
        : undefined,
    provenance: rules.provenance,
  });

  const wind = evidence.measuredWindMs;
  const modelled = wind === undefined ? modelledWind(site) : null;
  const windStatus: ScreenStatus =
    wind !== undefined
      ? wind < SCREEN_THRESHOLDS.viableWindMs
        ? "not-viable"
        : "eligible"
      : modelled === null
        ? "needs-evidence"
        : modelled.capacityFactor < SCREEN_THRESHOLDS.minModelledWindCf
          ? "not-viable"
          : "needs-evidence";
  const nonSolarNote =
    rules.nonSolarScheme === "none"
      ? ` ${rules.scheme} covers solar only; wind needs a bespoke generation licence.`
      : "";
  results.push({
    id: "wind",
    label: "Small wind",
    status: windStatus,
    reason:
      wind !== undefined
        ? wind < SCREEN_THRESHOLDS.viableWindMs
          ? `Measured mean wind of ${wind.toFixed(1)} m/s is below the roughly ${SCREEN_THRESHOLDS.viableWindMs} m/s needed for a small turbine to pay back.`
          : `Measured mean wind of ${wind.toFixed(1)} m/s could support a small turbine.`
        : modelled !== null
          ? `No site mast data. Without one, ${modelled.detail} — ${
              modelled.capacityFactor < SCREEN_THRESHOLDS.campaignWindCf
                ? "below the range where small wind usually beats solar on cost"
                : "worth a measurement campaign"
            }.${nonSolarNote}`
          : "No measured wind speed at hub height has been supplied, and no climate dataset covers this site. Coastal UAE annual means are typically 3 to 4 m/s at 10 m, which is below the economic threshold for small turbines.",
    unblockedBy:
      windStatus === "needs-evidence"
        ? "Twelve months of mast or LiDAR data at hub height, plus turbulence, aviation (GCAA) and noise clearances."
        : undefined,
    provenance: modelled?.provenance ?? MODEL_SOURCE,
  });

  const biomass = evidence.contractedBiomassTpd ?? 0;
  results.push({
    id: "biomass",
    label: "Biomass",
    status: biomass >= SCREEN_THRESHOLDS.biomassFeedstockTpd ? "needs-evidence" : "not-viable",
    reason:
      biomass >= SCREEN_THRESHOLDS.biomassFeedstockTpd
        ? `${biomass.toFixed(1)} dry tonnes per day of contracted feedstock was declared.`
        : "No contracted feedstock was declared. A map cannot prove a fuel supply, and an uncontracted waste stream is not a resource.",
    unblockedBy:
      biomass >= SCREEN_THRESHOLDS.biomassFeedstockTpd
        ? "Signed multi-year feedstock supply, storage and handling design, and an emissions permit path."
        : "A signed feedstock contract stating dry tonnes per day and moisture content.",
    provenance: MODEL_SOURCE,
  });

  const hydro = evidence.hydro;
  const hydroKw = hydro ? 9.81 * hydro.flowCms * hydro.headM * HYDRO_TURBINE_EFFICIENCY : 0;
  results.push({
    id: "hydro",
    label: "Micro hydro",
    status: hydroKw >= SCREEN_THRESHOLDS.hydroPotentialKw ? "needs-evidence" : "not-viable",
    reason:
      hydroKw >= SCREEN_THRESHOLDS.hydroPotentialKw
        ? `Declared flow and head give roughly ${Math.round(hydroKw)} kW of hydraulic potential.`
        : "No perennial watercourse with usable head has been declared. The UAE has no perennial rivers, so this is normally a no before any survey.",
    unblockedBy:
      hydroKw >= SCREEN_THRESHOLDS.hydroPotentialKw
        ? "A flow-duration curve, a surveyed head, and water abstraction rights."
        : undefined,
    provenance: MODEL_SOURCE,
  });

  const tidal = evidence.tidal;
  const tidalKw = tidal ? (0.5 * 1025 * tidal.sweptAreaM2 * tidal.velocityMs ** 3 * 0.35) / 1000 : 0;
  results.push({
    id: "tidal",
    label: "Tidal stream",
    status: tidalKw >= SCREEN_THRESHOLDS.tidalPotentialKw ? "needs-evidence" : "not-viable",
    reason:
      tidalKw >= SCREEN_THRESHOLDS.tidalPotentialKw
        ? `Declared current and swept area give roughly ${Math.round(tidalKw)} kW.`
        : "No measured tidal current has been declared. Gulf tidal streams are generally well under the roughly 2 m/s that tidal turbines need, and output falls with the cube of speed.",
    unblockedBy:
      tidalKw >= SCREEN_THRESHOLDS.tidalPotentialKw
        ? "An ADCP current survey, bathymetry, a marine works permit and a cable landing route."
        : undefined,
    provenance: MODEL_SOURCE,
  });

  const geo = evidence.geothermal;
  const geoIndex = geo ? ((geo.gradientCkm - 30) / 35) * (geo.depthM / 1800) : 0;
  results.push({
    id: "geothermal",
    label: "Geothermal",
    status: geoIndex >= SCREEN_THRESHOLDS.geothermalIndex ? "needs-evidence" : "not-viable",
    reason:
      geoIndex >= SCREEN_THRESHOLDS.geothermalIndex
        ? `Declared gradient and depth suggest a resource worth a feasibility study.`
        : "No measured gradient has been declared. Power generation needs a well above roughly 120 C; shallow UAE gradients suit heating and cooling, not electricity.",
    unblockedBy:
      geoIndex >= SCREEN_THRESHOLDS.geothermalIndex
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
