// Generates demo/demo-site-annual-statement.pdf — a realistic DEWA-style
// annual statement for the "Analyze your own site" upload demo.
// Hand-written minimal PDF: one page, Helvetica text lines, valid xref.
import { writeFileSync, mkdirSync } from "node:fs";

const lines = [
  "DEWA - Annual Electricity Statement",
  "Account name: Falcon Ridge Logistics LLC",
  "Premises address: Dubai Industrial City, Dubai, United Arab Emirates",
  "Building type: Warehouse",
  "",
  "Supply details",
  "Approved load: 420 kW",
  "Meter type: Smart AMI",
  "",
  "Annual consumption summary",
  "Annual electricity consumption: 1,284,500 kWh",
  "Monthly consumption (kWh): Jan 94,900 kWh  Feb 87,700 kWh  Mar 101,400 kWh  Apr 105,800 kWh  May 114,100 kWh  Jun 118,300 kWh",
  "                           Jul 124,900 kWh  Aug 122,600 kWh  Sep 115,400 kWh  Oct 109,000 kWh  Nov 98,200 kWh  Dec 92,200 kWh",
  "",
  "Site survey appendix",
  "Roof area: 6,200 m2",
  "Roof construction: concrete",
  "",
  "Prepared for demonstration - figures are illustrative.",
];

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const text = ["BT", "/F1 11 Tf", "50 780 Td", "14 TL"];
lines.forEach((l, i) => {
  if (i > 0) text.push("T*");
  if (l) text.push(`(${esc(l)}) Tj`);
});
text.push("ET");
const stream = text.join("\n");
const streamBytes = Buffer.byteLength(stream, "latin1");

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];

let pdf = "%PDF-1.4\n";
const offsets = [];
objects.forEach((obj, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
});
const xrefPos = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
offsets.forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

mkdirSync("demo", { recursive: true });
writeFileSync("demo/demo-site-annual-statement.pdf", pdf, "latin1");
console.log("wrote demo/demo-site-annual-statement.pdf");
