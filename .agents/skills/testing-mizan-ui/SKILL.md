---
name: testing-mizan-ui
description: How to run and end-to-end test the Mizan UAE renewable planner UI — serve modes, file-upload dialog handling, native select pickers, and pdf.js worker-realm pitfalls.
---

# Testing the Mizan UAE renewable planner

## Run the app

- `cd /home/ubuntu/repos/mizan && source ~/.nvm/nvm.sh && npm install && npm run build && node serve.mjs` → http://localhost:4173
- `serve.mjs` serves ONLY `dist/local.html` (re-read per request — a rebuild is picked up without restarting) plus three `/api/*` proxies. There is NO static `/assets/` handler: lazily-fetched chunks (e.g. the pdfjs chunk/worker) 404 on :4173.
- To test paths that need real `/assets/` files (e.g. pdfjs dynamic import), serve `dist/` statically: `cd dist && python3 -m http.server 4180` → `dist/index.html` uses the hashed `/assets/*` chunks.
- The recommender/examples feature is 100% client-side and deterministic — no AI calls, no env vars. Network-down testing = kill `serve.mjs` after load; the page keeps working.

## Key UI locations

- "#analyze-own" button ("+ Analyze your own site") sits in the LEFT RAIL under the site list (~x≈93,y≈621 at 1024×768).
- `#open-renewables` topbar button ("UAE energy mixes", ~x≈720,y≈72) opens `#renewable-dialog` with the `UAE example` `<select>` (~x≈503,y≈178). Do NOT click the portfolio dropdown (~x≈907,y≈72) by mistake.
- "Apply recommended mix" on a rec-card sits ~y≈433 on most cards (NOT ~y≈361 — that's the mix-chip grid).

## Driving native controls via computer-use

- File upload: clicking the "Upload documents" label opens a GTK file chooser → `ctrl+l`, type the ABSOLUTE path, `Return`. The `accept` filter shows "Custom Files" but a typed path still selects the file (works for .png etc.).
- Native `<select>`: click opens the dropdown with clickable option rows (~15px spacing starting ~y≈199). Alternatively focus the select and press a letter key — it fires `change` per press (useful for rapid-switch race tests).
- Dialogs scroll independently — scroll inside the dialog body to reach "Confirm & Analyze Site" (~x≈693,y≈680 after scrolling).

## pdf.js pitfalls (browser compat)

- pdf.js ≥6.x runs parsing inside a Worker realm — a `Uint8Array.prototype` polyfill injected on the main thread does NOT reach the worker. To shim, the polyfill must be inside the worker file/realm.
- `Uint8Array.prototype.toHex` is an ES2025 builtin absent in Chrome ≤~139 — pdf.js 6.3.x `fingerprints` getter throws `n.toHex is not a function` for EVERY pdf on such browsers (seen on Chrome 137).
- The app swallows pdf errors with `catch {}` → to see the real error, make a probe page importing the built `/assets/pdf-*.js` chunk directly and call `getDocument` (see dist/probe.html pattern), or check node-side `pdfjs-dist/legacy` for comparison.
- TXT/CSV/MD uploads bypass pdf.js entirely — use a .txt with the same content to test extraction/review/confirm natively.

## Devin secrets needed

- None — the app needs no credentials, env vars, or login.
