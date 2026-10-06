import type { EffectDef, RunState, Threat } from "../models/types.ts";
import { pushLog } from "./log.ts";
import { clamp, round2 } from "./util.ts";

export function hurt(state: RunState, amount: number, threat: Threat): RunState {
  if (amount <= 0 || state.phase === "ended") return state;
  const health = state.health - amount;
  if (health <= 0) {
    return {
      ...state,
      health: 0,
      phase: "ended",
      pendingCause: threat,
      lastThreat: threat,
    };
  }
  return { ...state, health: round2(health), lastThreat: threat };
}

export function addConditions(
  state: RunState,
  list: { id: string; hours: number }[] | undefined,
): RunState {
  if (!list?.length) return state;
  const conditions = state.conditions.map((condition) => ({ ...condition }));
  for (const incoming of list) {
    const existing = conditions.find((condition) => condition.id === incoming.id);
    if (existing) existing.hoursLeft = Math.max(existing.hoursLeft, incoming.hours);
    else conditions.push({ id: incoming.id, hoursLeft: incoming.hours });
  }
  return { ...state, conditions };
}

export function applyEffect(state: RunState, effect: EffectDef | undefined): RunState {
  if (!effect || state.phase === "ended") return state;
  let next = state;
  if (effect.hunger) next = { ...next, hunger: clamp(round2(next.hunger + effect.hunger), 0, 100) };
  if (effect.hydration) {
    next = { ...next, hydration: clamp(round2(next.hydration + effect.hydration), 0, 100) };
  }
  if (effect.fatigue) next = { ...next, fatigue: clamp(round2(next.fatigue + effect.fatigue), 0, 100) };
  if (effect.morale) next = { ...next, morale: clamp(round2(next.morale + effect.morale), 0, 100) };
  if (effect.health && effect.health > 0) {
    next = { ...next, health: clamp(round2(next.health + effect.health), 0, 100) };
  }
  next = addConditions(next, effect.addConditions);
  if (effect.health && effect.health < 0) {
    const threat = effect.addConditions?.some((condition) =>
      ["vomiting", "diarrhea", "nausea", "stomach"].includes(condition.id),
    )
      ? "sickness"
      : "injury";
    next = hurt(next, -effect.health, threat);
  }
  if (effect.log && next.phase !== "ended") next = pushLog(next, effect.log);
  else if (effect.log && next.phase === "ended") next = pushLog(next, effect.log);
  return next;
}
