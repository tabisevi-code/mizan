# Demo runbook — 3-minute path

## Before recording
```sh
cd mizan && source ~/.nvm/nvm.sh
npm install && npm run build && node serve.mjs
# open http://localhost:4173
```

## Health check
`npm test` → 83 pass. Page loads, "UAE examples" picker shows 15 cases.

## Demo input
None to type — the picker is the input. Exact sequence:

1. **Problem (0:00–0:20)** — open the page → "Renewable energy" section → the UAE examples dropdown.
2. **Sir Bani Yas (0:20–1:00)** — pick "Masdar · Sir Bani Yas". The **Mizan recommendation** card shows 14 MWp solar + one 4.5 MW turbine at ~30% modelled CF, payback ~7.9 yr, and the Abu Dhabi legal status. *This is the wow moment:* the same model that picked Sila/Sir Bani Yas/Delma/Al Halah in its top sites is recommending the mix — matching what Masdar actually built.
3. **Contrast (1:00–1:40)** — switch to "DIC parts manufacturer" (Dubai): the card rules wind *out* — "technically workable, but Shams Dubai publishes no connection path for it" — and caps solar at the v4.1 tiered limit. Then "Sila wind" (43% CF) for the inverse.
4. **Your own site (1:40–2:15)** — click **+ Analyze your own site** (top of the left panel) → **Upload documents** → `demo/demo-site-annual-statement.pdf` → watch "Reading document…" → the review screen shows Falcon Ridge Logistics, Dubai Industrial City, 1,284,500 kWh/yr, 420 kW approved load, 6,200 m² concrete roof — each tagged "Found in document" with the PDF as source → **Confirm & Analyze Site** → the renewables view opens with Mizan's recommendation for that business.
5. **Trust (2:15–3:00)** — open "What is still needed before building" (mast campaign, GCAA, licence) and point to SOURCES.md for the provenance chain.

## Expected output
Recommendation card: mix chips, MWh/yr, net saving, payback, wind CF, legal ✓/!/✕ lines, ruled-out list. All offline-safe — everything is baked into the repo.

## Recovery
- Picker change renders instantly; if the app is asleep on the preview URL, restart `node serve.mjs`.
- If a control misbehaves, re-open the page (state is per-session, refresh resets it).

## Reset
Reload the page; pick the first example again.
