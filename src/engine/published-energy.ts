import { MONTH_HOURS } from "./calendar";

/** Nameplate storage: MW power, MWh energy, round-trip efficiency as a fraction. */
export type StorageSpec = { powerMw: number; energyMwh: number; roundTripEfficiency: number };

/** A capacity-factor sensitivity, not a reconstruction of measured generation. */
export function capacityFactorMonthly(capacityKw: number, factor: number): number[] {
  if (!Number.isFinite(capacityKw) || capacityKw < 0 || !Number.isFinite(factor) || factor < 0 || factor > 1) throw new Error("Invalid generation scenario");
  return MONTH_HOURS.map(h => h * capacityKw * factor);
}

export function storageCycle(storage: StorageSpec, fraction: number) {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1 || storage.powerMw <= 0 || storage.energyMwh <= 0 || storage.roundTripEfficiency <= 0 || storage.roundTripEfficiency > 1) throw new Error("Invalid storage scenario");
  const deliveredMwh = storage.energyMwh * fraction;
  const chargingMwh = deliveredMwh / storage.roundTripEfficiency;
  return { deliveredMwh, chargingMwh, lossMwh: chargingMwh - deliveredMwh, dischargeHours: deliveredMwh / storage.powerMw };
}
