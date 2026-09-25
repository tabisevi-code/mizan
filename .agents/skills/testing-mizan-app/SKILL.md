---
name: testing-mizan-app
description: How to build, launch, and drive the Mizan static screening page for end-to-end UI tests, plus console-error capture and headless engine pre-verification tricks.
---

# Testing the Mizan static app

## Build and launch
- Run `source /home/ubuntu/.nvm/nvm.sh` before any npm command.
- `npm run build` produces a self-contained `dist/page.html` (~400 kB). Open it directly via `file:///home/ubuntu/repos/mizan/dist/page.html` — no dev server is needed.
- Chrome for Testing lives at `/home/ubuntu/.local/bin/google-chrome` on display `:0`. Maximize with `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.
- OSM/Esri satellite tiles may or may not load depending on network; missing tiles are expected and not a failure. Everything else is bundled.

## Navigating the engine UI
- The app boots on `RENEWABLE_PORTFOLIOS[0]` ("Mapped UAE Energy Projects") which is NOT the engine rail. The per-site engine rail is reached via the top-right portfolio picker (name + "▾" button in the header) → pick an engine portfolio: "Khaleej Logistics" (7 sites), "Mina Cold Chain" (5), "Arjaan Estates" (6).
- Each rail site shows "working it out…" while computing, then resolves to a verdict line + colored dot (green = within limit, amber = needs evidence, red outline = ruled out). The tally row (within limit / needs evidence / ruled out) sums to the site count.
- The right panel has, in order: verdict headline+reason, KPI grid (or "Recommended system: none"), "Explore this site's energy mix" details, "How each number was reached" details, "What went in", "What this leans on" (the assumption register), "How far this can be trusted". Scroll the right aside to reach the lower blocks.

## Console-error capture that actually works
- The `browser_console` tool with a `content` script only returns that script's output — it does not dump the page's accumulated console log. To capture page errors, inject listeners first, re-drive the UI, then read the arrays:
  ```js
  window.__capErr=[];window.__capWarn=[];
  (()=>{const e=console.error.bind(console),w=console.warn.bind(console);
    console.error=(...a)=>{window.__capErr.push(a.map(String).join(" "));e(...a)};
    console.warn=(...a)=>{window.__capWarn.push(a.map(String).join(" "));w(...a)};
    window.addEventListener("error",ev=>window.__capErr.push("window.onerror: "+ev.message));
    window.addEventListener("unhandledrejection",ev=>window.__capErr.push("unhandledrejection: "+String(ev.reason)))})()
  ```
  Then e.g. switch portfolios in the picker to re-run every site computation, and read `window.__capErr`/`window.__capWarn`. A site-compute failure logs `console.error("site failed", siteId, ...)`.

## Headless engine pre-verification (very effective)
- Before clicking, enumerate expected outcomes headlessly: run `npx tsx` on a small script that imports `computeSite` from `src/web/site-compute.ts` and iterates every site in `src/data/portfolios.ts`, printing site id, verdict kind/headline, best system kWp, and the regulatory cap. That tells you exactly which site is the stop site and which caps to expect, so UI assertions are precise instead of exploratory.

## Dubai cap sanity numbers (DRRG slab rule)
- Rules: 100% of first 100 kW TCL, 75% of 100–200, 50% of 200–400, 25% of 400–600, 5% above; 1,000 kW plot ceiling.
- Expected: 1,200→355, 1,400→365, 1,100→350, 900→340, 1,500→370, 1,600→375, 60→60, 400→275. A "Recommended system" KPI above the slab result on a Dubai site is a regression.

## Devin secrets needed
- None — fully static, no auth, no backend.
