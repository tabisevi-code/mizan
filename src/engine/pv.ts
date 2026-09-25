/**
 * PV array simulation: weather year in, 8760 hourly AC kW out.
 *
 * Loss stack, each term named so the report can list it:
 *   plane-of-array irradiance -> incidence-angle modifier -> soiling
 *   -> module temperature derate -> DC wiring and mismatch -> inverter
 *   -> clipping -> availability -> annual degradation.
 */

import {
  MOUNTING_THERMAL,
  WIND_AT_MODULE,
  huldRelativeEfficiency,
  monthOfHour,
  moduleTemperature,
  solarPosition,
  transpose,
  type WeatherYear,
} from "./solar";
import {
  HOURS_PER_YEAR,
  newSeries,
  sum,
  type HourlySeries,
  type LatLng,
  type Provenance,
  type PvArraySpec,
} from "./types";

export type PvLossAssumptions = {
  /**
   * Temperature coefficient of power from the module datasheet, fraction per
   * degree C, negative. The yield model uses Huld's field-fitted efficiency
   * surface rather than this number; this is what `electrical.ts` uses to work
   * out string voltages, where the datasheet value is exactly the right one.
   */
  gammaPerC: number;
  /** DC-side wiring, mismatch and connection losses as a fraction. */
  dcLosses: number;
  /** Inverter conversion efficiency at nominal load. */
  inverterEfficiency: number;
  /** Availability: grid outages, maintenance downtime. */
  availability: number;
  /**
   * Everything the hourly model does not resolve: nameplate tolerance,
   * light-induced degradation in the first months, inverter part-load
   * efficiency below its nominal point, and module-to-module mismatch beyond
   * string level. PVsyst-style designs carry a term like this; without it a
   * performance ratio comes out several points too flattering.
   */
  otherLosses: number;
  /** Module output decline per year after the first. */
  degradationPerYear: number;
  /**
   * Soiling between cleans. Gulf dust is the reason this is not a token 2%.
   * `soilingRatePerDay` is retained for callers that supply their own measured
   * rate; `cleaningIntervalDays` sets how often the panels are washed. When
   * `useMeasuredUaeSoiling` is true the loss follows the published Al Ain
   * field measurements instead of a linear rate.
   */
  soilingRatePerDay: number;
  cleaningIntervalDays: number;
  useMeasuredUaeSoiling?: boolean;
};

/**
 * Defaults. The electrical terms are standard industry values; the soiling
 * terms are the Gulf-specific ones and are flagged as assumptions in the UI
 * until a site supplies measured soiling data.
 */
export const DEFAULT_PV_LOSSES: PvLossAssumptions = {
  gammaPerC: -0.0034,
  dcLosses: 0.03,
  inverterEfficiency: 0.975,
  availability: 0.99,
  otherLosses: 0.03,
  degradationPerYear: 0.005,
  soilingRatePerDay: 0.0035,
  cleaningIntervalDays: 21,
  useMeasuredUaeSoiling: true,
};

/**
 * End-of-interval soiling loss measured on PV panels in Al Ain, UAE, 2019,
 * published in Sustainability 2020 (Al-Otaibi et al.). The study left panels
 * uncleaned and recorded the power loss versus a cleaned reference: about 4%
 * after two weeks and 13% after three months. The curve between is assumed
 * piecewise linear, which matches how dust accumulates in this climate.
 */
export const UAE_SOILING_MEASURED: { days: number; loss: number }[] = [
  { days: 0, loss: 0 },
  { days: 15, loss: 0.04 },
  { days: 90, loss: 0.13 },
];

export const SOILING_MEASURED_SOURCE: Provenance = {
  kind: "dataset",
  label: "Al Ain PV soiling study",
  url: "https://www.mdpi.com/2071-1050/12/9/3823",
  asOf: "2026-09-25",
  caveat:
    "Field measurements on fixed-tilt modules in Al Ain. Coastal dust composition differs; the curve interpolates linearly and saturates beyond 90 days.",
};

/** Loss on the day panels are cleaned, interpolating the measured curve. */
export const endOfCycleSoilingLoss = (days: number): number => {
  const table = UAE_SOILING_MEASURED;
  if (days <= table[0].days) return table[0].loss;
  for (let i = 1; i < table.length; i += 1) {
    if (days <= table[i].days) {
      const a = table[i - 1];
      const b = table[i];
      return a.loss + ((days - a.days) / (b.days - a.days)) * (b.loss - a.loss);
    }
  }
  // Past the last measurement the dust film has effectively saturated; hold it.
  return table[table.length - 1].loss;
};

/** Mean soiling loss over one cleaning cycle, as a fraction of output. */
export const meanSoilingLoss = (losses: PvLossAssumptions): number => {
  if (losses.useMeasuredUaeSoiling) {
    // Average the measured end-of-cycle curve over the interval. Daily
    // accumulation is near-linear, so a coarse 1-day integral is enough.
    const days = Math.max(1, Math.round(losses.cleaningIntervalDays));
    let total = 0;
    for (let day = 1; day <= days; day += 1) total += endOfCycleSoilingLoss(day);
    return Math.min(0.35, total / days);
  }
  const peak = losses.soilingRatePerDay * losses.cleaningIntervalDays;
  // Loss ramps roughly linearly between cleans, so the mean is half the peak.
  return Math.min(0.35, peak / 2);
};

/**
 * Flat industrial roofs in the UAE are usually built out at a shallow tilt to
 * cut row spacing and wind uplift, and to keep soiling from ponding. 10 degrees
 * is the common compromise; the optimum for annual yield at this latitude is
 * nearer 24 degrees but costs roof area.
 */
export const DEFAULT_ROOF_TILT_DEG = 10;
export const DEFAULT_GROUND_TILT_DEG = 22;

/**
 * How far this engine is from PVGIS's own PV model, measured rather than
 * asserted. Produced by `scripts/validate.ts`, which fits the one free
 * parameter on every site but the one being scored.
 *
 * Read it for what it is. PVGIS PVcalc is a model driven by measured satellite
 * irradiance and validated against real installations in many countries, so
 * agreeing with it closely is worth something. It is not a metered UAE system,
 * and this is not a claim to have matched one.
 */
export const ENGINE_VALIDATION = {
  reference: "PVGIS v5.3 PVcalc, PVGIS-SARAH3",
  setup: "1 kWp, 10 degree tilt, due south, building-mounted, matched loss stack",
  sites: 16,
  /** Leave-one-site-out, on annual AC yield per kWp. */
  yieldBias: 0.0,
  yieldMeanAbsError: 0.0109,
  yieldWorstSite: { name: "Sila", error: 0.0311 },
  /** In-plane irradiance, which uses no fitted parameter at all. */
  irradianceBias: 0.0026,
  irradianceMeanAbsError: 0.0151,
  /** And the clearness index behind it, from scripts/calibrate.ts. */
  irradianceSites: 32,
  checkedOn: "2026-09-24",
};

export type PvSimulation = {
  /** AC output in kW for each hour of the year, first year. */
  hourlyAcKw: HourlySeries;
  annualKwh: number;
  /** kWh per kWp per year, the number the industry compares on. */
  specificYield: number;
  clippedKwh: number;
  lossBreakdown: { label: string; fraction: number }[];
};

export const simulateArray = (
  site: LatLng,
  weather: WeatherYear,
  spec: PvArraySpec,
  losses: PvLossAssumptions = DEFAULT_PV_LOSSES,
  /**
   * Loss to the shadow of the row in front, as a fraction of the year's
   * plane-of-array energy, from `shading.ts`. Computed from the rows the
   * packer actually laid down, so it is zero until there is a layout. It is
   * applied as an annual derate rather than hour by hour: the shading is
   * concentrated in the winter mornings, so the hourly shape is slightly off,
   * but the annual energy every financial figure rests on is right.
   */
  shadingLoss = 0,
): PvSimulation => {
  const hourlyAcKw = newSeries();
  if (spec.kwp <= 0) {
    return {
      hourlyAcKw,
      annualKwh: 0,
      specificYield: 0,
      clippedKwh: 0,
      lossBreakdown: [],
    };
  }

  const soiling = meanSoilingLoss(losses);
  const shading = Math.max(0, Math.min(0.5, shadingLoss));
  const thermal = MOUNTING_THERMAL[spec.mounting] ?? MOUNTING_THERMAL.ground;
  const inverterKw = spec.kwp / Math.max(spec.dcAcRatio, 0.1);
  const albedo = spec.mounting === "ground" ? 0.25 : 0.15; // less reflected light on a roof

  let poaKwhPerM2 = 0;
  let dcBeforeTempKwh = 0;
  let dcAfterTempKwh = 0;
  let clippedKwh = 0;

  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const ghi = weather.ghi[hour];
    if (ghi <= 0) continue;

    const sun = solarPosition(site, hour);
    const doy = Math.floor(hour / 24) + 1;
    const poa = transpose(ghi, doy, sun, spec.tiltDeg, spec.azimuthDeg, albedo);
    if (poa.effectiveWm2 <= 0) continue;

    poaKwhPerM2 += poa.poaWm2 / 1000;

    // Standard test conditions are 1000 W/m2 at 25 C.
    const irradianceRatio = (poa.effectiveWm2 / 1000) * (1 - soiling);
    const dcBefore = spec.kwp * irradianceRatio;
    dcBeforeTempKwh += dcBefore;

    const cellC = moduleTemperature(
      poa.poaWm2,
      weather.ambientC[hour],
      weather.windMs[hour] * WIND_AT_MODULE,
      thermal.u0,
      thermal.u1,
    );
    // Efficiency against both heat and weak light, not heat alone. Huld's
    // coefficients are used as published rather than rescaled to a datasheet
    // temperature coefficient: they are fitted to how modules behave in the
    // field, which is not the same thing as how one behaves in a flash test,
    // and rescaling them turned out to be the difference between agreeing
    // with PVGIS and being eight per cent above it.
    const tempFactor = huldRelativeEfficiency(poa.effectiveWm2, cellC);
    const dc = dcBefore * Math.max(0, tempFactor) * (1 - losses.dcLosses);
    dcAfterTempKwh += dc;

    const acUnclipped = dc * losses.inverterEfficiency;
    const ac = Math.min(acUnclipped, inverterKw);
    clippedKwh += acUnclipped - ac;

    hourlyAcKw[hour] = ac * losses.availability * (1 - losses.otherLosses) * (1 - shading);
  }

  const annualKwh = sum(hourlyAcKw);
  const tempLoss = dcBeforeTempKwh > 0 ? 1 - dcAfterTempKwh / dcBeforeTempKwh : 0;

  return {
    hourlyAcKw,
    annualKwh,
    specificYield: annualKwh / spec.kwp,
    clippedKwh,
    lossBreakdown: [
      { label: "Soiling between cleans", fraction: soiling },
      { label: "Shadow of the row in front", fraction: shading },
      { label: "Heat and weak light on the modules", fraction: tempLoss - losses.dcLosses },
      { label: "DC wiring and mismatch", fraction: losses.dcLosses },
      { label: "Inverter conversion", fraction: 1 - losses.inverterEfficiency },
      {
        label: "Inverter clipping",
        fraction: annualKwh > 0 ? clippedKwh / (annualKwh + clippedKwh) : 0,
      },
      { label: "Availability", fraction: 1 - losses.availability },
      { label: "Nameplate, part-load and mismatch", fraction: losses.otherLosses },
    ],
    // poaKwhPerM2 is retained for the report but not part of the public shape yet.
  };
};

/** Output in year n, counting year 1 as n = 1. */
export const degradedOutput = (
  firstYearKwh: number,
  year: number,
  degradationPerYear = DEFAULT_PV_LOSSES.degradationPerYear,
): number => firstYearKwh * (1 - degradationPerYear) ** Math.max(0, year - 1);
