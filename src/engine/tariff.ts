/**
 * UAE electricity tariffs.
 *
 * Every rate below is transcribed from a named utility page with the date it
 * was read. Rates are in AED per kWh. Where a utility publishes a slab
 * structure, the slabs are modelled properly: solar displaces energy at the
 * *marginal* slab, which is the rate that actually decides the saving.
 *
 * Check these before a pitch. Tariffs move, and a stale rate is the fastest way
 * to lose a room.
 */

import type { CustomerClass, Emirate, HourlySeries, Provenance } from "./types";
import { HOURS_PER_YEAR } from "./types";

export type TariffSlab = {
  /** Upper bound of this slab in kWh per month; Infinity for the last one. */
  upToKwhPerMonth: number;
  aedPerKwh: number;
};

export type TimeOfUseWindow = {
  /** Months this window applies to, 1-12 inclusive. */
  months: number[];
  /** Local hours the peak rate applies, start inclusive, end exclusive. */
  startHour: number;
  endHour: number;
  peakAedPerKwh: number;
  offPeakAedPerKwh: number;
};

export type Tariff = {
  id: string;
  utility: string;
  emirate: Emirate;
  /** Set when one utility serves several emirates (EtihadWE, Northern Emirates). */
  emirates?: Emirate[];
  customerClass: CustomerClass;
  /** Energy slabs, or null when the tariff is time-of-use. */
  slabs: TariffSlab[] | null;
  timeOfUse: TimeOfUseWindow | null;
  /** Fuel surcharge added to every kWh. */
  surchargeAedPerKwh: number;
  /** Fixed monthly meter charge in AED. */
  meterChargeAedPerMonth: number;
  vatRate: number;
  /** True when the published rates already include VAT. */
  vatIncluded: boolean;
  provenance: Provenance;
  /** What the utility does with exported kWh. */
  exportTreatment: "credit-rollover-indefinite" | "credit-expires-annually" | "none" | "unknown";
};

const DEWA_SOURCE: Provenance = {
  kind: "authority",
  label: "DEWA slab tariff",
  url: "https://www.dewa.gov.ae/en/consumer/billing/slab-tariff",
  asOf: "2026-09-23",
  caveat: "Fuel surcharge is revised periodically; re-check before quoting.",
};

const ADDC_SOURCE: Provenance = {
  kind: "authority",
  label: "ADDC business rates",
  url: "https://www.addc.ae/en-US/business/Pages/RatesAndTariffs2025.aspx",
  asOf: "2026-09-23",
  caveat: "Transcribed from the 2025 tariff year; the 2026 page was unreachable.",
};

const ETIHADWE_SOURCE: Provenance = {
  kind: "authority",
  label: "EtihadWE tariff page",
  url: "https://etihadwe.ae/en/About/Pages/Tariff.aspx",
  asOf: "2026-09-25",
};

const SEWA_SOURCE: Provenance = {
  kind: "authority",
  label: "SEWA energy calculator",
  url: "https://sewa.gov.ae/en/energy-calculator",
  asOf: "2026-09-25",
};

const SEWA_INDUSTRIAL_SOURCE: Provenance = {
  kind: "assumption",
  label: "SEWA industrial tariff (secondary source)",
  asOf: "2026-09-25",
  caveat:
    "SEWA's own calculator publishes the four-slab commercial schedule only. Industrial slabs are transcribed from secondary compilations and must be confirmed with SEWA before any quote.",
};

const NORTHERN_EMIRATES: Emirate[] = ["ajman", "umm-al-quwain", "ras-al-khaimah", "fujairah"];

export const TARIFFS: Tariff[] = [
  {
    id: "dewa-commercial",
    utility: "DEWA",
    emirate: "dubai",
    customerClass: "commercial",
    slabs: [
      { upToKwhPerMonth: 2000, aedPerKwh: 0.23 },
      { upToKwhPerMonth: 4000, aedPerKwh: 0.28 },
      { upToKwhPerMonth: 6000, aedPerKwh: 0.32 },
      { upToKwhPerMonth: Infinity, aedPerKwh: 0.38 },
    ],
    timeOfUse: null,
    surchargeAedPerKwh: 0.06,
    meterChargeAedPerMonth: 35,
    vatRate: 0.05,
    vatIncluded: false,
    provenance: DEWA_SOURCE,
    exportTreatment: "credit-rollover-indefinite",
  },
  {
    id: "dewa-industrial",
    utility: "DEWA",
    emirate: "dubai",
    customerClass: "industrial",
    slabs: [
      { upToKwhPerMonth: 10000, aedPerKwh: 0.23 },
      { upToKwhPerMonth: Infinity, aedPerKwh: 0.38 },
    ],
    timeOfUse: null,
    surchargeAedPerKwh: 0.06,
    meterChargeAedPerMonth: 35,
    vatRate: 0.05,
    vatIncluded: false,
    provenance: DEWA_SOURCE,
    exportTreatment: "credit-rollover-indefinite",
  },
  {
    id: "addc-commercial",
    utility: "ADDC",
    emirate: "abu-dhabi",
    customerClass: "commercial",
    slabs: [{ upToKwhPerMonth: Infinity, aedPerKwh: 0.2 }],
    timeOfUse: null,
    surchargeAedPerKwh: 0,
    meterChargeAedPerMonth: 0,
    vatRate: 0.05,
    vatIncluded: true,
    provenance: ADDC_SOURCE,
    exportTreatment: "none",
  },
  {
    id: "addc-industrial-sub-1mw",
    utility: "ADDC",
    emirate: "abu-dhabi",
    customerClass: "industrial",
    slabs: [{ upToKwhPerMonth: Infinity, aedPerKwh: 0.286 }],
    timeOfUse: null,
    surchargeAedPerKwh: 0,
    meterChargeAedPerMonth: 0,
    vatRate: 0.05,
    vatIncluded: true,
    provenance: ADDC_SOURCE,
    exportTreatment: "none",
  },
  {
    id: "addc-industrial-over-1mw",
    utility: "ADDC",
    emirate: "abu-dhabi",
    customerClass: "industrial",
    slabs: null,
    timeOfUse: {
      months: [6, 7, 8, 9],
      startHour: 10,
      endHour: 22,
      peakAedPerKwh: 0.366,
      offPeakAedPerKwh: 0.27,
    },
    surchargeAedPerKwh: 0,
    meterChargeAedPerMonth: 0,
    vatRate: 0.05,
    vatIncluded: true,
    provenance: ADDC_SOURCE,
    exportTreatment: "none",
  },
  {
    id: "etihadwe-commercial",
    utility: "EtihadWE",
    emirate: "ajman",
    emirates: NORTHERN_EMIRATES,
    customerClass: "commercial",
    slabs: [
      { upToKwhPerMonth: 2000, aedPerKwh: 0.23 },
      { upToKwhPerMonth: 4000, aedPerKwh: 0.28 },
      { upToKwhPerMonth: 6000, aedPerKwh: 0.32 },
      { upToKwhPerMonth: Infinity, aedPerKwh: 0.38 },
    ],
    timeOfUse: null,
    surchargeAedPerKwh: 0.05,
    meterChargeAedPerMonth: 0,
    vatRate: 0.05,
    vatIncluded: false,
    provenance: ETIHADWE_SOURCE,
    exportTreatment: "credit-expires-annually",
  },
  {
    id: "etihadwe-industrial",
    utility: "EtihadWE",
    emirate: "ajman",
    emirates: NORTHERN_EMIRATES,
    customerClass: "industrial",
    slabs: [{ upToKwhPerMonth: Infinity, aedPerKwh: 0.4 }],
    timeOfUse: null,
    surchargeAedPerKwh: 0.04,
    meterChargeAedPerMonth: 0,
    vatRate: 0.05,
    vatIncluded: false,
    provenance: ETIHADWE_SOURCE,
    exportTreatment: "credit-expires-annually",
  },
  {
    id: "sewa-commercial",
    utility: "SEWA",
    emirate: "sharjah",
    customerClass: "commercial",
    slabs: [
      { upToKwhPerMonth: 2000, aedPerKwh: 0.23 },
      { upToKwhPerMonth: 4000, aedPerKwh: 0.28 },
      { upToKwhPerMonth: 6000, aedPerKwh: 0.32 },
      { upToKwhPerMonth: Infinity, aedPerKwh: 0.38 },
    ],
    timeOfUse: null,
    surchargeAedPerKwh: 0.06,
    meterChargeAedPerMonth: 0,
    vatRate: 0.05,
    vatIncluded: false,
    provenance: SEWA_SOURCE,
    exportTreatment: "unknown",
  },
  {
    id: "sewa-industrial",
    utility: "SEWA",
    emirate: "sharjah",
    customerClass: "industrial",
    slabs: [
      { upToKwhPerMonth: 10000, aedPerKwh: 0.2 },
      { upToKwhPerMonth: Infinity, aedPerKwh: 0.33 },
    ],
    timeOfUse: null,
    surchargeAedPerKwh: 0.06,
    meterChargeAedPerMonth: 0,
    vatRate: 0.05,
    vatIncluded: false,
    provenance: SEWA_INDUSTRIAL_SOURCE,
    exportTreatment: "unknown",
  },
];

export type TariffSelection = {
  emirate: Emirate;
  customerClass: CustomerClass;
  /** Peak demand in kW, used to pick the ADDC over-1-MW tariff. */
  peakDemandKw?: number;
};

export const selectTariff = (selection: TariffSelection): Tariff | null => {
  const candidates = TARIFFS.filter(
    (tariff) =>
      (tariff.emirates ? tariff.emirates.includes(selection.emirate) : tariff.emirate === selection.emirate) &&
      tariff.customerClass === selection.customerClass,
  );
  if (candidates.length === 0) return null;
  if (selection.emirate === "abu-dhabi" && selection.customerClass === "industrial") {
    const overMw = (selection.peakDemandKw ?? 0) > 1000;
    return (
      candidates.find((tariff) =>
        overMw ? tariff.id === "addc-industrial-over-1mw" : tariff.id === "addc-industrial-sub-1mw",
      ) ?? candidates[0]
    );
  }
  return candidates[0];
};

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Month index 0-11 for an hour of the year. */
const monthIndex = (hourOfYear: number): number => {
  let remaining = Math.floor(hourOfYear / 24) + 1;
  for (let month = 0; month < 12; month += 1) {
    if (remaining <= MONTH_LENGTHS[month]) return month;
    remaining -= MONTH_LENGTHS[month];
  }
  return 11;
};

/** The rate the *next* kWh in that month costs, before VAT. */
export const marginalRate = (
  tariff: Tariff,
  monthlyKwh: number,
  hourOfYear: number,
): number => {
  if (tariff.timeOfUse) {
    const month = monthIndex(hourOfYear) + 1;
    const hour = hourOfYear % 24;
    const inPeakMonth = tariff.timeOfUse.months.includes(month);
    const inPeakHour = hour >= tariff.timeOfUse.startHour && hour < tariff.timeOfUse.endHour;
    const base =
      inPeakMonth && inPeakHour
        ? tariff.timeOfUse.peakAedPerKwh
        : tariff.timeOfUse.offPeakAedPerKwh;
    return base + tariff.surchargeAedPerKwh;
  }

  const slabs = tariff.slabs ?? [];
  for (const slab of slabs) {
    if (monthlyKwh < slab.upToKwhPerMonth) return slab.aedPerKwh + tariff.surchargeAedPerKwh;
  }
  const last = slabs[slabs.length - 1];
  return (last?.aedPerKwh ?? 0) + tariff.surchargeAedPerKwh;
};

export type BillResult = {
  energyAed: number;
  meterAed: number;
  vatAed: number;
  totalAed: number;
  /** Effective AED per kWh actually paid, including VAT and fixed charges. */
  effectiveAedPerKwh: number;
};

/**
 * Cost of a year of imports, respecting slabs month by month.
 * `importKw` is the hourly import series in kW (equal to kWh for hourly steps).
 */
export const annualBill = (tariff: Tariff, importSeries: HourlySeries): BillResult => {
  let energyAed = 0;
  let totalKwh = 0;
  let runningMonth = 0;
  let monthAccumulator = 0;

  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const month = monthIndex(hour);
    if (month !== runningMonth) {
      runningMonth = month;
      monthAccumulator = 0;
    }
    const kwh = importSeries[hour];
    if (kwh <= 0) continue;
    // Charge each kWh at the slab it falls into as the month accumulates.
    energyAed += kwh * marginalRate(tariff, monthAccumulator, hour);
    monthAccumulator += kwh;
    totalKwh += kwh;
  }

  const meterAed = tariff.meterChargeAedPerMonth * 12;
  const subtotal = energyAed + meterAed;
  const vatAed = tariff.vatIncluded ? 0 : subtotal * tariff.vatRate;
  const totalAed = subtotal + vatAed;

  return {
    energyAed,
    meterAed,
    vatAed,
    totalAed,
    effectiveAedPerKwh: totalKwh > 0 ? totalAed / totalKwh : 0,
  };
};
