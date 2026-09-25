# Mizan — Devin engineering handoff

Prepared: **24 September 2026**. This document describes the working tree at handoff, including changes not yet committed. It is intended to let Devin continue development at the hackathon without reconstructing the earlier conversations.

## Contents

- [1. Read this first](#1-read-this-first)
- [2. Start, edit, build, and recover](#2-start-edit-build-and-recover)
- [3. Repository state and transfer precautions](#3-repository-state-and-transfer-precautions)
- [4. Complete component inventory](#4-complete-component-inventory)
- [5. Data model and units](#5-data-model-and-units)
- [6. Portfolio and dataset catalog](#6-portfolio-and-dataset-catalog)
- [7. UI, state, and rendering flow](#7-ui-state-and-rendering-flow)
- [8. Maps and geometry](#8-maps-and-geometry)
- [9. Detailed rooftop engineering path](#9-detailed-rooftop-engineering-path)
- [10. Monthly energy-mix path](#10-monthly-energy-mix-path)
- [11. Published energy and storage path](#11-published-energy-and-storage-path)
- [12. External services and network behavior](#12-external-services-and-network-behavior)
- [13. Known gaps, inconsistencies, and review targets](#13-known-gaps-inconsistencies-and-review-targets)
- [14. Tests and verified behavior](#14-tests-and-verified-behavior)
- [15. Hackathon demonstration sequence](#15-hackathon-demonstration-sequence)
- [16. Recommended next work, with acceptance criteria](#16-recommended-next-work-with-acceptance-criteria)
- [17. How to extend the system safely](#17-how-to-extend-the-system-safely)
- [18. Final handoff boundaries](#18-final-handoff-boundaries)

## 1. Read this first

Mizan is a **UAE renewable-energy screening and project exploration application**. It combines mapped sites, solar engineering, energy scenarios, investment screening, and source-linked examples. It is a TypeScript/Vite application with direct DOM rendering, not React, Next.js, or a full-stack SaaS product.

The user's priorities, in order of the recent requests, are:

1. Make the supplied static HTML concepts actually work in this repository.
2. Show useful projects instead of a list where everything fails the investment limit.
3. Use named companies and published project data, with assumptions identified.
4. Show identifiable buildings or energy assets on the map instead of anonymous regional pins.
5. Include non-solar energy: wind, biogas, and hydroelectric storage are now visible.
6. Preserve the existing rooftop design, wiring, and shading capabilities.

**Do not make results look viable by quietly changing investment hurdles, inventing meter data, or attaching a company's name to an unrelated roof.** Existing installations are examples, not available properties or verified investment offers.

### Current default experience

The app opens on **Mapped UAE Energy Projects**, with four sites:

- Aramex Dubai Logistics City: named warehouse footprint, published solar capacity and annual yield, editable financial screening assumptions.
- Al Rawabi: company map point, contextual building outlines, published solar and biogas capacities, interactive modeled generation.
- Masdar Al Halah: mapped wind turbine, published capacity, interactive capacity-factor scenario.
- DEWA Hatta: mapped lower-reservoir shoreline, published pumped-storage specifications, interactive charge/discharge energy calculation.

The important architectural distinction is that there are **three calculation paths**, not one unified optimizer:

| Path | Main entry | What it calculates | What it does not establish |
|---|---|---|---|
| Detailed rooftop planning | `main.ts` → `plan.ts` | Hourly solar/load/battery simulation, geometry, engineering, tariffs, lifecycle finance | Survey approval or real company meter consumption |
| Monthly energy-mix screening | `renewables.ts` → `renewable-combinations.ts` | Solar/wind/micro-hydro monthly output, shared load matching, simple payback | Hourly dispatch, full tariff billing, or lifecycle finance |
| Published project explorer | `published-energy.ts` in web and engine | Source-linked specifications, solar/wind/biogas output scenarios, separate storage cycles | Company savings, project payback, or a new-build recommendation |

Keep these boundaries visible in code and UI. A monthly result is not interchangeable with the rooftop planner's result.

## 2. Start, edit, build, and recover

### Fastest demo startup

From the repository root:

```bash
node serve.mjs
```

Open **http://localhost:4173/** or **http://127.0.0.1:4173/**.

This serves the already-built `dist/local.html`, using only Node built-ins. No dependency install is needed **if that built file has been transferred with the repository**. It does not compile changes or provide hot reload.

Important URL correction: with `serve.mjs`, `/dist/local.html` is **not** a route. Use `/`. An earlier conversation linked the longer URL because a Vite server was running at the time. `serve.mjs` serves `/` and `/index.html`; other non-API paths return 404.

### Development

```bash
npm install
npm run dev
```

Vite is configured for port 4173 and opens the browser. If that port is occupied, inspect which server is running; Vite can select another port, whereas the Node demo server will fail with `EADDRINUSE`.

Alternative demo port:

```bash
PORT=4174 node serve.mjs
```

The environment inspected at handoff had **Node v24.21.0** and **npm 11.19.0**. Node 24 is the safest reproduction target. `package.json` does not pin an engine version.

### Source-of-truth and generated files

- Edit **`src/web/shell.html`** for shared HTML and CSS.
- Edit **`src/web/main.ts`** and the other TypeScript modules for behavior.
- Do not hand-maintain root `index.html`; `scripts/build-shell.mjs` regenerates it.
- Do not edit bundled JavaScript in `dist/local.html`, `dist/page.html`, or `dist/assets/`.
- After source changes, run `npm run build` before using `serve.mjs`.
- During a running Vite session, edits to the shell may require `npm run shell`; predev only runs when starting the command.

### Commands

| Command | Behavior |
|---|---|
| `npm run dev` | Runs predev shell generation, then Vite development server |
| `npm run shell` | Regenerates root `index.html` from the shared shell |
| `npm run typecheck` | `tsc --noEmit`; strict TypeScript check for `src` |
| `npm test` | `tsx --test tests/*.test.ts`; Node's built-in test runner |
| `npm run build` | prebuild shell generation → Vite build → postbuild standalone page generation |
| `npm run page` | Rebuilds standalone `dist/page.html` and `dist/local.html` using installed Vite |
| `npm run serve` | Runs dependency-free Node demo server against `dist/local.html` |
| `npm run preview` | Vite production preview; do not assume development proxy behavior |
| `npm run demo` | Runs a sample site through the engine in the terminal |
| `npm run validate` | Compares PV output against the bundled 16-site PVGIS PVcalc reference |
| `npm run calibrate` | Recomputes/prints sunlight calibration comparisons using the bundled 32-site reference |
| `npm run bake` | Makes external data requests and writes `src/data/snapshots.json`; not a normal build step |

`validate` and `calibrate` use checked-in reference datasets; they do not need to download new reference data. `bake` does need network access and has integration caveats described below.

### Build artifacts

| Artifact | Purpose |
|---|---|
| `index.html` | Generated Vite development entry with `/src/web/main.ts` module script |
| `dist/index.html` | Vite production entry referencing hashed assets |
| `dist/assets/*.js` | Vite production bundle |
| `dist/page.html` | Shared shell fragment plus inline IIFE bundle; not a complete HTML document wrapper |
| `dist/local.html` | Complete standalone HTML document with inline application bundle; used by demo server |

`build-page.mjs` uses Vite's programmatic library build, IIFE format, `write: false`, ES2020 target, and esbuild minification. The normal Vite build targets ES2022. A previously hard-coded machine-specific bundler path was removed.

Standalone means application code and datasets are embedded. Satellite/street tiles and Google Fonts still use external services. Local vector geometry and calculations remain available without those requests.

## 3. Repository state and transfer precautions

At inspection:

- Branch: `main`.
- Last committed revision: `384235b` (`init: mizan`).
- Many working application changes, new datasets, new tests, and generated artifacts were **uncommitted**.
- `.gitignore`, README, build scripts, package metadata, UI sources, and engine exports also had working-tree changes.
- `pnpm-lock.yaml` and `pnpm-workspace.yaml` were present as untracked files. No npm lockfile was present in the inspected tree.
- `pnpm-workspace.yaml` contains an unfinished `allowBuilds.esbuild` setting with the text `set this to true or false`; do not assume pnpm installation is ready without resolving that deliberately.

**Do not transfer only the last commit and expect to have this implementation.** Commit the intended source/data/test changes or transfer the full relevant working tree. Do not upload `node_modules` as source. Include `dist/local.html` if the destination must demo without installing dependencies. Do not reset or discard unrelated user changes while preparing the transfer.

No deployment, PR, production hosting setup, account integration, or backend database has been created as part of this work.

## 4. Complete component inventory

### Root and tooling

| File | Responsibility |
|---|---|
| `package.json` | Project `mizan-uae-renewable-planner`, version 0.4.0; ES modules; scripts and development dependencies |
| `vite.config.ts` | Dev/preview ports, dev proxy routes, ES2022 production build target |
| `tsconfig.json` | Strict TypeScript, ES2022/DOM libraries, bundler resolution, no emit; includes `src` |
| `tsconfig.node.json` | Separate tooling TypeScript configuration |
| `serve.mjs` | Node HTTP server for standalone page and three external API proxies |
| `README.md` | Original overview; useful background but contains stale counts and live-feature claims |
| `DEVIN.md` | This working-tree handoff and current integration map |
| `scripts/build-shell.mjs` | Generates root development HTML from shell |
| `scripts/build-page.mjs` | Bundles standalone page without machine-specific paths |
| `scripts/demo.ts` | Programmatic example of using the planner |
| `scripts/bake.ts` | Attempts to fetch/capture weather and buildings for four study points |
| `scripts/calibrate.ts` | Cross-validation of monthly clearness estimates |
| `scripts/validate.ts` | End-to-end PV-yield reference comparison and module-wind calibration |

Dependencies are TypeScript, Vite, `tsx`, and Node type definitions. There is no React, charting package, GIS package, database client, AI SDK, or production application framework.

### Web modules

| File | Responsibility and integration status |
|---|---|
| `src/web/main.ts` | Active entry point; boot, picker, legacy site calculation/cache, verdicts, map/panel rendering, glossary/about sheets, mode routing |
| `src/web/shell.html` | All shared page markup and most styling; DOM IDs form a contract with renderers |
| `src/web/map.ts` | Legacy local-metre scene parsing and SVG area/roof/wiring/shading maps |
| `src/web/tiles.ts` | Esri/OSM tile placement, source attribution, load/error/retry UI |
| `src/web/project-map.ts` | New mapped-project view; auto-fit geometry, named building outlines, turbine/company symbols, reservoir polygon, links to OSM records |
| `src/web/renewable-workspace.ts` | Main rail/map/KPI/panel renderer for the newer renewable portfolios; routes published projects separately |
| `src/web/renewables.ts` | Monthly energy-mix controls, charts/tables, financial comparison, per-site session state, 12-example modal |
| `src/web/published-energy.ts` | Published data display and interactive wind/biogas/solar generation or storage-cycle scenarios |
| `src/web/live.ts` | Address search and live scene construction helpers; not wired into the current main UI |
| `src/web/tour.ts` | Guided-tour/focus state helpers; not initialized by the current main UI |

Do not describe live lookups or tour code as user-facing features merely because a file exists. Verify callers before claiming integration.

### Engine modules

| File | Responsibility |
|---|---|
| `types.ts` | Geography, site profiles, evidence ledger, provenance, technology screens, hourly series and result contracts |
| `solar.ts` | Solar geometry, clear-sky/weather model, irradiance transposition, module temperature, Huld efficiency, UAE calibration |
| `pv.ts` | Hourly PV AC simulation, named loss stack, specific yield and validation metadata |
| `capacity.ts` | Geographic polygon area, approximate usable area/array fit, row spacing/GCR |
| `packing.ts` | Actual panel rows within local-metre polygons, setbacks, clipping, placement, coordinate conversion |
| `electrical.ts` | Module/inverter catalog, temperature-dependent string sizing, wire paths, inverter allocation, cable bill of materials |
| `shading.ts` | Row shadows, bypass-diode effects, capacity-dependent shading curves, neighboring-building skyline losses |
| `load.ts` | Sector hourly load patterns, seasonal cooling adjustment, scaling to annual or monthly consumption |
| `tariff.ts` | DEWA/ADDC tariff selection, marginal rates, annual bill calculation |
| `rules.ts` | Per-emirate scheme assumptions, PV caps, structural screening, evidence-based technology screens |
| `battery.ts` | Hourly solar-surplus battery dispatch with losses and optional peak-window holdback |
| `finance.ts` | Capex, yearly cashflows, payback, NPV, IRR, LCOE, ownership/PPA comparison, avoided CO₂ |
| `uncertainty.ts` | Seeded Monte Carlo and one-factor sensitivity |
| `plan.ts` | Builds simulation context, enumerates size/layout/storage candidates, ranks by NPV |
| `renewable-combinations.ts` | Separate monthly multi-source calculation and simple financial model |
| `published-energy.ts` | Small pure helpers for capacity-factor output and storage-cycle energy accounting |
| `index.ts` | Barrel exports for most legacy modules and renewable combinations; not every module is re-exported |

### Connectors

| File | Responsibility |
|---|---|
| `src/connectors/pvgis.ts` | PVGIS v5.3 TMY fetch, UTC→UAE time rotation, weather snapshot serialization |
| `src/connectors/overpass.ts` | Building queries/parser, OSM attribution, Nominatim geocoding |

Neither connector is called from the current `main.ts` boot/site workflow. The running legacy UI explicitly uses `modelledWeatherYear`.

## 5. Data model and units

### Shared legacy contracts

`src/engine/types.ts` contains:

- `Provenance`: kind, label, optional URL, date, caveat.
- `Tracked<T>`: value, unit and provenance; the design vocabulary for attributable numbers.
- `SourceKind`: `user-evidence`, `dataset`, `authority`, `model`, `assumption`.
- `SiteProfile`: site/organization, emirate, customer class, sector, location, annual/monthly consumption, approved load, roof/ground rings, budget, construction, evidence ledger.
- `EvidenceLedger`: roof/structure/land/meter/approved-load evidence plus optional wind, biomass, hydro, tidal and geothermal resource inputs.
- `TechnologyId`: roof solar, ground solar, wind, biomass, hydro, tidal, geothermal, battery.
- `ScreenStatus`: eligible, needs-evidence, not-permitted, not-viable.
- `HourlySeries`: `Float64Array`, 8,760 values, local standard time, non-leap year.
- `SimulationResult`: generated/consumed/exported/imported energy, battery energy/cycles/losses/end-state, peak import and hourly arrays.

The newer interfaces do not yet apply `Tracked<T>` to every number. Most use explicit evidence text and source URLs. Provenance is a design aim, not complete type-enforced coverage.

### Newer contracts

`RenewableCase` in `portfolios-uae-multi.ts` contains:

- Identity, name, regional description, location, category.
- `annualKwh`, solar capacity, optional wind/profile, optional hydro capacity/head/monthly flows.
- Default selected sources and optional project URL.
- Optional solar monthly yield override or published annual output.
- Optional default tariff, solar cost override, evidence records.
- Optional map geometry/note.
- Optional `publishedEnergy`, which changes the rendering/financial behavior.

`RenewablePortfolioSite` adds `approvedLoadKw: number | null`. A null value means unknown, not zero and not permission to build. `RenewablePortfolio` holds identity, question, kind, hurdle and sites.

`PublishedEnergy` in `mapped-project-types.ts` contains:

- Assets with source `solar | wind | biogas`, published capacity, optional assumed capacity factor.
- Display metrics with labels/values.
- Optional storage power in MW, energy in MWh, round-trip efficiency as a fraction.

**Biogas belongs to this published-explorer asset union. It is not currently a `RenewableSource` in the monthly financial-combination engine.** Likewise, pumped storage is not smuggled into the micro-hydro generation source.

### Unit and geometry conventions

- kW = power; kWp = solar nameplate peak DC power.
- kWh = energy; MWh = kWh / 1,000; MW = kW / 1,000.
- Irradiation `kWh/m²` is not PV yield `kWh/kWp`.
- Capacity factors and efficiencies are fractions in calculations, percentages in inputs.
- Money is AED. Most engine inputs are unrounded; rounding is for display.
- `LatLng` objects use `{lat, lng}`.
- Geographic ring/feature arrays use **`[lng, lat]`**.
- Legacy engine `Ring` excludes the repeated closing vertex.
- New stored mapped polygons include their repeated closing vertex; point features contain one coordinate.
- `PolygonM` and packed rows are local metres, not degrees.
- The modeled calendar has 365 days, with month-hour totals matching 8,760.
- PV azimuth uses 0° south, +90° west, −90° east.

## 6. Portfolio and dataset catalog

### Main picker

The picker combines `RENEWABLE_PORTFOLIOS` first, then `PORTFOLIOS`. The first renewable portfolio is the default.

| Portfolio ID | Display name | Entries | Hurdle | Nature |
|---|---|---:|---:|---|
| `mapped-energy` | Mapped UAE Energy Projects | 4 | 5 years for financial screens | Named projects, mixed map geometries and technologies |
| `published-warehouses` | Published UAE Warehouses | 2 | 5 | Published capacities with explicit financial scenarios |
| `solar-only` | Inland Solar Focus | 3 | 5 | Illustrative industrial solar cases |
| `solar-wind` | Coastal + Wind Portfolio | 6 | 6 | Illustrative coastal solar/wind cases |
| `wind-only` | Wind Specialist (Rare Case) | 1 | 7 | Hypothetical Jebel Jais case |
| `solar-microhydro` | Wadi-Adjacent (Seasonal) | 2 | 7 | Hypothetical recoverable-flow cases |
| `khaleej` | Khaleej Logistics | 7 | 5 | Fictional operator, actual mapped buildings |
| `mina` | Mina Cold Chain | 5 | 6 | Fictional operator, actual mapped buildings |
| `arjaan` | Arjaan Estates | 6 | 6 | Fictional operator, actual mapped buildings |

There are **36 selectable entries**, not 36 unique verified companies or physical projects. Aramex deliberately appears in two portfolios with distinct IDs and independent session scenarios.

### Current named projects

#### Aramex, Dubai Logistics City

- IDs: `mapped-aramex`, `published-aramex`.
- Published installation: 3.2 MW solar; approximately 5 GWh/year; 9,000 panels; 38,000 m² roof area.
- The announcement forecasts 60% of the facility's power supplied by this system.
- Initial comparison consumption is **derived**, `5,000,000 / 0.60 ≈ 8.33 million kWh/year`; it is not a meter reading.
- Published annual solar yield is distributed across months using the existing modeled solar shape.
- Initial capex assumption: AED 2,500/kW; O&M: 1.5% of capex/year; avoided rate: AED 0.44/kWh.
- Initial modeled total capex: AED 8 million; net saving: AED 2.08 million/year; simple payback about 3.8 years.
- Named OSM warehouse: way **307805557**, bundled in `geometry/aramex.json`.
- The building outline does not prove exact panel positions or that every roof section carries the reported system.
- Existing historical capacity exceeding a modeled new-build scheme cap is not a waiver for a proposed new system.

Sources: [Aramex announcement](https://www2.aramex.com/ae/en/media-details/news/news-details?contentId=11826288-b3f2-659d-9310-ff0000e7fe0c&module=stories&page=16), [OSM building](https://www.openstreetmap.org/way/307805557).

#### IKEA Supply, DWC warehouse

- ID: `published-ikea`.
- ALEC documents a 3 MWp warehouse system completed in 2021.
- Published project details name SunPower modules, SMA inverters and robotic cleaning.
- Annual generation is modeled. Comparison consumption of 8 GWh/year is assumed.
- Uses the same initial tariff/cost/O&M scenario as Aramex; initial modeled payback about 3.7 years.
- Still has a **regional map**, not a verified warehouse footprint. It was not silently replaced with another nearby building.

Source: [ALEC project page](https://www.alecenergy.ae/project/shaper-house).

#### Al Rawabi, Al Khawaneej

- ID: `mapped-rawabi`.
- Company-reported 1 MW solar PV and 1.3 MW biogas plant, established in 2021.
- Reported treatment capacity up to 200 tonnes/day of organic waste; this is throughput, not generated electricity.
- RSB licence EG-03/2019 describes up to 1.3 MWac biogas CHP supplying the licensee's system.
- OSM company/farm point: node **3412128385**, at 25.2170472 N, 55.5290987 E.
- `geometry/rawabi.json`: company point plus eight nearby building outlines. Their operator is unverified; exact digesters/generators/solar roofs are **not individually located**.
- Explorer defaults to modeled solar plus **assumed 80%** biogas capacity factor.
- At 80%, biogas electricity is 9,110.4 MWh/year; at 40%, 4,555.2 MWh/year. These are arithmetic scenarios, not production reports.
- CHP thermal energy is excluded from electricity totals.
- No project capex/operating-cost/payback fiction is supplied.

Sources: [company sustainability](https://alrawabidairy.com/sustainability/), [RSB licence](https://rsbdubai.gov.ae/wp-content/uploads/2020/06/EG-03-2019-Al-Rawabi-Dairy-Co_web.pdf), [OSM company point](https://www.openstreetmap.org/node/3412128385).

#### Masdar, Al Halah wind

- ID: `mapped-halah`.
- Published capacity 4.5 MW, part of the UAE Wind Program inaugurated in October 2023.
- OSM turbine node **11361504560**, 25.4975118 N, 56.1519331 E, identifies Masdar and 4.5 MW.
- Defaults to **assumed 18%** capacity factor: 7,095.6 MWh/year.
- At 36%, the scenario doubles to 14,191.2 MWh/year.
- Monthly variations reflect month length only; no measured seasonal or hourly series is available.
- Symbol is a turbine point, not a building footprint or rotor-swept survey.
- Payback remains unassessed.

Sources: [Masdar announcement](https://masdar.ae/en/news/newsroom/khaled-bin-mohamed-bin-zayed-inaugurates-uae-wind-program), [OSM turbine](https://www.openstreetmap.org/node/11361504560).

#### DEWA, Hatta pumped storage

- ID: `mapped-hatta`.
- Published design: 250 MW discharge power, 1,500 MWh storage, 78.9% round-trip efficiency; approximately AED 1.42bn investment.
- Geometry is the **lower reservoir**, OSM way **863817702**. It is not the upper reservoir, powerhouse or project boundary.
- Full-cycle calculator: 1,500 MWh delivered, about 1,901.1 MWh charging, about 401.1 MWh losses, six hours at rated discharge power.
- 50% cycle: 750 MWh delivered and about 950.6 MWh charging.
- Calculator treats published storage capacity as deliverable energy, and states that assumption.
- No annual cycling schedule, charging price, dispatch optimization or payback is invented.
- Published January 2026 status described reliability verification expected to finish in Q1. That forecast is not treated as confirmation of commercial operation.

Sources: [DEWA project](https://www.dewa.gov.ae/en/about-us/strategic-initiatives/hatta-project), [dated January update](https://www.dewa.gov.ae/en/about-us/media-publications/latest-news/2026/1/dewas-projects-strengthen), [OSM reservoir](https://www.openstreetmap.org/way/863817702).

### Additional 12-example modal

`UAE_RENEWABLE_CASES` in `portfolios-uae-multi.ts` contains:

- `dic-solar`, `sharjah-solar`, `ajman-solar`.
- `jebel-ali-mix`, `ruwais-mix`, `fujairah-mix`, `khorfakkan-mix`, `rak-mix`.
- `sir-bani-yas`: published 14 MWp solar + 45 MW wind capacities; output/load/finance modeled or assumed.
- `delma`: published 27 MW wind capacity; output/load/finance modeled or assumed.
- `jais-wind`: hypothetical 300 kW research scenario.
- `wadi-ham`: hypothetical solar plus recoverable seasonal water flow.

The modal initially selects Sir Bani Yas. It is separate from the main mapped-project collection and does not include the biogas/storage explorer.

### Data files and provenance

| File | Contents / role |
|---|---|
| `portfolios.ts` | Three legacy portfolios, 18 site entries, glossary; fictional operator/account inputs attached to real scene geometries |
| `renewable-portfolios.ts` | Six newer portfolio registrations and shared portfolio/site types |
| `portfolios-uae-multi.ts` | Modal cases, `RenewableCase`, generic screening costs, `systemsForCase` |
| `published-warehouses.ts` | Aramex/IKEA published facts and benchmark financial scenarios |
| `mapped-energy-projects.ts` | Four default mapped projects and published specification/evidence records |
| `mapped-project-types.ts` | Geometry and published-energy contracts |
| `uae-monthly-profiles.ts` | Month hours, cached modeled solar yields, assumed regional wind factors |
| `osm-jafza.json` | Compact scene: 30 stored buildings, 45 roads |
| `osm-dic.json` | Compact scene: 26 stored buildings, 38 roads |
| `osm-business-bay.json` | Compact scene: 45 stored buildings, 59 roads |
| `pvgis-uae-monthly.json` | 32-site monthly reference dataset used for sunlight calibration |
| `pvgis-uae-pvcalc.json` | 16-site PVcalc reference used for PV-yield validation |
| `geometry/aramex.json` | Named warehouse polygon |
| `geometry/rawabi.json` | Company point plus contextual buildings |
| `geometry/halah.json` | Wind turbine point |
| `geometry/hatta.json` | Lower-reservoir shoreline polygon |
| `RENEWABLE_COMBINATIONS_GUIDE.md` | Monthly model guide with subsequent additions; opening/default-portfolio statements in early paragraphs are outdated |

Mapped geometry was retrieved 24 September 2026 from the OSM API and stored without contributor account metadata. Every feature retains its OSM ID and source URL. Attribution is **© OpenStreetMap contributors, ODbL**. Geometry is bundled so online Overpass availability is not required for the default demo.

The downloaded research intermediates and one-off geometry extraction script were in `/tmp`; do not depend on their survival or presence on Devin's machine. The normalized JSON in the repository is the deliverable. There is not yet a committed general-purpose refresh script for this new geometry collection.

## 7. UI, state, and rendering flow

### Shell and layout

The shell contains a header/picker, portfolio rail, center map, detail panel, source-example dialog, about sheet, and glossary sheet. Styling is a dark theme with gold solar accents, blue wind/maps, green status/hydro accents, and purple biogas in the published explorer. Inter and JetBrains Mono are loaded from Google Fonts with fallbacks.

Desktop uses the three-column composition. At narrow widths it stacks. Maps and charts are native HTML/SVG, not third-party map/chart widgets.

Important shared DOM IDs include `picker-btn`, `picker-menu`, `site-list`, `portfolio-question`, `rail-evidence-note`, `stage-title`, `stage-where`, `map`, `map-caption`, `map-attribution`, `views`, `base-sat`, `base-map`, `verdict`, `kpis`, `renewable-site`, `working-block`, `inputs-help`, `inputs`, `trust`, `renewable-dialog`, and the tally IDs. Renaming/removing them requires updating renderers.

### Main controller

`main.ts` holds legacy portfolio/site selection, selected map view, basemap, and optional newer renewable portfolio/site selection.

- `boot()` registers buttons/dialogs/menu/global resize and opens `RENEWABLE_PORTFOLIOS[0]`.
- `switchPortfolio()` selects the appropriate mode and starts legacy calculation if needed.
- `render()` dispatches to `renderRenewableWorkspace` or the original rail/stage/panel code.
- `computeAll()` processes legacy sites one at a time with `setTimeout(..., 0)` to allow painting.
- It checks that the requested portfolio/mode is still current before each queued calculation, preventing stale work from overwriting a newly selected mode.
- Legacy outcomes and scene parsing are cached in memory.
- Window resize triggers rerendering. There is no frontend router or URL-encoded scenario state.

### Monthly input state

`renewables.ts` keeps a module-level map keyed by site ID, containing selected sources, capacity overrides, tariff, annual load and per-source cost overrides.

- Numeric inputs respond to both `input` and `change`.
- Invalid/empty/non-finite values do not replace the last valid calculation.
- Capacities can be reduced from the configured design; original design capacity is the input maximum.
- Cost minimum is AED 1/kW; rate range is 0–2 AED/kWh; annual comparison consumption may be zero.
- Numeric updates replace calculated result/comparison/cost-note sections only, leaving the active input mounted and preserving disclosure state.
- Source changes rerender and restore focus.
- Workspace callback refreshes rail statuses, tallies, headline and KPIs from the same calculation.
- No selected sources produces a reversible empty state; toggles stay accessible.
- State survives switching examples/portfolios within the page, but resets on reload. It is not saved in localStorage or a backend.
- Legacy inline energy-mix comparisons deliberately do not change the original roof verdict/map.

### Published explorer state

`web/published-energy.ts` keeps a separate map of source-enabled flags, capacity factors and storage fraction.

- Published capacities are fixed; modeled source contribution can be enabled/disabled.
- Wind and biogas capacity-factor inputs accept 0–100%.
- Solar output uses the existing modeled yield at the site's location.
- Output shows per-source and combined annual totals, stacked monthly bars, legend and an exact-value table.
- Storage uses its own control/output rather than the generation chart.
- Inputs recalculate results without changing the published specification cards.
- Published project status stays **payback unassessed** regardless of a generation assumption.

### Verdicts

Legacy rooftop status considers structural blocking, whether a useful option exists, payback against portfolio hurdle, heavy neighbor shading (above 8%), and structure evidence.

Monthly portfolio status:

- Stop: empty/no output, no positive payback, or payback exceeding hurdle.
- Warn: illustrative case within hurdle but lacking resource evidence.
- Good: an evidence-bearing financial scenario within hurdle; headline explicitly says `(model)`.

Published-energy explorer status: warn/unassessed, with no fabricated financial calculation used as the verdict.

Green means within a financial screen, not approved to build. The shell legend was changed from “pays back, build it” to “within financial limit.” Evidence quality is not yet represented by a formal completeness score; presence of `evidence` is a coarse distinction in the monthly verdict.

## 8. Maps and geometry

### Legacy roof maps

`map.ts` decodes compact scenes:

- `o`: geographic origin `[lng, lat]`.
- `size`: local-metre extent.
- `b`: buildings with encoded polygon string `p`, area `a`, optional height `h`, height-source `hs`.
- `r`: roads with class code and encoded path.

Views are `area`, `roof`, `wiring`, `shading`. They display local mapped buildings/roads, selected roof, packed rows, cable strings/plant or per-panel shading as appropriate. These require legacy scene and engineering results.

### Mapped project maps

`projectMapBox()` derives an envelope from every feature, pads it, enforces a minimum 600 m width and a 1.6 aspect ratio. The renderer places tile imagery and an SVG overlay in the same local frame.

- Gold polygon: named building footprint.
- Grey polygon: contextual building, operator unverified.
- Blue turbine symbol: mapped turbine point.
- Green point: named company/farm location.
- Blue polygon: reservoir shoreline.
- Each feature is an accessible external link to its OSM record.
- A small legend sits at the bottom, rather than covering the center with a large location card.
- No pan/zoom GIS interaction or feature editing is implemented. Selection auto-fits the site.
- Mapped projects do not automatically gain the legacy roof/wiring/shading views. A stored footprint is not already a populated `Scene` plus equipment survey.

### Regional fallback maps

Cases without `mapGeometry` retain an approximate 4 km × 2.5 km regional map and coordinate marker. Their captions explicitly state no surveyed footprint is available. IKEA remains in this category.

### Tiles and failure behavior

`tiles.ts` chooses a Web Mercator zoom between 12 and 19, aiming for about 1,800 tile pixels across the requested extent. Sources:

- Satellite: Esri World Imagery (`server.arcgisonline.com`).
- Street map: `tile.openstreetmap.org`.

A loading message is shown. If all tiles fail or no tile has loaded after 12 seconds, the message offers retry and the other basemap. The first successful tile removes the notice. Partial tile failures are not separately reported. Retrying uses the existing basemap controls so selection and attribution remain synchronized.

The vector outlines/markers are bundled and remain visible without imagery. They are still community map data, not cadastral plans, structural drawings or current asset surveys.

## 9. Detailed rooftop engineering path

### Site preparation

`runSite()` in `main.ts`:

1. Resolves the site's scene/building index.
2. Converts geometry to a `SiteProfile` and derives location.
3. Builds a modeled weather year.
4. Packs south and east–west layouts.
5. Builds neighbor obstruction data if roof height is known.
6. Computes row-shading curves and combines them with neighbor loss.
7. Passes packed capacity/shading overrides into `plan()`.
8. Uses the selected option to generate thinning, shading and electrical drawings.
9. Stores the resulting `Outcome` in cache.

Legacy example evidence flags include assumptions: `hasApprovedLoadLetter` is set true and concrete roofs imply structural reserve in `profileFor()`. These are not uploaded documents. The surrounding UI says the operators/account values are illustrative, but some chips still read “Account” or “Stated”; improve this before treating legacy cases as verified customers.

### Solar position and weather (`solar.ts`)

The model includes solar declination, equation of time, local solar position, clear-sky GHI, diffuse fraction, incidence-angle modifier, and plane-of-array transposition. UAE time is UTC+4 without daylight saving.

The modeled year uses a calibrated monthly clearness model, location/latitude, and assumed monthly temperature/wind patterns. Calibration is based on PVGIS SARAH3 2018–2022 monthly reference data at 32 UAE coordinates. It is not a downloaded live TMY for each selected site.

Thermal/electrical performance uses mounting-dependent Faiman coefficients and Huld relative efficiency. Wind reaching the module is scaled by `WIND_AT_MODULE = 0.33`, a fitted parameter. Exports also include `CLEARNESS_FIT` and validation notes.

### PV output (`pv.ts`)

`simulateArray()` produces 8,760 AC values, annual energy, specific yield and named losses. Defaults:

| Parameter | Default |
|---|---:|
| Roof tilt | 10° |
| Ground tilt | 22° |
| DC/AC ratio used by planner | 1.2 |
| DC losses | 3% |
| Nominal inverter efficiency | 97.5% |
| Availability | 99% |
| Other losses | 3% |
| Degradation/year | 0.5% |
| Soiling accumulation/day | 0.35% |
| Cleaning interval | 21 days |
| Mean soiling loss at defaults | 3.675% |

Mean soiling is half the linear accumulation over a cleaning cycle, capped at 35%. Heat and weak light are modeled together rather than handled by a single arbitrary annual yield multiplier. Clipping is applied against inverter AC capacity.

Stored validation metadata reports about 1.09% annual yield mean absolute error against 16 PVGIS PVcalc sites, with worst case around 3.11%. These are model-to-model comparisons with matched assumptions, **not metered UAE installation validation**. Re-run validation after modifying the physical model rather than continuing to display stale accuracy figures.

### Area and packing (`capacity.ts`, `packing.ts`)

`capacity.ts` converts geographic polygon area to m² and estimates array fit from usable area, module dimensions, layout, tilt and winter-noon row spacing. Defaults include 30% rooftop obstruction allowance and 35% ground setback allowance.

`packing.ts` works in local metres and fits actual rows inside the roof:

- Default 1.5 m edge setback.
- 30% allowance for plant/skylights/walkways.
- 580 W modules, 1.134 × 2.278 m, 10° tilt.
- South or paired east–west layout.
- Polygon bounds/area, point-in-polygon, offset/setback handling, row clipping and local/geographic conversion.
- Plant/inverter positions are schematic geometry-derived locations, not surveyed equipment positions.

The approximate module dimensions in `capacity.ts` are slightly rounded relative to `packing.ts`; actual packed overrides are intended to take precedence. Do not accidentally use a rough area estimate when a valid detailed packed result is available.

### Shading (`shading.ts`)

Two distinct mechanisms:

1. **Row shading:** hourly geometric shading from the preceding row, with three bypass-diode cell groups turning small physical shadows into larger electrical loss. `thinRows` spreads reduced capacity across the roof. `shadingCurve` samples loss versus installed fill.
2. **Neighbor shading:** nearby outlines with known heights build an azimuth/elevation horizon against a directional sky-energy distribution. Only height above the subject roof matters. Main UI searches neighbors within 400 m.

Sky bins use 120 azimuth bins and 90 elevation bins. Unknown heights are counted rather than invented. Direct sunlight obstruction is modeled; diffuse sky-dome obstruction is not fully modeled. Row/neighbor losses are combined multiplicatively, `1 - (1-a)(1-b)`.

### Electrical design (`electrical.ts`)

Catalog:

- Modules: 580 W, 620 W and 450 W product classes.
- Inverters: 33 kW, 110 kW and 250 kW three-phase string inverter classes.
- Per-emirate design temperatures plus a temperate reference for comparison.

Key operations:

- Temperature-adjusted `Voc`, `Vmp`, `Isc`.
- Maximum modules/string from cold open-circuit voltage versus inverter DC ceiling.
- Minimum modules/string from hot maximum-power voltage versus full-power MPPT floor.
- Current/MPPT/string count and inverter power limits.
- Leapfrog module ordering, string grouping and paths.
- Home-run routing constrained to the roof.
- Cable lengths, areas, resistive losses and voltage-drop target (1%).
- Target DC/AC ratio 1.2; maximum string-step distance 5 m.

Current main workflow selects the first module class and chooses an inverter programmatically. Catalog presence does not mean the UI exposes full equipment selection. This is a screening/schematic design, not an approved construction package.

### Load (`load.ts`)

Archetypes: warehouse, cold-store, factory-2shift, factory-24h, office, retail and data-hall. Hourly weekday/weekend patterns are modified by cooling seasonality and scaled to annual kWh, or separately to supplied monthly totals. Runtime weekend logic uses Saturday/Sunday; an older type comment still says Friday/Saturday.

The browser does not currently provide interval-meter import or the complete `SiteProfile` editing experience. Engine support for an input is not evidence that the user can supply it in the current UI.

### Battery dispatch (`battery.ts`)

- Charge from surplus generation only; no grid charging.
- Discharge to unmet load, bounded by power, stored energy and reserve.
- Default round-trip efficiency 89%, depth of discharge 90%, reserve 0%.
- Efficiency is split using its square root on charge/discharge legs.
- Under time-of-use pricing, a simple three-hour lookahead can hold half the usable capacity for an approaching peak.
- Tracks final stored energy and losses so annual energy balance remains valid.

This is an explainable heuristic, not optimal dispatch or a resilience guarantee.

### Rules and technology screens (`rules.ts`)

The following are **what the code currently encodes**, not a fresh legal verification in this handoff:

- Dubai: approved-load cap, 2,080 kW plot cap, no ground-mounted Shams Dubai connection, AED 1,500 connection fee, indefinite export-credit metadata.
- Abu Dhabi: partially documented self-supply solar/battery policy, approved-load cap, unknown plot cap/export remuneration.
- Sharjah and northern emirates: partial/unverified scheme knowledge as identified in each `RuleSet`; no invented universal tariff.
- Structural screening distinguishes concrete, steel deck, sandwich panel and unknown construction. Indicative ballasted/railed loads are 15/7 kg/m². Lightweight mounting changes costs.
- Small wind requires hub-height evidence; a 5.5 m/s heuristic is used in the legacy screen.
- Biomass screen requires contracted feedstock and further study.
- Hydro screen uses head/flow potential with 68% efficiency; monthly demonstration hydro uses a separate 65% assumption.
- Tidal and geothermal have resource-evidence screens, not operational yield simulators.
- Battery evidence status depends on interval meter data.

A technology can be screened without being a sizing candidate in `plan()`. That planner enumerates solar and batteries, not a complete wind/biomass/hydro portfolio.

### Tariffs (`tariff.ts`)

Current encoded tariffs:

| Tariff | Rates / behavior |
|---|---|
| DEWA commercial | Monthly bands at 2,000 / 4,000 / 6,000 kWh: 0.23 / 0.28 / 0.32 / 0.38 AED/kWh |
| DEWA industrial | 0.23 through 10,000 kWh/month, then 0.38 |
| DEWA additions | 0.06 AED/kWh fuel surcharge, AED 35/month meter, 5% VAT |
| ADDC commercial | 0.20 AED/kWh, flagged VAT-included |
| ADDC industrial ≤1 MW | 0.286 AED/kWh, flagged VAT-included |
| ADDC industrial >1 MW | June–September 10:00–22:00 peak 0.366; otherwise 0.27 |

`selectTariff()` returns null when no matching tariff is supplied; it does not fill unsupported emirates with Dubai pricing. ADDC figures are explicitly from a 2025 page because the 2026 page was unreachable when entered.

`annualBill()` accumulates monthly imports and applies marginal rates, fixed charges and VAT. **Known approximation:** an entire hourly kWh block is priced at the slab applicable before that hour; an hour crossing a slab boundary is not split across bands. Add a boundary-crossing regression test before refining this.

Export-treatment fields describe policy, but the current planner computes savings from reduced imports and does not implement an export-credit bank/rollover settlement ledger. Do not claim full Shams Dubai credit accounting is implemented.

### Finance (`finance.ts`)

- Rooftop cost/kW tapers with system size using a logarithmic formula, with AED 2,400/kW floor; the formula can exceed AED 3,400/kW at very small sizes.
- Ground PV uses 90% of the comparable roof cost assumption.
- Battery capex: AED 1,100/kWh energy plus AED 900/kW power.
- Railed lightweight roof mounting receives a 1.15 cost factor in the planner.
- Defaults: 25-year analysis, 8% discount, 2% tariff escalation, 0.5% annual degradation, AED 55/kW/year O&M.
- Inverter replacement: year 12, AED 300/kW.
- Battery replacement: year 12, 50% of original battery capex.
- IRR uses bisection and returns null when the modeled range does not establish a sensible positive solution.
- LCOE uses discounted costs / discounted generation.
- Reported legacy “simple payback” is interpolated cumulative undiscounted cashflow recovery, including changing annual savings/O&M/replacements. It is not identical to the monthly engine's capex divided by year-one net saving.
- Main UI supplies a PPA scenario at AED 0.21/kWh, 2% escalation, 25-year term.
- Avoided CO₂ uses 0.4041 kg/kWh, a dated DEWA 2020 factor explicitly flagged as likely overstating current avoided emissions.

### Planner and uncertainty (`plan.ts`, `uncertainty.ts`)

`buildContext()` combines the site, weather, load, tariff, rule/structure screens, roof/ground fits, baseline bill, unit PV arrays and shading curves.

Candidate search:

- Two layouts: south and east–west.
- Roof capacity ladder: 0%, 25%, 50%, 75%, 100% of ceiling.
- Ground ladder: 0%, 50%, 100% of allowed fit.
- Battery energy ladder: 0%, 10%, 25%, 40% of daily load; battery power is half the selected kWh value.
- Reject combined capacity above cap and capex above budget.
- Rank remaining candidates by NPV.
- Re-evaluate the best sizing for uncertainty; the sizing is not re-optimized for each random draw.

Monte Carlo defaults to 250 seeded triangular draws. It reports P10/P50/P90 NPV, payback, savings, plus never-pays-back share. Sensitivity varies one factor at a time. Factors include yield, load, capex, O&M, tariff escalation and degradation.

These result objects exist even where the current UI does not display every chart or field.

## 10. Monthly energy-mix path

`systemsForCase()` creates source systems with capacity, monthly kWh per installed kW, capex per kW and annual O&M fraction.

Default generic assumptions:

| Source | Capex AED/kW | Annual O&M share |
|---|---:|---:|
| Solar | 3,000 | 1.5% |
| Wind | 6,500 | 3% |
| Micro-hydro | 12,000 | 4% |
| Geothermal cost placeholder | 20,000 | 4% |

Geothermal remains unavailable without resource data; the cost placeholder does not create a viable system. Warehouse examples override solar cost to AED 2,500/kW based on the midpoint of a historical 2024 benchmark, not a current quotation.

### Resource inputs

- `solarMonthlyYield(location)`: aggregate the existing modeled hourly PV output per kWp; cache by coordinates.
- Published Aramex annual output rescales the monthly shape to exactly its approximate annual baseline at original capacity.
- Wind factors are flat monthly assumptions: Jebel Ali 11%, Ruwais 14%, Fujairah/Khor Fakkan 13%, RAK 15%, Jais/Sir Bani Yas/Delma/Sila 20%, Al Halah 18%.
- Wadi Ham is hypothetical: 12 m head, 65% efficiency, Jan/Feb/Mar/Dec flows 0.04/0.03/0.01/0.02 m³/s, zero otherwise.
- Reducing turbine rating recomputes hydro yield, preserving the physical flow/head limit rather than simply multiplying the previous energy by capacity ratio.

### Equations

```text
wind kWh_month = rated kW × capacity factor × hours_month
hydro kW = min(rated kW, 9.81 × flow_m3_s × head_m × efficiency)
hydro kWh_month = hydro kW × hours_month
matched kWh_month = min(total generated kWh_month, load kWh_month)
gross savings = sum(matched kWh_month) × avoided AED/kWh
capex = sum(capacity_kW × assumed AED/kW)
annual O&M = sum(source capex × source O&M fraction)
net savings = gross savings − annual O&M
simple payback = capex / net savings, only when both are positive
```

The generic avoided tariff defaults to AED 0.30/kWh unless the case or user overrides it. Default monthly load is uniform power over month hours. The engine accepts 12 monthly readings if they sum to annual consumption, but the current numeric UI exposes annual consumption rather than a twelve-month editor.

Monthly savings are allocated proportionally among sources, preventing each source from independently claiming the same consumed kWh. Surplus earns zero revenue. Coverage is capped by matched load; total generation/load is a separate ratio that can exceed 100%.

Stability is `100 × max(0, 1 − CV)` of daily-average monthly output. Peak offset considers only non-flat output-rate profiles and uses circular month separation. A flat assumed wind factor does not establish a complementary seasonal peak. Neither statistic means hourly reliability or autonomy.

Validation rejects non-finite/negative values, non-12-month arrays, duplicate sources, and monthly yield exceeding nameplate-hours. Financial results use null rather than Infinity for no valid return.

The monthly model intentionally omits financing, tax, replacement, degradation and actual utility settlement. Its matching can overestimate self-consumption because it pools energy across a month. Keep the “optimistic ceiling” explanation visible.

### Published warehouse benchmark

The source for AED 2,500/kW is [MCC's distributed solar report](https://www.ipfa.org/wp-content/uploads/2025/01/Solar-report-from-MCC.pdf), using the midpoint of AED 2,400–2,600/kW in real 2024 prices. AED 0.44/kWh uses the September 2026 DEWA top slab plus fuel surcharge, excluding VAT. It assumes avoided units remain in that slab and the fuel rate persists. The input can be changed, but the model does not automatically apply slab crossing or inflation to the benchmark.

## 11. Published energy and storage path

`engine/published-energy.ts` deliberately contains no financial model:

- `capacityFactorMonthly(capacityKw, factor)` checks capacity/factor and returns 12 energy values.
- `storageCycle(storage, fraction)` returns delivered energy, required charging energy, energy loss and rated-power discharge duration.

```text
delivered MWh = storage MWh × discharged fraction
charging MWh = delivered MWh / round-trip efficiency
loss MWh = charging MWh − delivered MWh
discharge hours = delivered MWh / discharge MW
```

Al Rawabi and Al Halah use source-specific generation controls. Hatta has no generation assets and no `hydro` field in its site definition. Tests protect this distinction.

The shared case schema still requires an `annualKwh` value; published-energy cases use zero as an unused placeholder. **It must not be shown as measured zero consumption.** `renewable-workspace.ts` bypasses financial/load KPIs and replaces them with published specification cards for these cases.

## 12. External services and network behavior

| Service | Purpose | Current live UI usage |
|---|---|---|
| Esri World Imagery | Satellite tiles | Active |
| OSM raster tiles | Street basemap | Active |
| Google Fonts | Typography | Active external CSS/font requests |
| OSM API | Source of newly stored geometry | Research/import step; no request needed to render stored vectors |
| Overpass | Building queries | Connector/helper infrastructure; not current default UI flow |
| Nominatim | UAE place search | Connector/helper infrastructure; not current default UI flow |
| PVGIS | Typical meteorological year | Connector/bake infrastructure; current site rendering uses modeled weather |

Both Vite development config and `serve.mjs` provide:

- `/api/pvgis/*` → JRC `/api/v5_3/*`.
- `/api/overpass` → Overpass interpreter.
- `/api/geocode` → Nominatim search.

`serve.mjs` only serves the standalone page and these proxies. It is not a general static-file server or a production security-hardened backend. It has no authentication, request quotas, comprehensive timeout policy or persistent cache. The upstream hosts are fixed in the routing table.

PVGIS connector rotates UTC hourly data by four hours into UAE local time, requires at least 8,760 rows, and serializes snapshots with date/source information. Its browser requests use the local proxy; Node requests go directly to JRC.

The two OSM code paths differ: `connectors/overpass.ts` is proxy-aware, while `web/live.ts` currently requests public Nominatim/Overpass directly. Consolidate these if live search is activated.

No API keys or secrets are required for the present application.

## 13. Known gaps, inconsistencies, and review targets

These are important handoff findings. They are not all regressions introduced in the recent changes, and they were not fixed as part of writing this document.

### Integration and documentation

1. **Live search/TMY is not integrated.** README and some trust copy imply a local server makes measured weather arrive automatically. `main.ts` does not call the connectors and always creates modeled weather. Either wire the flow or correct those claims.
2. **Tour helpers are not main-UI features.** `tour.ts` exists but is not imported by the current main controller.
3. **Bake output is not consumed.** `scripts/bake.ts` writes `snapshots.json`; that file is not part of the inspected app imports. Baking alone does not alter default cases or weather.
4. **Overpass parser field mismatch.** `connectors/overpass.ts` expects `element.geom`; normal `out geom` Overpass JSON uses `geometry`, as the separate `web/live.ts` implementation expects. This likely explains empty parsed footprints on that connector path; add a recorded-response test before enabling it.
5. **README/guide counts and default names drifted.** Current default is mapped projects, main picker has nine portfolios, tests total 83, and bundled legacy scenes hold 101 buildings. Older references to 63/67 tests, other defaults or larger searched building totals should not be treated as current inventory.
6. **Package manager setup is not standardized.** Resolve the placeholder pnpm build setting and choose an intentional lockfile workflow before relying on reproducible clean installs.

### Calculation and evidence

7. **Legacy example evidence is partly asserted in code.** `profileFor()` sets an approved-load-letter flag and assumes concrete-roof structural reserve for examples. These are not real user evidence.
8. **Tariff boundary approximation.** Annual billing does not split an hourly quantity that crosses a monthly slab threshold.
9. **Export credits are metadata, not a settlement engine.** Do not equate ignoring cash export revenue with correctly implementing credit rollover.
10. **Rooftop planner and published historical capacities have different purposes.** Do not enforce current assumed new-build caps against a historical installed capacity by silently changing the published value; represent commissioning/regime evidence separately.
11. **Unknown legal or engineering evidence is not permission.** Screens and some prose contain dated assumptions; validate against primary sources before regulatory claims.
12. **Packed zero-capacity override deserves review.** `buildContext()` accepts a packed override only when its kWp is greater than zero. A genuinely unbuildable packed roof can therefore retain the rough area-derived fit. Add a regression for that case before changing behavior.
13. **Planner screens are not comprehensive hard gates.** Candidate enumeration is solar/battery-focused; the existence of `screenTechnologies()` does not mean every needs-evidence result prohibits scenario evaluation. Keep investment recommendation separate from technical scenario computation.
14. **Output label error in legacy working panel.** “Sunlight on the ground here” is populated from a unit array's annual AC kWh with an incomplete unit marker, not actual ground irradiation. Correct label/quantity together.
15. **Some legacy verdict explanations overgeneralize causes.** A failed hurdle does not necessarily prove insufficient daytime load; cost or other assumptions may cause it. Prefer an evidence-based binding reason.
16. **Emissions factor is stale.** The code explicitly flags the DEWA 2020 factor. Do not present avoided CO₂ as a current measured result.
17. **Biogas has no financial dispatch model.** Feedstock cost, parasitic consumption, CHP heat value, downtime and process limits are not modeled. The capacity-factor explorer is not a complete biogas feasibility study.
18. **Storage model is one cycle only.** No annual cycles, pump/turbine curve, head variation, price arbitrage, reservoir constraints or charge schedule is inferred.
19. **Financial models differ.** Monthly simple payback is not directly equivalent to legacy lifecycle cashflow recovery. Display model type when comparing results across modes.

### UX and mapping

20. **IKEA footprint is still missing.** Its regional location remains approximate.
21. **Al Rawabi equipment positions are unverified.** Eight contextual buildings must not be renamed as digesters, generators or owned buildings without evidence.
22. **No surveyed panel layout for Aramex.** Its visible outline is real OSM geometry; do not draw a fictional “as-built” solar layout and call it published.
23. **No persistence/export/import workflow.** Scenario edits disappear on reload. No user project CRUD, file upload, report download, CSV/GeoJSON export or share link is currently implemented.
24. **No GIS navigation toolkit.** Auto-fit maps have no implemented drag/zoom/draw interactions; point symbols are illustrative markers.
25. **Tile failure UI covers total failure, not partial gaps.** Cached vectors are reliable locally, but imagery can still fail on venue Wi-Fi.
26. **Full rerenders occur on resize/mode changes.** Site-state maps preserve values, but focus/scroll/disclosure behavior deserves regression coverage.
27. **No automated browser test suite.** Unit tests do not protect every DOM ID, picker flow, focus behavior or screenshot alignment.
28. **Geometry refresh is manual.** No committed refresh/import utility or central evidence validation pipeline yet exists for new mapped assets.

## 14. Tests and verified behavior

The latest functional implementation verification completed with:

- `npm run typecheck`: passed.
- `npm test`: **83 passed, 0 failed**.
- `npm run build`: passed, including standalone postbuild output.
- Browser checks against the local root URL.

Test distribution:

| File | Tests | Coverage |
|---|---:|---|
| `tests/engine.test.ts` | 67 | Solar geometry/yield, tariffs, rules, battery balance, finance, optimization, packing, wiring, shading and calibration behavior |
| `tests/renewables.test.ts` | 9 | Monthly energy conservation, no double-counted savings, seasonal mismatch, hydro, empty/invalid inputs, complementarity, case consistency |
| `tests/renewable-portfolios.test.ts` | 4 | Registered original groups, unique site IDs, source consistency, wind/hydro scenarios, published warehouse hurdle sensitivity |
| `tests/mapped-energy.test.ts` | 3 | Valid source-linked geometry and bounds, wind/biogas arithmetic, pumped-storage energy accounting and separation |

Manual browser checks performed during the implementation:

- Default picker opens mapped projects with four visible entries.
- Aramex gold outline visually aligns with the warehouse in satellite imagery.
- Hatta blue outline follows the lower reservoir; changing water level can make shoreline imagery differ.
- Raising Aramex cost from AED 2,500 to 5,000/kW changes payback from about 3.8 to 8.2 years and marks it past the unchanged limit.
- Zero comparison load produces no positive net saving.
- Biogas at 40% with solar disabled shows 4,555.2 MWh/year.
- Wind at 18% shows 7,095.6 MWh/year; 36% doubles it.
- Hatta at 100% shows 1,500 MWh delivered / 1,901.1 MWh charging; 50% halves both.
- Published source facts remain separate from changing scenario outputs.

In this Codex environment, `tsx` tests needed permission to create their IPC socket. That is a local sandbox issue, not an application requirement for elevated production privileges. Run normally on Devin's environment first.

Do not rerun external data downloads merely to validate a documentation or styling edit. For engine or data changes, run the relevant tests, typecheck, build, and a targeted browser check.

## 15. Hackathon demonstration sequence

1. Start the server at `/`; verify default portfolio says **Mapped UAE Energy Projects**.
2. Open Aramex. Show that the building outline is visible and linked to OSM. Explain that capacity/yield are published, while payback uses explicit assumptions.
3. Increase cost to demonstrate a genuine investment threshold crossing; restore the original value.
4. Open Al Rawabi. Point out solar plus biogas. Disable solar or change biogas capacity factor and show the recalculated monthly table.
5. Open Al Halah. Show the mapped turbine and the difference between 4.5 MW capacity and annual MWh under an assumed factor.
6. Open Hatta. Show the reservoir and why required charging energy exceeds returned energy. Do not describe it as free new generation.
7. Switch to a legacy portfolio such as Khaleej Logistics or Arjaan Estates. Show roof packing, wiring, and shading to demonstrate the deeper solar engineering capabilities.
8. Open **UAE energy mixes** for the extra 12 scenario examples, clearly distinguishing hypothetical cases from named published installations.
9. Explain evidence gaps and next steps rather than claiming every example is a validated investable deal.

For unreliable venue Wi-Fi, keep the prebuilt standalone file and stored geometry. Expect typography to fall back and online imagery to be unavailable; local outlines and calculations should still work. There is no service worker or offline tile cache.

## 16. Recommended next work, with acceptance criteria

These are suggested priorities, not claims that they are implemented or permission to publish changes externally.

### First: make the handoff reproducible

- Preserve/commit the working sources, datasets and tests.
- Settle the package-manager/lockfile configuration.
- Verify clean install, typecheck, tests, build, and demo server on the hackathon machine.
- Align README and visible trust copy with actual integration.

Acceptance: a new checkout plus documented install/build steps reproduces all nine portfolios and the default four mapped examples.

### Next: turn live site discovery into a real flow

- Consolidate duplicate geocoding/Overpass implementations.
- Fix/test Overpass response parsing with a saved genuine response fixture.
- Add address search UI with loading, no-results and network-failure states.
- Let the user choose a mapped building; do not assign the largest building automatically to a searched company.
- Preserve map provenance and operator-match confidence.

Acceptance: a user can search, select a visible footprint, review its source, and reach a site screen without invented company ownership.

### Next: connect actual weather and consumption evidence

- Add asynchronous PVGIS fetch with caching and request cancellation/stale-result guards.
- Ensure geometry, weather, timezone and scenario identity remain consistent.
- Add monthly bill/interval import with validation and clear fallback labeling.
- Update evidence chips only after the actual data has arrived and been used.

Acceptance: model provenance changes because the calculation actually uses the fetched/imported dataset; failures retain a labeled modeled fallback.

### Next: improve finance consistency

- Fix split-hour slab boundaries with tests.
- Implement explicit credit-banking/settlement if modeling it; keep exports unpaid in cash where appropriate.
- Make model type visible and avoid comparing annual-ratio payback with lifecycle payback as identical metrics.
- Separate existing-project facts from proposed new-build regulatory constraints.
- Obtain actual operating costs/feedstock/revenue assumptions before adding biogas/wind project finance.

Acceptance: every savings/payback display can be traced to a declared time resolution, tariff model, cost basis and evidence set.

### Next: improve usability and evidence portability

- Add scenario save/load, ideally with schema version and evidence dates.
- Add CSV/JSON/GeoJSON export and an evidence report.
- Add browser regression tests for picker/mode changes, map visibility, source toggles, empty/invalid inputs, numeric focus and mobile layout.
- Add properly sourced footprints for IKEA and verified equipment geometry for Al Rawabi if available.
- Keep source/geometry import tooling in the repository, rather than `/tmp`.

Acceptance: a scenario can be handed to another teammate with its inputs, geometry, sources, assumptions and model version intact.

## 17. How to extend the system safely

### Add a financial screening case

1. Add a `RenewableCase` or portfolio site with a globally unique ID.
2. Supply only actual available sources; attach published facts and assumption explanations separately.
3. Use the correct solar override semantics: per-kWp monthly shape versus whole-project annual kWh.
4. Register in `RENEWABLE_PORTFOLIOS` or the modal catalog as appropriate.
5. Keep unknown approved load null in the newer site schema.
6. Verify source systems, empty selections, capacity reduction, surplus and threshold behavior.
7. Do not change portfolio hurdle to manufacture a passing result.

### Add a published non-solar example

1. Add `publishedEnergy` with fixed source capacities and explicit scenario factors, or a storage definition.
2. Add source-linked metrics and dated evidence.
3. Do not use the required `annualKwh: 0` placeholder as a real load measurement.
4. Confirm `renewable-workspace.ts` routes it to the published explorer and leaves payback unassessed.
5. Extend source unions/labels/colors/calculators/tests together if introducing a new source.
6. Treat heat, fuel, electrical output, storage energy and power as distinct quantities.

### Add map geometry

1. Retrieve an authoritative or community map record with a stable ID and license.
2. Verify whether it identifies the operator, a building, a turbine point, or just a nearby feature.
3. Normalize to `[lng, lat]` and the local `ProjectMap` format.
4. Store retrieval date, attribution, feature label/type and source URL.
5. Add a precise `mapNote` describing what the geometry does and does not establish.
6. Test closed polygons, coordinates, bounds and visual alignment.
7. Never import a whole OSM response containing unnecessary contributor metadata just to draw a footprint.

### Change engineering defaults

Trace all affected layers: PV simulation, capacity estimate, exact packing, electrical catalog, shading options, finance and UI working text. These have related but separate constants. Updating one module's dimensions or loss factor does not automatically update every label or validation claim.

## 18. Final handoff boundaries

There is no authentication, billing, database, production deployment, document ingestion, AI reasoning service, automatic source refresh, permitting service, equipment procurement or real investment execution in this repository. The core value is a visible, explainable screening demo with source-linked examples and substantial local engineering calculations.

The strongest next iteration is to improve verified evidence and integration while preserving the distinction between **published facts**, **community mapping**, **modeled physics**, **scenario assumptions**, and **unknowns**.
