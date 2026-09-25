/**
 * "Analyze your own site": a business brings a document (bill, statement,
 * site sheet) instead of typing every number. Extraction is deterministic —
 * every field names the document and page it came from, and nothing reaches
 * the engine until the user reviews and confirms it.
 */

import { extractFields, mergeDocuments, FIELD_ORDER, FIELD_LABELS, type DocumentFields, type FieldKey, type MergedField } from "../engine/extract";
import { UAE_RENEWABLE_CASES, type RenewableCase } from "../data/portfolios-uae-multi";
import { WIND_SITES } from "../data/wind-sites";
import { labelEmirate } from "../engine/rules";
import type { Emirate } from "../engine/types";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const EMIRATES: Emirate[] = ["abu-dhabi", "dubai", "sharjah", "ajman", "umm-al-quwain", "ras-al-khaimah", "fujairah"];

/** Approximate coordinates for a site: nearest wind climate point by name, else emirate centroid. */
const approxLocation = (address: string, emirate: Emirate): { lat: number; lng: number; note: string } => {
  const inEmirate = WIND_SITES.filter(s => s.emirate === emirate);
  const hay = address.toLowerCase();
  const named = inEmirate.find(s => hay.includes(s.name.toLowerCase().split(" ")[0]))
    ?? WIND_SITES.find(s => hay.includes(s.name.toLowerCase().split(" ")[0]));
  if (named) return { lat: named.lat, lng: named.lng, note: `matched to the ${named.name} climate point` };
  const lat = inEmirate.reduce((t, s) => t + s.lat, 0) / inEmirate.length;
  const lng = inEmirate.reduce((t, s) => t + s.lng, 0) / inEmirate.length;
  return { lat, lng, note: `approximate centre of ${labelEmirate(emirate)} — refine with a real address` };
};

type Stage = "choose" | "reading" | "review";

export function openCustomSiteFlow(onConfirm: (site: RenewableCase) => void) {
  const dialog = document.getElementById("site-dialog") as HTMLDialogElement;
  const body = document.getElementById("site-dialog-body")!;
  let stage: Stage = "choose";
  let docs: DocumentFields[] = [];
  let merged: MergedField[] = [];
  let pdfLib: typeof import("pdfjs-dist") | null = null;

  // pdf.js ≥5 calls Uint8Array.prototype.toHex inside its worker realm; that
  // builtin is absent in Chrome <140. Wrapping the worker source in a blob URL
  // with a one-line polyfill puts the shim where a main-thread polyfill can't
  // reach — and keeps everything offline.
  const pdfWorkerSrc = async () => {
    const url = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
    const src = await (await fetch(url)).text();
    const shim = "Uint8Array.prototype.toHex ||= function(){return [...this].map(b=>b.toString(16).padStart(2,'0')).join('')};\n";
    return URL.createObjectURL(new Blob([shim + src], { type: "text/javascript" }));
  };

  const render = () => {
    if (stage === "choose") renderChoose();
    else if (stage === "reading") renderReading();
    else renderReview();
  };

  const progress = (label: string) => {
    const el = body.querySelector<HTMLElement>("[data-progress]");
    if (el) el.insertAdjacentHTML("beforeend", `<li>${esc(label)}</li>`);
  };

  const renderChoose = () => {
    body.innerHTML = `
      <p class="note">Bring the numbers Mizan needs two ways — type them in, or upload an electricity bill / site document and let Mizan read it. Nothing is analysed until you review what it found.</p>
      <div class="cs-choices">
        <button type="button" class="cs-choice" data-manual><b>Enter details manually</b><span>Type the site's load, location and roof details yourself.</span></button>
        <label class="cs-choice cs-upload"><b>Upload documents</b><span>PDF or text (electricity bill, annual statement, roof survey). Multiple files allowed.</span>
          <input type="file" data-files accept=".pdf,.txt,.csv,.md,.text" multiple hidden>
        </label>
      </div>
      <p class="note cs-privacy">Your uploaded file is read on this machine, used only to extract the information needed for this analysis, and is not stored or sent anywhere.</p>`;
    body.querySelector("[data-manual]")!.addEventListener("click", () => {
      docs = [];
      merged = FIELD_ORDER.map(key => ({ key, value: "", status: "not-found" as const, source: "manual entry", alternatives: [] }));
      stage = "review";
      render();
    });
    body.querySelector<HTMLInputElement>("[data-files]")!.addEventListener("change", async (e) => {
      const files = [...((e.target as HTMLInputElement).files ?? [])];
      if (!files.length) return;
      stage = "reading";
      renderReading();
      await readFiles(files);
    });
  };

  const renderReading = () => {
    body.innerHTML = `
      <h3>Reading your document</h3>
      <ul class="cs-progress" data-progress><li>Opening file…</li></ul>`;
  };

  const readFiles = async (files: File[]) => {
    docs = [];
    for (const file of files) {
      progress(`Reading ${file.name}…`);
      try {
        const ext = file.name.toLowerCase().split(".").pop() ?? "";
        if (["txt", "csv", "md", "text"].includes(ext)) {
          docs.push(extractFields(file.name, [await file.text()]));
          progress(`Found site information in ${file.name}.`);
        } else if (ext === "pdf") {
          progress(`Extracting energy data from ${file.name}…`);
          pdfLib ??= await import("pdfjs-dist");
          pdfLib.GlobalWorkerOptions.workerSrc = await pdfWorkerSrc();
          const pdf = await pdfLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
          const pages: string[] = [];
          for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            pages.push(
              content.items
                .map((i) => ("str" in i ? (i as { str: string }).str + ((i as { hasEOL?: boolean }).hasEOL ? "\n" : " ") : ""))
                .join(""),
            );
          }
          docs.push(extractFields(file.name, pages));
          progress(`Extracted ${pdf.numPages} page${pdf.numPages > 1 ? "s" : ""} from ${file.name}.`);
        } else {
          progress(`We couldn't read ${file.name} — try PDF, TXT or CSV.`);
        }
      } catch (err) {
        console.warn(`Mizan: could not read ${file.name}`, err);
        progress(`We couldn't read ${file.name} — the file may be a scan or damaged. Try a text PDF, or enter the details manually.`);
      }
    }
    if (!docs.length) {
      body.querySelector("[data-progress]")!.insertAdjacentHTML(
        "afterend",
        `<p class="callout is-warn">We couldn't find usable energy/site information in these documents. You can enter the details manually or try a different file.</p>
         <div class="cs-choices"><button type="button" class="cs-choice" data-back>← Back</button><button type="button" class="cs-choice" data-manual>Enter details manually</button></div>`,
      );
      body.querySelector("[data-back]")!.addEventListener("click", () => { stage = "choose"; render(); });
      body.querySelector("[data-manual]")!.addEventListener("click", () => {
        docs = [];
        merged = FIELD_ORDER.map(key => ({ key, value: "", status: "not-found" as const, source: "manual entry", alternatives: [] }));
        stage = "review";
        render();
      });
      return;
    }
    merged = mergeDocuments(docs);
    progress("Ready for review.");
    stage = "review";
    // Let the progress list paint before swapping to the form.
    setTimeout(render, 350);
  };

  const statusChip = (f: MergedField) =>
    f.status === "found"
      ? `<span class="cs-chip is-found">Found in document</span>`
      : f.status === "needs-confirmation"
        ? `<span class="cs-chip is-check">Please confirm</span>`
        : `<span class="cs-chip is-none">Not found</span>`;

  const fieldInput = (f: MergedField) => {
    const base = `data-field="${f.key}"`;
    if (f.key === "emirate") {
      return `<select ${base}><option value="">— pick —</option>${EMIRATES.map(e => `<option value="${e}" ${f.value === e ? "selected" : ""}>${labelEmirate(e)}</option>`).join("")}</select>`;
    }
    const numeric = ["annualKwh", "monthlyKwh", "approvedLoadKw", "roofAreaM2"].includes(f.key);
    return `<input ${base} type="text" inputmode="${numeric ? "numeric" : "text"}" value="${esc(f.value)}" placeholder="${f.status === "not-found" ? "Not found — enter if known" : ""}">`;
  };

  const renderReview = () => {
    const byDoc = docs.length ? `Provided by business · ${docs.map(d => esc(d.docName)).join(", ")}` : "Entered manually";
    body.innerHTML = `
      <h3>Review what Mizan found</h3>
      <p class="note">Extracted values are <b>${byDoc}</b> — check each one, edit anything wrong, fill what's missing, then confirm. The engine runs only on what you confirm.</p>
      <div class="cs-fields">
        ${merged.map(f => `
          <div class="cs-field ${f.status === "needs-confirmation" ? "is-check" : ""}">
            <div class="cs-field-head"><span class="cs-label">${FIELD_LABELS[f.key]}</span>${statusChip(f)}</div>
            ${fieldInput(f)}
            ${f.alternatives.length ? `<div class="cs-conflict"><b>Conflict detected:</b>${f.alternatives.map(a => `<label><input type="radio" name="alt-${f.key}" data-alt="${f.key}" value="${esc(a.value)}"> ${esc(a.value)} <span class="cs-src">${esc(a.source)}</span></label>`).join("")}</div>` : ""}
            ${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}
            ${f.source && f.status !== "not-found" ? `<p class="cs-src">Source: ${esc(f.source)}</p>` : ""}
          </div>`).join("")}
      </div>
      <p class="note">Monthly use (if found) is a comma-separated kWh series. Roof area drives the solar ceiling: about 6 m² per kWp.</p>
      <div class="cs-actions">
        <button type="button" class="cs-back" data-back>← Back</button>
        <button type="button" class="cs-confirm" data-confirm>Confirm &amp; Analyze Site</button>
      </div>`;

    body.querySelectorAll<HTMLInputElement>("[data-alt]").forEach(radio =>
      radio.addEventListener("change", () => {
        const key = radio.dataset.alt as FieldKey;
        const input = body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${key}"]`)!;
        (input as HTMLInputElement).value = radio.value;
      }),
    );
    body.querySelector("[data-back]")!.addEventListener("click", () => { stage = "choose"; render(); });
    body.querySelector("[data-confirm]")!.addEventListener("click", confirm);
  };

  const valueOf = (key: FieldKey) =>
    (body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${key}"]`)?.value ?? "").trim();

  const confirm = () => {
    const name = valueOf("name") || "My site";
    const emirate = (valueOf("emirate") || "dubai") as Emirate;
    const address = valueOf("address") || labelEmirate(emirate);
    const annualKwh = Number(valueOf("annualKwh").replace(/,/g, ""));
    const err = body.querySelector("[data-error]");
    err?.remove();
    if (!EMIRATES.includes(emirate) || !Number.isFinite(annualKwh) || annualKwh <= 0) {
      body.insertAdjacentHTML(
        "beforeend",
        `<p class="callout is-warn" data-error>Mizan needs at least an <b>emirate</b> and an <b>annual electricity use in kWh</b> to run. Fill those in and confirm again.</p>`,
      );
      return;
    }
    const roofAreaM2 = Number(valueOf("roofAreaM2").replace(/,/g, ""));
    const approvedLoadKw = Number(valueOf("approvedLoadKw").replace(/,/g, "")) || undefined;
    const { lat, lng, note } = approxLocation(address, emirate);
    // Solar ceiling: stated roof area at ~6 m²/kWp, else a load-based ceiling.
    const solarKw = Number.isFinite(roofAreaM2) && roofAreaM2 > 0 ? roofAreaM2 / 6 : annualKwh / 1600;

    const docFields = merged.filter(f => f.status !== "not-found" && f.value);
    const site: RenewableCase = {
      id: `custom-${Date.now()}`,
      name, where: address, emirate, location: { lat, lng },
      annualKwh,
      solarKw: Math.round(solarKw),
      approvedLoadKw,
      category: "Your site · analysed like the examples",
      description: `A site you supplied — fields marked "Found in document" came from your uploaded file (${docFields.map(d => d.source).join("; ") || "manual entry"}); everything else is a screening assumption. Location is ${note}.`,
      defaultSources: ["solar"],
      defaultTariff: 0.3,
      evidence: docFields.map(f => ({
        label: FIELD_LABELS[f.key],
        value: f.value + (f.note ? ` — ${f.note}` : ""),
      })),
    };
    if (approvedLoadKw) site.evidence!.push({ label: "Approved load", value: `${approvedLoadKw.toLocaleString()} kW` });
    UAE_RENEWABLE_CASES.push(site);
    dialog.close();
    onConfirm(site);
  };

  dialog.onclose = null;
  document.getElementById("site-dialog-close")!.onclick = () => dialog.close();
  render();
  dialog.showModal();
}
