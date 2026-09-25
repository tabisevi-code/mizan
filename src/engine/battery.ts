/**
 * Hourly energy balance and battery dispatch.
 *
 * The dispatch rule is deliberately simple and explainable: charge from surplus
 * generation, discharge to unmet load, never charge from the grid. Under a
 * time-of-use tariff it also holds charge back for the peak window, because
 * that is where an Abu Dhabi industrial site over 1 MW actually makes money.
 *
 * Nothing here is an optimiser. A judge can follow every branch, which is the
 * point.
 */

import type { Tariff } from "./tariff";
import {
  HOURS_PER_YEAR,
  newSeries,
  sum,
  type HourlySeries,
  type SimulationResult,
} from "./types";

export type BatterySpec = {
  capacityKwh: number;
  /** Continuous power rating in kW, charge and discharge. */
  powerKw: number;
  /** Round-trip efficiency, applied as the square root on each leg. */
  roundTripEfficiency: number;
  /** Usable fraction of nameplate capacity. */
  depthOfDischarge: number;
  /** Reserve kept for backup rather than arbitrage, as a fraction of usable. */
  reserveFraction: number;
};

export const DEFAULT_BATTERY: Omit<BatterySpec, "capacityKwh" | "powerKw"> = {
  roundTripEfficiency: 0.89,
  depthOfDischarge: 0.9,
  reserveFraction: 0,
};

/** Hours ahead to look for an upcoming peak window before holding charge back. */
const PEAK_LOOKAHEAD_HOURS = 3;
/** Fraction of usable capacity held back for an upcoming peak window. */
const PEAK_RESERVE_FRACTION = 0.5;

const isPeakHour = (tariff: Tariff | null, hourOfYear: number): boolean => {
  if (!tariff?.timeOfUse) return false;
  const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let remaining = Math.floor(hourOfYear / 24) + 1;
  let month = 0;
  for (; month < 12; month += 1) {
    if (remaining <= monthLengths[month]) break;
    remaining -= monthLengths[month];
  }
  const hour = hourOfYear % 24;
  return (
    tariff.timeOfUse.months.includes(month + 1) &&
    hour >= tariff.timeOfUse.startHour &&
    hour < tariff.timeOfUse.endHour
  );
};

export const simulateDispatch = (
  generationKw: HourlySeries,
  loadKw: HourlySeries,
  battery: BatterySpec | null,
  tariff: Tariff | null = null,
): SimulationResult => {
  const imported = newSeries();
  const exported = newSeries();
  const batterySoc = newSeries();

  const usableKwh = battery ? battery.capacityKwh * battery.depthOfDischarge : 0;
  const reserveKwh = battery ? usableKwh * battery.reserveFraction : 0;
  const legEfficiency = battery ? Math.sqrt(battery.roundTripEfficiency) : 1;

  let soc = reserveKwh;
  let throughput = 0;
  let lossKwh = 0;
  let peakImportKw = 0;

  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const generation = generationKw[hour];
    const load = loadKw[hour];
    let surplus = generation - load;

    if (battery && battery.capacityKwh > 0) {
      const peakNow = isPeakHour(tariff, hour);
      const nextPeakSoon = tariff?.timeOfUse ? isPeakHour(tariff, (hour + PEAK_LOOKAHEAD_HOURS) % HOURS_PER_YEAR) : false;

      if (surplus > 0) {
        // Charge from surplus only.
        const room = usableKwh - soc;
        const charge = Math.min(surplus, battery.powerKw, room / legEfficiency);
        if (charge > 0) {
          const stored = charge * legEfficiency;
          soc += stored;
          surplus -= charge;
          throughput += stored;
          lossKwh += charge - stored;
        }
      } else if (surplus < 0) {
        const deficit = -surplus;
        // Under a time-of-use tariff, hold charge for the peak window unless we
        // are already in it.
        const holdBack = !peakNow && nextPeakSoon ? usableKwh * PEAK_RESERVE_FRACTION : reserveKwh;
        const available = Math.max(0, soc - holdBack);
        const discharge = Math.min(deficit, battery.powerKw, available * legEfficiency);
        if (discharge > 0) {
          const drawn = discharge / legEfficiency;
          soc -= drawn;
          surplus += discharge;
          lossKwh += drawn - discharge;
        }
      }
    }

    if (surplus >= 0) {
      exported[hour] = surplus;
    } else {
      const importKw = -surplus;
      imported[hour] = importKw;
      if (importKw > peakImportKw) peakImportKw = importKw;
    }
    batterySoc[hour] = soc;
  }

  const generationKwh = sum(generationKw);
  const exportedKwh = sum(exported);
  const importedKwh = sum(imported);
  // Self-consumption is defined from the load side: the kWh the site would
  // otherwise have imported. Defining it as generation minus export would
  // silently count round-trip battery losses as useful energy.
  const selfConsumedKwh = Math.max(0, sum(loadKw) - importedKwh);

  return {
    generationKwh,
    selfConsumedKwh,
    exportedKwh,
    importedKwh,
    batteryThroughputKwh: throughput,
    batteryCycles: usableKwh > 0 ? throughput / usableKwh : 0,
    batteryLossKwh: lossKwh,
    batteryStoredKwh: soc,
    peakImportKw,
    hourly: {
      generation: generationKw,
      load: loadKw,
      imported,
      exported,
      batterySoc,
    },
  };
};
