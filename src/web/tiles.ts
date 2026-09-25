/**
 * Satellite imagery behind the drawing.
 *
 * A screening tool for roofs has to show the roof. A street map does not: it
 * shows a grey polygon where the building is, and the person looking at it has
 * to take on trust that there is a roof under there worth covering. Imagery
 * shows the plant, the skylights, the yard, the neighbours and the shadows,
 * and every panel drawn on top is visibly on a real building.
 *
 * Esri World Imagery, which is free to use with the attribution below. Tiles
 * only load where the page may fetch images from another host, which means
 * running it locally or on any normal deployment. Where they cannot arrive,
 * they simply do not, and the vector drawing underneath stands on its own.
 */

const TILE_SIZE = 256;

export type Basemap = "satellite" | "streets";

const SOURCES: Record<Basemap, { url: (z: number, x: number, y: number) => string; credit: string }> = {
  satellite: {
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    credit: "Imagery: Esri, Maxar, Earthstar Geographics · Outlines: OpenStreetMap, ODbL",
  },
  streets: {
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    credit: "Map and outlines: OpenStreetMap contributors, ODbL",
  },
};

export const basemapCredit = (basemap: Basemap): string => SOURCES[basemap].credit;

const lngToX = (lng: number, zoom: number) => ((lng + 180) / 360) * 2 ** zoom;
const latToY = (lat: number, zoom: number) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
};

/** Metres per degree of latitude (and of longitude at the equator). */
export const M_PER_DEG_LAT = 111320;

export type TileBox = {
  /** Metre box being shown, in the scene's local frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Scene origin as [lng, lat]. */
  origin: [number, number];
};

/**
 * Build the imagery layer for a metre box. Zoom is chosen so one tile pixel is
 * a little finer than one screen pixel, which is what keeps a roof sharp
 * enough to see the plant on it.
 */
export const tileLayer = (box: TileBox, basemap: Basemap = "satellite"): HTMLElement => {
  const layer = document.createElement("div");
  layer.className = "map-tiles";
  const source = SOURCES[basemap];
  const notice = document.createElement("div");
  notice.className = "map-load-status";
  notice.setAttribute("role", "status");
  notice.textContent = "Loading map imagery…";
  layer.append(notice);
  let loaded = 0;
  let settled = 0;
  let total = 0;
  let timeout: ReturnType<typeof setTimeout>;
  const showFailure = () => {
    if (!layer.isConnected || loaded > 0) return;
    notice.replaceChildren(document.createTextNode("Map imagery could not load. Check your connection or try another map. "));
    for (const mode of [basemap, basemap === "satellite" ? "streets" : "satellite"] as Basemap[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = mode === basemap ? "Retry" : mode === "streets" ? "Try street map" : "Try satellite";
      button.addEventListener("click", () => {
        clearTimeout(timeout);
        // Use the existing controls so attribution and selected basemap agree.
        const control = document.getElementById(mode === "streets" ? "base-map" : "base-sat");
        if (control) control.click();
        else layer.replaceWith(tileLayer(box, mode));
      });
      notice.append(button);
    }
  };

  const [originLng, originLat] = box.origin;
  const mPerDegLat = M_PER_DEG_LAT;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  const west = originLng + box.x / mPerDegLng;
  const east = originLng + (box.x + box.w) / mPerDegLng;
  const south = originLat + box.y / mPerDegLat;
  const north = originLat + (box.y + box.h) / mPerDegLat;

  // Roughly 900 CSS pixels across the map; aim for about two tile pixels per
  // CSS pixel so the imagery still reads when someone leans in.
  const targetPx = 1800;
  let zoom = 19;
  while (zoom > 12) {
    const spanPx = (lngToX(east, zoom) - lngToX(west, zoom)) * TILE_SIZE;
    if (spanPx <= targetPx) break;
    zoom -= 1;
  }
  zoom = Math.min(19, Math.max(12, zoom));

  const left = lngToX(west, zoom) * TILE_SIZE;
  const top = latToY(north, zoom) * TILE_SIZE;
  const boxWidthPx = (lngToX(east, zoom) - lngToX(west, zoom)) * TILE_SIZE;
  const boxHeightPx = (latToY(south, zoom) - latToY(north, zoom)) * TILE_SIZE;

  const firstX = Math.floor(left / TILE_SIZE);
  const lastX = Math.floor((left + boxWidthPx) / TILE_SIZE);
  const firstY = Math.floor(top / TILE_SIZE);
  const lastY = Math.floor((top + boxHeightPx) / TILE_SIZE);
  const span = 2 ** zoom;

  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) {
      if (y < 0 || y >= span) continue;
      const image = document.createElement("img");
      total += 1;
      image.src = source.url(zoom, ((x % span) + span) % span, y);
      image.alt = "";
      image.loading = "eager";
      image.decoding = "async";
      // A tile that never arrives must leave nothing behind: a broken-image
      // icon over the drawing is worse than no imagery at all.
      image.addEventListener("load", () => {
        loaded += 1;
        settled += 1;
        notice.remove();
        clearTimeout(timeout);
      });
      image.addEventListener("error", () => {
        settled += 1;
        image.remove();
        if (settled === total && loaded === 0) showFailure();
      });
      image.style.position = "absolute";
      image.style.left = `${((x * TILE_SIZE - left) / boxWidthPx) * 100}%`;
      image.style.top = `${((y * TILE_SIZE - top) / boxHeightPx) * 100}%`;
      image.style.width = `${(TILE_SIZE / boxWidthPx) * 100}%`;
      image.style.height = `${(TILE_SIZE / boxHeightPx) * 100}%`;
      layer.append(image);
    }
  }
  timeout = setTimeout(showFailure, 12000);
  return layer;
};

/** Kept for callers that still import the old name. */
export const TILE_ATTRIBUTION = SOURCES.satellite.credit;
