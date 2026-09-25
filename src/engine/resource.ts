/**
 * UAE resource layer.
 *
 * The baked NASA POWER grid (scripts/bake-resource.ts) supplies measured
 * 20-year reanalysis climatology per 0.4-degree point: monthly mean daily
 * global horizontal irradiation, air temperature and wind speed at 10 m and
 * 50 m. This module turns the nearest grid point into the series the rest of
 * the engine consumes, so a site at Al Ain no longer screens on a coastal
 * Dubai constant.
 *
 * Weather stays modelled hour by hour — a climatology has no daily shape — but
 * it is scaled so each month's irradiation equals the measured mean, and the
 * temperature and wind monthly means come straight from the reanalysis.
 */

import {
  HOURS_PER_YEAR,
  newSeries,
  type HourlySeries,
  type LatLng,
  type Provenance,
} from "./types";
import {
  buildSolarYear,
  clearSkyGhi,
  modelledWeatherYear,
  solarPosition,
  type SolarYear,
  type WeatherYear,
} from "./solar";
import { monthOfHour } from "./calendar";
import grid from "../data/uae-resource-grid.json";

export type ResourcePoint = {
  lat: number;
  lng: number;
  /** Monthly mean daily global horizontal irradiation, kWh/m2/day. */
  ghiKwhM2Day: number[];
  /** Monthly mean air temperature at 2 m, degrees C. */
  tempC: number[];
  /** Monthly mean wind speed at 10 m, m/s. */
  wind10m: number[];
  /** Monthly mean wind speed at 50 m, m/s. */
  wind50m: number[];
};

export const RESOURCE_PROVENANCE: Provenance = (grid as { provenance: Provenance }).provenance;

const POINTS = (grid as { points: ResourcePoint[] }).points;

const distanceSq = (a: LatLng, b: { lat: number; lng: number }): number =>
  (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;

/** Nearest baked grid point. With a 0.4-degree grid the worst case is ~30 km. */
export const resourcePointFor = (site: LatLng): ResourcePoint =>
  POINTS.reduce((nearest, point) =>
    distanceSq(site, point) < distanceSq(site, nearest) ? point : nearest,
  );

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Daily mean clear-sky irradiation for a month at this latitude, kWh/m2/day,
 * used to turn measured GHI into a clearness ratio. Averaged by sampling
 * every daylight hour across the month's middle day.
 */
const clearSkyDailyKwhM2 = (site: LatLng, month: number): number => {
  // Middle day of the month, day of year.
  let dayOfYear = 0;
  for (let m = 0; m < month; m += 1) dayOfYear += MONTH_DAYS[m];
  dayOfYear += Math.floor(MONTH_DAYS[month] / 2);

  let dailyWh = 0;
  for (let localHour = 0; localHour < 24; localHour += 1) {
    const hourOfYear = (dayOfYear - 1) * 24 + localHour;
    const sun = solarPosition(site, hourOfYear);
    dailyWh += clearSkyGhi(sun.cosZenith);
  }
  return dailyWh / 1000;
};

/**
 * A weather year anchored to measured climatology. The clear-sky model keeps
 * the hour-by-hour shape; the measured monthly GHI decides how much of that
 * sky arrives. Temperature and 10 m wind monthly means come from the same
 * reanalysis point.
 */
export const weatherYearFor = (site: LatLng, sun?: SolarYear): WeatherYear => {
  const point = resourcePointFor(site);
  const solarYear = sun ?? buildSolarYear(site);
  const ghi = newSeries();
  const ambientC = newSeries();
  const windMs = newSeries();

  const clearDaily = MONTH_DAYS.map((_, month) => clearSkyDailyKwhM2(site, month));
  const clearnessRatio = point.ghiKwhM2Day.map((measured, month) =>
    clearDaily[month] > 0 ? Math.min(1, measured / clearDaily[month]) : 0,
  );

  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const month = monthOfHour(hour);
    ghi[hour] = clearSkyGhi(solarYear.position[hour].cosZenith) * clearnessRatio[month];

    const localHour = hour % 24;
    const swing = 9; // daily temperature range, degrees C
    ambientC[hour] =
      point.tempC[month] + (swing / 2) * Math.sin(((localHour - 9) / 24) * 2 * Math.PI);
    windMs[hour] = point.wind10m[month];
  }

  return { ghi, ambientC, windMs, source: "nasa-power-climatology" };
};

/**
 * Monthly mean measured GHI at the nearest grid point, kWh/m2/day — the
 * number to quote when someone asks what the sun actually delivers there.
 */
export const measuredGhiDaily = (site: LatLng): number[] => resourcePointFor(site).ghiKwhM2Day;

/** Measured monthly mean wind at 50 m, the screening height for small wind. */
export const measuredWind50m = (site: LatLng): number[] => resourcePointFor(site).wind50m;

/**
 * Power-law shear between measurement height and hub height. The 1/7 exponent
 * is the standard open-terrain value; coastal industrial land is not far off.
 */
export const windAtHeight = (ms: number, fromM: number, toM: number, exponent = 1 / 7): number =>
  ms * (toM / fromM) ** exponent;

/**
 * Expected capacity factor of a small turbine from a monthly mean wind speed,
 * integrating a simple power curve over a Rayleigh speed distribution. The
 * curve is generic: cut-in 3 m/s, cubic to rated at `ratedMs`, flat to
 * cut-out 25 m/s. It answers "is the wind here worth a mast", not "how many
 * kWh will this make".
 */
export const rayleighCapacityFactor = (
  meanWindMs: number,
  options: { cutInMs?: number; ratedMs?: number; cutOutMs?: number } = {},
): number => {
  const cutIn = options.cutInMs ?? 3;
  const rated = options.ratedMs ?? 11;
  const cutOut = options.cutOutMs ?? 25;
  const sigma = meanWindMs / 1.0864; // Rayleigh scale from mean
  if (sigma <= 0) return 0;

  // E[P] = integral of the power curve against the Rayleigh density,
  // evaluated numerically in 0.05 m/s steps.
  let energy = 0;
  const step = 0.05;
  for (let v = cutIn + step / 2; v < cutOut; v += step) {
    const power = v >= rated ? 1 : (v / rated) ** 3;
    const pdf = (v / (sigma * sigma)) * Math.exp((-v * v) / (2 * sigma * sigma));
    energy += power * pdf * step;
  }
  return energy;
};

/**
 * Monthly kWh per installed kW for a small turbine at hub height, from the
 * measured 50 m wind at the nearest grid point. Day counts per month are
 * taken care of by the caller if it needs monthly totals; this returns an
 * average-day month in kWh.
 */
export const windMonthlyKwhPerKw = (
  site: LatLng,
  hubHeightM = 30,
  options?: { cutInMs?: number; ratedMs?: number; cutOutMs?: number },
): number[] =>
  measuredWind50m(site).map((ms, month) => {
    const atHub = windAtHeight(ms, 50, hubHeightM);
    return rayleighCapacityFactor(atHub, options) * 24 * MONTH_DAYS[month];
  });

/** Convenience wrapper used where a weather year is needed and none is supplied. */
export const weatherOrModelled = (
  site: LatLng,
  weather?: WeatherYear,
  sun?: SolarYear,
): WeatherYear =>
  weather ?? (POINTS.length > 0 ? weatherYearFor(site, sun) : modelledWeatherYear(site, sun));
