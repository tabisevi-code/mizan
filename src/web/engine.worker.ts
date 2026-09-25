/**
 * Engine worker. A full site takes most of a second on the main thread and a
 * portfolio runs several; offloading keeps the map responsive while the rail
 * fills in. Messages are plain data — the site record, the scene's buildings
 * and origin, and the portfolio's payback hurdle — and the reply is the
 * computed Outcome for that site.
 */

import { computeSite } from "./site-compute";

type Request = {
  portfolioId: string;
  hurdleYears: number;
  sceneOrigin: [number, number];
  buildings: import("./map").SceneBuilding[];
  site: import("../data/portfolios").PortfolioSite;
};

self.onmessage = (event: MessageEvent<Request>) => {
  const { site, buildings, sceneOrigin, hurdleYears, portfolioId } = event.data;
  try {
    const outcome = computeSite(site, buildings, sceneOrigin, hurdleYears);
    (self as unknown as Worker).postMessage({ portfolioId, siteId: site.id, outcome });
  } catch (error) {
    (self as unknown as Worker).postMessage({
      portfolioId,
      siteId: site.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
