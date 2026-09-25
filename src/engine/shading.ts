/**
 * Row-to-row shading.
 *
 * The packer picks a row spacing that clears the shadow of the row in front at
 * winter noon. That is the standard rule, and it is not the same as saying the
 * array is never shaded. Noon is the one moment of the day when the sun is
 * highest; for an hour or two after sunrise and before sunset, every row on a
 * flat roof is standing in the shadow of the row in front of it. Nothing in
 * the loss stack accounted for that, so the yield came out slightly optimistic.
 *
 * This computes it properly, hour by hour, from the rows the packer actually
 * laid down.
 *
 * Two pieces of geometry do the work:
 *
 *   1. The profile angle. Projected into the vertical plane that cuts across
 *      the rows, the sun sits at an angle psi where
 *      tan(psi) = tan(altitude) / cos(solar azimuth - array azimuth).
 *      Early and late in the day the sun is far round to the side, cos is
 *      small, and psi collapses towards the horizon even while the sun is
 *      still well up in the sky. That is why shading starts earlier than
 *      people expect.
 *
 *   2. Whether there is a row in front at all. The shadow also slides east or
 *      west as the sun moves, so a panel is only shaded if the row in front
 *      actually has modules at the place the shadow comes from. On a real roof
 *      outline the rows are different lengths, so the panels around the
 *      east and west edges spend far less of the year in shadow than the ones
 *      in the middle. That is what gives the heat map its shape, and it is
 *      the reason this is computed per panel rather than as one number.
 *
 * What this does NOT model, and the report says so: the extra loss from bypass
 * diodes. A shadow across the bottom of a module knocks out a whole cell group
 * rather than just the cells it covers, so the electrical loss is larger than
 * the geometric one below. PVsyst reports those as two separate figures for
 * the same reason.
 */

import { MONTH_OF_HOUR } from "./calendar";
import { solarPosition, transpose, type SolarYear, type WeatherYear } from "./solar";
import { distanceToEdge, pointInPolygon, type PanelRow, type PointM, type PolygonM } from "./packing";
import { HOURS_PER_YEAR, type LatLng } from "./types";

const DEG = Math.PI / 180;

/** Cell groups along the length of a module, one bypass diode across each. */
const CELL_GROUPS = 3;

export type ShadingOptions = {
  tiltDeg: number;
  /** 0 south, 90 west, -90 east. */
  azimuthDeg: number;
  /** Slant length of a module up the slope, metres. */
  moduleLengthM: number;
  moduleWidthM: number;
  albedo: number;
};

export type ShadingResult = {
  /**
   * Fraction of the year's direct irradiance lost to the row in front, for
   * every module, indexed the same way as the rows that went in.
   */
  byModule: number[][];
  /** Whole-array loss as a fraction of total plane-of-array energy. */
  arrayLoss: number;
  /** The same loss expressed against direct irradiance only. */
  directLoss: number;
  /**
   * Whole-array loss once bypass diodes are taken into account, as a fraction
   * of total plane-of-array energy. Always larger than `arrayLoss`, because a
   * shadow over part of a cell group takes out the whole group.
   */
  electricalArrayLoss: number;
  /** Best and worst module, as fractions of direct irradiance. */
  bestModuleLoss: number;
  worstModuleLoss: number;
  /** Share of modules losing less than half the array average. */
  edgeShare: number;
  /** Loss by month, fraction of that month's direct irradiance. */
  monthlyLoss: number[];
};

/**
 * The fraction of a module's slant height that stands in the shadow of the row
 * in front, given the profile angle and the clear gap between the two rows.
 *
 * Derived from the shadow cast by the top edge of the front row: a point a
 * distance s up the back module is shaded when
 *   s (sin b + cos b tan psi) < L sin b - gap * tan psi
 */
export const shadedFraction = (
  profileTan: number,
  gapM: number,
  moduleLengthM: number,
  tiltDeg: number,
): number => {
  if (profileTan <= 0) return 1; // sun on or below the horizon in this plane
  const tilt = tiltDeg * DEG;
  const rise = moduleLengthM * Math.sin(tilt);
  const numerator = rise - gapM * profileTan;
  if (numerator <= 0) return 0;
  const denominator = moduleLengthM * (Math.sin(tilt) + Math.cos(tilt) * profileTan);
  if (denominator <= 0) return 1;
  return Math.max(0, Math.min(1, numerator / denominator));
};

/**
 * For each row, the row physically in front of it: the nearest row to the
 * south whose shadow could reach. Rows the packer dropped for plant leave
 * gaps, and a row with a double gap in front of it is shaded far less, so the
 * real spacing is used rather than the nominal pitch.
 */
const rowInFront = (rows: PanelRow[]): (number | null)[] => {
  const order = rows.map((row, index) => ({ index, y: row.y })).sort((a, b) => a.y - b.y);
  const front: (number | null)[] = rows.map(() => null);
  for (let i = 1; i < order.length; i += 1) {
    front[order[i].index] = order[i - 1].index;
  }
  return front;
};

export const rowShading = (
  rows: PanelRow[],
  site: LatLng,
  weather: WeatherYear,
  options: ShadingOptions,
  solarYear?: SolarYear,
): ShadingResult => {
  const byModule = rows.map((row) => new Array<number>(row.modules).fill(0));
  const empty: ShadingResult = {
    byModule,
    arrayLoss: 0,
    directLoss: 0,
    electricalArrayLoss: 0,
    bestModuleLoss: 0,
    worstModuleLoss: 0,
    edgeShare: 0,
    monthlyLoss: new Array(12).fill(0),
  };
  if (rows.length < 2) return empty;

  const front = rowInFront(rows);
  const tilt = options.tiltDeg * DEG;
  const depth = options.moduleLengthM * Math.cos(tilt);
  const rise = options.moduleLengthM * Math.sin(tilt);
  const months = MONTH_OF_HOUR;
  const moduleTotal = totalModules(rows);

  // Loss accumulates per module as a difference array per row, so one hour
  // costs one add and one subtract per row instead of a pass over every
  // module. Prefix-summed once at the end.
  const delta = rows.map((row) => new Float64Array(row.modules + 1));
  // The same again, but counting whole cell groups rather than covered cells.
  const electricalDelta = rows.map((row) => new Float64Array(row.modules + 1));

  let directTotal = 0;
  let poaTotal = 0;
  const monthDirect = new Array(12).fill(0);
  const monthLost = new Array(12).fill(0);

  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const ghi = weather.ghi[hour];
    if (ghi <= 0) continue;
    const sun = solarYear?.position[hour] ?? solarPosition(site, hour);
    if (sun.altitudeDeg <= 0) continue;
    const doy = Math.floor(hour / 24) + 1;
    const poa = transpose(ghi, doy, sun, options.tiltDeg, options.azimuthDeg, options.albedo);
    poaTotal += poa.poaWm2;
    if (poa.directWm2 <= 0) continue;

    const month = months[hour];
    directTotal += poa.directWm2;
    monthDirect[month] += poa.directWm2;

    // The sun projected into the plane that cuts across the rows.
    const relativeAz = (sun.azimuthDeg - options.azimuthDeg) * DEG;
    const cosRelative = Math.cos(relativeAz);
    if (cosRelative <= 0.02) continue; // sun behind or along the rows
    const profileTan = Math.tan(sun.altitudeDeg * DEG) / cosRelative;

    // How far the shadow of the top edge slides east or west on its way back.
    // Azimuth is measured from south, positive towards west, so the direction
    // the shadow travels is (sin az, cos az) in (east, north). With the sun in
    // the east the azimuth is negative and the shadow moves west, which is
    // the check that fixes the sign.
    const shift = (rise / Math.tan(sun.altitudeDeg * DEG)) * Math.sin(sun.azimuthDeg * DEG);

    for (let r = 0; r < rows.length; r += 1) {
      const aheadIndex = front[r];
      if (aheadIndex === null) continue; // nothing in front of the first row
      const row = rows[r];
      const ahead = rows[aheadIndex];
      const gap = row.y - (ahead.y + depth);
      if (gap < 0) continue;

      const fraction = shadedFraction(profileTan, gap, options.moduleLengthM, options.tiltDeg);
      if (fraction <= 0) continue;

      // The top edge of the row in front spans [ahead.x, ahead.x + w]. Each
      // point of it casts its shadow `shift` further along x, so the modules
      // of this row standing in that shadow are the ones whose centres fall
      // inside that span slid by +shift.
      const from = ahead.x + shift;
      const to = ahead.x + ahead.w + shift;
      let first = Math.ceil((from - row.x) / options.moduleWidthM - 0.5);
      let last = Math.floor((to - row.x) / options.moduleWidthM - 0.5);
      if (first < 0) first = 0;
      if (last > row.modules - 1) last = row.modules - 1;
      if (last < first) continue;

      const lost = poa.directWm2 * fraction;
      delta[r][first] += lost;
      delta[r][last + 1] -= lost;

      // A module carries three cell groups along its length, each with a
      // bypass diode across it. A shadow reaching into a group takes the whole
      // group out, so the electrical loss steps rather than ramps.
      const electricalFraction = Math.min(1, Math.ceil(fraction * CELL_GROUPS) / CELL_GROUPS);
      const electricalLost = poa.directWm2 * electricalFraction;
      electricalDelta[r][first] += electricalLost;
      electricalDelta[r][last + 1] -= electricalLost;
      monthLost[month] += (lost * (last - first + 1)) / moduleTotal;
    }
  }

  // Prefix-sum the difference arrays into a loss per module.
  let best = Infinity;
  let worst = 0;
  let sumLoss = 0;
  let sumElectrical = 0;
  let count = 0;
  for (let r = 0; r < rows.length; r += 1) {
    let running = 0;
    let runningElectrical = 0;
    for (let m = 0; m < rows[r].modules; m += 1) {
      running += delta[r][m];
      runningElectrical += electricalDelta[r][m];
      const loss = directTotal > 0 ? running / directTotal : 0;
      byModule[r][m] = loss;
      if (loss < best) best = loss;
      if (loss > worst) worst = loss;
      sumLoss += loss;
      sumElectrical += directTotal > 0 ? runningElectrical / directTotal : 0;
      count += 1;
    }
  }
  if (count === 0) return empty;

  const directLoss = sumLoss / count;
  // Direct is only part of what lands on the plane, so the loss against the
  // whole plane-of-array year is smaller.
  const arrayLoss = poaTotal > 0 ? (directLoss * directTotal) / poaTotal : 0;
  const edgeShare =
    byModule.flat().filter((loss) => loss < directLoss * 0.5).length / Math.max(count, 1);

  return {
    byModule,
    arrayLoss,
    directLoss,
    electricalArrayLoss:
      poaTotal > 0 ? ((sumElectrical / count) * directTotal) / poaTotal : 0,
    bestModuleLoss: best === Infinity ? 0 : best,
    worstModuleLoss: worst,
    edgeShare,
    monthlyLoss: monthLost.map((lost, month) => (monthDirect[month] > 0 ? lost / monthDirect[month] : 0)),
  };
};

const totalModules = (rows: PanelRow[]): number =>
  Math.max(1, rows.reduce((total, row) => total + row.modules, 0));

/**
 * Thin a packed layout down to a share of its rows, spread across the roof
 * rather than taken off one end. This is the same rule the wiring uses, so
 * the shading, the drawing and the electrical design all describe one array.
 */
export const thinRows = (rows: PanelRow[], fill: number): PanelRow[] => {
  if (fill >= 1) return rows;
  if (fill <= 0) return [];
  const kept: PanelRow[] = [];
  let carried = 0;
  for (const row of rows) {
    carried += fill;
    if (carried < 1) continue;
    carried -= 1;
    kept.push(row);
  }
  return kept;
};

/**
 * Row shading against how much of the roof is built on, sampled at a handful
 * of fill levels so the planner can price each candidate system with the
 * shading that system would actually have.
 *
 * One number would be wrong in both directions. A system covering the whole
 * roof carries the full loss; one covering half of it has a double gap in
 * front of every row and carries none. Most UAE sites are capped well under
 * the roof by their approved load, so this is the common case, not a corner.
 */
export const shadingCurve = (
  rows: PanelRow[],
  site: LatLng,
  weather: WeatherYear,
  options: ShadingOptions,
  fills = [0.25, 0.5, 0.75, 1],
  solarYear?: SolarYear,
): { fill: number; loss: number }[] =>
  fills.map((fill) => ({
    fill,
    loss: rowShading(thinRows(rows, fill), site, weather, options, solarYear).electricalArrayLoss,
  }));

// --- shading from things standing above the roof ---------------------------

/**
 * Anything standing proud of the roof plane that can block the sun: a taller
 * building next door, the parapet around the roof edge, a stair core.
 *
 * The height is measured from the ROOF, not from the ground, and that is the
 * whole point. A roof sits on top of its own building, so a neighbour of the
 * same height blocks nothing at all: its roof and this one are the same plane.
 * Only the part of a neighbour that rises above this roof casts anything onto
 * it. In an industrial free zone, where every shed is much the same height,
 * that difference is usually zero, and the honest answer is that the
 * neighbours do not matter. In a city it is the tower across the road.
 */
export type Obstruction = {
  /** Outline in the same local metre frame as the rows. */
  ring: PolygonM;
  /** How far the top of it stands above the roof plane, metres. */
  riseM: number;
  label: string;
};

/**
 * Where the year's direct sunlight comes from, as energy per patch of sky.
 *
 * Built once per site. Shading then becomes a lookup rather than another pass
 * over 8,760 hours: whatever a panel's horizon is in some direction, the
 * energy it loses is the energy that arrives from below that horizon. Without
 * this, every panel would need its own hourly loop.
 */
export type SkyEnergy = {
  azimuthBins: number;
  elevationBins: number;
  /** Energy arriving at or below each elevation bin, per azimuth bin. */
  cumulative: Float64Array;
  /** Direct energy over the year, the denominator for a blocked-sky loss. */
  total: number;
  /** Everything landing on the plane, so a loss can be quoted against it. */
  poaTotal: number;
};

const AZIMUTH_BINS = 120; // three degrees each
const ELEVATION_BINS = 90; // one degree each

export const buildSkyEnergy = (
  site: LatLng,
  weather: WeatherYear,
  options: ShadingOptions,
  solarYear?: SolarYear,
): SkyEnergy => {
  const grid = new Float64Array(AZIMUTH_BINS * (ELEVATION_BINS + 1));
  let total = 0;
  let poaTotal = 0;
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const ghi = weather.ghi[hour];
    if (ghi <= 0) continue;
    const sun = solarYear?.position[hour] ?? solarPosition(site, hour);
    if (sun.altitudeDeg <= 0) continue;
    const poa = transpose(
      ghi,
      Math.floor(hour / 24) + 1,
      sun,
      options.tiltDeg,
      options.azimuthDeg,
      options.albedo,
    );
    poaTotal += poa.poaWm2;
    if (poa.directWm2 <= 0) continue;
    const az = Math.min(
      AZIMUTH_BINS - 1,
      Math.max(0, Math.floor(((sun.azimuthDeg + 180) / 360) * AZIMUTH_BINS)),
    );
    const el = Math.min(ELEVATION_BINS, Math.max(0, Math.floor(sun.altitudeDeg)));
    grid[az * (ELEVATION_BINS + 1) + el] += poa.directWm2;
    total += poa.directWm2;
  }
  // Running total up the elevation axis, so "everything below this angle" is
  // one read rather than a loop.
  for (let az = 0; az < AZIMUTH_BINS; az += 1) {
    const base = az * (ELEVATION_BINS + 1);
    for (let el = 1; el <= ELEVATION_BINS; el += 1) grid[base + el] += grid[base + el - 1];
  }
  return { azimuthBins: AZIMUTH_BINS, elevationBins: ELEVATION_BINS, cumulative: grid, total, poaTotal };
};

/**
 * The skyline seen from one point on the roof: the highest angle blocked in
 * each direction. Every edge of every obstruction is walked at a fixed step,
 * because a long wall spans many directions and its corners alone would leave
 * the middle of it out of the profile.
 */
const horizonAt = (point: PointM, obstructions: Obstruction[]): Float64Array => {
  const horizon = new Float64Array(AZIMUTH_BINS);
  for (const obstruction of obstructions) {
    if (obstruction.riseM <= 0) continue;
    const ring = obstruction.ring;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // Sample a wall finely when it is close and coarsely when it is far. One
      // azimuth bin is three degrees, so a step of about a twentieth of the
      // distance to the wall is already finer than the bins can record.
      const away = Math.hypot((a[0] + b[0]) / 2 - point[0], (a[1] + b[1]) / 2 - point[1]);
      const stepM = Math.max(2, away / 20);
      const steps = Math.max(1, Math.ceil(length / stepM));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const x = a[0] + (b[0] - a[0]) * t - point[0];
        const y = a[1] + (b[1] - a[1]) * t - point[1];
        const distance = Math.hypot(x, y);
        if (distance < 0.5) continue;
        const elevation = (Math.atan2(obstruction.riseM, distance) * 180) / Math.PI;
        // Azimuth of the obstruction from the panel, measured from south and
        // positive towards west, to match the sun.
        const azimuth = (Math.atan2(x, -y) * 180) / Math.PI;
        const bin = Math.min(
          AZIMUTH_BINS - 1,
          Math.max(0, Math.floor(((azimuth + 180) / 360) * AZIMUTH_BINS)),
        );
        if (elevation > horizon[bin]) horizon[bin] = elevation;
      }
    }
  }
  return horizon;
};

/** Share of the year's direct sunlight hidden behind a given skyline. */
const lossBehind = (horizon: Float64Array, sky: SkyEnergy): number => {
  if (sky.total <= 0) return 0;
  let lost = 0;
  for (let az = 0; az < AZIMUTH_BINS; az += 1) {
    const angle = horizon[az];
    if (angle <= 0) continue;
    const el = Math.min(sky.elevationBins, Math.floor(angle));
    lost += sky.cumulative[az * (sky.elevationBins + 1) + el];
  }
  return lost / sky.total;
};

export type ObstructionShading = {
  /** Fraction of the year's direct sunlight lost, per module. */
  byModule: number[][];
  /** Whole-array loss as a fraction of the year's direct sunlight. */
  arrayLoss: number;
  /**
   * The same loss against everything that lands on the panels, which is the
   * figure that belongs in the yield. It is the conservative direction: a
   * building blocks part of the sky's diffuse light too, and that is not
   * counted here.
   */
  arrayLossOfPoa: number;
  bestModuleLoss: number;
  worstModuleLoss: number;
  /** Share of modules losing less than half a percent. */
  clearShare: number;
  /** The obstructions that actually reach this roof, worst first. */
  culprits: { label: string; riseM: number; nearestM: number }[];
};

const EMPTY_OBSTRUCTION: ObstructionShading = {
  byModule: [],
  arrayLoss: 0,
  arrayLossOfPoa: 0,
  bestModuleLoss: 0,
  worstModuleLoss: 0,
  clearShare: 1,
  culprits: [],
};

/**
 * Shading of a roof by whatever stands above it.
 *
 * The skyline is worked out on a grid across the roof and then interpolated
 * onto the panels, rather than computed at every panel. A tower two hundred
 * metres away moves through the sky very slowly as you walk across a roof, so
 * a six-metre grid loses nothing and turns hundreds of thousands of distance
 * calculations into a few thousand.
 */
export const obstructionShading = (
  rows: PanelRow[],
  obstructions: Obstruction[],
  sky: SkyEnergy,
  moduleWidthM: number,
  gridStepM = 6,
): ObstructionShading => {
  const live = obstructions.filter((item) => item.riseM > 0 && item.ring.length >= 2);
  if (rows.length === 0 || live.length === 0 || sky.total <= 0) {
    return { ...EMPTY_OBSTRUCTION, byModule: rows.map((row) => new Array(row.modules).fill(0)) };
  }

  const minX = Math.min(...rows.map((row) => row.x));
  const maxX = Math.max(...rows.map((row) => row.x + row.w));
  const minY = Math.min(...rows.map((row) => row.y));
  const maxY = Math.max(...rows.map((row) => row.y + row.h));
  // A big roof gets a coarser grid rather than a slower one: the skyline from
  // a tower a few hundred metres off changes very little over six metres, and
  // over twelve it still changes very little.
  let step = gridStepM;
  while (((maxX - minX) / step + 1) * ((maxY - minY) / step + 1) > 1600) step *= 1.5;
  const cols = Math.max(2, Math.ceil((maxX - minX) / step) + 1);
  const rowsCount = Math.max(2, Math.ceil((maxY - minY) / step) + 1);
  const stepX = (maxX - minX) / (cols - 1);
  const stepY = (maxY - minY) / (rowsCount - 1);

  const node = new Float64Array(cols * rowsCount);
  for (let j = 0; j < rowsCount; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const point: PointM = [minX + i * stepX, minY + j * stepY];
      node[j * cols + i] = lossBehind(horizonAt(point, live), sky);
    }
  }

  const sample = (x: number, y: number): number => {
    const fx = Math.max(0, Math.min(cols - 1.0001, (x - minX) / stepX));
    const fy = Math.max(0, Math.min(rowsCount - 1.0001, (y - minY) / stepY));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const a = node[j * cols + i];
    const b = node[j * cols + i + 1];
    const c = node[(j + 1) * cols + i];
    const d = node[(j + 1) * cols + i + 1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };

  const byModule: number[][] = [];
  let best = Infinity;
  let worst = 0;
  let total = 0;
  let count = 0;
  let clear = 0;
  for (const row of rows) {
    const losses: number[] = [];
    for (let m = 0; m < row.modules; m += 1) {
      const loss = sample(row.x + (m + 0.5) * moduleWidthM, row.y + row.h / 2);
      losses.push(loss);
      if (loss < best) best = loss;
      if (loss > worst) worst = loss;
      if (loss < 0.005) clear += 1;
      total += loss;
      count += 1;
    }
    byModule.push(losses);
  }
  if (count === 0) return { ...EMPTY_OBSTRUCTION, byModule };

  // Which of them actually matters, judged one at a time against the same roof.
  const centre: PointM = [(minX + maxX) / 2, (minY + maxY) / 2];
  const culprits = live
    .map((item) => {
      const alone = lossBehind(horizonAt(centre, [item]), sky);
      const nearest = distanceToEdge(centre, item.ring);
      return { label: item.label, riseM: item.riseM, nearestM: Math.round(nearest), alone };
    })
    .filter((item) => item.alone > 0.001)
    .sort((a, b) => b.alone - a.alone)
    .slice(0, 4)
    .map(({ label, riseM, nearestM }) => ({ label, riseM, nearestM }));

  const arrayLoss = total / count;
  return {
    byModule,
    arrayLoss,
    arrayLossOfPoa: sky.poaTotal > 0 ? (arrayLoss * sky.total) / sky.poaTotal : 0,
    bestModuleLoss: best === Infinity ? 0 : best,
    worstModuleLoss: worst,
    clearShare: clear / count,
    culprits,
  };
};

/**
 * Turn mapped buildings into obstructions for one roof.
 *
 * Heights are measured from the ground, so each one is reduced by the height
 * of the roof being studied. A neighbour no taller than this roof drops out
 * entirely, which is the right answer and the common one in an industrial
 * zone. Buildings with no mapped height are not guessed at: they are returned
 * separately so the report can say how much of the neighbourhood it could not
 * see.
 */
export const neighbourObstructions = (
  neighbours: { ring: PolygonM; heightM: number | null; label: string }[],
  roofHeightM: number,
  reachM = 400,
  centre?: PointM,
): { obstructions: Obstruction[]; unknownHeights: number; considered: number } => {
  const obstructions: Obstruction[] = [];
  let unknownHeights = 0;
  let considered = 0;
  for (const item of neighbours) {
    if (item.ring.length < 2) continue;
    if (centre) {
      // Distance to the nearest EDGE, not vertex: a large footprint can have
      // all its vertices beyond the reach while a wall passes within metres.
      // A footprint that encloses the roof counts as within reach too.
      if (!pointInPolygon(centre, item.ring) && distanceToEdge(centre, item.ring) > reachM) continue;
    }
    considered += 1;
    if (item.heightM === null) {
      unknownHeights += 1;
      continue;
    }
    const rise = item.heightM - roofHeightM;
    if (rise <= 0) continue;
    obstructions.push({ ring: item.ring, riseM: rise, label: item.label });
  }
  return { obstructions, unknownHeights, considered };
};
