/**
 * The full computation for one site: roof packing, neighbour shading, the
 * plan, the electrical design and the verdict sentence. Pure — no DOM, no
 * globals — so the engine worker can run it off the main thread.
 */

import { metresToLngLat, packRoof, plantPositions, type PolygonM } from "../engine/packing";
import { plan, type CapacityOverride, type PlanResult } from "../engine/plan";
import { DEFAULT_PACK } from "../engine/packing";
import { DEFAULT_ROOF_TILT_DEG } from "../engine/pv";
import { modelledWeatherYear, type WeatherYear } from "../engine/solar";
import {
  buildSkyEnergy,
  neighbourObstructions,
  obstructionShading,
  rowShading,
  shadingCurve,
  thinRows,
  type ObstructionShading,
  type ShadingResult,
} from "../engine/shading";
import {
  DESIGN_TEMPERATURES,
  MODULES,
  chooseInverter,
  designElectrical,
  type ElectricalDesign,
} from "../engine/electrical";
import type { SiteProfile } from "../engine/types";
import type { SceneBuilding } from "./map";
import type { PortfolioSite } from "../data/portfolios";
import { aed, num, pct } from "./format";

export type Outcome = {
  status: "good" | "warn" | "stop";
  /** One line for the rail. */
  headline: string;
  /** The sentence that explains the verdict. */
  reason: string;
  result: PlanResult;
  packed: ReturnType<typeof packRoof>;
  polygon: PolygonM;
  shading: ShadingResult | null;
  blocked: (ObstructionShading & { unknownHeights: number; considered: number; taller: number }) | null;
  design: ElectricalDesign | null;
  fill: number;
  fullRoofShading: number;
  weather: WeatherYear;
  profile: SiteProfile;
};

const shadingOptions = (layout: "south" | "east-west") => ({
  tiltDeg: DEFAULT_ROOF_TILT_DEG,
  azimuthDeg: layout === "east-west" ? -90 : 0,
  moduleLengthM: DEFAULT_PACK.moduleHeightM,
  moduleWidthM: DEFAULT_PACK.moduleWidthM,
  albedo: 0.15,
});

export const latLngOfSite = (
  site: PortfolioSite,
  buildings: SceneBuilding[],
  sceneOrigin: [number, number],
): { lat: number; lng: number } => {
  const building = buildings[site.buildingIndex];
  const centre = building.polygon.reduce(
    (total, p) => [total[0] + p[0] / building.polygon.length, total[1] + p[1] / building.polygon.length],
    [0, 0],
  );
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((sceneOrigin[1] * Math.PI) / 180);
  return { lat: sceneOrigin[1] + centre[1] / mPerDegLat, lng: sceneOrigin[0] + centre[0] / mPerDegLng };
};

/** The site's consumption and account facts become the engine's SiteProfile. */
const profileFor = (
  site: PortfolioSite,
  polygon: PolygonM,
  location: { lat: number; lng: number },
  sceneOrigin: { lng: number; lat: number },
): SiteProfile => ({
  siteName: site.name,
  emirate: site.emirate,
  customerClass: site.customerClass,
  sector: site.sector,
  location,
  annualKwh: site.annualKwh,
  approvedLoadKw: site.approvedLoadKw,
  roofConstruction: site.roofConstruction,
  // The real outline, so the engine reports the roof it actually screened
  // rather than a blank where the area should be.
  roofRings: [metresToLngLat(polygon, sceneOrigin)],
  evidence: {
    hasRoofSurvey: false,
    hasStructuralReserve: site.roofConstruction === "concrete",
    hasLandRights: false,
    hasIntervalMeterData: false,
    hasApprovedLoadLetter: true,
  },
});

export const computeSite = (
  site: PortfolioSite,
  buildings: SceneBuilding[],
  sceneOrigin: [number, number],
  hurdleYears: number,
): Outcome => {
  const subject = buildings[site.buildingIndex];
  const polygon = subject.polygon;
  const location = latLngOfSite(site, buildings, sceneOrigin);
  const origin = { lng: sceneOrigin[0], lat: sceneOrigin[1] };
  const profile = profileFor(site, polygon, location, origin);
  const weather = modelledWeatherYear(location);

  const south = packRoof(polygon, location.lat, { layout: "south" });
  const eastWest = packRoof(polygon, location.lat, { layout: "east-west" });

  // What the buildings around it block. Needs this roof's own height: a
  // neighbour only shades it by the part standing above it.
  const roofHeight = site.roofHeightM ?? subject.heightM;
  let blocked: Outcome["blocked"] = null;
  if (roofHeight !== null && south.rows.length > 0) {
    const centre: [number, number] = [
      polygon.reduce((t, p) => t + p[0], 0) / polygon.length,
      polygon.reduce((t, p) => t + p[1], 0) / polygon.length,
    ];
    const { obstructions, unknownHeights, considered } = neighbourObstructions(
      buildings
        .filter((b) => b.index !== site.buildingIndex)
        .map((b) => ({
          ring: b.polygon,
          heightM: b.heightM,
          label: `${num.format(Math.round(b.areaM2))} m² building`,
        })),
      roofHeight,
      400,
      centre,
    );
    const sky = buildSkyEnergy(location, weather, shadingOptions("south"));
    blocked = {
      ...obstructionShading(south.rows, obstructions, sky, DEFAULT_PACK.moduleWidthM),
      unknownHeights,
      considered,
      taller: obstructions.length,
    };
  }

  const combine = (a: number, b: number) => 1 - (1 - a) * (1 - b);
  const curve = (packed: ReturnType<typeof packRoof>, layout: "south" | "east-west") =>
    shadingCurve(packed.rows, location, weather, shadingOptions(layout)).map((point) => ({
      fill: point.fill,
      loss: combine(point.loss, blocked?.arrayLossOfPoa ?? 0),
    }));

  const override: CapacityOverride = {
    south: { kwp: south.kwp, moduleCount: south.moduleCount, shadingCurve: curve(south, "south") },
    "east-west": {
      kwp: eastWest.kwp,
      moduleCount: eastWest.moduleCount,
      shadingCurve: curve(eastWest, "east-west"),
    },
  };

  const result = plan(profile, weather, { aedPerKwh: 0.21, escalation: 0.02, termYears: 25 }, override);
  const isEastWest = result.best?.sizing.layout === "east-west";
  const packed = isEastWest ? eastWest : south;
  const layout = isEastWest ? "east-west" : "south";
  const fill = packed.kwp > 0 ? Math.min(1, (result.best?.sizing.roofSolarKwp ?? 0) / packed.kwp) : 0;
  const rows = thinRows(packed.rows, fill);
  const shading = rows.length >= 2 ? rowShading(rows, location, weather, shadingOptions(layout)) : null;
  const shipped = override[layout]?.shadingCurve ?? [];

  let design: ElectricalDesign | null = null;
  const targetKwp = result.best?.sizing.roofSolarKwp ?? 0;
  if (targetKwp > 0 && packed.rows.length > 0) {
    const temps = DESIGN_TEMPERATURES[site.emirate];
    const module = MODULES[0];
    design = designElectrical({
      rows: packed.rows,
      module,
      inverter: chooseInverter(targetKwp, temps, module),
      temperatures: temps,
      plantAt: plantPositions(polygon).inverter,
      roof: polygon,
      moduleLimit: Math.max(1, Math.round((targetKwp * 1000) / module.watts)),
    });
  }

  return {
    ...verdict(site, result, blocked, hurdleYears),
    result,
    packed,
    polygon,
    shading,
    blocked,
    design,
    fill,
    fullRoofShading: shipped.length > 0 ? shipped[shipped.length - 1].loss : 0,
    weather,
    profile,
  };
};

/**
 * The verdict, and the reason for it in one sentence. Every branch here names
 * something a person can act on: a measurement to take, a rule that binds, or
 * a building next door that is not going anywhere.
 */
const verdict = (
  site: PortfolioSite,
  result: PlanResult,
  blocked: Outcome["blocked"],
  hurdleYears: number,
): { status: Outcome["status"]; headline: string; reason: string } => {
  const best = result.best;
  const structure = result.context.structure;

  if (structure.status === "not-viable" || structure.recommendedMounting === "blocked") {
    return {
      status: "stop",
      headline: "Roof cannot take it",
      reason: `${structure.headline} ${structure.detail}`,
    };
  }
  if (!best || best.sizing.roofSolarKwp <= 0) {
    return {
      status: "stop",
      headline: "Nothing worth building",
      reason:
        result.context.cap.capKw <= 0
          ? result.context.cap.explanation
          : result.infeasibility?.explanation ??
            "No system size pays back on this site's consumption and tariff. The building does not use enough power during daylight to be worth covering.",
    };
  }

  const payback = best.finance.simplePaybackYears;
  if (payback === null || payback > hurdleYears) {
    return {
      status: "stop",
      headline:
        payback === null
          ? "Never pays back"
          : `${payback.toFixed(1)} years, past your ${hurdleYears}-year limit`,
      reason:
        payback === null
          ? "Nothing here earns back its cost. The building draws too little during daylight to be worth covering."
          : `It would pay back eventually, and ${aed(best.finance.firstYearSavingsAed)} a year is real money, but not inside the ${hurdleYears} years this portfolio approves. The building is barely used during daylight, and solar is worth most when it is consumed on site: under Shams Dubai anything exported is credited against later bills and never paid out in cash.`,
    };
  }

  const shadeLoss = blocked?.arrayLossOfPoa ?? 0;
  if (shadeLoss > 0.08) {
    return {
      status: "warn",
      headline: `${num.format(best.sizing.roofSolarKwp)} kW · ${payback.toFixed(1)}y · heavily shaded`,
      reason: `${blocked!.taller} buildings within 400 m stand above this roof and take ${pct(shadeLoss)} of the year. It still pays back, but the shaded strip is worth leaving empty rather than filling.`,
    };
  }
  if (structure.status === "needs-evidence") {
    return {
      status: "warn",
      headline: `${num.format(best.sizing.roofSolarKwp)} kW · ${payback.toFixed(1)}y · check the roof`,
      reason: `${structure.headline} ${structure.detail}`,
    };
  }
  return {
    status: "good",
    headline: `${num.format(best.sizing.roofSolarKwp)} kW · pays back ${payback.toFixed(1)}y`,
    reason: `${aed(best.finance.firstYearSavingsAed)} off the first year's bill, from ${num.format(best.sizing.roofSolarKwp)} kW. ${best.bindingExplanation}`,
  };
};
