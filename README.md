# Mizan — UAE renewable energy screening

Pick a real building, say what the site uses, and find out what solar can go on
it, what it saves, and which rule caps it. Or click **+ Analyze your own site**,
upload an electricity bill or site document (PDF, TXT, CSV, MD) or type the
figures, review what Mizan read — each field tagged found / needs confirmation /
not found with the page it came from — and confirm before anything is analysed.
Nothing leaves the browser.

Open **UAE energy mixes** for 15 UAE examples spanning solar only, solar + wind,
wind only and hypothetical solar + micro-hydro, each with a recommendation card
(mix, legal status per emirate, options ruled out and why, evidence still
needed). Wind rests on Global Wind Atlas + ERA5 at 27 UAE climate points and
says so. Toggle sources, reduce capacity,
adjust the assumed avoided tariff, and compare monthly generation, load coverage
and simple payback. Every portfolio building also has an energy-mix section.
Published project capacities and assumed resource/financial inputs are labelled
separately. Geothermal electricity remains unavailable without subsurface data.
See [the calculation and data guide](src/data/RENEWABLE_COMBINATIONS_GUIDE.md).

The main portfolio picker also includes the four groups from the supplied HTML:
**Inland Solar Focus**, **Coastal + Wind Portfolio**, **Wind Specialist (Rare Case)**,
and **Wadi-Adjacent (Seasonal)**. These 12 sites run directly in the three-column
workspace, with live verdicts, source toggles, monthly charts and financial tables.
Sites without surveyed footprints use labelled regional location maps. The
original rooftop portfolios remain available in the same picker.

After changing source files, `npm run build` refreshes both the Vite output and
the self-contained `dist/local.html` used by `node serve.mjs`. `npm run page`
rebuilds just the self-contained page using the project's installed Vite.

## Run it

```bash
node serve.mjs       # then open http://localhost:4173
```

Nothing to install. No `npm install`, no build step, no dependencies: the server
uses only what ships with Node, because `npm install` is blocked on some managed
networks and a demo that will not start is not a demo. This is the version to
show.

If npm does work for you, `npm install && npm run dev` gives the same app with
hot reload while editing the source.

Either way, running locally unlocks three things a published static page cannot
do:

- **Real map tiles** from OpenStreetMap behind the building outlines.
- **Address search.** Type a company's address, and the buildings around it are
  pulled live from Overpass. Anywhere in the UAE, not just the two areas baked
  into the build.
- **Measured sunlight.** PVGIS refuses requests made straight from a browser, so
  the local server proxies them at `/api/pvgis`. When a typical meteorological
  year comes back for the site's coordinates, the page re-renders with it and
  the source chip changes from "Modelled" to "PVGIS SARAH3".

With no network, or as a published page, none of that arrives and the app falls
back to its baked areas, its own vector map and a modelled sunlight year. It
says which it is using in "What this rests on" rather than pretending.

## Other commands

```bash
node serve.mjs   # run the app, nothing to install
npm test         # 128 engine tests
npm run validate # check the engine against PVGIS at 16 UAE coordinates
npm run calibrate# refit the clearness index against PVGIS measurements
npm run demo     # one site through the engine, printed to the terminal
npm run bake     # cache PVGIS years and OSM footprints into src/data
npm run page     # build the single-file version in dist/
npm run build    # production build in dist/
```

## Layout

```
index.html          the app shell, markup and styles
src/engine/         pure TypeScript, no UI imports, fully unit tested
  solar.ts          solar position and irradiance
  pv.ts             array simulation and the named loss stack
  packing.ts        fitting panel rows inside a real roof outline, and setbacks
  electrical.ts     string sizing, leapfrog stringing, cable routes and sizes
  shading.ts        row-to-row and neighbouring-building shading, per panel
  capacity.ts       polygon area, row spacing, array fit
  load.ts           sector load shapes scaled to evidenced consumption
  tariff.ts         DEWA and ADDC tariffs, with sources and dates
  rules.ts          per-emirate scheme rules, roof structure, screening
  battery.ts        hourly dispatch and energy balance
  finance.ts        capex, cashflow, IRR, NPV, LCOE, own vs PPA, CO2
  uncertainty.ts    Monte Carlo bands and the sensitivity tornado
  plan.ts           ranks options by net present value, names what binds them
src/web/            map, charts, tiles, live lookups, the app itself
src/connectors/     PVGIS, Overpass, Nominatim
tests/              63 tests, including energy balance, string voltage limits,
                    setback geometry, shadow direction and skyline geometry
```

## The wiring view

"This roof" shows what fits. "Wiring" shows how it gets built: every string of
panels wired in series, drawn as the leapfrog path an installer actually pulls,
and the cable routed back to the inverters along the building rather than
straight across it.

String length is not a preference. It is pinned between two limits that both
depend on the weather here:

- On the coldest morning, open-circuit voltage peaks. The string must stay
  under the inverter's maximum DC input or the inverter is destroyed. This is
  the ceiling. (IEC 62548 s.7.2; NEC 690.7 is the US equivalent.)
- On the hottest afternoon, maximum-power voltage bottoms out. The string must
  stay above the inverter's full-power window or it throttles at noon. This is
  the floor.

The Gulf sits at an unusual point: mild winters make the ceiling generous, and
eighty-degree cell temperatures make the floor bite. A string length copied
from a European design is usually wrong here in both directions, so the app
shows both limits and how far apart they are, per emirate.

Module and inverter figures are published datasheet values for the product
class, not supplier quotes.

## The shading view

Row spacing is set so the row in front does not shade the row behind at midday
in December. That is the standard rule and it only covers midday. Early and
late in the day the sun swings round to the side, the profile angle collapses,
and the rows do shade each other.

"Shading" colours every panel by how much of the year's direct sunlight it
loses to the row in front, computed hour by hour from this site's own sun and
the rows actually drawn. Two numbers come out of it: the geometric loss, which
is the panel area genuinely covered, and the larger electrical loss, because a
panel carries three groups of cells with a bypass diode across each, and a
shadow a few centimetres up the bottom edge switches the whole bottom group
off. The electrical figure is the one applied to the yield, since it is what
the array will actually produce.

The loss is not one number for a roof. A system smaller than the roof could
hold is built as whole rows spread across it, so below roughly six tenths of
the roof every row has a double gap in front and there is no row shading at
all. Most UAE sites are capped well under their roof by their approved load,
so that is the common case. The engine samples the loss at several fill levels
and the planner prices each candidate system with the shading that system
would have.

### The buildings next door

A roof sits on top of its own building, so a neighbour of the same height has
its roof in the same plane and blocks nothing at all. Only the part of a
neighbour that stands **above this roof** casts anything onto it, which is why
the height of the roof itself is the first thing the check asks for and why it
is never guessed.

Where the heights are known, the skyline is built from the real mapped
outlines: every edge is walked, the horizon is computed on a grid across the
roof and interpolated onto the panels, and the loss is read off a map of where
the year's direct sunlight comes from. In Business Bay a 68,000 m² podium at
8 m loses about 11% of its year to the towers around it, and the worst panel on
it loses 83%. The same roof raised to 120 m loses 6%.

One result worth carrying into a design review: **at this latitude a tower to
the east or west costs more than one to the south.** The sun is never low in
the south at 25°N, so a southern tower is above its path for only a short part
of the year. On the same roof and the same tower it is 4.5% from the east
against 3.6% from the south here, and in northern Europe it turns over
completely, 11.5% from the south against 5.4% from the east. Keeping the south
side clear is a European rule and it is the wrong one in the Gulf.

Coverage is the limit, and it is stated rather than papered over. Across 464
mapped buildings in Jebel Ali Free Zone and Dubai Industrial City, **not one**
carries a height or a floor count in OpenStreetMap. In Business Bay 25 of 45
do. Buildings without a height are counted and reported as unknown, never
filled in with a guess. Diffuse shading from the rest of the sky dome is not
modelled either, which makes the neighbour figure the low end.

## How accurate it is

The engine is checked against PVGIS, and the numbers are reproducible with
`npm run validate` and `npm run calibrate`.

- **Sunlight.** The monthly clearness index is fitted to five-year PVGIS SARAH3
  means at 32 points across the UAE. Leaving each site out and predicting it
  from the other 31 gives **1.9% mean absolute error** on annual irradiation,
  with no bias. The hand-written values it replaced scored 7.4%, and were low
  at every single site: the app had been understating output everywhere.
- **Yield.** One kilowatt-peak at 10° on a flat roof, run through this engine
  and through PVGIS's own PV model at 16 UAE coordinates with a matched loss
  stack, agrees to **1.1% mean absolute error, no bias, worst site 3.1%**.

Those two errors were pointing in opposite directions and hiding each other.
The sunlight was 7% low; the module model was 12% generous, because it used
free-standing rack cooling coefficients for a roof array, fed them wind
measured at ten metres in the open, and had no low-light term at all. Either
error alone would have shown up in the headline yield. Together they nearly
cancelled, and the total looked reasonable.

The fixes are physics, not fudge: Faiman coefficients that depend on how the
array is mounted, Huld et al. (2011) relative efficiency for heat and weak
light together, and wind reduced to what actually reaches a module a metre or
two above a roof inside an array. That last one is the single parameter fitted
rather than cited, and `scripts/validate.ts` fits it on 15 sites and scores it
on the 16th.

**What this is not.** PVGIS PVcalc is a model, not a meter. It is driven by
measured satellite irradiance and has been validated against real
installations in many countries, so agreeing with it closely is worth
something — but no real UAE system's metered output has been compared against
this engine, and nothing here claims otherwise.

## What it does not claim Roof outlines come from OpenStreetMap and are not
title plans. Load shapes are sector patterns unless twelve monthly readings are
entered. Installed costs are published vendor ranges, and O&M is industry
convention with no UAE source found. Before money is spent: have the roof
structure assessed, pull interval meter data, confirm the approved load on the
account, and take real quotes.
