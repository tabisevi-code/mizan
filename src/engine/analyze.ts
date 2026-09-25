/**
 * The whole rooftop analysis behind one call.
 *
 * The app, the demo script and the tests all need the same pipeline: lay rows
 * on the real outline, measure how much they shade each other at every fill
 * level the planner might choose, then plan with the capacity and shading
 * that actually packed in — not the area-times-coverage estimate. Before this
 * file existed, that wiring lived in the web controller, and every other
 * caller quietly got the rougher estimate.
 *
 * Neighbour-building shading stays with the caller: it needs the surrounding
 * footprints, which only the map layer has. It folds into the curve through
 * `additionalPoaLoss`, which receives the packed rows, the weather year and
 * the precomputed sun so a caller can run `obstructionShading` itself.
 */

import { DEFAULT_PACK, packRoof, type PackOptions, type PackResult, type PanelRow, type PolygonM } from "./packing";
import { DEFAULT_ROOF_TILT_DEG } from "./pv";
import { shadingCurve, type ShadingOptions } from "./shading";
import { buildSolarYear, type SolarYear, type WeatherYear } from "./solar";
import { weatherOrModelled } from "./resource";
import { plan, type CapacityOverride, type PlanResult } from "./plan";
import { DEFAULT_PPA, type PpaTerms } from "./finance";
import type { ArrayLayout } from "./capacity";
import type { SiteProfile } from "./types";

export type AnalyzeRoofInput = {
  site: SiteProfile;
  /** Roof outline in the local metre frame — the same frame packRoof uses. */
  polygon: PolygonM;
  /** Weather year; the measured-climatology year for the site coordinate when absent. */
  weather?: WeatherYear;
  /** Precomputed sun positions; built once here when absent. */
  solarYear?: SolarYear;
  ppaTerms?: PpaTerms;
  /**
   * Extra whole-array loss folded into every shading-curve sample, as a
   * fraction of plane-of-array energy. Given the packed south rows, the
   * weather and the sun so a caller with surrounding buildings can run
   * `obstructionShading` without re-packing. Combined multiplicatively with
   * the row-shading sample.
   */
  additionalPoaLoss?: (ctx: {
    rows: PanelRow[];
    weather: WeatherYear;
    solarYear: SolarYear;
    shadingOptions: ShadingOptions;
  }) => number;
  /** Overrides for the packer (setback, module, tilt); layout is ignored. */
  pack?: Partial<PackOptions>;
};

export type RoofAnalysis = {
  plan: PlanResult;
  /** What the packer fit on this roof for each layout. */
  packed: Record<ArrayLayout, PackResult>;
  /** The capacity+shading override handed to the planner. */
  override: CapacityOverride;
  /** The shading inputs used, so a display pass can recompute consistently. */
  shadingOptions: Record<ArrayLayout, ShadingOptions>;
  weather: WeatherYear;
  solarYear: SolarYear;
};

/**
 * Shading inputs shared by every pass over this roof. The azimuth is the only
 * layout-dependent term: an east-west array is analysed as if facing east,
 * which is symmetric with west for a flat roof.
 */
export const roofShadingOptions = (layout: ArrayLayout): ShadingOptions => ({
  tiltDeg: DEFAULT_ROOF_TILT_DEG,
  azimuthDeg: layout === "east-west" ? -90 : 0,
  moduleLengthM: DEFAULT_PACK.moduleHeightM,
  moduleWidthM: DEFAULT_PACK.moduleWidthM,
  albedo: 0.15,
});

export const analyzeRoof = (input: AnalyzeRoofInput): RoofAnalysis => {
  const sun = input.solarYear ?? buildSolarYear(input.site.location);
  const weather = weatherOrModelled(input.site.location, input.weather, sun);

  const packed: Record<ArrayLayout, PackResult> = {
    south: packRoof(input.polygon, input.site.location.lat, { ...input.pack, layout: "south" }),
    "east-west": packRoof(input.polygon, input.site.location.lat, {
      ...input.pack,
      layout: "east-west",
    }),
  };

  const southOptions = roofShadingOptions("south");
  const extra =
    input.additionalPoaLoss?.({
      rows: packed.south.rows,
      weather,
      solarYear: sun,
      shadingOptions: southOptions,
    }) ?? 0;
  const combineLoss = (a: number, b: number) => 1 - (1 - a) * (1 - b);
  const curve = (layout: ArrayLayout) =>
    shadingCurve(
      packed[layout].rows,
      input.site.location,
      weather,
      roofShadingOptions(layout),
      undefined,
      sun,
    ).map((point) => ({ fill: point.fill, loss: combineLoss(point.loss, extra) }));

  const override: CapacityOverride = {
    south: {
      kwp: packed.south.kwp,
      moduleCount: packed.south.moduleCount,
      shadingCurve: curve("south"),
    },
    "east-west": {
      kwp: packed["east-west"].kwp,
      moduleCount: packed["east-west"].moduleCount,
      shadingCurve: curve("east-west"),
    },
  };

  const result = plan(input.site, weather, input.ppaTerms ?? DEFAULT_PPA, override, sun);

  return {
    plan: result,
    packed,
    override,
    shadingOptions: {
      south: southOptions,
      "east-west": roofShadingOptions("east-west"),
    },
    weather,
    solarYear: sun,
  };
};
