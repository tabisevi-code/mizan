---
name: testing-mizan-ui
description: How to run and end-to-end test the Mizan UAE renewable planner UI — serve modes, file-upload dialog handling, native select pickers, and pdf.js worker-realm pitfalls.
---

# Testing the Mizan UAE renewable planner

## Run the app

- `cd /home/ubuntu/repos/mizan && source ~/.nvm/nvm.sh && npm install && npm run build && node serve.mjs` → http://localhost:4173
- `serve.mjs` serves ONLY `dist/local.html` (re-read per request — a rebuild is picked up without restarting) plus three `/api/*` proxies. There is NO static `/assets/` handler. The integrated single-file build inlines pdf.js and its worker, so verify PDF intake independently in this mode rather than assuming it needs asset routes.
- Also run `npm run dev -- --host 0.0.0.0` for Vite coverage. If 4173 is occupied, read Vite's output for its selected port (often 4174).
- To test paths that need real `/assets/` files (e.g. pdfjs dynamic import), serve `dist/` statically: `cd dist && python3 -m http.server 4180` → `dist/index.html` uses the hashed `/assets/*` chunks.
- The recommender/examples feature is 100% client-side and deterministic — no AI calls, no env vars. Network-down testing = kill `serve.mjs` after load; the page keeps working.

## Key UI locations

- "#analyze-own" button ("+ Analyze your own site") sits in the LEFT RAIL under the site list (~x≈93,y≈621 at 1024×768).
- `#open-renewables` topbar button ("UAE energy mixes", ~x≈720,y≈72) opens `#renewable-dialog` with the `UAE example` `<select>` (~x≈503,y≈178). Do NOT click the portfolio dropdown (~x≈907,y≈72) by mistake.
- "Apply recommended mix" on a rec-card sits ~y≈433 on most cards (NOT ~y≈361 — that's the mix-chip grid).

## Driving native controls via computer-use

- File upload: clicking the "Upload documents" label opens a GTK file chooser → `ctrl+l`, type the ABSOLUTE path, `Return`. The `accept` filter shows "Custom Files" but a typed path still selects the file (works for .png etc.).
- Multi-file uploads: navigate to the directory, then Ctrl-click the desired file rows and Open. Quoted multiple absolute paths in the Location field may be treated as one invalid directory.
- Native `<select>`: click opens the dropdown with clickable option rows (~15px spacing starting ~y≈199). Alternatively focus the select and press a letter key — it fires `change` per press (useful for rapid-switch race tests).
- Dialogs scroll independently — scroll inside the dialog body to reach "Confirm & Analyze Site" (~x≈693,y≈680 after scrolling).

## pdf.js pitfalls (browser compat)

- pdf.js ≥6.x runs parsing inside a Worker realm — a `Uint8Array.prototype` polyfill injected on the main thread does NOT reach the worker. To shim, the polyfill must be inside the worker file/realm.
- `Uint8Array.prototype.toHex` is an ES2025 builtin absent in Chrome ≤~139 — pdf.js 6.3.x `fingerprints` getter throws `n.toHex is not a function` for EVERY pdf on such browsers (seen on Chrome 137).
- The app swallows pdf errors with `catch {}` → to see the real error, make a probe page importing the built `/assets/pdf-*.js` chunk directly and call `getDocument` (see dist/probe.html pattern), or check node-side `pdfjs-dist/legacy` for comparison.
- TXT/CSV/MD uploads bypass pdf.js entirely — use a .txt with the same content to test extraction/review/confirm natively.
- Vite may inject `/@vite/client` into a worker fetched as text and rewrapped in a blob. That absolute-path import cannot resolve from a blob base; watch for `Setting up fake worker failed` with `Invalid relative url or base scheme isn't hierarchical`. A successful built/offline PDF test does not prove Vite works.
- Capture caught warnings as well as uncaught exceptions: document extraction can show a generic damaged-file message while console warnings retain the actual worker/import cause.

## Integrated intake and reports

- Use `demo/demo-site-annual-statement.pdf` for the built PDF path, then edit a review field before confirmation. Verify both the analysis result and the expanded published-facts section reflect the confirmed value, not just the original extraction.
- Conflict fixtures should share site/location but disagree on annual kWh. Verify source-labelled alternatives, then choose one and compare the resulting initial MWh load AND published facts.
- Check extracted monthly kWh sum against annual kWh; disagreement should not silently pass review.
- The portfolio report buttons are at the bottom of the right panel under "Act on it". Verify JSON parses and open the downloaded PDF; compare site, recommended kW and provenance against the selected site.

## Devin secrets needed

- None — the app needs no credentials, env vars, or login.
