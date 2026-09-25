/**
 * From geometry to kilowatts.
 *
 * Roof area is derived from mapped polygons, never typed in. The array that
 * fits is then a function of module efficiency and row spacing, and row spacing
 * is a function of latitude and tilt. At 25 N a shallow tilt buys density; a
 * steep tilt buys yield per module and costs area.
 */

import type { LatLng, PvArraySpec, Ring } from "./types";

const DEG = Math.PI / 180;
const EARTH_RADIUS_M = 6378137;

/** Row pitch of an east-west pair as a multiple of its plan depth; the reciprocal is its ground coverage ratio. */
export const EAST_WEST_PITCH_FACTOR = 1.08;

/** Planar area of a lng/lat ring in square metres, good to well under 1% at city scale. */
export const ringAreaM2 = (ring: Ring): number => {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((total, [, lat]) => total + lat, 0) / ring.length;
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLng = mPerDegLat * Math.cos(meanLat * DEG);

  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    area += lng1 * mPerDegLng * (lat2 * mPerDegLat) - lng2 * mPerDegLng * (lat1 * mPerDegLat);
  }
  return Math.abs(area) / 2;
};

export const ringsAreaM2 = (rings: Ring[] | undefined): number =>
  (rings ?? []).reduce((total, ring) => total + ringAreaM2(ring), 0);

export const ringCentroid = (ring: Ring): LatLng => {
  const lng = ring.reduce((total, [value]) => total + value, 0) / ring.length;
  const lat = ring.reduce((total, [, value]) => total + value, 0) / ring.length;
  return { lat, lng };
};

export type ModuleSpec = {
  label: string;
  widthM: number;
  heightM: number;
  watts: number;
};

/** A current mainstream commercial module. Swap it, the maths follows. */
export const DEFAULT_MODULE: ModuleSpec = {
  label: "580 W bifacial, 2.28 x 1.13 m",
  widthM: 1.13,
  heightM: 2.28,
  watts: 580,
};

export type UsableAreaAssumptions = {
  /** Share of gross roof lost to plant, skylights, walkways and edge setbacks. */
  roofObstructionAllowance: number;
  /** Share of a land parcel lost to access tracks, setbacks and inverter stations. */
  groundSetbackAllowance: number;
};

export const DEFAULT_USABLE_AREA: UsableAreaAssumptions = {
  roofObstructionAllowance: 0.3,
  groundSetbackAllowance: 0.35,
};

/**
 * Ground coverage ratio: module area divided by land area, set so that rows do
 * not shade each other at the winter-solstice solar noon, which is the standard
 * design rule. At a shallow roof tilt this approaches 1.
 */
export const groundCoverageRatio = (tiltDeg: number, latitudeDeg: number): number => {
  if (tiltDeg <= 1) return 0.95;
  // Solar altitude at noon on the winter solstice.
  const noonAltitude = 90 - Math.abs(latitudeDeg) - 23.45;
  if (noonAltitude <= 5) return 0.35;
  const tilt = tiltDeg * DEG;
  // Row pitch needed so the row behind stays unshaded at that altitude.
  const pitchRatio =
    Math.cos(tilt) + (Math.sin(tilt) / Math.tan(noonAltitude * DEG));
  return Math.max(0.2, Math.min(0.95, 1 / pitchRatio));
};

export type ArrayLayout = "south" | "east-west";

export type ArrayFit = {
  kwp: number;
  moduleCount: number;
  usableAreaM2: number;
  groundCoverageRatio: number;
  wattsPerM2: number;
};

export const fitArray = (
  grossAreaM2: number,
  mounting: PvArraySpec["mounting"],
  tiltDeg: number,
  latitudeDeg: number,
  module: ModuleSpec = DEFAULT_MODULE,
  assumptions: UsableAreaAssumptions = DEFAULT_USABLE_AREA,
  layout: ArrayLayout = "south",
): ArrayFit => {
  const allowance =
    mounting === "ground" ? assumptions.groundSetbackAllowance : assumptions.roofObstructionAllowance;
  const usableAreaM2 = Math.max(0, grossAreaM2 * (1 - allowance));
  // East-west rows sit back to back in a shallow V, so they barely shade each
  // other and need almost no gap between them. At this shallow a tilt the gain
  // is real but modest, roughly a tenth more modules; the bigger prize is that
  // output spreads into the morning and evening instead of spiking at noon.
  const gcr =
    layout === "east-west"
      ? Math.min(0.92, 1 / EAST_WEST_PITCH_FACTOR)
      : groundCoverageRatio(tiltDeg, latitudeDeg);
  const moduleAreaM2 = module.widthM * module.heightM;
  const moduleCount = Math.floor((usableAreaM2 * gcr) / moduleAreaM2);
  const kwp = (moduleCount * module.watts) / 1000;

  return {
    kwp,
    moduleCount,
    usableAreaM2,
    groundCoverageRatio: gcr,
    wattsPerM2: usableAreaM2 > 0 ? (kwp * 1000) / usableAreaM2 : 0,
  };
};

/**
 * Row rectangles for drawing on the map. Rows run east to west so the modules
 * face south. This is a visual approximation of the layout implied by `fitArray`,
 * not a construction drawing, and the UI must say so.
 */
export const layoutRows = (
  ring: Ring,
  fit: ArrayFit,
  tiltDeg: number,
  module: ModuleSpec = DEFAULT_MODULE,
): Ring[] => {
  if (ring.length < 3 || fit.moduleCount <= 0) return [];

  const lats = ring.map(([, lat]) => lat);
  const lngs = ring.map(([lng]) => lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const meanLat = (minLat + maxLat) / 2;

  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLng = mPerDegLat * Math.cos(meanLat * DEG);

  const inset = 2; // metres of edge setback before the first row
  const rowDepthM = module.heightM * Math.cos(tiltDeg * DEG);
  const pitchM = rowDepthM / Math.max(fit.groundCoverageRatio, 0.2);

  const heightM = (maxLat - minLat) * mPerDegLat - inset * 2;
  const widthM = (maxLng - minLng) * mPerDegLng - inset * 2;
  if (heightM <= rowDepthM || widthM <= module.widthM) return [];

  const rowCount = Math.max(1, Math.floor(heightM / pitchM));
  const perRow = Math.max(1, Math.floor(widthM / module.widthM));
  const rowsNeeded = Math.min(rowCount, Math.ceil(fit.moduleCount / perRow));

  const rows: Ring[] = [];
  for (let index = 0; index < rowsNeeded; index += 1) {
    const offsetM = inset + index * pitchM;
    const south = minLat + offsetM / mPerDegLat;
    const north = south + rowDepthM / mPerDegLat;
    const modulesThisRow = Math.min(perRow, fit.moduleCount - index * perRow);
    const rowWidthM = modulesThisRow * module.widthM;
    const west = minLng + inset / mPerDegLng;
    const east = west + rowWidthM / mPerDegLng;
    rows.push([
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ]);
  }
  return rows;
};
