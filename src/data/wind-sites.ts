import type { Emirate } from "../engine/types";

/**
 * The points the wind climate is sampled at, one per study area, spread across
 * all seven emirates. Coordinates are the centre of the named area and are
 * accurate to a few hundred metres, which is finer than the 3 km Atlas pixel
 * and far finer than the ERA5 cell, so they are good enough to select the
 * right climate without implying a surveyed turbine position.
 *
 * `terrain` is the surface roughness class used to bring the generalized
 * Atlas climate down to the ground, in metres:
 *   0.0002  open sea
 *   0.03    open desert, sabkha, airfields
 *   0.10    scattered farms and low buildings
 *   0.40    suburb, industrial estate, dense obstacles
 */
export type WindSite = {
  id: string;
  name: string;
  emirate: Emirate;
  lat: number;
  lng: number;
  terrain: number;
  /** Ground elevation, metres, used only to sanity-check the pressure record. */
  elevationM: number;
  /**
   * "ridge": a turbine here would go on the high ground inside the Atlas box,
   * so the level uses the windiest tenth of the box rather than its mean.
   * Default is the box mean, right for a flat site.
   */
  siting?: "ridge";
};

export const WIND_SITES: WindSite[] = [
  // Abu Dhabi
  { id: "abu-dhabi-city", name: "Abu Dhabi city", emirate: "abu-dhabi", lat: 24.4539, lng: 54.3773, terrain: 0.4, elevationM: 5 },
  { id: "masdar-city", name: "Masdar City", emirate: "abu-dhabi", lat: 24.4269, lng: 54.6167, terrain: 0.4, elevationM: 12 },
  { id: "al-ain", name: "Al Ain", emirate: "abu-dhabi", lat: 24.2075, lng: 55.7447, terrain: 0.1, elevationM: 270 },
  { id: "ruwais", name: "Ruwais industrial city", emirate: "abu-dhabi", lat: 24.1112, lng: 52.7304, terrain: 0.1, elevationM: 5 },
  { id: "madinat-zayed", name: "Madinat Zayed", emirate: "abu-dhabi", lat: 23.6532, lng: 53.7061, terrain: 0.03, elevationM: 120 },
  { id: "liwa", name: "Liwa oasis", emirate: "abu-dhabi", lat: 23.1332, lng: 53.7842, terrain: 0.03, elevationM: 145 },
  { id: "sir-bani-yas", name: "Sir Bani Yas island", emirate: "abu-dhabi", lat: 24.3153, lng: 52.5831, terrain: 0.03, elevationM: 20 },
  { id: "delma", name: "Delma island", emirate: "abu-dhabi", lat: 24.5053, lng: 52.3022, terrain: 0.03, elevationM: 10 },
  { id: "sila", name: "Al Sila", emirate: "abu-dhabi", lat: 24.0494, lng: 51.6017, terrain: 0.03, elevationM: 8 },

  // Dubai
  { id: "jebel-ali", name: "Jebel Ali free zone", emirate: "dubai", lat: 24.9857, lng: 55.0879, terrain: 0.4, elevationM: 6 },
  { id: "dubai-industrial-city", name: "Dubai Industrial City", emirate: "dubai", lat: 24.9053, lng: 55.1547, terrain: 0.1, elevationM: 18 },
  { id: "al-khawaneej", name: "Al Khawaneej", emirate: "dubai", lat: 25.2170, lng: 55.5291, terrain: 0.1, elevationM: 30 },
  { id: "business-bay", name: "Business Bay", emirate: "dubai", lat: 25.1853, lng: 55.2683, terrain: 0.4, elevationM: 8 },
  { id: "hatta", name: "Hatta", emirate: "dubai", lat: 24.7990, lng: 56.1180, terrain: 0.1, elevationM: 330, siting: "ridge" },

  // Sharjah
  { id: "sharjah-industrial", name: "Sharjah industrial area", emirate: "sharjah", lat: 25.3128, lng: 55.4701, terrain: 0.4, elevationM: 15 },
  { id: "hamriyah", name: "Hamriyah free zone", emirate: "sharjah", lat: 25.4697, lng: 55.5050, terrain: 0.1, elevationM: 4 },
  { id: "khorfakkan", name: "Khor Fakkan", emirate: "sharjah", lat: 25.3394, lng: 56.3568, terrain: 0.1, elevationM: 15 },
  { id: "al-dhaid", name: "Al Dhaid", emirate: "sharjah", lat: 25.2869, lng: 55.8811, terrain: 0.03, elevationM: 105, siting: "ridge" },

  // Ajman
  { id: "ajman", name: "Ajman city", emirate: "ajman", lat: 25.4052, lng: 55.4700, terrain: 0.4, elevationM: 8 },
  { id: "ajman-manama", name: "Manama, Ajman", emirate: "ajman", lat: 25.3215, lng: 56.0170, terrain: 0.03, elevationM: 160, siting: "ridge" },

  // Umm Al Quwain
  { id: "umm-al-quwain", name: "Umm Al Quwain city", emirate: "umm-al-quwain", lat: 25.5647, lng: 55.5553, terrain: 0.1, elevationM: 3 },

  // Ras Al Khaimah
  { id: "ras-al-khaimah", name: "Ras Al Khaimah city", emirate: "ras-al-khaimah", lat: 25.7895, lng: 55.9432, terrain: 0.4, elevationM: 5 },
  { id: "al-hamra", name: "Al Hamra, RAK", emirate: "ras-al-khaimah", lat: 25.6880, lng: 55.7900, terrain: 0.1, elevationM: 4 },
  { id: "jebel-jais", name: "Jebel Jais", emirate: "ras-al-khaimah", lat: 25.9350, lng: 56.1500, terrain: 0.03, elevationM: 1500, siting: "ridge" },

  // Fujairah
  { id: "fujairah", name: "Fujairah city", emirate: "fujairah", lat: 25.1230, lng: 56.3370, terrain: 0.4, elevationM: 10 },
  { id: "al-halah", name: "Al Halah", emirate: "fujairah", lat: 25.4975, lng: 56.1519, terrain: 0.03, elevationM: 780, siting: "ridge" },
  { id: "dibba", name: "Dibba Al Fujairah", emirate: "fujairah", lat: 25.6160, lng: 56.2710, terrain: 0.1, elevationM: 12 },
];

export const windSite = (id: string): WindSite => {
  const site = WIND_SITES.find((candidate) => candidate.id === id);
  if (!site) throw new Error(`No wind site configured for ${id}`);
  return site;
};

/** Great-circle distance in kilometres. */
export const siteDistanceKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/**
 * The configured site nearest to a point. This is a screening convenience —
 * the climate at the point is the climate of that pixel's 3 km box, so a site
 * 40 km away in different terrain is indicative at best and flagged as such.
 */
export const nearestWindSite = (lat: number, lng: number): WindSite =>
  WIND_SITES.reduce((nearest, site) =>
    siteDistanceKm({ lat, lng }, site) < siteDistanceKm({ lat, lng }, nearest) ? site : nearest,
  );
