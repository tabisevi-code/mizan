# Mizan engine — improvement work order

Prepared: 25 September 2026. Companion to `DEVIN.md`, which describes the
system as built. This document lists concrete, review-verified changes to
`src/engine/`, ordered so cheap safe wins come first and riskier behavioural
changes come later. Hand this file to the agent doing the work; everything it
needs to know is here plus `DEVIN.md` §9 (detailed rooftop engineering path).

Baseline at handoff: `npm run typecheck` clean, `npm test` = 83 pass / 0 fail.

---

## 0. Rules of engagement — read before touching anything

1. **The engine is pure TypeScript.** `src/engine/` must never import from
   `src/web/` or `src/connectors/`. Inputs come in as arguments; outputs are
   plain data. Dependency direction is `web → engine`, `data → engine` — the
   reverse direction is one of the problems being fixed below.
2. **Provenance is a design rule, not a style.** Every number that reaches the
   UI carries a `Provenance` (`types.ts:10-33`). Any new constant needs a
   `kind`, `label`, `asOf`, and `caveat` where a reader could mistrust it.
3. **Comment style is explanatory, not decorative.** Comments in this codebase
   explain *why* a model choice was made and what it does NOT claim. Match that
   register; do not strip existing comments.
4. **House style:** `export const fn = (): T => {}` arrow functions,
   long explanatory doc-comments, data tables as typed consts. `types.ts` and
   most of the engine follow this; `renewable-combinations.ts` is the outlier
   (see §6).
5. **Do not change physics to make tests pass.** The engine is validated
   against PVGIS; see `ENGINE_VALIDATION` in `src/engine/pv.ts:104-118` and
   `CLEARNESS_FIT` in `src/engine/solar.ts:337-363`. If a change alters yield
   numbers, run `npm run validate` and report the new error figures rather
   than silently shipping different numbers. Changes that only restructure
   code (items 1-4 below) must produce byte-identical outputs.
6. **Known issues already logged** in `DEVIN.md` §13 (slab-boundary splitting,
   export credits being metadata not a settlement engine, packed-zero-override,
   TMY integration not wired, Overpass `geom`/`geometry` mismatch). Do not
   re-report them; do fix them only if you pick them up deliberately.
7. **One test per fix.** `tests/engine.test.ts` is the main file (67 tests);
   match its style — `node:test`, `assert/strict`, one behaviour per test name.
   All commands: `npm test`, `npm run typecheck`, `npm run build`.

---

## 1. Quick wins — pure refactor, outputs must not change

### 1.1 Hoist `totalModules` out of the hot loop — `src/engine/shading.ts`

`rowShading` line ~230 calls `totalModules(rows)` inside
`for hour → for row`, making the function O(8760 × rows²). It is a pure reduce
over `rows`; compute it once before the hour loop.

- **Change:** `const moduleTotal = totalModules(rows);` above the loop; use it
  in the `monthLost[month] += ...` line.
- **Also:** `monthOfHourIndex()` is rebuilt on every `rowShading` call. Make it
  a module-level `const MONTH_OF_HOUR = monthOfHourIndex()` — or better, fold
  it into the shared calendar from §2.
- **Acceptance:** all shading tests still pass unchanged ("the front row and
  any row with a double gap are never shaded", "thinning to half the rows…",
  etc., `tests/engine.test.ts` lines ~905-1100). No behavioural change.

### 1.2 Dead code and unused symbols

- `src/engine/packing.ts` (~line 247): `rowIndex` is incremented in the
  `packRoof` loop and never read. Remove it.
- `src/engine/pv.ts:14`: `monthOfHour` imported but never used. Remove from
  the import.
- `src/engine/electrical.ts` (~line 513): the `return` after `chooseCable`'s
  `for` loop is unreachable — the loop always returns on the last size. Remove
  it and let the compiler prove the loop is exhaustive.
- `src/engine/pv.ts` (~line 162, 228): `poaKwhPerM2` is accumulated and never
  returned. Either expose it on `PvSimulation` (it is useful for the report —
  in-plane irradiation is what validation compares) or delete the accumulator.
  Prefer exposing it; update the return type and the early return at ~line 146.
- `src/engine/electrical.ts` (~line 573-583): the keep-ratio thinning loop
  duplicates `thinRows` in `shading.ts:285`. Call `thinRows` instead — it is
  the same algorithm, and the comment there says the wiring uses the same rule
  on purpose.
- **Acceptance:** typecheck + tests green; identical outputs.

### 1.3 Name the screening thresholds — `src/engine/rules.ts`

Magic numbers in `screenTechnologies` (~lines 280, 300, 321, 339, 356, 371,
389): 200 m² minimum roof, 1,000 m² minimum land, 5.5 m/s wind viability,
1.5 tpd biomass feedstock, 5 kW hydro, 10 kW tidal, geoIndex 0.45. Lift them to
a named `SCREEN_THRESHOLDS` const with a one-line basis comment each, so a
reviewer can find and challenge them. Behaviour unchanged.

---

## 2. Shared calendar — fixes a real inconsistency, small risk

Month-of-year math is implemented **five times** today:
`solar.ts:400` (`monthOfHour`), `load.ts:117` (`monthOf`), `tariff.ts:182`
(`monthIndex`), `battery.ts:42` (inline in `isPeakHour`), `shading.ts:84`
(`monthOfHourIndex`). `MONTH_LENGTHS` is duplicated in four files and `DEG` in
four more.

- **Change:** create `src/engine/calendar.ts` exporting `MONTH_LENGTHS`,
  `monthOfHour(hourOfYear): 0-11`, `MONTH_OF_HOUR` (precomputed Uint8Array),
  and `dayOfYearFromHour`. Point all five call sites at it; delete the local
  copies. Export it from `index.ts`.
- **Also fix the weekend bug** in `load.ts:132-135` while you are there:
  `isWeekend` returns `dayIndex === 5 || 6` with `firstDayOffset = 4` (Jan 1 =
  Thursday), i.e. **Friday + Saturday**. Its own comment claims
  "Saturday/Sunday are treated as the weekend". Decide deliberately: the UAE
  statutory weekend since 2022 is Sat–Sun with Friday a half-day for the
  public sector; private-sector industrial sites commonly work Saturday.
  Reasonable model: `weekend` = Saturday + Sunday full, and add a
  `fridayHalfDay` derating (e.g. apply the weekend shape after 13:00 on
  Friday) OR keep Fri+Sat but fix the comment to say so. Whichever you pick,
  make comment and code agree and add a test pinning the day-of-week mapping
  (e.g. hour 0 = Thursday is a weekday; hour = 24 (Friday) matches the chosen
  rule).
- **Acceptance:** tests green except load-shape tests if the weekend model
  changes — update them with justification in the test comment. Output changes
  here are *expected and intended* but should be small (a few % of annual
  load moves between weekday and weekend shape).

## 3. Correctness fixes

### 3.1 `shrinkPolygon` mitre check uses the wrong vertex — `packing.ts:177`

`shrinkPolygon` builds `moved` by skipping zero-length edges, then tests each
mitre corner's `reach` against `polygon[i % polygon.length]`. When any edge was
skipped, `moved[i]` no longer corresponds to `polygon[i]`, so the distance is
measured to the wrong vertex and the MITRE_LIMIT can be applied at the wrong
corner.

- **Change:** carry the original vertex index alongside `{at, dir}` when
  building `moved` (the corner between edge i-1 and edge i is vertex i of the
  original ring), and test `reach` against that vertex.
- **Test:** a polygon containing a duplicated vertex (zero-length edge)
  followed by a sharp corner — assert the offset corner is bevelled at the
  right place, not at the shifted index.

### 3.2 Clamp DNI — `solar.ts:183`

`transpose` computes `dni = beamHorizontal / max(cosZenith, 1e-3)`. With the
modelled Haurwitz year this is safe, but with a real PVGIS TMY series a bright
near-horizon hour (high GHI at ~0° sun) yields unphysical DNI and a
multi-kWh single-hour spike that corrupts the hourly shape and clipping
accounting.

- **Change:** cap `dni` at the extraterrestrial normal for that hour —
  `dni = Math.min(dni, SOLAR_CONSTANT * eccentricity)` (compute the
  eccentricity factor already used in `extraterrestrialHorizontal`, or clamp
  at ~1367 W/m² flat with a comment). Physical DNI cannot exceed the
  extraterrestrial value; anything higher is a measurement artefact.
- **Risk:** this can shift PVGIS-TMY-modeled yields slightly. Run
  `npm run validate` afterwards; if `ENGINE_VALIDATION` numbers move, update
  them in `pv.ts:104` with the new `checkedOn` date and note it.
- **Test:** feed a synthetic weather year with `ghi = 300 W/m²` at an hour
  where `cosZenith ≈ 0.001`; assert `transpose` output stays under
  ~1,500 W/m² effective.

### 3.3 Missing upper MPPT-window check — `electrical.ts` `sizeString`

The string design checks Voc(cold) against `maxSystemVdc` and Vmp(hot) against
`mpptFullPowerMinV`, but never verifies Vmp at the *cold* end stays under
`mpptMaxV`. Today's catalogue lands inside by ~10%, but nothing enforces it.

- **Change:** compute `vmpColdV = vmpAt(module, temperatures.recordLowC)` (or a
  design-point cell temperature near ambient — state which), derive
  `stringVmpColdV = modulesPerString * vmpColdV`, add it to `StringSizing`,
  and push a `notes` entry when it exceeds `mpptMaxV` (flag as
  `feasible`-adjacent warning — a tracker can see over-window voltage without
  damage but will stop tracking).
- **Test:** construct a module/inverter pair where the cold Vmp exceeds
  `mpptMaxV` and assert the note appears.

### 3.4 `selectTariff` should use approved load, not modelled peak — `plan.ts:206`, `tariff.ts:162`

The >1 MW ADDC threshold is currently fed `load.peakKw`, computed from a
smooth sector shape that understates real demand peaks. `site.approvedLoadKw`
is the contracted figure on the account — a better and more defensible signal.

- **Change:** `peakDemandKw: site.approvedLoadKw ?? load.peakKw`.
- **Test:** a site with `approvedLoadKw = 1200` and a small smooth load shape
  must get `addc-industrial-over-1mw`.

### 3.5 `neighbourObstructions` reach filter uses vertices, not edges — `shading.ts:618`

Each candidate ring is culled if all its *vertices* are beyond `reachM`. A
large footprint (district podium, estate polygon) can have all vertices >400 m
away yet pass within metres of the roof — or enclose it. Use the existing
`distanceToEdge`-style point-to-segment distance instead of vertex distance.
`packing.ts` already has `distanceToSegment`; reuse it on the ring's edges.

- **Test:** a huge square ring centred on the roof with vertices 1 km away and
  sides passing 50 m away must be `considered`, not culled.

### 3.6 Short-string MPPT assignment can silently collide — `electrical.ts:672`

The formula `Math.ceil(fullHere / sizing.stringsPerMppt) + (slot - fullHere)`
assumes each inverter's short strings occupy tracker inputs after its full
strings. Non-uniform distributions can give a short string the same `mppt`
index as a pair of full strings on that inverter — exactly the conflict the
comments say is avoided. The existing warning only fires when the *max* index
exceeds `mpptCount`, so a silent share is possible.

- **Change:** after assigning, group strings per inverter by `mppt` and assert
  no input carries strings of differing length. If detected, bump the short
  string to the next free index; if none exists, warn.
- **Test:** a layout producing a collision (you may need uneven row lengths so
  stretch-breaks create odd string counts) — assert either a unique index or
  an explicit warning.

---

## 4. Functional gaps

### 4.1 No tariff → empty plan for 5 of 7 emirates — `tariff.ts`, `plan.ts:412`

`TARIFFS` covers only DEWA (Dubai) and ADDC (Abu Dhabi). For Sharjah, Ajman,
UAQ, RAK and Fujairah, `selectTariff` returns `null`, `evaluateSizing` returns
`null`, and `plan()` returns zero options with no machine-readable reason.
SEWA and EtihadWE do publish commercial rates.

Two acceptable scopes; pick deliberately and say which you did:

- **Minimal:** add a `planUnavailableReason` field to `PlanResult` (e.g.
  `"no-tariff"`) so the UI can say "no published tariff modelled for Sharjah"
  instead of showing nothing, and keep returning context (screens, cap,
  yield) which today works fine.
- **Full:** add SEWA and EtihadWE commercial tariffs to `TARIFFS` with proper
  `Provenance` (authority, URL, asOf date, caveat), including export
  treatment where published (EtihadWE credit expires annually — already
  reflected in `rules.ts`). Verify rates against the utilities' current pages
  before transcribing; stale numbers are worse than missing ones.
- **Test:** a Sharjah site produces either a populated `options` list (full
  scope) or `planUnavailableReason === "no-tariff"` with non-empty `context`
  (minimal scope).

### 4.2 Engine-level facade — new entry point in `plan.ts` or a new `analyze.ts`

Today `src/web/main.ts` (~lines 150-220) performs the whole orchestration:
`packRoof` → `shadingCurve` → `CapacityOverride` → `plan` → `designElectrical`
with `moduleLimit`. `scripts/demo.ts:53` calls `plan(site)` *without* the
packed override, so the demo silently uses the area×GCR estimate — different
numbers from what the app shows for the same site.

- **Change:** export `analyzeRoof(site, polygonM, opts?)` from the engine that
  packs both layouts, builds shading curves, calls `plan` with the override,
  and returns `{ plan: PlanResult, packed: {south, eastWest}, override }` —
  the same bundle `main.ts` currently assembles. Migrate `main.ts` and
  `demo.ts` to it.
- **Constraint:** keep `plan()`'s signature unchanged for tests, or update
  tests accordingly. `buildSkyEnergy`/`obstructionShading` may stay in the web
  layer (they need neighbour data) — the facade covers packing + shading +
  planning.
- **Test:** `analyzeRoof` on the demo-site rectangle returns
  `best.sizing.roofSolarKwp ≤ packed capacity` and a non-empty shading curve.

### 4.3 Layering: engine imports from `src/data`

`renewable-combinations.ts:1` and `published-energy.ts:2` import `MONTH_HOURS`
and types from `../data/`. Move `MONTH_HOURS` into `calendar.ts` (§2) and the
`RenewableSource` type into `types.ts` (or declare it in the engine file and
have data import it), so `src/engine` has zero upward dependencies. Update
`src/data/uae-monthly-profiles.ts` and `mapped-project-types.ts` to import
from the engine instead. Typecheck will find every call site.

### 4.4 Main-thread planning — consider a Web Worker

`main.ts:198` calls `plan()` synchronously: ~120 candidate evaluations, then
250 Monte Carlo runs and 13 sensitivity evals, each ~2×8,760 inner steps, plus
the packing/shading passes above. After §5's caching this is lighter but still
a multi-hundred-ms block. Options: (a) move `analyzeRoof` into a worker —
natural once §4.2 exists; (b) chunk candidate evaluation with `await` yields;
(c) leave as-is but measure and document. Do not ship (a) without confirming
the Vite build bundles the worker correctly (`vite build` + manual check in
`dist/local.html`).

---

## 5. Performance: cache the solar year

`solarPosition(site, hour)` is recomputed inside `modelledWeatherYear`, every
`simulateArray` (4× per `buildContext`), every `rowShading` (4+ per shading
curve ×2 layouts), `buildSkyEnergy`, and display shading — ~90k calls/site of
~15 trig ops each. `transpose` is similarly repeated.

- **Change:** add a `SolarYear` type = precomputed
  `{ position: SolarPosition[], extraHorizontal: Float64Array }` for the 8,760
  hours, built once per site; thread it through `simulateArray`, `rowShading`,
  `buildSkyEnergy`, `modelledWeatherYear` as an optional parameter defaulting
  to per-call computation (keeps tests and external callers working). Have
  `buildContext`/`analyzeRoof` build it once and share it.
- **Alternative cheaper version:** memoise `solarPosition` on a
  `WeakMap<LatLng-ish key>` keyed by site — less invasive, slightly less
  explicit. Either is fine; the point is one computation per site per hour.
- **Acceptance:** outputs identical (same functions, same order); plan
  duration measurably lower. Add a `console.time` or `Date.now` probe in
  `scripts/demo.ts` if you want a rough before/after figure in the commit
  message — do not leave timing code in.

---

## 6. Consistency and modelling cleanups (lower priority)

- **`renewable-combinations.ts` / `published-energy.ts` style.** They use
  `function` declarations, terse inline types, and `throw` for validation
  while the rest of the engine uses arrow consts and result objects. Decide:
  conform them to house style, or move them under `src/engine/monthly/` with a
  header comment stating the monthly path is intentionally a different,
  simpler model (per `DEVIN.md` §10 — monthly matching is an optimistic
  ceiling, not dispatch). At minimum, add a file-level doc comment to
  `renewable-combinations.ts` saying so — it currently has none.
- **Finance asymmetries — `finance.ts`.** (a) O&M never inflates while savings
  escalate at `tariffEscalation` — add an `omEscalation` assumption (default
  equal to tariff escalation or CPI ~2%) or a comment justifying flat O&M.
  (b) Capex and O&M carry no VAT while the bill savings they offset are
  VAT-inclusive — either apply `vatRate` to capex or document the choice.
  Changes alter `evaluateFinance` outputs: update the IRR/payback tests'
  expected numbers honestly rather than loosening them.
- **O&M constant duplication:** `omAedPerKwYear: 55` lives in
  `DEFAULT_FINANCE` but `plan.ts:374` hardcodes `55 * factors.omFactor` —
  reference `DEFAULT_FINANCE.omAedPerKwYear` instead.
- **Electrical BOM → capex disconnect.** `designElectrical` produces cable
  metres/cross-sections/inverter counts that `buildCapex` ignores — two
  layouts with wildly different BOS cost the same. Either pass a summarised
  BOM into `buildCapex` (cable AED/m by cross-section, per-inverter installed
  cost, both with `Provenance`) or add a `COST_SOURCE.caveat` line stating
  BOS is inside the flat AED/kW rate.
- **`ladder()` refinement — `plan.ts:148`.** The 0/25/50/75/100% rungs can step
  over the NPV optimum. After ranking, re-evaluate at ±½ rung around the best
  option and keep the better one. Cheap; add a test where the optimum sits
  between rungs (e.g. self-consumption cliff).
- **`battery.ts` holdback magic numbers:** `usableKwh * 0.5` and the `hour + 3`
  lookahead deserve named constants and a one-line justification each.
- **`isPeakHour` vs `marginalRate`:** once `calendar.ts` exists, export a
  single `inToUWindow(tariff, hourOfYear)` used by both `battery.ts` and
  `tariff.ts` — they currently implement the same check twice.

---

## 7. Suggested test additions (beyond the per-fix tests above)

- Battery TOU holdback: on the `addc-industrial-over-1mw` tariff, a battery
  dispatched in June must retain ≥ ~50% usable charge entering the 10:00 peak
  window.
- `shrinkPolygon` on an L-shaped outline with a notch narrower than
  2× setback — assert no kept corner lies inside the notch.
- `plan()` on a no-tariff emirate (see §4.1).
- `percentile`/`monteCarlo` determinism: two calls with the same seed produce
  identical bands.

---

## 8. Work order

1. §1 (all) — pure refactors, verify identical output.
2. §2 calendar extraction + weekend fix.
3. §3 correctness fixes (3.1–3.6), each with its test.
4. §5 solar-year cache.
5. §4.1 minimal scope, then full scope if rates are verified.
6. §4.2 facade + §4.3 layering.
7. §6 cleanups as time permits; §4.4 worker last and only with build
   verification.

After each step: `npm test && npm run typecheck`. Before finishing:
`npm run build` and, if any physics-adjacent line changed (`solar.ts`,
`pv.ts`, `shading.ts` numerics), `npm run validate` and reconcile
`ENGINE_VALIDATION`. Do not commit `dist/` artifacts unless the repo's normal
flow (`npm run build` → `build-page.mjs --local`) produced them.
