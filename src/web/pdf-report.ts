/**
 * Turn a SiteReport into a readable A4 PDF.
 *
 * The JSON report is for systems; this is for people. Same numbers, laid out
 * so a facilities manager or a finance director can read it without knowing
 * what a kWp is: what was found, what it is worth, and what to do next, each
 * step with the benefit it brings. Everything on the page comes from the
 * structured report — it draws, it does not re-derive.
 *
 * jsPDF is imported lazily: it outweighs the rest of the app and only earns
 * its bytes when someone actually asks for a PDF.
 */

import type { jsPDF } from "jspdf";
import type { SiteReport } from "../engine/report";

const MARGIN = 48;
const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

// Palette kept close to the app's ink/paper/amber.
const INK: [number, number, number] = [33, 33, 36];
const DIM: [number, number, number] = [107, 105, 99];
const FAINT: [number, number, number] = [153, 151, 143];
const LINE: [number, number, number] = [227, 225, 217];
const BG: [number, number, number] = [245, 243, 237];
const AMBER: [number, number, number] = [217, 148, 46];
const AMBER_LIGHT: [number, number, number] = [237, 194, 115];
const GREEN: [number, number, number] = [46, 158, 92];
const GREEN_SOFT: [number, number, number] = [230, 245, 232];
const RED: [number, number, number] = [191, 61, 43];
const RED_SOFT: [number, number, number] = [248, 232, 227];
const WARN_SOFT: [number, number, number] = [250, 242, 222];

const STATUS_COLOR = { good: GREEN, warn: AMBER, stop: RED } as const;
const STATUS_BG = { good: GREEN_SOFT, warn: WARN_SOFT, stop: RED_SOFT } as const;
const STATUS_WORD = { good: "Recommended", warn: "Worth a closer look", stop: "Not recommended" } as const;

const num = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 });
const aed = (v: number) => `AED ${num.format(Math.round(v))}`;
const kwh = (v: number) => `${num.format(Math.round(v))} kWh`;

export type PdfReportInput = {
  report: SiteReport;
  /** Modelled generation per calendar month for the recommended array, kWh. */
  monthlyKwh: number[] | null;
  /** Cumulative net cash position per year (index 0 = end of year 1), AED. */
  cashflowCumulativeAed: number[] | null;
};

const fill = (doc: jsPDF, rgb: [number, number, number]) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
const stroke = (doc: jsPDF, rgb: [number, number, number]) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
const ink = (doc: jsPDF, rgb: [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

const text = (
  doc: jsPDF,
  x: number,
  y: number,
  s: string,
  options: { size?: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; align?: "left" | "center" | "right" } = {},
) => {
  doc.setFont("helvetica", options.bold ? "bold" : options.italic ? "italic" : "normal");
  doc.setFontSize(options.size ?? 10);
  ink(doc, options.color ?? INK);
  doc.text(s, x, y, { align: options.align ?? "left" });
};

const wrap = (doc: jsPDF, s: string, size: number, maxWidth: number, bold = false): string[] => {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  return doc.splitTextToSize(s, maxWidth) as string[];
};

const box = (doc: jsPDF, x: number, y: number, w: number, h: number, rgb: [number, number, number], border?: [number, number, number]) => {
  fill(doc, rgb);
  if (border) {
    stroke(doc, border);
    doc.setLineWidth(0.75);
    doc.rect(x, y, w, h, "FD");
  } else {
    doc.rect(x, y, w, h, "F");
  }
};

const rule = (doc: jsPDF, x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = LINE, width = 0.6) => {
  stroke(doc, rgb);
  doc.setLineWidth(width);
  doc.line(x1, y1, x2, y2);
};

const heading = (doc: jsPDF, w: number, y: number, title: string, sub?: string): number => {
  text(doc, MARGIN, y + 10, title, { size: 11, bold: true });
  if (sub) text(doc, MARGIN + w, y + 10, sub, { size: 8.5, color: FAINT, align: "right" });
  return y + 22;
};

const barChart = (
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  values: number[],
  labels: string[],
): void => {
  const max = Math.max(...values, 1);
  const plotH = h - 16;
  const gap = 6;
  const barW = (w - gap * (values.length + 1)) / values.length;
  rule(doc, x, y + plotH, x + w, y + plotH, [191, 189, 181], 0.8);
  rule(doc, x, y + plotH / 2, x + w, y + plotH / 2, LINE, 0.4);
  text(doc, x - 4, y + 4, `${num.format(Math.round(max / 1000))} MWh`, { size: 7.5, color: FAINT, align: "right" });
  values.forEach((value, i) => {
    const bh = Math.max(1.5, (value / max) * plotH);
    const bx = x + gap + i * (barW + gap);
    box(doc, bx, y + plotH - bh, barW, bh, AMBER);
    text(doc, bx + barW / 2, y + plotH + 11, labels[i] ?? "", { size: 7.5, color: DIM, align: "center" });
  });
};

const cumulativeChart = (
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  cumulative: number[],
): void => {
  const min = Math.min(...cumulative, 0);
  const max = Math.max(...cumulative, 0);
  const span = Math.max(1e-9, max - min);
  const plotH = h - 20;
  const px = (i: number) => x + (i / (cumulative.length - 1)) * w;
  const py = (v: number) => y + plotH - ((v - min) / span) * plotH;

  rule(doc, x, py(0), x + w, py(0), [191, 189, 181], 0.8);
  stroke(doc, AMBER);
  doc.setLineWidth(1.6);
  doc.lines(
    cumulative.slice(1).map((v, i) => [px(i + 1) - px(i), py(v) - py(cumulative[i])]),
    px(0),
    py(cumulative[0]),
    [1, 1],
    "S",
  );
  fill(doc, AMBER);
  doc.circle(px(0), py(cumulative[0]), 2.2, "F");
  doc.circle(px(cumulative.length - 1), py(cumulative[cumulative.length - 1]), 2.2, "F");

  // Axis labels stay inside the plot: nothing may print past the right edge.
  doc.setFontSize(7.5);
  const maxLabel = aed(max);
  text(doc, x + w - doc.getTextWidth(maxLabel), y + 1, maxLabel, { size: 7.5, color: FAINT });
  const minLabel = aed(min);
  text(doc, x + w - doc.getTextWidth(minLabel), py(min) + 9, minLabel, { size: 7.5, color: FAINT });
  for (const year of [1, Math.ceil(cumulative.length / 2), cumulative.length]) {
    text(doc, px(year - 1), y + plotH + 11, `yr ${year}`, { size: 7.5, color: DIM, align: "center" });
  }

  // The payback point is where the line crosses zero.
  for (let i = 0; i < cumulative.length; i += 1) {
    if (cumulative[i] >= 0) {
      const fraction = i === 0 ? 0 : i - 1 + -cumulative[i - 1] / (cumulative[i] - cumulative[i - 1]);
      const crossX = x + (fraction / (cumulative.length - 1)) * w;
      fill(doc, GREEN);
      doc.circle(crossX, py(0), 3, "F");
      text(doc, crossX, py(0) - 7, "pays back", { size: 7.5, bold: true, color: GREEN, align: "center" });
      break;
    }
  }
};

const stackedBar = (
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  self: number,
  exported: number,
): void => {
  const total = Math.max(1e-9, self + exported);
  const selfW = (self / total) * w;
  box(doc, x, y, selfW, 14, GREEN);
  box(doc, x + selfW, y, w - selfW, 14, AMBER_LIGHT);
  const selfPct = Math.round((self / total) * 100);
  if (selfW > 70) text(doc, x + 8, y + 10, `used on site ${selfPct}%`, { size: 8.5, bold: true, color: [255, 255, 255] });
  if (w - selfW > 70) text(doc, x + w - 8, y + 10, `exported ${100 - selfPct}%`, { size: 8.5, bold: true, align: "right" });

  // Captions: the right-hand one only prints when it clears the left-hand one.
  const left = `${kwh(self)} used the hour it is made`;
  const right = `${kwh(exported)} exported (credited, not paid)`;
  doc.setFontSize(8);
  const leftW = doc.getTextWidth(left);
  const rightW = doc.getTextWidth(right);
  text(doc, x, y + 27, left, { size: 8, color: DIM });
  if (x + leftW + 12 < x + w - rightW) {
    text(doc, x + w, y + 27, right, { size: 8, color: DIM, align: "right" });
  }
};

const effortBadge = (doc: jsPDF, xRight: number, y: number, effort: string): void => {
  const label = `${effort} effort`;
  doc.setFontSize(7.5);
  const w = doc.getTextWidth(label) + 10;
  box(doc, xRight - w, y, w, 13, BG, LINE);
  text(doc, xRight - w / 2, y + 9.5, label, { size: 7.5, color: DIM, align: "center" });
};

const actionList = (doc: jsPDF, w: number, y: number, report: SiteReport, pageH: number): number => {
  for (const step of report.actions) {
    const detailLines = wrap(doc, step.detail, 8.5, w - 26);
    const benefitLines = wrap(doc, `Benefit: ${step.benefit}`, 8.5, w - 26);
    const needed = 30 + (detailLines.length + benefitLines.length) * 11 + 22;
    if (y + needed > pageH - 60) {
      doc.addPage();
      y = MARGIN;
    }
    fill(doc, AMBER);
    doc.circle(MARGIN + 9, y + 8, 9, "F");
    text(doc, MARGIN + 9, y + 11.5, String(step.order), { size: 9, bold: true, color: [255, 255, 255], align: "center" });
    text(doc, MARGIN + 26, y + 9, step.action, { size: 10, bold: true });
    effortBadge(doc, MARGIN + w, y + 2, step.effort);

    let cursor = y + 22;
    for (const line of detailLines) {
      text(doc, MARGIN + 26, cursor, line, { size: 8.5, color: DIM });
      cursor += 11;
    }
    for (const line of benefitLines) {
      text(doc, MARGIN + 26, cursor, line, { size: 8.5, color: GREEN });
      cursor += 11;
    }
    if (step.benefitAedPerYear !== undefined) {
      text(doc, MARGIN + 26, cursor, `Value: ${aed(step.benefitAedPerYear)} per year`, { size: 8.5, bold: true, color: GREEN });
      cursor += 11;
    } else if (step.benefitKwp !== undefined) {
      text(doc, MARGIN + 26, cursor, `Unlocks: ${num.format(step.benefitKwp)} kWp of roof`, { size: 8.5, bold: true, color: GREEN });
      cursor += 11;
    }
    y = cursor + 10;
    rule(doc, MARGIN + 26, y - 4, MARGIN + w, y - 4, LINE, 0.4);
  }
  return y;
};

export const siteReportPdf = async (input: PdfReportInput): Promise<Uint8Array> => {
  const { jsPDF } = await import("jspdf");
  const { report } = input;
  const rec = report.recommendation;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const w = pageW - MARGIN * 2;
  let y = MARGIN;

  // --- header ----------------------------------------------------------------
  text(doc, MARGIN, y + 9, "MIZAN", { size: 9, bold: true, color: AMBER });
  text(doc, MARGIN + w, y + 9, "Rooftop solar screening", { size: 9, color: FAINT, align: "right" });
  y += 20;
  text(doc, MARGIN, y + 15, report.site.name, { size: 17, bold: true });
  text(doc, MARGIN + w, y + 14, report.generatedAt.slice(0, 10), { size: 9, color: FAINT, align: "right" });
  y += 24;
  text(
    doc,
    MARGIN,
    y + 9,
    `Solar screening report - ${report.site.sector.replace(/-/g, " ")} - ${report.site.emirate.replace(/-/g, " ")}`,
    { size: 9.5, color: DIM },
  );
  y += 26;

  // --- verdict: the box is sized to the reason, never the other way round ------
  const reasonLines = wrap(doc, report.verdict.reason, 8.5, w - 28);
  const verdictH = 34 + reasonLines.length * 11 + 10;
  box(doc, MARGIN, y, w, verdictH, STATUS_BG[report.verdict.status]);
  box(doc, MARGIN, y, 4, verdictH, STATUS_COLOR[report.verdict.status]);
  text(doc, MARGIN + 14, y + 14, STATUS_WORD[report.verdict.status].toUpperCase(), {
    size: 8,
    bold: true,
    color: STATUS_COLOR[report.verdict.status],
  });
  text(doc, MARGIN + 14, y + 28, report.verdict.headline, { size: 11.5, bold: true });
  reasonLines.forEach((line, i) => {
    text(doc, MARGIN + 14, y + 41 + i * 11, line, { size: 8.5, color: DIM });
  });
  y += verdictH + 14;

  if (rec) {
    // --- KPI strip -------------------------------------------------------------
    const gap = 8;
    const bw = (w - gap * 3) / 4;
    const kpis: [string, string, string][] = [
      ["System size", `${num.format(rec.roofSolarKwp)} kW`, `${num.format(rec.moduleCount)} panels, ${rec.layout === "east-west" ? "east-west" : "south"}`],
      ["Year-one saving", aed(rec.firstYearSavingsAed), "off the electricity bill"],
      ["Pays back in", rec.simplePaybackYears === null ? "never" : `${rec.simplePaybackYears} yrs`, rec.irrPct !== null ? `${rec.irrPct}% IRR over 25 yrs` : "no IRR"],
      ["Own power share", `${num.format(rec.renewableSharePct)}%`, `${kwh(rec.generationKwhPerYear)} a year`],
    ];
    kpis.forEach(([label, value, sub], i) => {
      const x = MARGIN + i * (bw + gap);
      box(doc, x, y, bw, 52, BG);
      text(doc, x + 9, y + 13, label.toUpperCase(), { size: 7, bold: true, color: FAINT });
      text(doc, x + 9, y + 31, value, { size: 13, bold: true });
      text(doc, x + 9, y + 45, sub, { size: 7.5, color: DIM });
    });
    y += 66;

    // --- monthly generation ----------------------------------------------------
    if (input.monthlyKwh && input.monthlyKwh.length === 12) {
      y = heading(doc, w, y, "What it would generate each month", `${kwh(rec.generationKwhPerYear)} per year`);
      barChart(doc, MARGIN, y + 4, w, 130, input.monthlyKwh, MONTH_INITIALS);
      y += 146;
    }

    // --- energy split ------------------------------------------------------------
    y = heading(doc, w, y, "Where the energy goes");
    stackedBar(doc, MARGIN, y, w, rec.selfConsumedKwhPerYear, rec.exportedKwhPerYear);
    y += 44;

    // --- cumulative cash -----------------------------------------------------------
    if (input.cashflowCumulativeAed && input.cashflowCumulativeAed.length > 0) {
      y = heading(doc, w, y, "Money paid against money saved", "cumulative over 25 years");
      cumulativeChart(doc, MARGIN + 10, y + 4, w - 30, 120, input.cashflowCumulativeAed);
      y += 136;
    }
  }

  // --- actions -----------------------------------------------------------------
  doc.addPage();
  y = MARGIN;
  y = heading(doc, w, y, "What to do next, in order", "each step with the benefit it brings");
  y = actionList(doc, w, y + 4, report, pageH);

  // --- alternatives ---------------------------------------------------------------
  if (report.alternatives.length > 0) {
    if (y + 120 > pageH - 60) {
      doc.addPage();
      y = MARGIN;
    }
    y = heading(doc, w, y + 10, "Other options considered", "ranked by 25-year value");
    const cols = Array.from({ length: 5 }, (_, i) => MARGIN + (i / 5) * w);
    box(doc, MARGIN, y, w, 16, BG);
    const heads = ["Size", "Battery", "Cost to build", "Payback", "25-yr value"];
    heads.forEach((h, i) => text(doc, cols[i] + 4, y + 11, h.toUpperCase(), { size: 7, bold: true, color: FAINT }));
    y += 16;
    report.alternatives.slice(0, 4).forEach((alt) => {
      const cells = [
        `${num.format(alt.roofSolarKwp)} kW`,
        alt.batteryKwh > 0 ? `${num.format(alt.batteryKwh)} kWh` : "none",
        aed(alt.capexAed),
        alt.simplePaybackYears === null ? "never" : `${alt.simplePaybackYears} yrs`,
        aed(alt.npvAed),
      ];
      cells.forEach((c, i) => text(doc, cols[i] + 4, y + 11, c, { size: 8.5 }));
      rule(doc, MARGIN, y + 16, MARGIN + w, y + 16, LINE, 0.4);
      y += 16;
    });
    y += 8;
  }

  // --- financing -----------------------------------------------------------------
  if (report.financing) {
    if (y + 50 > pageH - 60) {
      doc.addPage();
      y = MARGIN;
    }
    box(doc, MARGIN, y, w, 34, GREEN_SOFT);
    box(doc, MARGIN, y, 4, 34, GREEN);
    text(doc, MARGIN + 12, y + 13, report.financing.verdict === "own" ? "Buying beats a PPA here" : "A PPA beats buying here", {
      size: 9.5,
      bold: true,
    });
    wrap(doc, report.financing.explanation, 8, w - 24).forEach((line, i) => {
      text(doc, MARGIN + 12, y + 24 + i * 10, line, { size: 8, color: DIM });
    });
    y += 46;
  }

  // --- caveats --------------------------------------------------------------------
  if (report.caveats.length > 0) {
    if (y + 90 > pageH - 50) {
      doc.addPage();
      y = MARGIN;
    }
    y = heading(doc, w, y + 8, "What this rests on");
    for (const caveat of report.caveats) {
      wrap(doc, caveat, 8, w - 10).forEach((line, i) => {
        text(doc, MARGIN + (i === 0 ? 0 : 8), y + 8, i === 0 ? `- ${line}` : line, { size: 8, color: FAINT });
        y += 10.5;
      });
    }
  }

  // --- footers ----------------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    rule(doc, MARGIN, pageH - 40, MARGIN + w, pageH - 40, LINE, 0.5);
    text(doc, MARGIN, pageH - 27, "Screening estimate, not a quotation. Generated by Mizan.", { size: 7.5, color: FAINT });
    text(doc, MARGIN + w, pageH - 27, `page ${i} of ${pages}`, { size: 7.5, color: FAINT, align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
};
