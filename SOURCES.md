# Sources and validation metrics

Every resource number Mizan shows is traceable to one of these records. Status
`verified` means the value was pulled from the named primary source; `partial`
means the primary document was reached but parts of the scheme are unpublished.

## Climate and resource data

| Source | What Mizan uses it for | Publisher | Status | Where it lands |
|---|---|---|---|---|
| Global Wind Atlas 3.3 (WPS `get_area_mean`, `get_libfile`) | Gridded mean wind speed and best-decile siting level at 50/100/150 m for 27 UAE points | DTU Wind Energy | verified (fetched live) | `src/data/wind-uae.json`, `src/engine/wind.ts`, `src/engine/wind-sites.ts` |
| NASA POWER climatology (GHI, T2M, WS10M, WS50M, RH, PS) on a 0.5° grid | Hourly weather year for the roof planner; small-wind screen where no Atlas point is within 40 km | NASA LaRC | verified (baked by `scripts/bake-resource.ts`) | `src/data/uae-resource-grid.json`, `src/engine/resource.ts` |
| ERA5 reanalysis, 2015–2024 hourly 100 m wind, 2 m temperature, surface pressure — Open-Meteo archive API | Monthly Weibull fits (seasonality), UAE air-density correction | ECMWF / Open-Meteo | verified (fetched live) | `src/data/wind-uae.json` |
| PVGIS SARAH3 solar radiation 2018–2022 | Calibrated UAE solar yield model (temperature + dust losses) | EC JRC | verified | solar model in `src/engine/`, referenced in `src/data/uae-monthly-profiles.ts` |
| Masdar UAE Wind Program announcement (Oct 2023) | Published capacities for Sir Bani Yas (45 MW wind + 14 MWp solar), Delma (27 MW), Sila, Al Halah (4.5 MW); validation that modelled-CF ranking finds the sites Masdar actually built | Masdar | verified | `UAE_WIND_SOURCE`, demos, validation below |
| OpenStreetMap / Overpass | Site footprints, roofs, mapped turbines, Al Rawabi company point | OSM contributors (ODbL) | verified per-feature | `src/data/geometry/*.json`, `mapGeometry` |
| Company-published specs (Aramex, Al Rawabi, IKEA/ALEC, DEWA Hatta) | Published capacities and project facts shown in evidence panels | each company | verified | `src/data/mapped-energy-projects.ts`, `src/data/published-warehouses.ts` |

## Law and connection rules (per emirate)

| Emirate | Instrument | Publisher | Status | Encoded in |
|---|---|---|---|---|
| Dubai | DEWA DRRG Connection Conditions v4.1 (Nov 2025): tiered solar cap 100%×0–100 kW + 75%×100–200 + 50%×200–400 + 25%×400–600 + 5%×>600, max 1,000 kW/plot; rooftop/BIPV only; credits roll over, never cash; solar-only scheme | DEWA | verified | `RULE_SETS.dubai.tclSlabs`, `tclSlabCapKw`, `regulatoryCapFor` |
| Abu Dhabi | DoE Self-Supply Licence decision DoE/ED/G04/005 (eff. Feb 2026): licence under Law 2/1998; no net metering unless expressly authorized; new industrial self-supply licences paused | Abu Dhabi DoE | partial (primary doc obtained; caps sit in unpublished instruments) | `RULE_SETS["abu-dhabi"]` |
| Northern emirates (Sharjah ENOC-free zones excluded; Ajman, UAQ, RAK, Fujairah under EtihadWE) | Federal Decree-Law 17/2022 + MoEI ministerial decision (Nov 2024): ≤10% of approved load, ≤1 MW per unit, monthly netting, same-year credit | MoEI / uaelegislation.gov.ae | partial (decision text not obtained directly) | `northernEmirates()` in `rules.ts` (`approvedLoadFraction: 0.1`, `plotCapKw: 1000`, `confidence: "partial"`) |
| Sharjah | SEWA distributed-generation scheme | SEWA | unverified — no published scheme found; federal law still applies | `RULE_SETS.sharjah` |
| Dubai non-solar | RSB licence EG-03/2019 (Al Rawabi 1.3 MWac biogas CHP) — the precedent that non-solar generation needs a bespoke licence | RSB Dubai | verified | `RULE_SETS.dubai.nonSolarScheme`, Al Rawabi evidence |

## Accuracy metrics the recommendation layer is validated against

1. **Site-selection agreement (primary "is this the right place" metric):** the model's
   capacity-factor ranking places all four published UAE Wind Program sites
   (Sila, Sir Bani Yas, Delma, Al Halah) in the top 7 of the 27 screened points
   independently. Modeled utility-scale CF: Sila 43%, Al Halah 39%,
   Madinat Zayed 37%, Liwa 35%, Delma 31%, Sir Bani Yas 30%.
2. **Solar annual yield:** checked against PVGIS SARAH3 monthly output, bundled
   and fitted — error vs PVGIS is the calibration residual of the existing model.
3. **Air-density derate:** computed per site (3.4–12.4% energy penalty;
   10.5% at Jebel Jais) — a UAE-specific correction most tools ignore.
4. **Known gaps (reported, not hidden):** ERA5/GWA are reanalysis/modelled
   climate, not mast measurements — every wind recommendation is tagged
   "modelled, needs a measurement campaign." Published project sites carry
   capacities, not metered output; payback uses assumed tariffs.

## How the two wind datasets are used together

`rules.screenTechnologies` asks `modelledWind(site)` for a screening capacity
factor when no mast figure has been supplied. Within 40 km of a configured
Atlas/ERA5 climate point it runs a 100 kW machine through that point's monthly
Weibull fit; anywhere else it runs the NASA POWER 50 m monthly means through the
generic Rayleigh curve. The result's provenance names the dataset, and the screen
never returns `eligible` from a model — only `not-viable` or `needs-evidence`.
The energy-mix recommender (`engine/recommend.ts`) always uses the Atlas/ERA5
model, because its example sites are the configured points.

## Reproduce

```sh
npx tsx scripts/fetch-wind.ts   # refetches ERA5 + GWA, rewrites wind-uae.json (resumable cache in scripts/.cache/)
npm test && npx tsc --noEmit && npm run build
```
