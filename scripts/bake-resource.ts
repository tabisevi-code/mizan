/**
 * Bake the UAE resource grid into the bundle.
 *
 * Run on a machine with normal internet access:
 *   npm run bake:resource
 *
 * Pulls NASA POWER 20-year monthly climatologies — solar irradiance, air
 * temperature and wind speed at 10 m and 50 m — for a 0.4-degree grid over the
 * Emirates and writes src/data/uae-resource-grid.json. The app then screens a
 * site against measured-reanalysis climate instead of a single coastal
 * constant, and keeps working offline.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../src/data/uae-resource-grid.json");

const LAT_MIN = 22.6;
const LAT_MAX = 26.3;
const LNG_MIN = 51.5;
const LNG_MAX = 56.5;
const STEP = 0.4;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

type PowerPoint = {
  lat: number;
  lng: number;
  ghiKwhM2Day: number[];
  tempC: number[];
  wind10m: number[];
  wind50m: number[];
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const fetchPoint = async (lat: number, lng: number): Promise<PowerPoint | null> => {
  const url =
    "https://power.larc.nasa.gov/api/temporal/climatology/point" +
    `?parameters=ALLSKY_SFC_SW_DWN,T2M,WS10M,WS50M&community=RE` +
    `&longitude=${lng.toFixed(2)}&latitude=${lat.toFixed(2)}&format=JSON`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const json = (await response.json()) as {
    properties?: { parameter?: Record<string, Record<string, number>> };
  };
  const parameter = json.properties?.parameter;
  if (!parameter) return null;
  const series = (name: string): number[] => MONTHS.map((month) => parameter[name]?.[month] ?? NaN);
  const point = {
    lat,
    lng,
    ghiKwhM2Day: series("ALLSKY_SFC_SW_DWN"),
    tempC: series("T2M"),
    wind10m: series("WS10M"),
    wind50m: series("WS50M"),
  };
  if (point.ghiKwhM2Day.some(Number.isNaN)) return null;
  return point;
};

const points: PowerPoint[] = [];
const misses: [number, number][] = [];
for (let lat = LAT_MIN; lat <= LAT_MAX + 1e-9; lat += STEP) {
  for (let lng = LNG_MIN; lng <= LNG_MAX + 1e-9; lng += STEP) {
    const rounded = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
    const point = await fetchPoint(rounded.lat, rounded.lng);
    if (point) points.push(point);
    else misses.push([rounded.lat, rounded.lng]);
    await sleep(120);
  }
}

writeFileSync(
  out,
  JSON.stringify(
    {
      provenance: {
        kind: "dataset",
        label: "NASA POWER 20-year climatology (2001-2020)",
        url: "https://power.larc.nasa.gov/",
        asOf: new Date().toISOString().slice(0, 10),
        caveat:
          "Reanalysis climatology on a ~0.5 degree grid, not a site measurement. Baked for offline use; treat near-shore points with care.",
      },
      stepDeg: STEP,
      points,
      missing: misses,
    },
    null,
    1,
  ) + "\n",
);
console.log(`wrote ${points.length} points, ${misses.length} misses -> ${out}`);
