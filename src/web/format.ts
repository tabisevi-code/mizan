/**
 * Formatting helpers shared by the app shell and the compute path, which also
 * runs inside the engine worker. Keep them here, not pasted per file.
 */

export const num = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 });

export const aed = (value: number): string => {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `AED ${(value / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `AED ${Math.round(value / 1e3)}k`;
  return `AED ${Math.round(value)}`;
};

export const kwh = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} GWh`;
  if (value >= 1e3) return `${num.format(Math.round(value / 1e3))} MWh`;
  return `${num.format(value)} kWh`;
};

export const pct = (value: number, places = 1) => `${(value * 100).toFixed(places)}%`;

export const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
