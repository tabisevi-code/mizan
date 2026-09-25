import { MONTH_HOURS, monthOfHour } from "../engine/calendar";
import { DEFAULT_ROOF_TILT_DEG, simulateArray } from "../engine/pv";
import { modelledWeatherYear } from "../engine/solar";
import type { LatLng, RenewableSource } from "../engine/types";

// Re-exported so existing data/web call sites keep working; the definitions
// live in the engine now (dependency direction is data -> engine).
export { MONTH_HOURS };
export type { RenewableSource };

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const SOURCE_LABELS: Record<RenewableSource, string> = { solar: "Solar", wind: "Wind", hydro: "Micro-hydro", geothermal: "Geothermal" };

import { windYield } from "../engine/wind";

/**
 * kWh per installed kW of wind per month at a configured climate site.
 *
 * Replaces the old flat regional capacity factors with the physical model:
 * Global Wind Atlas level, ERA5 monthly shape and density, turbine power
 * curve. Still a model, not a met mast — the provenance lives in wind-uae.json.
 */
export function windMonthlyKwhPerKw(siteId: string, turbineId = "mid-900", turbineCount = 1): number[] {
  return windYield(siteId, turbineId, { turbineCount }).monthlyKwhPerKw;
}

const solarCache = new Map<string, number[]>();
/** kWh per installed kWp per month, with existing UAE heat/dust/loss model. */
export function solarMonthlyYield(location: LatLng): number[] {
  const key = `${location.lat},${location.lng}`;
  if (!solarCache.has(key)) {
    const pv = simulateArray(location, modelledWeatherYear(location), {
      kwp: 1, tiltDeg: DEFAULT_ROOF_TILT_DEG, azimuthDeg: 0, mounting: "roof-flat", dcAcRatio: 1.2,
    });
    const monthly = Array<number>(12).fill(0);
    pv.hourlyAcKw.forEach((kw, hour) => { monthly[monthOfHour(hour)] += kw; });
    solarCache.set(key, monthly);
  }
  return [...solarCache.get(key)!];
}

/** Normalized energy shares; unknown locations are errors, never coastal defaults. */
export function getMonthlyProfile(source: RenewableSource, location: string, turbineId = "mid-900"): number[] {
  if (source !== "wind") {
    throw new Error(`No published or assumed profile configured for ${source} at ${location}`);
  }
  const energy = windMonthlyKwhPerKw(location, turbineId);
  const total = energy.reduce((a, b) => a + b, 0);
  return energy.map(v => v / total);
}
