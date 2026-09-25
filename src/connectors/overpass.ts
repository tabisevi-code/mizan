/**
 * OpenStreetMap building footprints via Overpass.
 *
 * This is what replaces "type your roof area into a box". The operator drops a
 * pin or searches an address, and the tool reads the actual building outlines
 * around it.
 *
 * Caveat the UI must carry: OSM coverage of Gulf industrial estates is uneven.
 * When nothing comes back, that is a gap in the map, not an absence of roof, and
 * the operator is asked to draw or upload the boundary instead.
 */

import type { LatLng, Ring } from "../engine/types";
import { ringAreaM2 } from "../engine/capacity";

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
export const OVERPASS_PROXY_PATH = "/api/overpass";
export const OSM_ATTRIBUTION = {
  kind: "dataset" as const,
  label: "OpenStreetMap buildings",
  url: "https://www.openstreetmap.org/copyright",
  caveat: "Community-mapped outlines under ODbL. Coverage of industrial estates varies.",
};

export type BuildingFootprint = {
  osmId: number;
  ring: Ring;
  areaM2: number;
  tags: Record<string, string>;
  centroid: LatLng;
};

const isBrowser = typeof window !== "undefined";

export const buildingQuery = (centre: LatLng, radiusM: number): string => {
  const latDelta = radiusM / 111320;
  const lngDelta = radiusM / (111320 * Math.cos((centre.lat * Math.PI) / 180));
  const south = centre.lat - latDelta;
  const north = centre.lat + latDelta;
  const west = centre.lng - lngDelta;
  const east = centre.lng + lngDelta;
  return `[out:json][timeout:45];(way["building"](${south},${west},${north},${east}););out geom;`;
};

export const fetchBuildings = async (
  centre: LatLng,
  radiusM = 400,
  fetchImpl: typeof fetch = fetch,
): Promise<BuildingFootprint[]> => {
  const url = isBrowser ? OVERPASS_PROXY_PATH : OVERPASS_ENDPOINT;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: buildingQuery(centre, radiusM) }).toString(),
  });
  if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
  const payload = (await response.json()) as {
    elements: { id: number; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> }[];
  };
  return parseBuildings(payload);
};

export const parseBuildings = (payload: {
  elements: { id: number; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> }[];
}): BuildingFootprint[] =>
  payload.elements
    .filter((element) => (element.geometry?.length ?? 0) > 3)
    .map((element) => {
      const ring = element.geometry!.map((point) => [point.lon, point.lat] as [number, number]);
      // Overpass repeats the first node to close the way; the engine does not.
      const closed =
        ring.length > 1 &&
        ring[0][0] === ring[ring.length - 1][0] &&
        ring[0][1] === ring[ring.length - 1][1];
      const openRing = closed ? ring.slice(0, -1) : ring;
      const areaM2 = ringAreaM2(openRing);
      const lat = openRing.reduce((total, [, value]) => total + value, 0) / openRing.length;
      const lng = openRing.reduce((total, [value]) => total + value, 0) / openRing.length;
      return {
        osmId: element.id,
        ring: openRing,
        areaM2,
        tags: element.tags ?? {},
        centroid: { lat, lng },
      };
    })
    .filter((building) => building.areaM2 > 50)
    .sort((a, b) => b.areaM2 - a.areaM2);

/** Nominatim, for turning a typed address or company site into a coordinate. */
export const geocode = async (
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ label: string; location: LatLng }[]> => {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    countrycodes: "ae",
    limit: "5",
  });
  const url = isBrowser
    ? `/api/geocode?${params}`
    : `https://nominatim.openstreetmap.org/search?${params}`;
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "mizan-site-screening/0.2 (hackathon prototype)" },
  });
  if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
  const payload = (await response.json()) as { display_name: string; lat: string; lon: string }[];
  return payload.map((item) => ({
    label: item.display_name,
    location: { lat: Number(item.lat), lng: Number(item.lon) },
  }));
};
