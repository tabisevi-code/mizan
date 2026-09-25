/**
 * Calibrate the modelled sunlight year against measured data.
 *
 *   npx tsx scripts/calibrate.ts
 *
 * The engine's clear-sky model is physics: Haurwitz for the clear-sky maximum,
 * and a solar position from Spencer. The one genuinely assumed input was the
 * monthly clearness index, a hand-written list of twelve numbers describing how
 * much of that clear-sky maximum actually arrives in a Gulf month. Everything
 * the app says about a site with no cached PVGIS year rests on those twelve
 * numbers, and nobody had ever checked them.
 *
 * This checks them, against five-year monthly means from PVGIS SARAH3 at 32
 * points across the UAE, and fits better ones. The fit is deliberately tiny:
 * twelve monthly values, optionally with one latitude term per month. A larger
 * model would fit the noise in 32 sites and report a flattering error that
 * would not survive a new site.
 *
 * Every figure it prints is cross-validated by holding sites out, never by
 * scoring the fit on the data it was fitted to.
 */

import {
  CLEAR_SKY_REFERENCE_CLEARNESS,
  clearSkyGhi,
  clearnessFor,
  solarPosition,
} from "../src/engine/solar";
import { HOURS_PER_YEAR } from "../src/engine/types";
import measured from "../src/data/pvgis-uae-monthly.json" with { type: "json" };

type Site = { name: string; lat: number; lon: number; elev: number; m: number[] };
const SITES = measured.sites as Site[];

/**
 * The hand-written clearness index the engine carried before this script was
 * written, kept here so the comparison stays honest and reproducible after the
 * engine was changed. Reading the engine's own current values would compare
 * the fit against itself.
 */
const HAND_WRITTEN = [0.66, 0.66, 0.63, 0.63, 0.63, 0.6, 0.57, 0.57, 0.63, 0.66, 0.67, 0.66];

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The clear-sky irradiation the engine's own physics puts on a horizontal
 * plane at this coordinate, by month, in kWh/m2. This is the denominator the
 * clearness index divides into.
 */
const clearSkyByMonth = (site: { lat: number; lng: number }): number[] => {
  const totals = new Array(12).fill(0);
  let hour = 0;
  for (let month = 0; month < 12; month += 1) {
    for (let i = 0; i < MONTH_LENGTHS[month] * 24; i += 1, hour += 1) {
      const sun = solarPosition(site, hour);
      totals[month] += clearSkyGhi(sun.cosZenith) / 1000; // W/m2 for an hour -> kWh/m2
    }
  }
  if (hour !== HOURS_PER_YEAR) throw new Error(`walked ${hour} hours, expected ${HOURS_PER_YEAR}`);
  return totals;
};

/**
 * What clearness index would have reproduced the measured month exactly. The
 * engine applies `ghi = clearSky * (K / CLEAR_SKY_REFERENCE_CLEARNESS)`, so
 * this inverts that.
 */
const impliedK = (site: Site): number[] => {
  const clear = clearSkyByMonth({ lat: site.lat, lng: site.lon });
  return site.m.map(
    (measuredKwh, month) => CLEAR_SKY_REFERENCE_CLEARNESS * (measuredKwh / clear[month]),
  );
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Least squares fit of y = a + b*x. */
const line = (x: number[], y: number[]): { a: number; b: number } => {
  const mx = mean(x);
  const my = mean(y);
  let top = 0;
  let bottom = 0;
  for (let i = 0; i < x.length; i += 1) {
    top += (x[i] - mx) * (y[i] - my);
    bottom += (x[i] - mx) ** 2;
  }
  const b = bottom === 0 ? 0 : top / bottom;
  return { a: my - b * mx, b };
};

type Model = {
  name: string;
  /** Fit on these sites, then predict the clearness index for any coordinate. */
  fit: (train: { site: Site; k: number[] }[]) => (site: Site) => number[];
};

const MODELS: Model[] = [
  {
    name: "the hand-written values this replaced",
    fit: () => () => [...HAND_WRITTEN],
  },
  {
    name: "one number per month, national",
    fit: (train) => {
      const monthly = Array.from({ length: 12 }, (_, m) => mean(train.map((row) => row.k[m])));
      return () => monthly;
    },
  },
  {
    name: "what the engine ships now: per month, sloped with latitude",
    fit: (train) => {
      const lats = train.map((row) => row.site.lat);
      const fits = Array.from({ length: 12 }, (_, m) => line(lats, train.map((row) => row.k[m])));
      return (site) => fits.map((f) => f.a + f.b * site.lat);
    },
  },
];

const errorsFor = (predicted: number[], site: Site, clear: number[]) =>
  site.m.map((measuredKwh, month) => {
    const modelled = clear[month] * (predicted[month] / CLEAR_SKY_REFERENCE_CLEARNESS);
    return (modelled - measuredKwh) / measuredKwh;
  });

const run = () => {
  console.log(`\nMeasured: ${measured.source}`);
  console.log(`          ${measured.years}, ${SITES.length} points across the UAE\n`);

  const prepared = SITES.map((site) => ({
    site,
    k: impliedK(site),
    clear: clearSkyByMonth({ lat: site.lat, lng: site.lon }),
  }));

  // Leave one site out, every site in turn. A site the model never saw is the
  // only honest test, because the app's whole point is answering for a site
  // nobody has cached.
  for (const model of MODELS) {
    const monthly: number[][] = [];
    const annual: number[] = [];
    for (let held = 0; held < prepared.length; held += 1) {
      const train = prepared.filter((_, i) => i !== held);
      const predict = model.fit(train);
      const row = prepared[held];
      const predicted = predict(row.site);
      monthly.push(errorsFor(predicted, row.site, row.clear).map(Math.abs));

      const modelledYear = row.clear.reduce(
        (t, c, m) => t + c * (predicted[m] / CLEAR_SKY_REFERENCE_CLEARNESS),
        0,
      );
      const measuredYear = row.site.m.reduce((a, b) => a + b, 0);
      annual.push((modelledYear - measuredYear) / measuredYear);
    }
    const flatMonthly = monthly.flat();
    const worstSite = annual
      .map((e, i) => ({ e, name: prepared[i].site.name }))
      .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))[0];

    console.log(`${model.name}`);
    console.log(
      `  annual  mean abs error ${(mean(annual.map(Math.abs)) * 100).toFixed(2)}%` +
        `   bias ${(mean(annual) * 100).toFixed(2)}%` +
        `   worst site ${worstSite.name} ${(worstSite.e * 100).toFixed(1)}%`,
    );
    console.log(
      `  monthly mean abs error ${(mean(flatMonthly) * 100).toFixed(2)}%` +
        `   worst month ${(Math.max(...flatMonthly) * 100).toFixed(1)}%\n`,
    );
  }

  // The fit over every site, which is what ships.
  const all = prepared.map(({ site, k }) => ({ site, k }));
  const national = MODELS[1].fit(all)(SITES[0]);
  const lats = SITES.map((s) => s.lat);
  const sloped = Array.from({ length: 12 }, (_, m) => line(lats, prepared.map((r) => r.k[m])));

  console.log("Fitted on all 32 sites, for the engine:\n");
  console.log("  national   [" + national.map((v) => v.toFixed(4)).join(", ") + "]");
  console.log(
    "  intercept  [" + sloped.map((f) => f.a.toFixed(4)).join(", ") + "]",
  );
  console.log("  perDegLat  [" + sloped.map((f) => f.b.toFixed(5)).join(", ") + "]\n");

  console.log("  month   hand-written   measured mean   spread across the 32 sites");
  for (let m = 0; m < 12; m += 1) {
    const ks = prepared.map((r) => r.k[m]);
    console.log(
      `  ${MONTHS[m]}      ${HAND_WRITTEN[m].toFixed(3)}          ${national[m].toFixed(3)}` +
        `           ${Math.min(...ks).toFixed(3)} to ${Math.max(...ks).toFixed(3)}`,
    );
  }

  // What ships must match what was just fitted, or the printout is fiction.
  const shipped = clearnessFor(SITES[0].lat);
  const expected = sloped.map((f) => f.a + f.b * SITES[0].lat);
  const drift = Math.max(...shipped.map((v, m) => Math.abs(v - expected[m])));
  console.log(
    drift < 0.002
      ? `  The engine ships this fit (largest difference ${drift.toFixed(4)}).`
      : `  WARNING: the engine is ${drift.toFixed(4)} away from this fit. Update it.`,
  );
  console.log();
};

run();
