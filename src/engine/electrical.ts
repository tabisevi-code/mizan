/**
 * Electrical design: how the modules are actually wired.
 *
 * Everything above this file sizes an array in kilowatts. That is a screening
 * answer. A system is built out of strings of modules in series, and a string
 * has to obey two hard limits at once:
 *
 *   1. On the coldest morning of the year, open-circuit voltage is at its
 *      highest. The string must still sit under the inverter's maximum DC
 *      input voltage, or the inverter is destroyed. This sets the MAXIMUM
 *      number of modules in a string. (IEC 62548 s.7.2; NEC 690.7 is the
 *      equivalent US rule.)
 *
 *   2. On the hottest afternoon, maximum-power voltage is at its lowest. The
 *      string must still be above the inverter's full-power MPPT window, or
 *      the inverter throttles exactly when the sun is strongest. This sets the
 *      MINIMUM number of modules in a string.
 *
 * Both limits are climate-dependent, and the Gulf sits at an unusual point:
 * winters are mild, so the cold limit is generous and strings run long; roofs
 * reach eighty degrees at the cell, so the hot limit bites hard. A string
 * length copied from a European design is usually wrong here in both
 * directions. That is the whole reason this file exists.
 *
 * Nothing here is fitted or learned. It is datasheet arithmetic plus the
 * Faiman cell-temperature model already used in solar.ts.
 */

import { moduleTemperature } from "./solar";
import { thinRows } from "./shading";
import type { Emirate, Provenance } from "./types";
import { pointInPolygon, type PanelRow, type PointM, type PolygonM } from "./packing";

// --- equipment -------------------------------------------------------------

export type PvModule = {
  id: string;
  label: string;
  watts: number;
  /** Open-circuit voltage at standard test conditions, V. */
  vocV: number;
  /** Maximum-power voltage at STC, V. */
  vmpV: number;
  /** Short-circuit current at STC, A. */
  iscA: number;
  /** Maximum-power current at STC, A. */
  impA: number;
  /** Temperature coefficient of Voc, fraction per degree C. Negative. */
  betaVocPerC: number;
  /** Temperature coefficient of Vmp, fraction per degree C. Negative. */
  betaVmpPerC: number;
  /** Temperature coefficient of Isc, fraction per degree C. Positive. */
  alphaIscPerC: number;
  widthM: number;
  heightM: number;
  /** Factory cable lead on each terminal, metres. */
  leadM: number;
  provenance: Provenance;
};

const DATASHEET: Provenance = {
  kind: "dataset",
  label: "Manufacturer datasheet",
  asOf: "2026-09-23",
  caveat:
    "Published datasheet values for this product class. Confirm against the supplier's current revision before ordering; manufacturers revise electrical data between production batches.",
};

const INVERTER_SHEET: Provenance = {
  ...DATASHEET,
  label: "Inverter datasheet",
};

/**
 * Three modules that cover the range a UAE commercial roof actually gets
 * quoted: a large n-type bifacial for open sheds, a slightly larger one for
 * maximum density, and a short module for roofs cut up by plant.
 */
export const MODULES: PvModule[] = [
  {
    id: "n-580",
    label: "580 W n-type TOPCon bifacial (72-cell)",
    watts: 580,
    vocV: 51.9,
    vmpV: 43.7,
    iscA: 14.1,
    impA: 13.3,
    betaVocPerC: -0.0025,
    betaVmpPerC: -0.003,
    alphaIscPerC: 0.00045,
    widthM: 1.134,
    heightM: 2.278,
    leadM: 1.2,
    provenance: DATASHEET,
  },
  {
    id: "n-620",
    label: "620 W n-type TOPCon bifacial (66-cell, large format)",
    watts: 620,
    vocV: 53.6,
    vmpV: 45.1,
    iscA: 14.6,
    impA: 13.8,
    betaVocPerC: -0.0024,
    betaVmpPerC: -0.0029,
    alphaIscPerC: 0.00045,
    widthM: 1.134,
    heightM: 2.382,
    leadM: 1.2,
    provenance: DATASHEET,
  },
  {
    id: "n-450",
    label: "450 W n-type TOPCon (54-cell, short)",
    watts: 450,
    vocV: 41.6,
    vmpV: 34.7,
    iscA: 13.8,
    impA: 13.0,
    betaVocPerC: -0.0025,
    betaVmpPerC: -0.003,
    alphaIscPerC: 0.00045,
    widthM: 1.134,
    heightM: 1.722,
    leadM: 1.2,
    provenance: DATASHEET,
  },
];

export type InverterSpec = {
  id: string;
  label: string;
  acKw: number;
  /** Manufacturer's maximum recommended DC input, kWp. */
  maxDcKw: number;
  /** Absolute maximum DC input voltage. Exceeding it destroys the inverter. */
  maxSystemVdc: number;
  /** Lowest voltage the tracker will follow at all. */
  mpptMinV: number;
  /** Lowest voltage at which the inverter still delivers rated AC power. */
  mpptFullPowerMinV: number;
  mpptMaxV: number;
  mpptCount: number;
  stringsPerMppt: number;
  /** Maximum operating current one MPPT input will accept, A. */
  maxCurrentPerMpptA: number;
  provenance: Provenance;
};

/** Three-phase string inverters in the size range a UAE C&I roof uses. */
export const INVERTERS: InverterSpec[] = [
  {
    id: "sg33",
    label: "33 kW three-phase string inverter",
    acKw: 33,
    maxDcKw: 49.5,
    maxSystemVdc: 1100,
    mpptMinV: 200,
    mpptFullPowerMinV: 480,
    mpptMaxV: 1000,
    mpptCount: 3,
    stringsPerMppt: 2,
    maxCurrentPerMpptA: 30,
    provenance: INVERTER_SHEET,
  },
  {
    id: "sg110",
    label: "110 kW three-phase string inverter",
    acKw: 110,
    maxDcKw: 165,
    maxSystemVdc: 1100,
    mpptMinV: 200,
    mpptFullPowerMinV: 550,
    mpptMaxV: 1000,
    mpptCount: 9,
    stringsPerMppt: 2,
    maxCurrentPerMpptA: 30,
    provenance: INVERTER_SHEET,
  },
  {
    id: "sg250",
    label: "250 kW three-phase string inverter",
    acKw: 250,
    maxDcKw: 375,
    maxSystemVdc: 1500,
    mpptMinV: 500,
    mpptFullPowerMinV: 860,
    mpptMaxV: 1450,
    mpptCount: 12,
    stringsPerMppt: 2,
    maxCurrentPerMpptA: 30,
    provenance: INVERTER_SHEET,
  },
];

// --- design temperatures ---------------------------------------------------

export type DesignTemperatures = {
  /** Lowest air temperature the site is designed against, degrees C. */
  recordLowC: number;
  /** Air temperature used for the hot-limit check, degrees C. */
  designHighAmbientC: number;
  /** Irradiance assumed at that moment, W/m2. */
  designIrradianceWm2: number;
  /** Wind speed assumed at that moment, m/s. Low wind is the hard case. */
  designWindMs: number;
  provenance: Provenance;
};

const NCM: Provenance = {
  kind: "authority",
  label: "UAE National Center of Meteorology station extremes",
  url: "https://www.ncm.gov.ae/",
  asOf: "2026-09-23",
  caveat:
    "Coastal station records, rounded outward for design margin. Highland Ras Al Khaimah (Jebel Jais and above roughly 1,000 m) records sub-zero temperatures and must be designed to -6 C instead.",
};

/**
 * Per-emirate design temperatures. The low figure is what sets string length,
 * so it is stated per emirate rather than as one national number.
 */
export const DESIGN_TEMPERATURES: Record<Emirate, DesignTemperatures> = {
  dubai: { recordLowC: 6, designHighAmbientC: 47, designIrradianceWm2: 1000, designWindMs: 1, provenance: NCM },
  "abu-dhabi": { recordLowC: 5, designHighAmbientC: 48, designIrradianceWm2: 1000, designWindMs: 1, provenance: NCM },
  sharjah: { recordLowC: 5, designHighAmbientC: 47, designIrradianceWm2: 1000, designWindMs: 1, provenance: NCM },
  ajman: { recordLowC: 5, designHighAmbientC: 47, designIrradianceWm2: 1000, designWindMs: 1, provenance: NCM },
  "umm-al-quwain": { recordLowC: 5, designHighAmbientC: 47, designIrradianceWm2: 1000, designWindMs: 1, provenance: NCM },
  "ras-al-khaimah": { recordLowC: 2, designHighAmbientC: 47, designIrradianceWm2: 1000, designWindMs: 1, provenance: NCM },
  fujairah: { recordLowC: 7, designHighAmbientC: 46, designIrradianceWm2: 1000, designWindMs: 1, provenance: NCM },
};

/** A northern-European design point, for the comparison the report makes. */
export const TEMPERATE_REFERENCE: DesignTemperatures = {
  recordLowC: -10,
  designHighAmbientC: 30,
  designIrradianceWm2: 1000,
  designWindMs: 1,
  provenance: {
    kind: "assumption",
    label: "Northern European design point",
    caveat: "Shown only to contrast string length; not used in any UAE result.",
  },
};

// --- string sizing ---------------------------------------------------------

/** Open-circuit voltage of one module at temperature t. */
export const vocAt = (module: PvModule, tC: number): number =>
  module.vocV * (1 + module.betaVocPerC * (tC - 25));

/** Maximum-power voltage of one module at cell temperature t. */
export const vmpAt = (module: PvModule, tC: number): number =>
  module.vmpV * (1 + module.betaVmpPerC * (tC - 25));

/** Short-circuit current of one module at cell temperature t. */
export const iscAt = (module: PvModule, tC: number): number =>
  module.iscA * (1 + module.alphaIscPerC * (tC - 25));

export type StringSizing = {
  module: PvModule;
  inverter: InverterSpec;
  temperatures: DesignTemperatures;
  /** Cell temperature on the hot design day, degrees C. */
  hotCellC: number;
  /** Module Voc at the record low, V. */
  vocColdV: number;
  /** Module Vmp at the record low, V: the top of the tracker's working range. */
  vmpColdV: number;
  /** Module Vmp at the hot cell temperature, V. */
  vmpHotV: number;
  maxModulesPerString: number;
  minModulesPerString: number;
  /** The unrounded hot-limit requirement, before rounding up to a whole module. */
  rawMinModules: number;
  /** The length actually chosen: the longest that fits both limits. */
  modulesPerString: number;
  /** Worst-case string voltage the inverter will see, V. */
  stringVocColdV: number;
  /** String working voltage at the cold design point, V. */
  stringVmpColdV: number;
  /** String voltage at the hot design point, V. */
  stringVmpHotV: number;
  /** Headroom under the inverter's absolute limit, as a fraction. */
  voltageHeadroom: number;
  stringsPerMppt: number;
  maxStringsPerInverter: number;
  feasible: boolean;
  /** Plain-language findings, in the order a reviewer would want them. */
  notes: string[];
};

export const sizeString = (
  module: PvModule,
  inverter: InverterSpec,
  temperatures: DesignTemperatures,
): StringSizing => {
  const hotCellC = moduleTemperature(
    temperatures.designIrradianceWm2,
    temperatures.designHighAmbientC,
    temperatures.designWindMs,
  );

  const vocColdV = vocAt(module, temperatures.recordLowC);
  // Under load on the record-low morning the cell sits near ambient: irradiance
  // is what warms a module, and first-light sun is weak. That makes this the
  // highest working voltage the tracker will ever see.
  const vmpColdV = vmpAt(module, temperatures.recordLowC);
  const vmpHotV = vmpAt(module, hotCellC);
  const iscHotA = iscAt(module, hotCellC);

  const maxModulesPerString = Math.floor(inverter.maxSystemVdc / vocColdV);
  const rawMinModules = inverter.mpptFullPowerMinV / vmpHotV;
  const minModulesPerString = Math.ceil(rawMinModules);
  const feasible = maxModulesPerString >= minModulesPerString && maxModulesPerString > 0;
  /** How close the hot limit sits to tipping over to one more module. */
  const hotMargin = minModulesPerString - rawMinModules;

  // Longest string that still fits. Fewer strings means fewer home runs, less
  // cable and less current, so length is worth taking where it is legal.
  const modulesPerString = feasible ? maxModulesPerString : 0;
  const stringVocColdV = modulesPerString * vocColdV;
  const stringVmpColdV = modulesPerString * vmpColdV;
  const stringVmpHotV = modulesPerString * vmpHotV;

  // An MPPT input accepts a current, and two strings in parallel double it.
  const stringsPerMppt = Math.max(
    1,
    Math.min(inverter.stringsPerMppt, Math.floor(inverter.maxCurrentPerMpptA / Math.max(iscHotA, 0.1))),
  );

  const notes: string[] = [];
  if (!feasible) {
    notes.push(
      `No string length works: the cold limit allows at most ${maxModulesPerString} modules but the inverter needs at least ${minModulesPerString} to reach full power when hot. Pick a module with a lower Voc or an inverter with a wider window.`,
    );
  } else {
    notes.push(
      `At ${temperatures.recordLowC} C each module reaches ${vocColdV.toFixed(1)} V open-circuit, so at most ${maxModulesPerString} may sit in series under the inverter's ${inverter.maxSystemVdc} V limit.`,
    );
    notes.push(
      `At ${Math.round(hotCellC)} C cell temperature each module drops to ${vmpHotV.toFixed(1)} V, so at least ${minModulesPerString} are needed to keep the inverter above ${inverter.mpptFullPowerMinV} V and at full power.`,
    );
    notes.push(
      `${modulesPerString} modules per string: ${Math.round(stringVocColdV)} V worst case cold, ${Math.round(stringVmpHotV)} V working hot.`,
    );
  }
  if (feasible && stringVmpColdV > inverter.mpptMaxV) {
    notes.push(
      `On the coldest morning the string works at ${Math.round(stringVmpColdV)} V, above the ${inverter.mpptMaxV} V the tracker will follow. Nothing is damaged, but the inverter leaves the maximum-power point until the modules warm. Shortening the string conflicts with the hot limit, so prefer an inverter with a wider window.`,
    );
  }
  if (feasible && hotMargin < 0.1) {
    notes.push(
      `The hot limit is on a knife edge: ${rawMinModules.toFixed(2)} modules are needed and ${minModulesPerString} is the next whole number. A design day ${((hotMargin / Math.max(rawMinModules, 1)) * 100).toFixed(1)}% hotter, or a module with a slightly steeper voltage coefficient, pushes the minimum to ${minModulesPerString + 1}. Confirm the module's temperature coefficient before committing to ${minModulesPerString}.`,
    );
  }
  if (feasible && stringsPerMppt < inverter.stringsPerMppt) {
    notes.push(
      `Only ${stringsPerMppt} string per tracker input: two would draw ${(iscHotA * 2).toFixed(1)} A against a ${inverter.maxCurrentPerMpptA} A limit.`,
    );
  }

  return {
    module,
    inverter,
    temperatures,
    hotCellC,
    vocColdV,
    vmpColdV,
    vmpHotV,
    maxModulesPerString,
    minModulesPerString,
    rawMinModules,
    modulesPerString,
    stringVocColdV,
    stringVmpColdV,
    stringVmpHotV,
    voltageHeadroom: 1 - stringVocColdV / inverter.maxSystemVdc,
    stringsPerMppt,
    maxStringsPerInverter: inverter.mpptCount * stringsPerMppt,
    feasible,
    notes,
  };
};

// --- stringing geometry ----------------------------------------------------

export type ModulePosition = {
  /** Index of the packed row this module sits in. */
  row: number;
  /** Centre of the module in the local metre frame. */
  at: PointM;
};

export type StringRun = {
  index: number;
  /** Which inverter this string lands on, counting from zero. */
  inverter: number;
  mppt: number;
  modules: ModulePosition[];
  /** The leapfrog path through the modules, in visiting order. */
  path: PointM[];
  /** The route the home run cable takes back to the inverter. */
  homeRunPath: PointM[];
  /** Series cable used between modules, metres. */
  seriesLengthM: number;
  /** Twin home run from the string ends to the inverter, metres of trench. */
  homeRunM: number;
};

/**
 * Lay the packed rows out as one continuous sequence of modules, snaking so
 * that the end of one row is next to the start of the next. Consecutive
 * modules in the sequence are then always physically adjacent, which is what
 * lets a string stay compact.
 */
export const moduleSequence = (rows: PanelRow[], moduleWidthM: number): ModulePosition[] => {
  const out: ModulePosition[] = [];
  rows.forEach((row, rowIndex) => {
    const centres: PointM[] = [];
    for (let i = 0; i < row.modules; i += 1) {
      centres.push([row.x + (i + 0.5) * moduleWidthM, row.y + row.h / 2]);
    }
    if (rowIndex % 2 === 1) centres.reverse();
    for (const at of centres) out.push({ row: rowIndex, at });
  });
  return out;
};

/**
 * Leapfrog order: walk out taking every other module, step across at the far
 * end, and walk back picking up the ones that were skipped. The string ends
 * next to where it began, so the pair of conductors going back to the inverter
 * start from the same place and no separate return run is needed along the
 * row. This is the standard way a rooftop string is wired, and it is the
 * single biggest saving in DC cable on a long row.
 */
export const leapfrogOrder = (count: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < count; i += 2) out.push(i);
  for (let i = count % 2 === 0 ? count - 1 : count - 2; i >= 1; i -= 2) out.push(i);
  return out;
};

const distance = (a: PointM, b: PointM): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Cable does not fly diagonally across a roof. It runs in tray, along the ends
 * of the rows to a spine, and down the spine to the switchroom. Routing it
 * that way is both what gets installed and a more honest cable length than a
 * straight line, which always understates it.
 */
const homeRunRoute = (from: PointM, to: PointM, roof?: PolygonM): PointM[] => {
  if (Math.abs(from[0] - to[0]) < 0.05 || Math.abs(from[1] - to[1]) < 0.05) return [from, to];
  const elbow: PointM = [to[0], from[1]];
  if (!roof || pointInPolygon(elbow, roof)) return [from, elbow, to];

  // On a roof set at an angle to the rows, the corner of a clean L can land
  // out over open air. Run along the row as far as the building goes, then
  // cut in. Ten halvings put the turn within a centimetre of the roof edge.
  let inside = from[0];
  let outside = to[0];
  for (let i = 0; i < 10; i += 1) {
    const middle = (inside + outside) / 2;
    if (pointInPolygon([middle, from[1]], roof)) inside = middle;
    else outside = middle;
  }
  return [from, [inside, from[1]], to];
};

/**
 * The largest step allowed between one module and the next in the same string.
 * A step within a row is one module width; a wrap onto the next row is one row
 * pitch. Anything much larger means the rows do not line up — the tapered end
 * of a shed, say — and a string that jumped it would be cable strung across
 * open roof. Those strings are broken instead.
 */
export const MAX_STRING_STEP_M = 5;

const pathLength = (path: PointM[]): number => {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += distance(path[i - 1], path[i]);
  return total;
};

// --- cable ------------------------------------------------------------------

export type CableRun = {
  crossSectionMm2: number;
  lengthM: number;
  /** Voltage drop along this run at the hot design point, as a fraction. */
  dropFraction: number;
};

export type CableBom = {
  /** Cable used between modules beyond the factory leads, metres. */
  extraSeriesM: number;
  /** Total twin home-run cable to buy, metres, both conductors counted. */
  homeRunM: number;
  runs: CableRun[];
  /** Worst voltage drop on any home run, as a fraction of string voltage. */
  worstDropFraction: number;
  /** Cross-sections selected, smallest first. */
  sizesUsedMm2: number[];
};

/** Resistivity of copper at operating temperature, ohm mm2 per metre. */
const COPPER_RHO = 0.0195;
const CABLE_SIZES_MM2 = [4, 6, 10, 16, 25];
/** Design target for DC-side voltage drop. Industry convention is 1%. */
export const DC_DROP_TARGET = 0.01;

/**
 * Array kWp per kW of inverter. Above roughly 1.3 the inverter spends the
 * middle of a clear day clipping; below about 1.05 it is being paid for and
 * not used. 1.2 is the usual compromise and is what the sizing aims at.
 */
export const TARGET_DC_AC_RATIO = 1.2;

const chooseCable = (lengthM: number, currentA: number, stringVoltageV: number): CableRun => {
  // Both conductors, so twice the one-way length.
  const dropFor = (size: number): number => {
    const drop = (2 * lengthM * currentA * COPPER_RHO) / size;
    return stringVoltageV > 0 ? drop / stringVoltageV : 1;
  };
  // The largest size is taken even above target; the caller warns when the
  // worst run still misses the 1% drop target.
  const size =
    CABLE_SIZES_MM2.find((candidate) => dropFor(candidate) <= DC_DROP_TARGET) ??
    CABLE_SIZES_MM2[CABLE_SIZES_MM2.length - 1];
  return { crossSectionMm2: size, lengthM, dropFraction: dropFor(size) };
};

// --- the whole design ------------------------------------------------------

export type ElectricalDesign = {
  sizing: StringSizing;
  strings: StringRun[];
  inverterCount: number;
  /** Modules that could not be made into a full string. */
  strandedModules: number;
  modulesWired: number;
  kwpWired: number;
  acKw: number;
  dcAcRatio: number;
  cable: CableBom;
  /** Where each inverter sits, in the local metre frame. */
  inverterAt: PointM[];
  warnings: string[];
};

export type DesignInput = {
  rows: PanelRow[];
  module: PvModule;
  inverter: InverterSpec;
  temperatures: DesignTemperatures;
  /** Where the switchroom is. Home runs are measured to here. */
  plantAt: PointM;
  /** The roof outline, so cable can be kept on the building. */
  roof?: PolygonM;
  /** Cap the design to this many modules, if the recommendation is smaller. */
  moduleLimit?: number;
};

export const designElectrical = (input: DesignInput): ElectricalDesign => {
  const sizing = sizeString(input.module, input.inverter, input.temperatures);
  const warnings: string[] = [];

  if (!sizing.feasible) {
    return {
      sizing,
      strings: [],
      inverterCount: 0,
      strandedModules: 0,
      modulesWired: 0,
      kwpWired: 0,
      acKw: 0,
      dcAcRatio: 0,
      cable: { extraSeriesM: 0, homeRunM: 0, runs: [], worstDropFraction: 0, sizesUsedMm2: [] },
      inverterAt: [],
      warnings: [sizing.notes[0]],
    };
  }

  const n = sizing.modulesPerString;

  // A system smaller than the roof could hold is built as whole rows spread
  // across the roof, never as every other panel within a row: an array with
  // gaps down each row would need more rail, more cable and more labour for
  // the same output. Dropping rows is what actually gets built, and it is the
  // same thinning rule the shading model uses.
  const total = input.rows.reduce((count, row) => count + row.modules, 0);
  const keep =
    input.moduleLimit !== undefined && input.moduleLimit < total ? input.moduleLimit / total : 1;
  const thinned = new Set(thinRows(input.rows, keep));
  const chosen = input.rows
    .map((row, index) => ({ row, index }))
    .filter((item) => thinned.has(item.row));

  // moduleSequence numbers rows as it receives them, so the indices are
  // mapped back to the roof's own row numbering before anything else sees
  // them.
  const sequence = moduleSequence(
    chosen.map((item) => item.row),
    input.module.widthM,
  ).map((item) => ({ ...item, row: chosen[item.row].index }));

  // Break the snaked sequence wherever consecutive modules are too far apart
  // to wire together, then fill whole strings inside each unbroken stretch.
  const stretches: ModulePosition[][] = [];
  let current: ModulePosition[] = [];
  for (const item of sequence) {
    if (current.length > 0 && distance(current[current.length - 1].at, item.at) > MAX_STRING_STEP_M) {
      stretches.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) stretches.push(current);

  // Fill whole strings first, then keep the leftover as a shorter string when
  // it is still long enough to hold the inverter above its full-power window.
  // A short string may not share a tracker input with a full one -- the two
  // would fight over the maximum-power point -- so it gets an input of its
  // own, which is exactly how this is built on site.
  const stringModules: ModulePosition[][] = [];
  for (const stretch of stretches) {
    let i = 0;
    for (; i + n <= stretch.length; i += n) stringModules.push(stretch.slice(i, i + n));
    const remainder = stretch.length - i;
    if (remainder >= sizing.minModulesPerString) stringModules.push(stretch.slice(i));
  }
  // Longest first, so full strings pair up on shared inputs and the short ones
  // fall at the end where they take an input each.
  stringModules.sort((a, b) => b.length - a.length);
  const stringCount = stringModules.length;
  const shortStrings = stringModules.filter((modules) => modules.length < n).length;
  const strandedModules = sequence.length - stringModules.reduce((t, m) => t + m.length, 0);
  const perInverter = sizing.maxStringsPerInverter;
  const arrayKwp =
    (stringModules.reduce((total, modules) => total + modules.length, 0) * input.module.watts) / 1000;

  // Three separate things set how many inverters are needed, and the binding
  // one is whichever asks for most. Counting tracker inputs alone is the
  // classic mistake: nine trackers will physically accept far more array than
  // a 110 kW inverter is rated to convert.
  const byStringSlots = Math.ceil(stringCount / perInverter);
  const byDcRating = Math.ceil(arrayKwp / input.inverter.maxDcKw);
  const byTargetRatio = Math.round(arrayKwp / (input.inverter.acKw * TARGET_DC_AC_RATIO));
  const inverterCount = Math.max(1, byStringSlots, byDcRating, byTargetRatio);

  // Inverters are spread along the line between the plant position and the
  // centre of the array, which is where a switchroom wall usually runs.
  const inverterAt: PointM[] = [];
  for (let i = 0; i < inverterCount; i += 1) {
    const offset = (i - (inverterCount - 1) / 2) * 3;
    inverterAt.push([input.plantAt[0] + offset, input.plantAt[1]]);
  }

  const strings: StringRun[] = [];
  const runs: CableRun[] = [];
  let extraSeriesM = 0;
  let homeRunTotalM = 0;

  const impHotA = input.module.impA; // current barely moves with temperature
  const hop = input.module.widthM * 2;
  const leadReach = input.module.leadM * 2;

  for (let s = 0; s < stringCount; s += 1) {
    const modules = stringModules[s];
    const order = leapfrogOrder(modules.length);
    const path = order.map((i) => modules[i].at);
    const seriesLengthM = pathLength(path);

    // Each leapfrog hop is two module widths. Where the factory leads on the
    // two modules do not span that, a short jumper is bought.
    const hops = Math.max(0, modules.length - 1);
    extraSeriesM += hops * Math.max(0, hop - leadReach);

    // Strings are dealt round-robin across the inverters, so each one carries
    // roughly the same number and no unit is left nearly empty. Within an
    // inverter, equal-length strings pair onto a shared tracker input and a
    // short string takes one to itself.
    const inverter = s % inverterCount;
    const slot = Math.floor(s / inverterCount);
    const fullHere = Math.ceil((stringCount - shortStrings - inverter) / inverterCount);
    const mppt =
      modules.length === n
        ? Math.floor(slot / sizing.stringsPerMppt)
        : Math.ceil(fullHere / sizing.stringsPerMppt) + (slot - fullHere);
    const start = path[0];
    const homeRunPath = homeRunRoute(start, inverterAt[inverter], input.roof);
    const homeRunM = pathLength(homeRunPath);
    homeRunTotalM += homeRunM;

    const run = chooseCable(homeRunM, impHotA, sizing.stringVmpHotV);
    runs.push(run);

    strings.push({ index: s, inverter, mppt, modules, path, homeRunPath, seriesLengthM, homeRunM });
  }

  // A tracker input may only parallel strings of the same length, up to
  // `stringsPerMppt` of them. The round-robin assignment above can
  // occasionally land a short string on an input already carrying a full
  // pair; move it to the next free input on that inverter.
  const mpptOccupancy = new Map<number, Map<number, { length: number; count: number }>>();
  let mpptReassigned = 0;
  for (const run of strings) {
    const slots = mpptOccupancy.get(run.inverter) ?? new Map();
    mpptOccupancy.set(run.inverter, slots);
    const conflicts = (slot: { length: number; count: number } | undefined): boolean =>
      slot !== undefined &&
      (slot.length !== run.modules.length || slot.count >= sizing.stringsPerMppt);
    const assigned = run.mppt;
    while (conflicts(slots.get(run.mppt))) run.mppt += 1;
    if (run.mppt !== assigned) mpptReassigned += 1;
    const slot = slots.get(run.mppt);
    if (slot === undefined) slots.set(run.mppt, { length: run.modules.length, count: 1 });
    else slot.count += 1;
  }

  const worstDropFraction = runs.reduce((worst, run) => Math.max(worst, run.dropFraction), 0);
  const sizesUsedMm2 = [...new Set(runs.map((run) => run.crossSectionMm2))].sort((a, b) => a - b);

  const modulesWired = stringModules.reduce((total, modules) => total + modules.length, 0);
  const kwpWired = (modulesWired * input.module.watts) / 1000;
  const acKw = inverterCount * input.inverter.acKw;
  const dcAcRatio = acKw > 0 ? kwpWired / acKw : 0;

  if (strandedModules > 0) {
    warnings.push(
      `${strandedModules} panel${strandedModules === 1 ? "" : "s"} left over. A string has to be at least ${sizing.minModulesPerString} panels long to hold the inverter at full power, and the last part-rows are shorter than that, so they are not wired.`,
    );
  }
  if (shortStrings > 0) {
    warnings.push(
      `${shortStrings} of the ${stringCount} strings are shorter than ${n} panels. Each takes a tracker input of its own rather than sharing one, because a short string and a full string on the same input pull against each other.`,
    );
  }
  if (mpptReassigned > 0) {
    warnings.push(
      `${mpptReassigned} string${mpptReassigned === 1 ? "" : "s"} moved onto a tracker input of its own: sharing an input with a different-length string would pull both off their maximum-power point.`,
    );
  }
  const mpptNeeded = Math.max(...strings.map((run) => run.mppt), -1) + 1;
  if (mpptNeeded > input.inverter.mpptCount) {
    warnings.push(
      `The layout wants ${mpptNeeded} tracker inputs per inverter and this model has ${input.inverter.mpptCount}. Add an inverter, or drop the short strings.`,
    );
  }
  if (dcAcRatio > 1.35) {
    warnings.push(
      `DC to AC ratio is ${dcAcRatio.toFixed(2)}. Above about 1.3 the inverters clip through the middle of the day; add an inverter or take modules off.`,
    );
  }
  if (dcAcRatio > 0 && dcAcRatio < 1.05) {
    warnings.push(
      `DC to AC ratio is ${dcAcRatio.toFixed(2)}. Inverter capacity is barely used; a smaller inverter would cost less and lose nothing.`,
    );
  }
  if (kwpWired > input.inverter.maxDcKw * inverterCount) {
    warnings.push(
      `${Math.round(kwpWired)} kWp exceeds the ${Math.round(input.inverter.maxDcKw * inverterCount)} kWp the inverters are rated to accept.`,
    );
  }
  if (worstDropFraction > DC_DROP_TARGET) {
    warnings.push(
      `The longest home run drops ${(worstDropFraction * 100).toFixed(1)}% even on ${CABLE_SIZES_MM2[CABLE_SIZES_MM2.length - 1]} mm2. Move the inverter closer to the array.`,
    );
  }

  return {
    sizing,
    strings,
    inverterCount,
    strandedModules,
    modulesWired,
    kwpWired,
    acKw,
    dcAcRatio,
    cable: {
      extraSeriesM,
      homeRunM: homeRunTotalM * 2,
      runs,
      worstDropFraction,
      sizesUsedMm2,
    },
    inverterAt,
    warnings,
  };
};

/**
 * Pick the inverter that gets closest to a 1.2 DC/AC ratio for a target array
 * size without exceeding its DC input rating, preferring fewer units.
 */
export const chooseInverter = (
  targetKwp: number,
  sizingTemps: DesignTemperatures,
  module: PvModule,
): InverterSpec => {
  const workable = INVERTERS.filter((inverter) => sizeString(module, inverter, sizingTemps).feasible);
  const pool = workable.length > 0 ? workable : INVERTERS;
  let best = pool[0];
  let bestScore = Infinity;
  for (const inverter of pool) {
    // Try both sides of the ideal count, because rounding one way can leave a
    // much worse ratio than rounding the other.
    const ideal = targetKwp / (inverter.acKw * TARGET_DC_AC_RATIO);
    for (const count of new Set([Math.floor(ideal), Math.ceil(ideal), 1])) {
      if (count < 1 || count > 40) continue;
      if (targetKwp > inverter.maxDcKw * count) continue;
      const ratio = targetKwp / (count * inverter.acKw);
      if (ratio > 1.35) continue;
      // Prefer the right ratio, then markedly fewer units: nine small inverters cost more to install, commission and maintain than three large ones.
      const score = Math.abs(ratio - TARGET_DC_AC_RATIO) + count * 0.03;
      if (score < bestScore) {
        bestScore = score;
        best = inverter;
      }
    }
  }
  return best;
};

/**
 * How much longer a string can be here than in northern Europe, given the same
 * equipment. A mild winter is worth real money: fewer strings means fewer home
 * runs, fewer fuses and fewer tracker inputs for the same array.
 */
export const climateStringAdvantage = (module: PvModule, inverter: InverterSpec, here: DesignTemperatures) => {
  const local = Math.floor(inverter.maxSystemVdc / vocAt(module, here.recordLowC));
  const temperate = Math.floor(inverter.maxSystemVdc / vocAt(module, TEMPERATE_REFERENCE.recordLowC));
  return {
    local,
    temperate,
    extraModules: local - temperate,
    fractionFewerStrings: local > 0 ? 1 - temperate / local : 0,
  };
};
