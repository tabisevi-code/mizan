// @ts-expect-error Node.js type definitions are not included in this project.
import assert from "node:assert/strict";
// @ts-expect-error Node.js type definitions are not included in this project.
import test from "node:test";
import { parseBuildings } from "../src/connectors/overpass.ts";

// Shape of an Overpass `[out:json]; ... out geom;` response for a closed way.
const square = (id: number, lat: number, lon: number, sizeDeg: number, tags?: Record<string, string>) => ({
  type: "way",
  id,
  bounds: { minlat: lat, minlon: lon, maxlat: lat + sizeDeg, maxlon: lon + sizeDeg },
  nodes: [1, 2, 3, 4, 1],
  geometry: [
    { lat, lon },
    { lat, lon: lon + sizeDeg },
    { lat: lat + sizeDeg, lon: lon + sizeDeg },
    { lat: lat + sizeDeg, lon },
    { lat, lon },
  ],
  tags,
});

test("parseBuildings reads Overpass `geometry`, drops the closing node and small or degenerate ways", () => {
  const payload = {
    version: 0.6,
    elements: [
      square(10, 25.1, 55.2, 0.0005, { building: "warehouse" }),
      square(11, 25.1, 55.21, 0.00005),
      { type: "way", id: 12, geometry: [{ lat: 25.1, lon: 55.2 }, { lat: 25.1, lon: 55.201 }], tags: {} },
      { type: "way", id: 13, tags: { building: "yes" } },
    ],
  };
  const buildings = parseBuildings(payload);
  assert.equal(buildings.length, 1);
  const [building] = buildings;
  assert.equal(building.osmId, 10);
  assert.equal(building.ring.length, 4);
  assert.deepEqual(building.ring[0], [55.2, 25.1]);
  assert.deepEqual(building.tags, { building: "warehouse" });
  assert.ok(building.areaM2 > 2500 && building.areaM2 < 3200);
  assert.ok(Math.abs(building.centroid.lat - 25.10025) < 1e-9);
  assert.ok(Math.abs(building.centroid.lng - 55.20025) < 1e-9);
});

test("parseBuildings returns an empty list when no elements carry geometry", () => {
  assert.deepEqual(parseBuildings({ elements: [] }), []);
  assert.deepEqual(parseBuildings({ elements: [{ id: 1, tags: {} }] }), []);
});
