import type { DawnLine, GameData, MomentLines, RunState } from "../models/types.ts";
import { isDark } from "./pace.ts";
import { bandAt, isHeatBand } from "./time.ts";

/**
 * Flavor text must not assert things that are not true right now: an ankle you did not hurt,
 * a sun that has set, a fire that was never built. These helpers pick the variant that fits.
 */
export type Moment = "night" | "heat" | "day";

export function momentAt(hour: number, data: GameData): Moment {
  if (isDark(hour, data)) return "night";
  if (isHeatBand(bandAt(hour, data.biome).id)) return "heat";
  return "day";
}

export function pickMoment(lines: MomentLines, hour: number, data: GameData): string {
  const moment = momentAt(hour, data);
  return moment === "night" ? lines.night : moment === "heat" ? lines.heat : lines.neutral;
}

const WOUNDS = ["snakebite", "scorpion", "laceration", "infection", "bandaged-cut-dirty", "bandaged-cut"];

/** A travel aside about what actually hurts, or "" when nothing does. */
export function injuryNote(state: RunState, data: GameData): string {
  const copy = data.copy.travel.injury;
  if (state.sprainHours > 0) return copy.ankle;
  const active = state.conditions.filter((condition) => condition.hoursLeft > 0).map((condition) => condition.id);
  const worst = WOUNDS.find((id) => active.includes(id));
  if (!worst) return "";
  if (worst === "snakebite") return copy.snakebite;
  const name = (data.conditions[worst]?.name ?? "wound").toLowerCase();
  return copy.wound.replace("{wound}", name);
}

export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** "You leave camp…", "You turn back…": time-of-day variant plus an injury aside only if injured. */
export function travelLine(
  kind: "leave" | "back",
  state: RunState,
  data: GameData,
  vars: Record<string, string | number>,
): string {
  return fill(pickMoment(data.copy.travel[kind], state.hour, data), vars) + injuryNote(state, data);
}

export function arriveCampLine(state: RunState, data: GameData): string {
  return pickMoment(data.copy.travel.arrive, state.hour, data);
}

export function dawnLineFor(entry: string | DawnLine | undefined, atCamp: boolean, asleep: boolean): string {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  if (!atCamp && entry.away) return entry.away;
  if (!asleep && entry.awake) return entry.awake;
  return entry.text;
}

/** True if any hour of [hour, hour + hours) is dark. */
export function spansDark(hour: number, hours: number, data: GameData): boolean {
  for (let i = 0; i < hours; i += 1) if (isDark(hour + i, data)) return true;
  return false;
}
