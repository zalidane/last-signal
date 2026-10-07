import type { FatigueTier, GameData, RunState } from "../models/types.ts";
import { hasBudgetFlag } from "./needs.ts";

/**
 * Pace replaces the old daily work-hour budget. Nothing is gated on hours any more:
 * every action simply costs clock time, scaled by fatigue, darkness, and strain.
 */

export type LightSource = "day" | "fire" | "torch" | "none";

export function isDark(hour: number, data: GameData): boolean {
  const h = ((hour % 24) + 24) % 24;
  const { fromHour, toHour } = data.needs.darkness;
  return fromHour > toHour ? h >= fromHour || h < toHour : h >= fromHour && h < toHour;
}

/** What lights the next action. A torch is only counted if one is in the pack. */
export function lightAt(state: RunState, data: GameData, allowTorch = true): LightSource {
  if (!isDark(state.hour, data)) return "day";
  if (state.location === "camp" && state.camp.firePit) return "fire";
  if (allowTorch && (state.inventory.torch ?? 0) >= 1) return "torch";
  return "none";
}

export function fatigueTier(fatigue: number, data: GameData): FatigueTier | null {
  let found: FatigueTier | null = null;
  for (const tier of data.needs.fatigue.tiers) if (fatigue >= tier.above) found = tier;
  return found;
}

export interface Strain {
  slow: number;
  risk: number;
  notes: string[];
}

/** The old budget rules, now as slowdown and hazard odds instead of lost hours. */
export function computeStrain(state: RunState, data: GameData): Strain {
  let slow = 0;
  let risk = 0;
  const notes: string[] = [];
  for (const rule of data.needs.strain.rules) {
    let hit = false;
    if (rule.meter) {
      const value = state[rule.meter];
      if (rule.below !== undefined && value < rule.below) hit = true;
      if (rule.above !== undefined && value > rule.above) hit = true;
    }
    if (rule.flag && hasBudgetFlag(state, data, rule.flag)) hit = true;
    if (hit) {
      slow += rule.slow;
      risk += rule.risk;
      notes.push(rule.note);
    }
  }
  return { slow: Math.min(slow, data.needs.strain.maxSlow), risk, notes };
}

export interface ActionPlan {
  base: number;
  hours: number;
  mult: number;
  dark: boolean;
  light: LightSource;
  /** True when this action will burn a torch. */
  torch: boolean;
  /** Multiplier on every hazard roll during this action (fatigue and strain; darkness is per hazard). */
  risk: number;
  notes: string[];
  blocked: string | null;
}

export function paceMultiplier(
  state: RunState,
  data: GameData,
  allowTorch = true,
): { mult: number; risk: number; notes: string[]; light: LightSource } {
  const light = lightAt(state, data, allowTorch);
  const notes: string[] = [];
  let mult = 1;
  const tier = fatigueTier(state.fatigue, data);
  if (tier) {
    mult *= tier.mult;
    notes.push(tier.note);
  }
  const d = data.needs.darkness;
  if (light === "none") {
    mult *= d.timeMult;
    notes.push("Dark: everything takes longer and the ground hides things.");
  } else if (light === "torch") {
    mult *= d.torchTimeMult;
    notes.push("Dark, by torchlight.");
  } else if (light === "fire") {
    mult *= d.fireTimeMult;
    notes.push("Dark, by the fire pit.");
  }
  const strain = computeStrain(state, data);
  mult *= 1 + strain.slow;
  notes.push(...strain.notes);
  mult = Math.min(mult, data.needs.pace.maxMult);
  const risk = (tier?.risk ?? 1) * (1 + strain.risk);
  return { mult, risk, notes, light };
}

export function planAction(
  state: RunState,
  base: number,
  data: GameData,
  opts: { needsLight?: boolean; useTorch?: boolean } = {},
): ActionPlan {
  // A torch is only lit for work that needs light, or for walking and searching where it also cuts risk.
  const pace = paceMultiplier(state, data, opts.useTorch ?? Boolean(opts.needsLight));
  const hours = Math.max(base, Math.round(base * pace.mult));
  const blocked = opts.needsLight && pace.light === "none"
    ? data.needs.darkness.blockedText
    : null;
  return {
    base,
    hours,
    mult: pace.mult,
    dark: pace.light !== "day",
    light: pace.light,
    torch: pace.light === "torch",
    risk: pace.risk,
    notes: pace.notes,
    blocked,
  };
}

/** Darkness wakes snakes and scorpions and hides footing. Light cuts most of the extra. */
export function darkHazardMult(hazardId: string, plan: Pick<ActionPlan, "dark" | "light">, data: GameData): number {
  if (!plan.dark) return 1;
  const extra = (data.needs.darkness.hazardMult[hazardId] ?? 1) - 1;
  const scale = plan.light === "none" ? 1 : data.needs.darkness.lightHazardScale;
  return 1 + extra * scale;
}

export function planLabel(plan: ActionPlan): string {
  if (plan.hours === plan.base) return `${plan.hours}h`;
  return `${plan.hours}h (normally ${plan.base}h)`;
}
