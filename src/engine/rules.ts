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
  /** True when PV capacity may not exceed the account's Approved Load. */
  cappedByApprovedLoad: boolean;
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
      "Design and installation must be by a DEWA-enrolled DRRG consultant and contractor.",
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
    confidence: "partial",
    provenance: {
      kind: "authority",
      label: "Abu Dhabi DoE self-supply policy (Resolution 20 of 2026)",
      url: "https://www.doe.gov.ae/-/media/Project/DOE/Department-Of-Energy/Media-Center-Publications/2026/Feb/PV-and-Battery-Energy-Storage-Systems-For-Self-Supply-Policy.pdf",
      asOf: "2026-09-25",
      caveat:
        "Policy effective 5 February 2026. The policy text states that net metering is not permitted unless explicitly authorised by the DoE, so exports earn nothing. Capacity caps are set in the implementing instruments, not the policy; sizing here falls back to the site's own approved load.",
    },
    notes: [
      "Distributed PV and PV-plus-battery self-supply is permitted for businesses under Executive Council Resolution 20 of 2026.",
      "Net metering, cross-plot sales and private wires are not permitted unless the DoE explicitly authorises them, so no export credit is modelled.",
      "Capacity limits are set by implementing instruments rather than the policy itself; sizing falls back to the site's own approved load.",
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
    offGridProhibited: false,
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

export const regulatoryCap = (site: SiteProfile): CapResult => {
  const rules = RULE_SETS[site.emirate];
  const limits: { kw: number; rule: CapResult["bindingRule"]; text: string }[] = [];

  // The site's single approved-load figure stands in for the plot's Total
  // Connected Load: a multi-account plot's true TCL is the sum across every
  // consumption account, so this is conservative where several accounts exist.
  if (rules.tclSlabs && site.approvedLoadKw && site.approvedLoadKw > 0) {
    limits.push({
      kw: Math.min(rules.plotCapKw ?? Infinity, tclSlabCapKw(site.approvedLoadKw, rules.tclSlabs)),
      rule: "tcl-slab",
      text: `${rules.scheme} allows a sliding share of Total Connected Load — on a TCL of ${site.approvedLoadKw.toLocaleString()} kW that is ${Math.round(tclSlabCapKw(site.approvedLoadKw, rules.tclSlabs)).toLocaleString()} kW.`,
    });
  } else if (rules.cappedByApprovedLoad && site.approvedLoadKw && site.approvedLoadKw > 0) {
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
