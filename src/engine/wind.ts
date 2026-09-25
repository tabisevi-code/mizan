/**
 * Wind energy, for UAE conditions.
 *
 * The previous model was a single capacity factor per area, guessed. This one
 * takes the wind climate for the site out of `wind-uae.json` and runs it
 * through a turbine, which changes the answer a lot: output goes with the cube
 * of the wind speed, so a 15% error in speed is a 50% error in energy, and
 * every UAE site here sits on the steep part of the curve where a turbine is
 * either worth building or nowhere near it.
 *
 * Three things matter here that a generic model gets wrong in the Gulf.
 *
 * Air density. Power curves are published at 1.225 kg/m3, which is 15 C at sea
 * level. Abu Dhabi in July averages about 36 C, and the air is about 8% thinner
 * than that; below rated power the turbine gives back that 8% directly. The
 * monthly density comes from the same reanalysis as the wind, so the summer
 * derate is carried rather than assumed.
 *
 * Terrain. Reanalysis is computed on a grid tens of kilometres wide, so it
 * flattens the Hajar mountains, where the only good UAE wind actually is. The
 * level comes from the Global Wind Atlas instead, which resolves them.
 *
 * Shape. Gulf wind is closer to Rayleigh than to the peaky distributions of
 * the trade-wind belt, and the shape parameter decides how much of the year is
 * spent above cut-in. It is fitted per month rather than assumed.
 *
 * What this model does not do: turbulence, wind shear across the rotor, wake
 * losses beyond a flat allowance, terrain speed-up at a resolution finer than
 * the Atlas pixel, or anything at all about a rooftop's own wake. It is a
 * screening model. Nobody should finance a turbine on it.
 */

import windData from "../data/wind-uae.json";

/** Calendar month lengths; kept local so the data layer can depend on this
 * module rather than the other way round. */
const MONTH_HOURS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((d) => d * 24);

export type WindSiteClimate = {
  name: string;
  emirate: string;
  lat: number;
  lng: number;
  terrain: number;
  /** "ridge" means the Atlas best-decile is the siting level, not the box mean. */
  siting?: "ridge";
  era5: {
    months: { weibullA: number; weibullK: number; meanMs: number; meanTempC: number; meanPressureHpa: number }[];
    annualMeanMs: number;
  };
  gwa: {
    roughnessLengthM: number;
    heights: number[];
    meanMsByHeight: number[];
    gridded: Record<string, { meanMs: number; bestDecileMs: number }>;
  };
  terrainFactor: number;
};

const SITES = windData.sites as unknown as Record<string, WindSiteClimate>;
export const WIND_CLIMATE_META = windData.meta;

export const windClimate = (siteId: string): WindSiteClimate => {
  const site = SITES[siteId];
  if (!site) {
    throw new Error(
      `No wind climate for "${siteId}". Sites are listed in src/data/wind-sites.ts; run scripts/fetch-wind.ts to add one.`,
    );
  }
  return site;
};

export const windSiteIds = (): string[] => Object.keys(SITES);

/** Lanczos gamma, called only for arguments in [1, 2] here. */
const gamma = (x: number): number => {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a;
};

/**
 * A turbine, described by what a datasheet's front page gives you.
 *
 * The power curve is derived from these numbers rather than copied from a
 * manufacturer, because a curve typed in from memory would look authoritative
 * and be wrong. Deriving it keeps the model honest about being a model: it is
 * the Betz relation with a realistic peak power coefficient, capped at rated.
 */
export type Turbine = {
  id: string;
  name: string;
  ratedKw: number;
  rotorDiameterM: number;
  hubHeightM: number;
  cutInMs: number;
  cutOutMs: number;
  /** Peak power coefficient. Modern large turbines reach about 0.47. */
  peakCp: number;
  /** Drivetrain and converter efficiency at rated. */
  driveTrainEfficiency: number;
  class: string;
  note: string;
};

export const TURBINES: Record<string, Turbine> = {
  "utility-4500": {
    id: "utility-4500",
    name: "Utility scale, 4.5 MW, 155 m rotor",
    ratedKw: 4500,
    rotorDiameterM: 155,
    hubHeightM: 120,
    cutInMs: 3,
    cutOutMs: 25,
    peakCp: 0.47,
    driveTrainEfficiency: 0.95,
    class: "IEC III / S, low wind",
    note:
      "Sized on the 4.5 MW unit published for Masdar's Al Halah site. Rotor and hub height are the low-wind configuration typical of that rating, not a quoted specification for that machine.",
  },
  "utility-2000": {
    id: "utility-2000",
    name: "Utility scale, 2 MW, 120 m rotor",
    ratedKw: 2000,
    rotorDiameterM: 120,
    hubHeightM: 100,
    cutInMs: 3,
    cutOutMs: 25,
    peakCp: 0.46,
    driveTrainEfficiency: 0.95,
    class: "IEC III, low wind",
    note: "A low specific power machine, the class that makes 5 to 6 m/s sites work at all.",
  },
  "mid-900": {
    id: "mid-900",
    name: "Mid scale, 900 kW, 60 m rotor",
    ratedKw: 900,
    rotorDiameterM: 60,
    hubHeightM: 70,
    cutInMs: 3,
    cutOutMs: 25,
    peakCp: 0.44,
    driveTrainEfficiency: 0.94,
    class: "IEC II",
    note: "A single machine at industrial-estate scale, where land and setback allow one.",
  },
  "small-100": {
    id: "small-100",
    name: "Small wind, 100 kW, 21 m rotor",
    ratedKw: 100,
    rotorDiameterM: 21,
    hubHeightM: 36,
    cutInMs: 3,
    cutOutMs: 25,
    peakCp: 0.4,
    driveTrainEfficiency: 0.92,
    class: "Small wind, IEC 61400-2",
    note: "A mast-mounted machine on a site's own land. Not a rooftop turbine.",
  },
  "small-10": {
    id: "small-10",
    name: "Small wind, 10 kW, 8 m rotor",
    ratedKw: 10,
    rotorDiameterM: 8,
    hubHeightM: 18,
    cutInMs: 3,
    cutOutMs: 25,
    peakCp: 0.35,
    driveTrainEfficiency: 0.9,
    class: "Small wind, IEC 61400-2",
    note:
      "At 18 m in a built-up UAE area this sits inside the roughness layer of its own surroundings. The model will show the low yield; turbulence makes the real one lower still.",
  },
};

/**
 * Losses between the power curve and the meter, as fractions kept.
 *
 * Soiling is the UAE-specific one. Blade leading edges collect the same dust
 * that costs rooftop PV its output, and the published range for arid sites is
 * wide; 2% is at the optimistic end of it and assumes cleaning.
 */
export const WIND_LOSSES = {
  availability: 0.97,
  electrical: 0.98,
  soiling: 0.98,
  /** Applied only when more than one turbine is on the site. */
  wakePerArray: 0.95,
} as const;

/** Dry-air density at a height, from the surface record. */
export const airDensity = (tempC: number, pressureHpa: number, heightM: number): number => {
  const R = 287.05;
  const g = 9.80665;
  const lapse = 0.0065;
  const tempAtHeightK = tempC + 273.15 - lapse * heightM;
  const pressurePa = pressureHpa * 100 * Math.exp((-g * heightM) / (R * (tempC + 273.15)));
  return pressurePa / (R * tempAtHeightK);
};

/**
 * Turbine power at one wind speed and one air density, in kW.
 *
 * Below rated the rotor is density-limited, so thin air costs output directly.
 * Above rated the machine is torque-limited and holds its rating, so the
 * summer derate only bites on the part of the year the turbine is not maxed
 * out, which in the UAE is nearly all of it.
 */
export const turbinePowerKw = (turbine: Turbine, speedMs: number, density: number): number => {
  if (speedMs < turbine.cutInMs || speedMs > turbine.cutOutMs) return 0;
  const sweptArea = Math.PI * (turbine.rotorDiameterM / 2) ** 2;
  const aerodynamic =
    (0.5 * density * sweptArea * turbine.peakCp * speedMs ** 3 * turbine.driveTrainEfficiency) / 1000;
  return Math.min(turbine.ratedKw, aerodynamic);
};

/**
 * Mean wind speed at a hub height.
 *
 * Between 50 and 150 m the Atlas has its own gridded values, which already
 * carry the terrain, so the model interpolates those against the logarithm of
 * height instead of extrapolating a shear law over ground it cannot see.
 * Outside that band it falls back to the log law on the site's roughness.
 */
export const hubHeightSpeed = (site: WindSiteClimate, hubHeightM: number): number => {
  const grid = site.gwa.gridded;
  const level = (height: number) =>
    site.siting === "ridge" ? grid[String(height)].bestDecileMs : grid[String(height)].meanMs;
  const heights = Object.keys(grid)
    .map(Number)
    .sort((a, b) => a - b);
  const clamp = Math.max(heights[0], Math.min(heights[heights.length - 1], hubHeightM));
  if (hubHeightM >= heights[0] && hubHeightM <= heights[heights.length - 1]) {
    for (let i = 0; i < heights.length - 1; i++) {
      const [lower, upper] = [heights[i], heights[i + 1]];
      if (clamp < lower || clamp > upper) continue;
      const share = (Math.log(clamp) - Math.log(lower)) / (Math.log(upper) - Math.log(lower));
      return level(lower) + share * (level(upper) - level(lower));
    }
  }
  const reference = hubHeightM < heights[0] ? heights[0] : heights[heights.length - 1];
  const z0 = Math.max(0.0002, site.terrain);
  return level(reference) * (Math.log(hubHeightM / z0) / Math.log(reference / z0));
};

export type WindYield = {
  /** kWh per installed kW, Jan to Dec, after losses. */
  monthlyKwhPerKw: number[];
  annualKwhPerKw: number;
  capacityFactor: number;
  hubSpeedMs: number;
  /** Annual mean air density seen by the rotor. */
  meanAirDensity: number;
  /** What the same turbine would make in 1.225 kg/m3 air. The gap is the heat. */
  densityPenalty: number;
  turbine: Turbine;
  site: WindSiteClimate;
};

/**
 * Monthly energy for one turbine at one site.
 *
 * The integral is over the fitted Weibull distribution for each month, which
 * is the only honest way to do this: a turbine's output at the mean wind speed
 * is not its mean output, and for a Rayleigh-ish distribution at 5 m/s the
 * difference is most of the answer.
 */
export const windYield = (
  siteId: string,
  turbineId: string,
  options: { turbineCount?: number; hubHeightM?: number } = {},
): WindYield => {
  const site = windClimate(siteId);
  const base = TURBINES[turbineId];
  if (!base) throw new Error(`Unknown turbine "${turbineId}"`);
  const turbine = options.hubHeightM ? { ...base, hubHeightM: options.hubHeightM } : base;
  const turbineCount = options.turbineCount ?? 1;
  if (!Number.isFinite(turbineCount) || turbineCount < 1) throw new Error("Turbine count must be at least 1");

  const hubSpeedMs = hubHeightSpeed(site, turbine.hubHeightM);
  const losses =
    WIND_LOSSES.availability *
    WIND_LOSSES.electrical *
    WIND_LOSSES.soiling *
    (turbineCount > 1 ? WIND_LOSSES.wakePerArray : 1);

  let densityWeighted = 0;
  let referenceEnergy = 0;
  const monthlyKwhPerKw = site.era5.months.map((month, index) => {
    // The Atlas sets the annual level, the reanalysis sets the month-to-month
    // shape. Neither is used for the job the other does better.
    const seasonalIndex = month.meanMs / site.era5.annualMeanMs;
    const meanMs = hubSpeedMs * seasonalIndex;
    const k = month.weibullK;
    const a = meanMs / gamma(1 + 1 / k);
    const density = airDensity(month.meanTempC, month.meanPressureHpa, turbine.hubHeightM);
    densityWeighted += density / 12;

    // Trapezoidal integration of the Weibull density against the power curve.
    const step = 0.25;
    let meanKw = 0;
    let meanKwReference = 0;
    for (let v = step / 2; v < turbine.cutOutMs + step; v += step) {
      const probability =
        (k / a) * (v / a) ** (k - 1) * Math.exp(-((v / a) ** k)) * step;
      meanKw += probability * turbinePowerKw(turbine, v, density);
      meanKwReference += probability * turbinePowerKw(turbine, v, 1.225);
    }
    referenceEnergy += (meanKwReference / turbine.ratedKw) * MONTH_HOURS[index] * losses;
    return (meanKw / turbine.ratedKw) * MONTH_HOURS[index] * losses;
  });

  const annualKwhPerKw = monthlyKwhPerKw.reduce((sum, value) => sum + value, 0);
  return {
    monthlyKwhPerKw,
    annualKwhPerKw,
    capacityFactor: annualKwhPerKw / 8760,
    hubSpeedMs,
    meanAirDensity: densityWeighted,
    densityPenalty: referenceEnergy > 0 ? 1 - annualKwhPerKw / referenceEnergy : 0,
    turbine,
    site,
  };
};

/**
 * Whether a turbine is worth assessing at all at this site.
 *
 * The thresholds are screening thresholds, not investment advice, and they are
 * deliberately blunt: below about a 20% capacity factor a UAE turbine is
 * competing with solar that costs a third as much per kWh and needs no
 * setback, no aviation clearance and no noise study.
 */
export const windVerdict = (result: WindYield): { rank: "good" | "marginal" | "poor"; reason: string } => {
  const cf = result.capacityFactor * 100;
  const speed = result.hubSpeedMs;
  if (cf >= 25) {
    return { rank: "good", reason: `${cf.toFixed(1)}% capacity factor at ${speed.toFixed(1)} m/s hub wind. Worth a measurement campaign.` };
  }
  if (cf >= 18) {
    return { rank: "marginal", reason: `${cf.toFixed(1)}% capacity factor at ${speed.toFixed(1)} m/s hub wind. Viable only against a high tariff or where land is already held.` };
  }
  return {
    rank: "poor",
    reason: `${cf.toFixed(1)}% capacity factor at ${speed.toFixed(1)} m/s hub wind. Solar delivers more energy per dirham on this site.`,
  };
};
