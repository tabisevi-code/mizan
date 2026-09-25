/**
 * Refreshes the UAE wind climate dataset in `src/data/wind-uae.json`.
 *
 * Two independent sources are captured for every site, because neither one on
 * its own is trustworthy here:
 *
 * - ERA5 reanalysis hourly 100 m wind, temperature and surface pressure, via
 *   the Open-Meteo archive. This gives the seasonal shape and the air density,
 *   which matters in the Gulf: a 45 C afternoon is about 12% thinner than the
 *   1.225 kg/m3 a turbine power curve is published at, and power scales with
 *   density.
 * - The Global Wind Atlas generalized wind climate (WAsP .lib) for the nearest
 *   3 km pixel, which is a mesoscale model downscaled to 250 m and resolves
 *   terrain that ERA5's ~31 km grid flattens completely. Jebel Jais is the
 *   obvious case.
 *
 * ERA5 sets the shape, the Atlas sets the level. The ratio between them is
 * stored per site rather than applied here, so the engine can show it.
 *
 * Network access is required. This is not part of the build; the JSON it
 * writes is committed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { WIND_SITES } from "../src/engine/wind-sites";

const CACHE_DIR = new URL("./.cache", import.meta.url).pathname;
mkdirSync(CACHE_DIR, { recursive: true });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ERA5_START = "2015-01-01";
const ERA5_END = "2024-12-31";
const GWA_WPS = "https://wps.globalwindatlas.info/";
const ERA5_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

type MonthStats = {
  /** Weibull scale parameter of the ERA5 100 m wind, m/s. */
  weibullA: number;
  /** Weibull shape parameter. */
  weibullK: number;
  meanMs: number;
  meanTempC: number;
  meanPressureHpa: number;
};

const gamma = (x: number): number => {
  // Lanczos approximation; only ever called with x in [1, 2.5] here.
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a;
};

/**
 * Weibull parameters by the method of moments. The shape parameter is solved
 * from the ratio of the mean cube to the cube of the mean, which is the moment
 * that actually drives turbine output, rather than from the standard deviation.
 */
const fitWeibull = (speeds: number[]): { a: number; k: number } => {
  const n = speeds.length;
  const mean = speeds.reduce((s, v) => s + v, 0) / n;
  const meanCube = speeds.reduce((s, v) => s + v ** 3, 0) / n;
  if (mean <= 0) return { a: 0, k: 2 };
  const target = meanCube / mean ** 3;
  let lo = 1.0;
  let hi = 6.0;
  for (let i = 0; i < 80; i++) {
    const k = (lo + hi) / 2;
    const ratio = gamma(1 + 3 / k) / gamma(1 + 1 / k) ** 3;
    if (ratio > target) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  return { a: mean / gamma(1 + 1 / k), k };
};

const fetchJson = async (url: string): Promise<any> => {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
      return await response.json();
    } catch (error) {
      if (attempt === 5) throw error;
      // Open-Meteo rate-limits by minute; a busy reanalysis window needs real patience.
      await sleep(60_000 * (attempt + 1));
    }
  }
};

const fetchEra5 = async (lat: number, lng: number): Promise<{ months: MonthStats[]; annualMeanMs: number }> => {
  const url =
    `${ERA5_ARCHIVE}?latitude=${lat}&longitude=${lng}&start_date=${ERA5_START}&end_date=${ERA5_END}` +
    `&hourly=wind_speed_100m,temperature_2m,surface_pressure&wind_speed_unit=ms&timezone=UTC`;
  const data = await fetchJson(url);
  const times: string[] = data.hourly.time;
  const speeds: number[] = data.hourly.wind_speed_100m;
  const temps: number[] = data.hourly.temperature_2m;
  const pressures: number[] = data.hourly.surface_pressure;

  const byMonth: { speeds: number[]; temps: number[]; pressures: number[] }[] = Array.from(
    { length: 12 },
    () => ({ speeds: [], temps: [], pressures: [] }),
  );
  times.forEach((stamp, i) => {
    const month = Number(stamp.slice(5, 7)) - 1;
    if (speeds[i] === null || temps[i] === null || pressures[i] === null) return;
    byMonth[month].speeds.push(speeds[i]);
    byMonth[month].temps.push(temps[i]);
    byMonth[month].pressures.push(pressures[i]);
  });

  const round = (v: number, places = 3) => Number(v.toFixed(places));
  const months = byMonth.map((bucket) => {
    const { a, k } = fitWeibull(bucket.speeds);
    const average = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
    return {
      weibullA: round(a),
      weibullK: round(k),
      meanMs: round(average(bucket.speeds)),
      meanTempC: round(average(bucket.temps), 2),
      meanPressureHpa: round(average(bucket.pressures), 1),
    };
  });
  const all = byMonth.flatMap((bucket) => bucket.speeds);
  return { months, annualMeanMs: round(all.reduce((s, v) => s + v, 0) / all.length) };
};

/**
 * The .lib format: a header line, then counts, roughness lengths and heights,
 * then per roughness class a sector frequency line followed by an A line and a
 * k line for each height.
 */
const parseLib = (text: string) => {
  const numbers = (line: string) => line.trim().split(/\s+/).map(Number);
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const [roughnessCount, heightCount, sectorCount] = numbers(lines[1]);
  const roughnessLengths = numbers(lines[2]);
  const heights = numbers(lines[3]);

  let cursor = 4;
  const classes = roughnessLengths.map(() => {
    const frequencies = numbers(lines[cursor++]);
    const byHeight = heights.map(() => {
      const a = numbers(lines[cursor++]);
      const k = numbers(lines[cursor++]);
      return { a, k };
    });
    return { frequencies, byHeight };
  });

  if (classes.some((c) => c.frequencies.length !== sectorCount)) throw new Error("Unexpected .lib sector count");
  if (heights.length !== heightCount || roughnessLengths.length !== roughnessCount) {
    throw new Error("Unexpected .lib header");
  }

  /** Sector-weighted mean speed for one roughness class and height. */
  const meanSpeed = (classIndex: number, heightIndex: number) => {
    const { frequencies, byHeight } = classes[classIndex];
    const { a, k } = byHeight[heightIndex];
    const weightTotal = frequencies.reduce((s, v) => s + v, 0);
    const weighted = frequencies.reduce((sum, frequency, sector) => {
      return sum + frequency * a[sector] * gamma(1 + 1 / k[sector]);
    }, 0);
    return weighted / weightTotal;
  };

  return { roughnessLengths, heights, meanSpeed };
};

/**
 * The gridded Atlas mean over a roughly 2.5 km box, at one height.
 *
 * This is the number the Atlas website shows, and it is the one that carries
 * the terrain. The generalized .lib climate deliberately strips orography out,
 * which is why it reads 3.2 m/s on top of Jebel Jais and 5.3 m/s at Al Halah
 * where the gridded map says 5.4 and 6.9. Masdar did not put 4.5 MW on a
 * 5.3 m/s ridge.
 *
 * Returns the mean over the whole box and the mean of its windiest tenth,
 * which is the difference between "this area" and "the one hill in it".
 */
const fetchGwaAreaMean = async (lat: number, lng: number, height: number) => {
  const d = 0.012;
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
  });
  const url =
    `${GWA_WPS}?service=WPS&version=1.0.0&request=Execute&identifier=get_area_mean` +
    `&datainputs=${encodeURIComponent(`location=${polygon};height=${height};variable=wspd`)}`;
  const xml = await (await fetch(url, { signal: AbortSignal.timeout(180_000) })).text();
  const payload = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1];
  if (!payload) throw new Error(`No area mean at ${height} m for ${lat},${lng}`);
  const bins: { val: number; sel_perc: number }[] = JSON.parse(payload).area_means;
  const at = (percentile: number) =>
    bins.reduce((best, bin) =>
      Math.abs(bin.sel_perc - percentile) < Math.abs(best.sel_perc - percentile) ? bin : best,
    ).val;
  return { meanMs: at(100), bestDecileMs: at(10) };
};

const fetchGwaLib = async (lat: number, lng: number) => {
  const location = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
  const url =
    `${GWA_WPS}?service=WPS&version=1.0.0&request=Execute&identifier=get_libfile` +
    `&datainputs=${encodeURIComponent(`location=${location}`)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  const xml = await response.text();
  const path = xml.match(/"path":\s*"([^"]+)"/)?.[1];
  if (!path) throw new Error(`No .lib produced for ${lat},${lng}`);
  const lib = await (await fetch(path.replace("http://", "https://"), { signal: AbortSignal.timeout(120_000) })).text();
  const { roughnessLengths, heights, meanSpeed } = parseLib(lib);

  // Roughness 0.03 m is short grass and open desert, the class the Atlas itself
  // uses for its published open-terrain wind speeds.
  const openIndex = roughnessLengths.indexOf(0.03);
  const roughnessIndex = openIndex >= 0 ? openIndex : 1;
  return {
    roughnessLengthM: roughnessLengths[roughnessIndex],
    heights,
    meanMsByHeight: heights.map((_, i) => Number(meanSpeed(roughnessIndex, i).toFixed(3))),
  };
};

const main = async () => {
  const sites: Record<string, unknown> = {};
  for (const site of WIND_SITES) {
    process.stdout.write(`${site.id} `);
    const cachePath = `${CACHE_DIR}/${site.id}.json`;
    if (existsSync(cachePath)) {
      const cached = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>;
      if (site.siting) cached.siting = site.siting;
      sites[site.id] = cached;
      const summary = cached as { era5: { annualMeanMs: number }; terrainFactor: number };
      console.log(`(cached) era5 ${summary.era5.annualMeanMs} m/s, factor ${summary.terrainFactor}`);
      continue;
    }
    const [era5, lib, at50, at100, at150] = await Promise.all([
      fetchEra5(site.lat, site.lng),
      fetchGwaLib(site.lat, site.lng),
      fetchGwaAreaMean(site.lat, site.lng, 50),
      fetchGwaAreaMean(site.lat, site.lng, 100),
      fetchGwaAreaMean(site.lat, site.lng, 150),
    ]);
    const gwa = { ...lib, gridded: { "50": at50, "100": at100, "150": at150 } };
    const gwaAt100 = at100.meanMs;
    sites[site.id] = {
      name: site.name,
      emirate: site.emirate,
      lat: site.lat,
      lng: site.lng,
      terrain: site.terrain,
      ...(site.siting ? { siting: site.siting } : {}),
      era5,
      gwa,
      /** Gridded Atlas mean over ERA5 mean at 100 m. Above 1 where terrain is real. */
      terrainFactor: Number((gwaAt100 / era5.annualMeanMs).toFixed(4)),
    };
    console.log(`era5 ${era5.annualMeanMs} m/s, gwa ${gwaAt100} m/s (best tenth ${at100.bestDecileMs})`);
    writeFileSync(cachePath, JSON.stringify(sites[site.id]));
    await sleep(4000);
  }

  const output = {
    meta: {
      generatedBy: "scripts/fetch-wind.ts",
      retrieved: new Date().toISOString().slice(0, 10),
      era5: {
        source: "ERA5 reanalysis via the Open-Meteo archive API",
        url: "https://open-meteo.com/en/docs/historical-weather-api",
        period: `${ERA5_START} to ${ERA5_END}`,
        heightM: 100,
        licence: "ERA5, Copernicus Climate Change Service; Open-Meteo CC BY 4.0",
        caveat:
          "Reanalysis on a roughly 31 km grid. It carries the seasonal cycle and the air density well, and understates wind over terrain it cannot resolve.",
      },
      gwa: {
        source:
          "Global Wind Atlas 3.0: gridded area means over a 2.5 km box (get_area_mean) for the wind level, and the generalized wind climate (WAsP .lib) for sector and shape detail",
        url: "https://globalwindatlas.info/",
        licence: "CC BY 4.0, DTU Wind Energy and the World Bank Group",
        caveat: "A model, not a met mast. It is not a substitute for on-site measurement before investment.",
      },
    },
    sites,
  };
  writeFileSync(new URL("../src/data/wind-uae.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`\nWrote ${Object.keys(sites).length} sites to src/data/wind-uae.json`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
