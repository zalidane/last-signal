import type { BandDef, BandId, BiomeConfig } from "../models/types.ts";

export function bandAt(hour: number, biome: BiomeConfig): BandDef {
  const h = ((hour % 24) + 24) % 24;
  const band = biome.hours.find((row) => h >= row.from && h < row.to);
  if (!band) {
    throw new Error(`No biome band covers hour ${h}`);
  }
  return band;
}

/** Hours until the clock next reads 06:00. At 06:00 this is a full day. */
export function hoursUntilDawn(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 6) return 6 - h;
  return 24 - h + 6;
}

export function isHeatBand(id: BandId): boolean {
  return id === "hot" || id === "extreme";
}
