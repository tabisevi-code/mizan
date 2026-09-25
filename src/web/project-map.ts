import type { ProjectMap } from "../data/mapped-project-types";
import { M_PER_DEG_LAT, tileLayer, type Basemap, type TileBox } from "./tiles";

/** Smallest box width shown, in metres, so a single point still gets some context. */
const MIN_BOX_WIDTH_M = 600;
/** Box side relative to the geometry's extent: 1.5 leaves a quarter-width margin each side. */
const FIT_PADDING = 1.5;
/** Width ÷ height of the box, matching the 1000×625 SVG viewBox. */
const BOX_ASPECT = 1.6;

export function projectMapBox(geometry: ProjectMap): TileBox {
  const points = geometry.features.flatMap(f => f.coordinates);
  const lngs = points.map(p => p[0]), lats = points.map(p => p[1]);
  const west = Math.min(...lngs), east = Math.max(...lngs), south = Math.min(...lats), north = Math.max(...lats);
  const origin: [number, number] = [(east + west) / 2, (north + south) / 2];
  const width = (east - west) * M_PER_DEG_LAT * Math.cos(origin[1] * Math.PI / 180);
  const height = (north - south) * M_PER_DEG_LAT;
  const w = Math.max(MIN_BOX_WIDTH_M, width * FIT_PADDING, height * FIT_PADDING * BOX_ASPECT);
  const h = w / BOX_ASPECT;
  return { x: -w / 2, y: -h / 2, w, h, origin };
}

export function renderProjectMap(root: HTMLElement, geometry: ProjectMap, basemap: Basemap) {
  const box = projectMapBox(geometry);
  root.replaceChildren(tileLayer(box, basemap));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 1000 625");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-label", "Published project map: mapped outlines and asset locations");
  const project = (p: number[]) => {
    const x = (p[0] - box.origin[0]) * M_PER_DEG_LAT * Math.cos(box.origin[1] * Math.PI / 180);
    const y = (p[1] - box.origin[1]) * M_PER_DEG_LAT;
    return [(x - box.x) / box.w * 1000, (box.y + box.h - y) / box.h * 625];
  };
  for (const feature of geometry.features) {
    const link = document.createElementNS(ns, "a");
    link.setAttribute("href", feature.url);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.setAttribute("aria-label", feature.label + " · OpenStreetMap record");
    const title = document.createElementNS(ns, "title");
    title.textContent = feature.label;
    link.append(title);
    const points = feature.coordinates.map(project);
    const shape = document.createElementNS(ns, "path");
    const [x, y] = points[0];
    shape.setAttribute("class", `project-feature project-${feature.kind}`);
    shape.setAttribute("vector-effect", "non-scaling-stroke");
    shape.setAttribute("d", points.length > 1
      ? points.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ") + " Z"
      : feature.kind === "turbine"
        ? `M${x},${y + 38} L${x},${y} L${x},${y - 30} M${x},${y} L${x - 26},${y + 15} M${x},${y} L${x + 26},${y + 15}`
        : `M${x - 12},${y} a12,12 0 1,0 24,0 a12,12 0 1,0 -24,0`);
    link.append(shape);
    svg.append(link);
  }
  root.append(svg);
  const legend = document.createElement("div");
  legend.className = "project-map-legend";
  legend.textContent = geometry.features.some(f => f.kind === "building") ? "Gold: named warehouse footprint"
    : geometry.features.some(f => f.kind === "turbine") ? "Blue: mapped wind turbine"
    : geometry.features.some(f => f.kind === "reservoir") ? "Blue: lower reservoir shoreline"
    : "Green: company point · Grey: nearby buildings (operator unverified)";
  root.append(legend);
}
