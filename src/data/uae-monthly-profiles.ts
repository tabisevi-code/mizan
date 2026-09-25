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

/** Sensitivity assumptions, NOT measured wind resources or MERRA-2 data.
 * No seasonal complementarity is asserted without a measured time series. */
export const WIND_CAPACITY_FACTORS: Record<string, number[]> = {
  "jebel-ali": Array(12).fill(0.11),
  ruwais: Array(12).fill(0.14),
  fujairah: Array(12).fill(0.13),
  khorfakkan: Array(12).fill(0.13),
  "ras-al-khaimah": Array(12).fill(0.15),
  "jebel-jais": Array(12).fill(0.20),
  "sir-bani-yas": Array(12).fill(0.20),
  delma: Array(12).fill(0.20),
  sila: Array(12).fill(0.20),
  "al-halah": Array(12).fill(0.18),
};

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
export function getMonthlyProfile(source: RenewableSource, location: string): number[] {
  if (source !== "wind" || !WIND_CAPACITY_FACTORS[location]) {
    throw new Error(`No published or assumed profile configured for ${source} at ${location}`);
  }
  const energy = WIND_CAPACITY_FACTORS[location].map((cf, m) => cf * MONTH_HOURS[m]);
  const total = energy.reduce((a, b) => a + b, 0);
  return energy.map(v => v / total);
}
