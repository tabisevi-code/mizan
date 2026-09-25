/**
 * Solar geometry and irradiance.
 *
 * Everything here is computed from published, checkable models rather than
 * fitted to anything. Where a model needs a coefficient, the coefficient is
 * named and attributed in `SOLAR_MODEL_NOTES` so the UI can show it.
 *
 * Models used:
 *  - Solar position: Spencer (1971) declination and equation of time.
 *  - Clear-sky GHI: Haurwitz (1945).
 *  - Diffuse fraction: Erbs et al. (1982).
 *  - Plane-of-array transposition: Hay & Davies (1980) with ground reflection.
 *  - Incidence-angle modifier: ASHRAE, b0 = 0.05.
 *  - Module temperature: Faiman (2008), the model PVGIS also uses.
 */

import { HOURS_PER_YEAR, type HourlySeries, type LatLng, newSeries } from "./types";

export const SOLAR_MODEL_NOTES = {
  clearSky: "Haurwitz (1945) clear-sky GHI",
  diffuseSplit: "Erbs et al. (1982) diffuse fraction",
  transposition: "Hay & Davies (1980) transposition",
  iam: "ASHRAE incidence-angle modifier, b0 = 0.05",
  cellTemp: "Faiman (2008), U0 = 25 W/m2K, U1 = 6.84 W s/m3K",
  albedo: "Ground albedo 0.25, desert/industrial surface assumption",
} as const;

const DEG = Math.PI / 180;
const SOLAR_CONSTANT = 1367; // W/m2

/** UAE runs on UTC+4 with no daylight saving. */
export const UAE_UTC_OFFSET_HOURS = 4;

export type SolarPosition = {
  /** Degrees above the horizon; negative at night. */
  altitudeDeg: number;
  /** Degrees from south, positive towards west. */
  azimuthDeg: number;
  /** cos(zenith), floored at 0. */
  cosZenith: number;
};

const dayOfYearFromHour = (hourOfYear: number) => Math.floor(hourOfYear / 24) + 1;

/** Spencer (1971) fractional year angle in radians. */
const gamma = (dayOfYear: number) => ((2 * Math.PI) / 365) * (dayOfYear - 1);

/** Solar declination in radians, Spencer (1971). */
export const declination = (dayOfYear: number): number => {
  const g = gamma(dayOfYear);
  return (
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  );
};

/** Equation of time in minutes, Spencer (1971). */
export const equationOfTime = (dayOfYear: number): number => {
  const g = gamma(dayOfYear);
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  );
};

/**
 * Sun position at the mid-point of the given hour of the year.
 * `hourOfYear` is in local standard time, 0 = 1 Jan 00:00.
 */
export const solarPosition = (
  site: LatLng,
  hourOfYear: number,
  utcOffsetHours = UAE_UTC_OFFSET_HOURS,
): SolarPosition => {
  const doy = dayOfYearFromHour(hourOfYear);
  const localHour = (hourOfYear % 24) + 0.5; // mid-hour
  const decl = declination(doy);
  const eot = equationOfTime(doy);

  // Longitude correction: 4 minutes per degree from the time-zone meridian.
  const standardMeridian = utcOffsetHours * 15;
  const solarTime = localHour + (4 * (site.lng - standardMeridian) + eot) / 60;
  const hourAngle = (solarTime - 12) * 15 * DEG;

  const latRad = site.lat * DEG;
  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  const clamped = Math.max(-1, Math.min(1, cosZenith));
  const zenith = Math.acos(clamped);
  const altitude = Math.PI / 2 - zenith;

  // Azimuth measured from south, positive west (matches PVGIS aspect convention).
  const sinAz = (Math.cos(decl) * Math.sin(hourAngle)) / Math.max(Math.sin(zenith), 1e-6);
  const cosAz =
    (Math.sin(altitude) * Math.sin(latRad) - Math.sin(decl)) /
    Math.max(Math.cos(altitude) * Math.cos(latRad), 1e-6);
  const azimuth = Math.atan2(
    Math.max(-1, Math.min(1, sinAz)),
    Math.max(-1, Math.min(1, cosAz)),
  );

  return {
    altitudeDeg: altitude / DEG,
    azimuthDeg: azimuth / DEG,
    cosZenith: Math.max(0, clamped),
  };
};

/** Extraterrestrial irradiance on a horizontal surface, W/m2. */
export const extraterrestrialHorizontal = (dayOfYear: number, cosZenith: number): number => {
  const eccentricity = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  return SOLAR_CONSTANT * eccentricity * cosZenith;
};

/** Haurwitz (1945) clear-sky global horizontal irradiance, W/m2. */
export const clearSkyGhi = (cosZenith: number): number => {
  if (cosZenith <= 0) return 0;
  return 1098 * cosZenith * Math.exp(-0.059 / cosZenith);
};

/** Erbs et al. (1982): diffuse fraction of GHI from the clearness index. */
export const diffuseFraction = (clearnessIndex: number): number => {
  const kt = Math.max(0, Math.min(1, clearnessIndex));
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.8) {
    return (
      0.9511 -
      0.1604 * kt +
      4.388 * kt ** 2 -
      16.638 * kt ** 3 +
      12.336 * kt ** 4
    );
  }
  return 0.165;
};

/** ASHRAE incidence-angle modifier. */
export const incidenceAngleModifier = (cosAoi: number, b0 = 0.05): number => {
  if (cosAoi <= 0) return 0;
  return Math.max(0, 1 - b0 * (1 / cosAoi - 1));
};

export type PoaResult = {
  /** Plane-of-array irradiance after the incidence-angle modifier, W/m2. */
  effectiveWm2: number;
  /** Raw plane-of-array irradiance before the modifier, W/m2. */
  poaWm2: number;
  /**
   * The part of the plane-of-array irradiance that arrives from the direction
   * of the sun: beam plus the circumsolar halo. This is the part a row in
   * front can block, so shading works on this and leaves the rest alone.
   */
  directWm2: number;
};

/**
 * Hay & Davies transposition of GHI onto a tilted plane.
 * `surfaceAzimuthDeg` uses the PVGIS convention: 0 south, 90 west, -90 east.
 */
export const transpose = (
  ghi: number,
  dayOfYear: number,
  sun: SolarPosition,
  tiltDeg: number,
  surfaceAzimuthDeg: number,
  albedo = 0.25,
): PoaResult => {
  if (ghi <= 0 || sun.cosZenith <= 0) return { effectiveWm2: 0, poaWm2: 0, directWm2: 0 };

  const extra = extraterrestrialHorizontal(dayOfYear, sun.cosZenith);
  const kt = extra > 0 ? ghi / extra : 0;
  const diffuse = ghi * diffuseFraction(kt);
  const beamHorizontal = Math.max(0, ghi - diffuse);
  const dni = beamHorizontal / Math.max(sun.cosZenith, 1e-3);

  const tilt = tiltDeg * DEG;
  const surfAz = surfaceAzimuthDeg * DEG;
  const sunAz = sun.azimuthDeg * DEG;
  const sunAlt = sun.altitudeDeg * DEG;

  // cos of the angle of incidence on the tilted surface.
  const cosAoi = Math.max(
    0,
    Math.sin(sunAlt) * Math.cos(tilt) +
      Math.cos(sunAlt) * Math.sin(tilt) * Math.cos(sunAz - surfAz),
  );

  const beamPoa = dni * cosAoi;

  // Anisotropy index: the share of diffuse treated as circumsolar.
  const ai = extra > 0 ? Math.min(1, beamHorizontal / Math.max(extra, 1e-6)) : 0;
  const circumsolar = diffuse * ai * (cosAoi / Math.max(sun.cosZenith, 1e-3));
  const isotropic = diffuse * (1 - ai) * ((1 + Math.cos(tilt)) / 2);
  const ground = ghi * albedo * ((1 - Math.cos(tilt)) / 2);

  const poa = beamPoa + circumsolar + isotropic + ground;
  // The modifier applies to the beam and circumsolar parts; diffuse and ground
  // arrive from all directions, so they are left alone.
  const effective =
    (beamPoa + circumsolar) * incidenceAngleModifier(cosAoi) + isotropic + ground;

  return {
    effectiveWm2: Math.max(0, effective),
    poaWm2: Math.max(0, poa),
    directWm2: Math.max(0, (beamPoa + circumsolar) * incidenceAngleModifier(cosAoi)),
  };
};

/**
 * Faiman (2008) module temperature, degrees C.
 *
 * The default coefficients are Faiman's own, and they are for a free-standing
 * rack with air moving freely behind the module. A module lying on a flat roof
 * a few hundred millimetres up, in a field of other modules, is not that: the
 * air behind it is warmer and slower, and the module runs hotter for the same
 * sun. Using the free-rack numbers on a roof is the most common way a yield
 * model comes out optimistic, and it is the way this one was.
 */
export const moduleTemperature = (
  poaWm2: number,
  ambientC: number,
  windMs: number,
  u0 = 25,
  u1 = 6.84,
): number => ambientC + poaWm2 / (u0 + u1 * Math.max(0, windMs));

/**
 * Faiman coefficients by how the array is mounted. Ground-mounted racks get
 * Faiman's published free-standing values; a roof array is given the reduced
 * cooling that restricted airflow behind it actually produces.
 */
export const MOUNTING_THERMAL: Record<string, { u0: number; u1: number; label: string }> = {
  ground: { u0: 25, u1: 6.84, label: "free-standing rack, Faiman (2008)" },
  "roof-flat": { u0: 17, u1: 5.2, label: "flat roof, restricted airflow behind the module" },
  "roof-pitched": { u0: 15, u1: 4.6, label: "pitched roof, close to the covering" },
};

/**
 * Wind at the module, as a share of the wind in the weather file.
 *
 * Weather files report wind at ten metres in the open, which is what a met
 * station measures. Faiman's equation wants the wind actually moving over the
 * module, a metre or two above a roof and usually several rows deep into an
 * array. Feeding the ten-metre figure in unchanged is the quiet reason a yield
 * model runs cool and comes out optimistic, and it is what this engine was
 * doing.
 *
 * A power law down to two metres over built-up ground accounts for about two
 * thirds of the reduction; the rest is the array sheltering itself. The
 * combined figure is the one parameter in the thermal model fitted rather than
 * taken from a paper, and `scripts/validate.ts` both fits it and reports what
 * it is worth on sites left out of the fit.
 */
export const WIND_AT_MODULE = 0.33;

/**
 * Huld et al. (2011) relative efficiency for crystalline silicon: how module
 * efficiency moves with irradiance and temperature together, rather than with
 * temperature alone.
 *
 * Two things a plain temperature coefficient misses. Efficiency falls away in
 * weak light, which matters at the start and end of every day. And the
 * temperature penalty itself depends on the light level, so the two cannot be
 * applied separately without double counting or under counting. This is the
 * model PVGIS uses, which is why the engine can now be checked against it.
 *
 * Huld, Gottschalg, Beyer and Topic, "Mapping the performance of PV modules,
 * effects of module type and data averaging", Solar Energy 85 (2011).
 *
 * `gammaScale` carries a module better or worse than the crystalline silicon
 * Huld fitted. Modern n-type cells lose noticeably less to heat than the 2011
 * vintage, so the temperature terms are scaled by the ratio of the datasheet
 * coefficients rather than pretending every module is the same.
 */
export const HULD_CSI = {
  k1: -0.017237,
  k2: -0.040465,
  k3: -0.004702,
  k4: 0.000149,
  k5: 0.000170,
  k6: 0.000005,
  /** The effective temperature coefficient this fit carries near STC. */
  impliedGammaPerC: -0.0047,
};

export const huldRelativeEfficiency = (
  poaWm2: number,
  cellC: number,
  gammaScale = 1,
): number => {
  if (poaWm2 <= 0) return 0;
  // Below about 20 W/m2 the fit is outside the data it was made from, and its
  // logarithms run away. Nothing useful is generated there anyway.
  const g = Math.log(Math.max(poaWm2, 20) / 1000);
  const t = cellC - 25;
  const { k1, k2, k3, k4, k5, k6 } = HULD_CSI;
  const irradiance = k1 * g + k2 * g * g;
  const thermal = t * (k3 + k4 * g + k5 * g * g) + k6 * t * t;
  return Math.max(0, 1 + irradiance + thermal * gammaScale);
};

/**
 * A modelled clear-sky year for a coordinate, scaled by a monthly clearness
 * index. This is the fallback used when a PVGIS series has not been cached for
 * the site; it is always labelled as modelled, never as measured.
 */

/**
 * The monthly clearness index: how much of the clear-sky maximum actually
 * reaches the ground in a Gulf month.
 *
 * These twelve numbers used to be hand-written from the general shape of the
 * Gulf year, a clear winter and a hazy summer, and they were the one genuinely
 * assumed input in the engine. They have now been fitted against measurement:
 * five-year monthly means from PVGIS SARAH3 at 32 points across the UAE, from
 * Sila on the Qatar border to Khorfakkan on the Gulf of Oman, and from Umm
 * Zumul in the south to Ras Al Khaimah in the north.
 *
 * The hand-written values turned out to be low at every one of those 32 sites,
 * by 7.4% of the year on average and never in the other direction. The app was
 * quietly understating what a roof would produce, everywhere.
 *
 * `scripts/calibrate.ts` reproduces the fit and its error, which is measured
 * by leaving each site out in turn and predicting it from the other 31. A site
 * the model was fitted on tells you nothing about a site it has never seen,
 * and a site it has never seen is the only kind the app is ever asked about.
 */
export const CLEARNESS_FIT = {
  /** Clearness at the reference latitude, by month. */
  atReferenceLat: [
    0.7111, 0.7014, 0.6873, 0.6572, 0.6778, 0.6746, 0.6094, 0.6446, 0.6891, 0.7085, 0.7005, 0.6979,
  ],
  /**
   * How clearness changes per degree of latitude, by month. Negative in every
   * month: the northern UAE is the humid, hazy Gulf coast and the south is dry
   * desert interior. That the sign is the same in all twelve months is the
   * reason this term is trusted at all -- noise would not line up like that.
   */
  perDegreeLat: [
    -0.01895, -0.01666, -0.01943, -0.01191, -0.00549, -0.00737, -0.00145, -0.00613, -0.00723,
    -0.00851, -0.01651, -0.02039,
  ],
  /** Mean latitude of the 32 fitted sites, where the intercept above applies. */
  referenceLat: 24.4977,
  /** The span the sites cover. Outside it the latitude term is held, not run on. */
  latRange: [22.7, 25.79] as [number, number],
  /** Leave-one-site-out error on annual irradiation, as a fraction. */
  crossValidatedAnnualError: 0.0187,
  crossValidatedMonthlyError: 0.0201,
  /** What the hand-written values scored on the same test. */
  previousAnnualError: 0.0742,
  siteCount: 32,
  source: "PVGIS SARAH3 monthly means 2018-2022, 32 UAE points",
};

/**
 * Clearness by month for a latitude, from the fit above.
 *
 * Held flat outside the latitudes the fit covers: a straight line through 32
 * points says nothing about a coordinate beyond either end of them, and
 * running it out there would invent numbers with no evidence behind them.
 */
export const clearnessFor = (latitudeDeg: number): number[] => {
  const [low, high] = CLEARNESS_FIT.latRange;
  const lat = Math.max(low, Math.min(high, latitudeDeg));
  return CLEARNESS_FIT.atReferenceLat.map((base, month) =>
    Math.max(
      0.3,
      Math.min(0.85, base + CLEARNESS_FIT.perDegreeLat[month] * (lat - CLEARNESS_FIT.referenceLat)),
    ),
  );
};

/** The national monthly means, for anything that wants one set of numbers. */
export const UAE_MONTHLY_CLEARNESS = CLEARNESS_FIT.atReferenceLat;


/** Monthly mean dry-bulb temperature for the coastal UAE, degrees C. */
export const UAE_MONTHLY_TEMP_C = [
  19.5, 20.5, 23.5, 27.5, 31.5, 33.5, 35.5, 35.5, 33, 30, 25.5, 21.5,
];

/** Monthly mean wind speed at 10 m for the coastal UAE, m/s. */
export const UAE_MONTHLY_WIND_MS = [
  3.6, 3.8, 3.9, 3.9, 3.8, 3.7, 3.5, 3.3, 3.2, 3.2, 3.4, 3.5,
];

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Month index 0-11 for an hour of the year. */
export const monthOfHour = (hourOfYear: number): number => {
  const doy = dayOfYearFromHour(hourOfYear);
  let remaining = doy;
  for (let month = 0; month < 12; month += 1) {
    if (remaining <= MONTH_LENGTHS[month]) return month;
    remaining -= MONTH_LENGTHS[month];
  }
  return 11;
};

/**
 * Clearness index of a Haurwitz clear sky. The monthly clearness index is
 * applied as a ratio to this value, since Haurwitz already describes a clear
 * sky rather than an extraterrestrial one.
 */
export const CLEAR_SKY_REFERENCE_CLEARNESS = 0.75;

export type WeatherYear = {
  ghi: HourlySeries;
  ambientC: HourlySeries;
  windMs: HourlySeries;
  source: "modelled-clear-sky" | "pvgis-tmy" | "nasa-power-climatology";
};

/**
 * Build a modelled weather year for a coordinate. Diurnal temperature follows a
 * sine with a 15:00 peak, which is the standard shape for a desert coast.
 */
export const modelledWeatherYear = (site: LatLng): WeatherYear => {
  const clearness = clearnessFor(site.lat);
  const ghi = newSeries();
  const ambientC = newSeries();
  const windMs = newSeries();

  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const month = monthOfHour(hour);
    const sun = solarPosition(site, hour);
    const clear = clearSkyGhi(sun.cosZenith);
    ghi[hour] = clear * (clearness[month] / CLEAR_SKY_REFERENCE_CLEARNESS);

    const localHour = hour % 24;
    const swing = 9; // daily temperature range, degrees C
    ambientC[hour] =
      UAE_MONTHLY_TEMP_C[month] + (swing / 2) * Math.sin(((localHour - 9) / 24) * 2 * Math.PI);
    windMs[hour] = UAE_MONTHLY_WIND_MS[month];
  }

  return { ghi, ambientC, windMs, source: "modelled-clear-sky" };
};
