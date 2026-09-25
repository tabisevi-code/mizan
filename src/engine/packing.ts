/**
 * Fitting panel rows inside a real roof outline.
 *
 * Everything here works in metres in a local frame, because that is how a
 * layout is actually drawn. A roof is not a rectangle: it has corners, notches
 * and an edge you cannot build right up to. So rows are laid across the shape
 * and clipped to it, and the module count that comes out is a count of modules
 * that actually fit, not an area multiplied by a coverage factor.
 */

import { EAST_WEST_PITCH_FACTOR } from "./capacity";

export type PointM = [number, number];
export type PolygonM = PointM[];

export type PanelRow = { x: number; y: number; w: number; h: number; modules: number };

export type PackResult = {
  rows: PanelRow[];
  moduleCount: number;
  kwp: number;
  /** Area inside the setback line, in square metres. */
  netAreaM2: number;
  grossAreaM2: number;
};

export type PackOptions = {
  /** Metres left clear at every roof edge for access and wind uplift. */
  setbackM: number;
  /** Share of the roof taken by plant, skylights and walkways. */
  obstructionAllowance: number;
  moduleWidthM: number;
  moduleHeightM: number;
  moduleWatts: number;
  tiltDeg: number;
  /** Rows all facing south, or back-to-back pairs facing east and west. */
  layout: "south" | "east-west";
};

export const DEFAULT_PACK: PackOptions = {
  setbackM: 1.5,
  obstructionAllowance: 0.3,
  moduleWidthM: 1.134,
  moduleHeightM: 2.278,
  moduleWatts: 580,
  tiltDeg: 10,
  layout: "south",
};

export const polygonAreaM2 = (polygon: PolygonM): number => {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
};

export const polygonBounds = (polygon: PolygonM) => {
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

export const polygonCentroid = (polygon: PolygonM): PointM => {
  const bounds = polygonBounds(polygon);
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
};

export const pointInPolygon = (point: PointM, polygon: PolygonM): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > point[1] !== yj > point[1]) {
      const x = ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
      if (point[0] < x) inside = !inside;
    }
  }
  return inside;
};

/** Twice the signed area; positive when the ring winds anticlockwise. */
const signedArea2 = (polygon: PolygonM): number => {
  let total = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    total += x1 * y2 - x2 * y1;
  }
  return total;
};

/** Shortest distance from a point to a line segment. */
const distanceToSegment = (p: PointM, a: PointM, b: PointM): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** Shortest distance from a point to any edge of the polygon. */
export const distanceToEdge = (point: PointM, polygon: PolygonM): number => {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const d = distanceToSegment(point, polygon[i], polygon[(i + 1) % polygon.length]);
    if (d < best) best = d;
  }
  return best;
};

/**
 * Sharp corners are not allowed to spike out to infinity: a 10 degree corner
 * offset inward by 1.5 m would otherwise put its new vertex 17 m away. Past
 * this multiple of the setback the corner is cut off square instead.
 */
const MITRE_LIMIT = 2.5;

/**
 * Move every edge of a polygon inward by `metres`, perpendicular to itself,
 * and rebuild the corners where the moved edges meet.
 *
 * This is what a setback actually is, and it is not the same as shrinking the
 * shape towards its middle. On an L-shaped warehouse — which is most of them —
 * scaling towards the centroid pulls the long arms in far more than 1.5 m and
 * pushes the inside corner the wrong way entirely. Offsetting edge by edge
 * keeps every point of the result exactly `metres` clear of the roof edge,
 * which is the thing the fire code and the wind-uplift detail both ask for.
 *
 * Corners that fold back on themselves — a neck narrower than twice the
 * setback — are dropped, because the correct answer there is that nothing
 * fits, not a sliver.
 */
export const shrinkPolygon = (polygon: PolygonM, metres: number): PolygonM => {
  if (polygon.length < 3 || metres <= 0) return polygon;
  const anticlockwise = signedArea2(polygon) > 0;
  const count = polygon.length;

  // Each edge, slid inward along its own normal. `vertex` records which
  // original vertex the edge starts at, so the corner between edge i-1 and
  // edge i can be tested against original vertex i even after degenerate
  // edges were skipped.
  const moved: { at: PointM; dir: PointM; vertex: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % count];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    const dir: PointM = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    // Inward normal depends on which way the ring winds.
    const normal: PointM = anticlockwise ? [-dir[1], dir[0]] : [dir[1], -dir[0]];
    moved.push({ at: [a[0] + normal[0] * metres, a[1] + normal[1] * metres], dir, vertex: i });
  }
  if (moved.length < 3) return [];

  // A corner is where two consecutive moved edges cross.
  const corners: PolygonM = [];
  for (let i = 0; i < moved.length; i += 1) {
    const previous = moved[(i - 1 + moved.length) % moved.length];
    const current = moved[i];
    const cross = previous.dir[0] * current.dir[1] - previous.dir[1] * current.dir[0];
    if (Math.abs(cross) < 1e-9) {
      // The two edges are parallel: the corner is a straight line, so the
      // moved start point is already the answer.
      corners.push(current.at);
      continue;
    }
    const dx = current.at[0] - previous.at[0];
    const dy = current.at[1] - previous.at[1];
    const t = (dx * current.dir[1] - dy * current.dir[0]) / cross;
    const corner: PointM = [previous.at[0] + previous.dir[0] * t, previous.at[1] + previous.dir[1] * t];

    const original = polygon[current.vertex];
    const reach = Math.hypot(corner[0] - original[0], corner[1] - original[1]);
    if (reach > metres * MITRE_LIMIT) {
      // Too sharp to mitre: bevel it with the two edge endpoints instead.
      corners.push([previous.at[0] + previous.dir[0] * 1e-6, previous.at[1] + previous.dir[1] * 1e-6]);
      corners.push(current.at);
      continue;
    }
    corners.push(corner);
  }

  // Anything that folded past the far side of the roof is not part of the
  // buildable area. A true offset point sits exactly `metres` from the nearest
  // edge; a folded one sits closer, or outside altogether.
  const tolerance = metres * 0.98;
  const kept = corners.filter(
    (corner) => pointInPolygon(corner, polygon) && distanceToEdge(corner, polygon) >= tolerance,
  );
  if (kept.length < 3 || polygonAreaM2(kept) <= 0) return [];
  return kept;
};

/** Where a horizontal line at height y crosses the polygon. */
const scanline = (polygon: PolygonM, y: number): [number, number][] => {
  const crossings: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y) crossings.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  crossings.sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) spans.push([crossings[i], crossings[i + 1]]);
  return spans;
};

/**
 * Row pitch. South-facing rows must clear the shadow of the row in front at
 * winter noon; east-west pairs sit nose to nose and need almost none.
 */
export const rowPitchM = (options: PackOptions, latitudeDeg: number): number => {
  const depth = options.moduleHeightM * Math.cos((options.tiltDeg * Math.PI) / 180);
  if (options.layout === "east-west") return depth * EAST_WEST_PITCH_FACTOR;
  const noonAltitude = Math.max(5, 90 - Math.abs(latitudeDeg) - 23.45);
  const rise = options.moduleHeightM * Math.sin((options.tiltDeg * Math.PI) / 180);
  return depth + rise / Math.tan((noonAltitude * Math.PI) / 180);
};

export const packRoof = (
  polygon: PolygonM,
  latitudeDeg: number,
  options: Partial<PackOptions> = {},
): PackResult => {
  const config = { ...DEFAULT_PACK, ...options };
  const grossAreaM2 = polygonAreaM2(polygon);
  if (polygon.length < 3 || grossAreaM2 < 50) {
    return { rows: [], moduleCount: 0, kwp: 0, netAreaM2: 0, grossAreaM2 };
  }

  const inner = shrinkPolygon(polygon, config.setbackM);
  const netAreaM2 = polygonAreaM2(inner);
  const bounds = polygonBounds(inner);
  const pitch = rowPitchM(config, latitudeDeg);
  const depth = config.moduleHeightM * Math.cos((config.tiltDeg * Math.PI) / 180);

  // Plant, skylights and walkways are not mapped, so instead of pretending to
  // know where they are, the same share of rows is left out, spread evenly.
  const keepRatio = 1 - config.obstructionAllowance;
  const rows: PanelRow[] = [];
  let moduleCount = 0;
  let carried = 0;

  for (let y = bounds.minY; y + depth <= bounds.maxY; y += pitch) {
    carried += keepRatio;
    if (carried < 1) continue;
    carried -= 1;

    // Sample the middle of the row so a row only counts where the roof is
    // continuous across its whole depth.
    const spans = scanline(inner, y + depth / 2);
    for (const [left, right] of spans) {
      const width = right - left;
      if (width < config.moduleWidthM * 2) continue;
      const modules = Math.floor(width / config.moduleWidthM);
      if (modules < 2) continue;
      rows.push({ x: left, y, w: modules * config.moduleWidthM, h: depth, modules });
      moduleCount += modules;
    }
  }

  return {
    rows,
    moduleCount,
    kwp: (moduleCount * config.moduleWatts) / 1000,
    netAreaM2,
    grossAreaM2,
  };
};

/**
 * Where the inverters and, if there is one, the battery would sit. Both are
 * nudged until they land inside the outline, because a marker floating off the
 * edge of the roof is worse than no marker.
 */
export const plantPositions = (polygon: PolygonM): { inverter: PointM; battery: PointM } => {
  const centre = polygonCentroid(polygon);
  const place = (offset: number): PointM => {
    for (const fraction of [1, 0.6, 0.3, 0]) {
      const candidate: PointM = [centre[0] + offset * fraction, centre[1]];
      if (pointInPolygon(candidate, polygon)) return candidate;
    }
    return centre;
  };
  return { inverter: place(-14), battery: place(14) };
};

/** Convert a local metre polygon to lng/lat so the rest of the engine can use it. */
export const metresToLngLat = (
  polygon: PolygonM,
  origin: { lng: number; lat: number },
): [number, number][] => {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return polygon.map(([x, y]) => [origin.lng + x / mPerDegLng, origin.lat + y / mPerDegLat]);
};

/** Inverse of `metresToLngLat`: a [lng, lat] ring into the local metre frame. */
export const lngLatToMetres = (
  ring: [number, number][],
  origin: { lng: number; lat: number },
): PolygonM => {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return ring.map(([lng, lat]) => [(lng - origin.lng) * mPerDegLng, (lat - origin.lat) * mPerDegLat]);
};
