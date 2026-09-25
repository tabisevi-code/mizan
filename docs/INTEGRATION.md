# Mizan — three-version integration

Written before any merge work, as the spec requires. Kept in the repo so the
reasoning behind the final tree is auditable.

## The three versions

| | Branch (frozen) | Origin | Head | Typecheck / tests at handoff |
|---|---|---|---|---|
| **A** | `version-a-custom-site` | `mizan-main (2).zip` | `eeabdb7` | clean / 83 pass (once `pdfjs-dist` is installed) |
| **B** | `main` | PR #11 engine upgrade + folded scan remediation | `694f155` | clean / 97 pass |
| **C** | `engine` | "engine improvements and pdf generation" | `da0a06d` | clean / 102 pass (once `jspdf` is installed) |

All three fork from `178e992` ("implement wind energy & add more samples").
None of them has seen the others. Nothing is deleted: the two side branches
stay on the remote untouched; `final-integration` is cut from `main`.

## What each one is

**A — the company-facing flow.** "+ Analyze your own site" in the rail opens a
dialog: manual entry or multi-file upload (PDF via lazily loaded pdf.js, plus
TXT/CSV/MD). A deterministic regex extractor (`engine/extract.ts`) pulls name,
address, emirate, annual/monthly kWh, approved load, roof area/type, building
type, each tagged found / needs-confirmation / not-found with the document and
page it came from; conflicting documents are surfaced for the user to pick.
Nothing enters an analysis until confirmed. The confirmed site becomes a
`RenewableCase` shown in the energy-mix dialog, which A extended with a
recommendation card (`engine/recommend.ts`: a small explainable solar × turbine
search, legal items per emirate, "ruled out" reasons, evidence still needed).
A also replaced the flat regional wind capacity factors with a real wind model
(`engine/wind.ts`): Global Wind Atlas level + ERA5 monthly Weibull shape,
temperature and pressure → air density, derived turbine power curves for three
archetypes, 15 sampled UAE climate points (`data/wind-uae.json`, fetched by
`scripts/fetch-wind.ts`). It independently found and fixed the DEWA DRRG slab
cap, and adds the EtihadWE 10 %-of-approved-load / 1 MW-per-unit rule. Ships a
demo PDF, `DEMO.md`, `SOURCES.md`, and a UI-testing skill.

**B — the engine upgrade (current `main`).** DRRG v4.1 slab cap (table-driven),
Dubai off-grid prohibition, Abu Dhabi DoE export/net-metering restrictions,
EtihadWE + SEWA tariffs so all seven emirates price a kWh, a baked NASA POWER
20-year climatology grid (130 points) with measured-GHI blending, wind shear +
Rayleigh CF from NASA 50 m wind, the measured Al Ain soiling curve, a
constrained planner with named binding constraints and quantified
infeasibility, a Web Worker so the map never freezes, a parser-first bill
intake + guided questionnaire (`engine/intake.ts`), corporate-tax handling,
P50/P90 bands, own-vs-PPA, and the on-screen assumption/provenance register.
Validated against PVGIS (0.26 % bias, 1.51 % MAE). E2E-tested in Chrome.

**C — the engineering work order.** Executes `docs/ENGINE_IMPROVEMENTS.md` (moved from the root): shared
`calendar.ts` (five duplicate month-of-hour implementations collapsed, weekend
mapping made deliberate and tested), `SolarYear` cache (sun positions computed
once per site), `analyzeRoof` facade so app, demo script and tests run the
same pipeline, DNI clamp at extraterrestrial, `shrinkPolygon` mitre-index fix,
cold-end MPPT window check, MPPT input collision detection,
`neighbourObstructions` edge-distance culling, `selectTariff` on approved load,
O&M escalation, VAT basis caveat, `SCREEN_THRESHOLDS`, half-rung ladder
refinement, engine/data layering fix (`RenewableSource` into `types.ts`),
`planUnavailableReason`. Adds a structured `SiteReport` (JSON) and an A4 PDF
rendering via lazily imported jsPDF, with two download buttons in the panel.
19 new tests in `tests/improvements.test.ts`.

## Comparison

| Subsystem | A | B (main) | C (engine) | Decision |
|---|---|---|---|---|
| Architecture | web + engine + data, sync | same + Web Worker + `site-compute.ts` | same + `analyzeRoof` facade + `SolarYear` cache | **B base**; C's facade and cache slot under B's `site-compute.ts` (MERGE) |
| Build / deploy | Vite multi-file + single-file page; pdf.js worker breaks under single-file | single-file page 400 kB, verified | single-file page 1 MB (jsPDF inlined by IIFE build) | B build; lazy deps kept out of the single-file page (see conflicts) |
| Portfolio / map | unchanged | worker-backed, failure handling | facade | B (KEEP) |
| Regulatory cap | DRRG slabs (function), EtihadWE 10 %/1 MW, `nonSolarScheme`, richer citations | DRRG slabs (table), off-grid, AD export rules, Sharjah | unchanged | **MERGE**: B structure + A's EtihadWE fraction cap (verified: MoEI decision Nov 2024, Khaleej Times/Enterprise) + A's notes/citations |
| Tariffs | Dubai/AD only | all 7 emirates | Dubai/AD only + `planUnavailableReason` | B; keep C's field (reachable when a future emirate lacks a tariff), drop C's "only DEWA/ADDC modelled" verdict text (false after B) |
| Solar resource | PVGIS-fitted model | + NASA POWER grid, measured GHI, soiling | + DNI clamp, `SolarYear` cache | B + C (MERGE) |
| Wind | GWA + ERA5 Weibull per month, density, turbine curves, 15 sites | NASA 50 m → shear → Rayleigh CF | — | **A authoritative** for the energy-mix path; B's `windMonthlyKwhPerKw` demoted to a fallback for coordinates with no climate point |
| Planner | — | constrained sweep, `Infeasibility`, budget/target | half-rung refinement, `DEFAULT_FINANCE` ref, approved-load tariff | B + C (MERGE; refinement must respect B's constraints) |
| Finance | — | corporate tax | O&M escalation, VAT caveat | B + C (MERGE) |
| Document intake | `extract.ts` multi-field, statuses, conflicts, pdf.js | `intake.ts` bill parser + guided questions + enrichment | — | **MERGE**: A's `extract.ts` is the document layer, B's `intake.ts` questionnaire/enrichment stays; B's parser duplicates A's and is folded |
| Custom-site UI | full dialog flow → `RenewableCase` | none (follow-up noted) | none | **A**, restyled to B's shell tokens, gains B's budget/target inputs |
| Recommendation card | `recommend.ts` | — | — | A (KEEP), legal items sourced from B's rules |
| Report / export | — | assumption register | `SiteReport` JSON + PDF | C (KEEP); register rows included in the report |
| Calendar / dedup | — | — | `calendar.ts` | C (KEEP) |
| Electrical/packing/shading fixes | — | — | 6 correctness fixes with tests | C (KEEP) |
| Demo assets | demo PDF, DEMO.md, SOURCES.md, skill | — | ENGINE_IMPROVEMENTS.md | A's docs KEEP; C's work order → `docs/` as history |
| Tests | 83 | 97 | 102 | union (all three files) |
| Dependencies | `pdfjs-dist` | none new | `jspdf` | both, lazy; lockfile: repo has both `package-lock.json` and `pnpm-lock.yaml` — keep npm lock, drop pnpm files |

## Base: B (`main`)

Strongest on correctness (verified regulatory model, PVGIS validation),
reliability (worker, failure paths, E2E-tested), coverage (97 tests), data
model (provenance/`Tracked<T>` everywhere, all-emirate tariffs) and deployment
(single-file page works). A and C are each additive on top of the fork point,
so they can be imported subsystem by subsystem.

## Expected conflicts and how they are resolved

1. **`main.ts` orchestration.** B moved per-site work into `site-compute.ts`
   (worker); C moved it into `analyzeRoof`. Resolution: `site-compute.ts`
   calls `analyzeRoof`; the worker protocol is unchanged.
2. **`plan.ts`.** B's constrained sweep vs C's half-rung probe. The probe is
   kept but runs through B's `evaluateSizing` path so budget/area/regulatory
   constraints apply to the probed sizes too.
3. **`rules.ts`.** Both A and B fixed DRRG. B's table form is kept (tested);
   A's `approvedLoadFraction` is added to the `RuleSet` and applied for the
   EtihadWE emirates. **This is a calculation change**: a 500 kW approved-load
   site in RAK was capped at 500 kW by B and is capped at 50 kW after
   integration. Test added.
4. **Wind.** B's Rayleigh path and A's Weibull path give different kWh/kW.
   A's is the better-sourced model (terrain-resolving GWA level, per-month
   shape, density) and is used wherever a climate point exists; the NASA
   grid remains for solar temperature/GHI and as the wind fallback for
   arbitrary coordinates, labelled as such in provenance.
5. **Document extraction.** B's `parseBillText` and A's `extractFields`
   overlap on kWh/approved load. A's is richer and status-aware; B's intake
   keeps its questionnaire/enrichment and delegates text parsing to A's.
6. **`RenewableCase` vs `SiteProfile`.** A's custom site only reaches the
   monthly energy-mix path. Integration adds an adapter so a confirmed custom
   site also gets B's rules/cap/tariff/register (no roof polygon → area from
   the declared roof m², no packing/shading).
7. **Single-file build.** Rollup inlines dynamic imports in IIFE output, so
   `jspdf` and `pdfjs-dist` would land in `page.html`. Both are loaded through
   a `loadLazy()` helper that catches failure and degrades: PDF report → JSON
   download still works; PDF upload → "use TXT/CSV or type the values" with
   the manual form pre-opened. The multi-file `dist/index.html` gets both.
8. **Weekend model (C).** C's change moves a few % of load between weekday
   and weekend shapes; validated numbers in `ENGINE_VALIDATION` are re-run.
9. **Version-A `RenewableSource`/`MONTH_HOURS` layering vs C.** C's
   `types.ts` home wins; A's data files re-pointed.

## Dropped, and why

- B's synchronous `parseBillText` regexes (superseded by A's `extract.ts`).
- C's verdict text "Only Dubai (DEWA) and Abu Dhabi (ADDC) rates are modelled
  today" — untrue after B's tariffs.
- A's `WIND_CAPACITY_FACTORS` (already removed by A itself; B still had them).
- A's `dubaiTclContributionKw` (same maths as B's `tclSlabCapKw`; one kept).
- `pnpm-lock.yaml` / `pnpm-workspace.yaml` — the repo is npm (`package-lock.json`).
- Committed `dist/assets/*` from C — regenerated by the build.

## Order of work

1. C engine (calendar, cache, fixes, facade, finance) → typecheck/test/validate.
2. C report + PDF → lazy load, single-file degrade check.
3. A rules (EtihadWE fraction, notes) → tests for the cap change.
4. A wind model + data + examples → energy-mix path, provenance.
5. A extract + custom-site + recommend → restyle, wire to B intake/rules.
6. Dedup, docs, hygiene, regression tests, E2E + adversarial via testing agent.

## Outcome (written after the merge)

What landed on `final-integration`, against the plan above:

- **C** imported whole (commit `7dfc981`): calendar, `SolarYear` cache,
  `analyzeRoof` facade, structured report + jsPDF export, the six correctness
  fixes, half-rung refinement, `planUnavailableReason`. `analyzeRoof` was
  changed to source its weather year through B's `weatherOrModelled`, so the
  UI plans against the NASA POWER climatology rather than C's clear-sky year
  (regression test in `tests/improvements.test.ts`). `report.ts` learned that
  Dubai's binding constraint is `tcl-slab`, not `approved-load`. Three of C's
  tests encoded pre-B assumptions (Sharjah has no tariff; Dubai caps at the
  flat approved load) and were rewritten to the verified model.
- **A** imported selectively: `engine/extract.ts`, `web/custom-site.ts`,
  `engine/recommend.ts`, `engine/wind.ts` + `engine/wind-sites.ts` (moved out
  of `data/` because it is logic, not data) + `data/wind-uae.json`, the 15
  energy-mix examples, the demo PDF, `DEMO.md`, `SOURCES.md`, the UI-testing
  skill. `rules.ts` kept B's table-driven DRRG and gained A's
  `approvedLoadFraction` (EtihadWE 10 % / 1 MW, `confidence: "partial"` with
  the press-coverage caveat) and `nonSolarScheme`.
- **One cap formula.** `regulatoryCapFor(emirate, approvedLoadKw)` is the
  single implementation; `regulatoryCap(site)` and `recommendMix` both call it.
  A's `dubaiTclContributionKw` is gone.
- **Two wind datasets, one screen.** `modelledWind(site)` in `rules.ts` uses
  the Atlas/ERA5 point within 40 km, else the NASA 50 m grid, and labels which.
  The technology screen now returns `not-viable` (CF < 12 %) or
  `needs-evidence` with the dataset in provenance instead of a generic
  "no measurement supplied" — it never returns `eligible` from a model.
- **Custom site.** The confirmed site's default tariff comes from B's
  `selectTariff`/`marginalRate` for the emirate (was a hard-coded 0.30), and
  its solar ceiling from the shared cap. It still runs the energy-mix
  recommender, not the roof planner: without a roof polygon there is nothing
  to pack or shade, so plan item 6's full `SiteProfile` adapter (register,
  P50/P90) is **not done** and is the first follow-up.
- **Two text parsers remain, separated on purpose.** `extract.ts` is the
  document layer behind the upload UI (multi-field, statuses, conflicts).
  `intake.ts` is B's engine-side bill proposal for `SiteProfile`
  (`extractBill` → `applyBillProposal`) plus the guided questionnaire and
  enrichment; it is tested but has no UI yet. Folding one into the other
  (plan item 5) was deferred rather than risk either's tests.
- **Single-file page grew** from ~1.2 MB to ~3.4 MB because Vite's lib build
  inlines the pdf.js worker as a data URL. That is what makes PDF upload work
  offline from `dist/local.html`; the degrade-on-failure path (plan item 7)
  exists (`custom-site.ts` catches the import and offers TXT/CSV or manual
  entry) but the inlining means it should rarely trigger.
- **Dropped:** `DEVIN_DEMO_NOTES.md` (A's video-evidence narrative; its facts
  are in `SOURCES.md` and here), `pnpm-lock.yaml`/`pnpm-workspace.yaml`,
  the four drifted `esc()` copies (now `web/format.ts`).
- **Tests:** 128 (97 B + 19 C + 1 facade weather + 11 seam tests in
  `tests/integration.test.ts`: shared cap, EtihadWE, recommender ≤ cap, wind
  model sanity and dataset selection, model-never-eligible, extractor found /
  needs-confirmation / not-found / conflict).
