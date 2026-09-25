/**
 * Deterministic document extraction: pulls the fields the Mizan engine can
 * actually use out of uploaded business documents (bills, statements, site
 * sheets). No model calls — every value is a regex hit on the document text,
 * so each extracted field can name the document (and page) it came from.
 *
 * Extraction is never automatic truth: everything returns with a status and
 * the UI must ask the user to confirm before the value enters an analysis.
 */

export type FieldKey =
  | "name"
  | "address"
  | "emirate"
  | "annualKwh"
  | "monthlyKwh"
  | "approvedLoadKw"
  | "roofAreaM2"
  | "roofType"
  | "buildingType";

export type FieldStatus = "found" | "needs-confirmation" | "not-found";

export type ExtractedField = {
  key: FieldKey;
  value: string;
  status: FieldStatus;
  /** e.g. "DEWA_Annual_Statement.pdf — page 2" */
  source: string;
  note?: string;
};

export type DocumentFields = { docName: string; fields: ExtractedField[] };

export const FIELD_LABELS: Record<FieldKey, string> = {
  name: "Business / site name",
  address: "Address or location",
  emirate: "Emirate",
  annualKwh: "Annual electricity use",
  monthlyKwh: "Monthly electricity use",
  approvedLoadKw: "Approved load / connection capacity",
  roofAreaM2: "Roof area",
  roofType: "Roof construction",
  buildingType: "Building / site type",
};

export const FIELD_ORDER: FieldKey[] = [
  "name",
  "address",
  "emirate",
  "annualKwh",
  "monthlyKwh",
  "approvedLoadKw",
  "roofAreaM2",
  "roofType",
  "buildingType",
];

const NUM = `([\\d][\\d,]*(?:\\.\\d+)?)`;
const num = (s: string) => Number(s.replace(/,/g, ""));

const EMIRATE_WORDS: [RegExp, string][] = [
  [/\babu\s*dhabi\b/i, "abu-dhabi"],
  [/\bdubai\b|jebel\s*ali|al\s*quoz|deira\b|al\s*khawaneej/i, "dubai"],
  [/\bsharjah\b|khor\s*fakkan|al\s*dhaid/i, "sharjah"],
  [/\bajman\b/i, "ajman"],
  [/\bumm\s*al\s*quwain\b/i, "umm-al-quwain"],
  [/\bras\s*al\s*khaimah\b|\brak\b/i, "ras-al-khaimah"],
  [/\bfujairah\b|dibba\b/i, "fujairah"],
];

const foundIn = (docName: string, page: number) => `${docName}${page > 0 ? ` — page ${page}` : ""}`;

type Hit = { value: string; page: number; note?: string; confirmed?: boolean };

/** First regex match with a capture group, scanning per-page text. */
const first = (pages: string[], re: RegExp, group = 1): Hit | null => {
  for (let p = 0; p < pages.length; p++) {
    const m = pages[p].match(re);
    if (m?.[group]) return { value: m[group].trim(), page: p + 1 };
  }
  return null;
};

/** Energy figure + unit pair: returns kWh, flagging non-kWh units for confirmation. */
const energyKwh = (pages: string[], near: RegExp[]): Hit | null => {
  for (const keyword of near) {
    for (let p = 0; p < pages.length; p++) {
      const text = pages[p];
      const km = text.match(keyword);
      if (!km) continue;
      const window = text.slice(Math.max(0, km.index! - 80), km.index! + 160);
      // value before unit: "1,284,500 kWh" / "1.28 GWh"
      const vu = window.match(new RegExp(`${NUM}\\s*(kWh|MWh|GWh|units?)\\b`, "i"));
      if (!vu) continue;
      const v = num(vu[1]);
      const unit = vu[2].toLowerCase();
      const kwh = unit === "gwh" ? v * 1e6 : unit === "mwh" ? v * 1e3 : v;
      const note = unit === "kwh" || unit === "units"
        ? undefined
        : `Document says ${vu[1].replace(/,/g, "")} ${unit} — converted to kWh; confirm the unit.`;
      if (!Number.isFinite(kwh) || kwh <= 0) continue;
      return { value: String(Math.round(kwh)), page: p + 1, note, confirmed: !note };
    }
  }
  return null;
};

/** Twelve numbers that look like a monthly kWh row, on one page. */
const monthlyKwh = (pages: string[]): Hit | null => {
  for (let p = 0; p < pages.length; p++) {
    const text = pages[p];
    const marker = text.match(/monthly|jan[a-z]*\s.{0,20}feb[a-z]*\s.{0,20}mar/i);
    if (!marker) continue;
    const window = text.slice(marker.index! + marker[0].length, marker.index! + marker[0].length + 900);
    const unitMwh = /mwh/i.test(marker[0]);
    const raw = [...window.matchAll(new RegExp(`${NUM}\\s*(?:kwh|mwh)`, "gi"))]
      .map((m) => ({ v: num(m[1]), mwh: /mwh/i.test(m[0]) }));
    // An annual total sitting beside the series dwarfs the monthly values — drop outliers >2x the median.
    const median = [...raw.map(x => x.v)].sort((a, b) => a - b)[Math.floor(raw.length / 2)] ?? 0;
    const values = raw.filter(x => x.v <= median * 2.5).slice(0, 12);
    if (values.length >= 6) {
      const kwhs = values.map((x) => Math.round(x.mwh || unitMwh ? x.v * 1e3 : x.v));
      return { value: kwhs.join(","), page: p + 1, note: values.length < 12 ? `Only ${values.length} monthly values found — confirm.` : undefined, confirmed: values.length === 12 };
    }
  }
  return null;
};

export const extractFields = (docName: string, pageTexts: string[]): DocumentFields => {
  const fields: ExtractedField[] = [];
  const push = (key: FieldKey, hit: Hit | null, extra?: string) => {
    if (hit) {
      fields.push({
        key,
        value: hit.value,
        status: hit.confirmed === false || hit.note ? "needs-confirmation" : "found",
        source: foundIn(docName, hit.page),
        note: hit.note,
      });
    } else {
      fields.push({ key, value: "", status: "not-found", source: docName, note: extra });
    }
  };

  const address =
    first(pageTexts, /(?:premises|site|supply address|address|location)[^\n:]{0,25}:\s*([^\n]{6,90})/i) ??
    first(pageTexts, /(dubai industrial city|jebel ali|al quoz|deira|al khawaneej|masdar city|kizad|saif zone|hamriyah|khor fakkan|ruwais|madinat zayed|al ain)[^\n]{0,60}/i);
  push("address", address);

  const name =
    first(pageTexts, /(?:account name|customer name|business name|company|licensee|consumer)[^\n:]{0,15}:\s*([^\n]{3,70})/i) ??
    (address ? null : first(pageTexts, /^\s*([A-Z][A-Za-z0-9& .-]{3,60}(?:LLC|L\.L\.C|FZ|FZE|PJSC|Est\.?|Ltd)\.?)\s*$/m));
  push("name", name);

  const emirateHit = (() => {
    const hay = pageTexts.join("\n");
    for (const [re, emirate] of EMIRATE_WORDS) {
      const m = hay.match(re);
      if (m) {
        const page = pageTexts.findIndex((t) => re.test(t)) + 1;
        return { value: emirate, page: Math.max(1, page), confirmed: true };
      }
    }
    return null;
  })();
  push("emirate", emirateHit);

  const annual = energyKwh(pageTexts, [/annual\s+(?:electricity\s+)?consumption/i, /total\s+(?:annual\s+)?consumption/i, /year\s+(?:to\s+date\s+)?consumption/i, /consumption/i]);
  push("annualKwh", annual, annual ? undefined : "No annual consumption figure was found — enter it manually.");

  push("monthlyKwh", monthlyKwh(pageTexts));

  const load = (() => {
    const re = new RegExp(`(?:approved|sanctioned|connected|contract|maximum)\\s+(?:electrical\\s+)?(?:load|demand|capacity)[^\\n]{0,30}?:?\\s*${NUM}\\s*(kW|kVA|MW)`, "i");
    const m = pageTexts.join("\n").match(re);
    if (!m) return null;
    const page = pageTexts.findIndex((t) => re.test(t)) + 1;
    const v = num(m[1]);
    const unit = m[2].toLowerCase();
    const kw = unit === "mw" ? v * 1e3 : v;
    return {
      value: String(Math.round(kw)), page: Math.max(1, page),
      note: unit === "kva" ? "Document says kVA — treated as kW; confirm the power factor." : unit === "mw" ? "Document says MW — converted to kW; confirm the unit." : undefined,
      confirmed: unit === "kw",
    };
  })();
  push("approvedLoadKw", load);

  const roofArea = (() => {
    const m = pageTexts.join("\n").match(new RegExp(`roof\\s+(?:area|space|surface)[^\\n]{0,25}?:?\\s*${NUM}\\s*(m2|m²|sqm|sq\\.?\\s*m|sq\\.?\\s*ft|ft2|sqft)`, "i"));
    if (!m) return null;
    const page = pageTexts.findIndex((t) => /roof\s+(?:area|space|surface)/i.test(t)) + 1;
    const v = num(m[1]);
    const isFt = /ft|sqft/i.test(m[2]);
    return { value: String(Math.round(isFt ? v / 10.7639 : v)), page: Math.max(1, page), note: isFt ? "Document says sq ft — converted to m²; confirm." : undefined, confirmed: !isFt };
  })();
  push("roofAreaM2", roofArea, "Electricity documents rarely state roof area — leave blank unless a survey says it.");

  const roofType = first(pageTexts, /roof\s+(?:type|construction|material)[^\n:]{0,20}:\s*([^\n]{3,40})/i)
    ?? (pageTexts.join("\n").match(/(concrete|metal|sheet|asphalt|tile|flat)\s+roof/i)
      ? { value: pageTexts.join("\n").match(/(concrete|metal|sheet|asphalt|tile|flat)\s+roof/i)![1], page: pageTexts.findIndex((t) => /(concrete|metal|sheet|asphalt|tile|flat)\s+roof/i.test(t)) + 1, confirmed: true }
      : null);
  push("roofType", roofType);

  const buildingType = first(pageTexts, /(?:building|premises|facility)\s+type[^\n:]{0,20}:\s*([^\n]{3,40})/i)
    ?? (pageTexts.join("\n").match(/\b(warehouse|factory|logistics|office|retail|cold\s*storage|manufacturing|data\s*centre|farm|dairy)\b/i)
      ? { value: pageTexts.join("\n").match(/\b(warehouse|factory|logistics|office|retail|cold\s*storage|manufacturing|data\s*centre|farm|dairy)\b/i)![1], page: pageTexts.findIndex((t) => /\b(warehouse|factory|logistics|office|retail|cold\s*storage|manufacturing|data\s*centre|farm|dairy)\b/i.test(t)) + 1, confirmed: true }
      : null);
  push("buildingType", buildingType);

  return { docName, fields };
};

/** Merge several extracted documents into one field per key; conflicts stay visible. */
export type MergedField = ExtractedField & { alternatives: { value: string; source: string }[] };

export const mergeDocuments = (docs: DocumentFields[]): MergedField[] =>
  FIELD_ORDER.map((key) => {
    const hits = docs.flatMap((d) => d.fields.filter((f) => f.key === key && f.status !== "not-found"));
    if (hits.length === 0) {
      return { key, value: "", status: "not-found", source: docs[0]?.docName ?? "", alternatives: [] };
    }
    const distinct = [...new Map(hits.map((h) => [h.value, h])).values()];
    const primary = hits.find((h) => h.status === "found") ?? hits[0];
    return {
      ...primary,
      status: distinct.length > 1 ? "needs-confirmation" : primary.status,
      alternatives: distinct.slice(1).map((h) => ({ value: h.value, source: h.source })),
      note: distinct.length > 1 ? "Conflict detected — pick the correct value." : primary.note,
    };
  });
