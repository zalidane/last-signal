import type { RescueConfig } from "../models/types.ts";

export function rollRescueDay(next: () => number, cfg: RescueConfig): number {
  const span = cfg.rollMax - cfg.rollMin + 1;
  return cfg.rollMin + Math.floor(next() * span);
}

/**
 * Each dawn the signal stayed lit pulls the hidden rescue day forward by one.
 * It cannot arrive before minDay, so a beacon is influence, not a cheat code.
 */
export function effectiveRescueDay(
  baseDay: number,
  signalDays: number,
  cfg: RescueConfig,
): number {
  return Math.max(cfg.minDay, baseDay - signalDays);
}
