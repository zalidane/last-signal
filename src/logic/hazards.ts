import type { GameData, HazardDef, Journal, RunState } from "../models/types.ts";
import { applyEffect } from "./effects.ts";
import { hurt } from "./effects.ts";
import { learnHazard, noteRunHazard, runNumber } from "./journal.ts";
import { pushLog } from "./log.ts";
import { darkHazardMult, type ActionPlan } from "./pace.ts";
import { bandAt } from "./time.ts";
import { clamp } from "./util.ts";

export function exposureTags(activity: "travel" | "search", atCamp: boolean): string[] {
  if (activity === "travel") return ["travel"];
  return atCamp ? ["search"] : ["search", "search-zone"];
}

export function applyHazard(
  state: RunState,
  journal: Journal,
  hazard: HazardDef,
  _data: GameData,
  log?: string,
): { state: RunState; journal: Journal } {
  let next = pushLog(state, log ?? hazard.log);
  const learned = learnHazard(journal, {
    id: hazard.id,
    name: hazard.name,
    text: hazard.journal,
    learnedOnRun: runNumber(journal),
  });
  journal = learned.journal;
  if (learned.learned) next = noteRunHazard(next, hazard.id);

  if (hazard.effect?.fatigue) {
    next = { ...next, fatigue: clamp(next.fatigue + hazard.effect.fatigue, 0, 100) };
  }
  if (hazard.effect?.morale) {
    next = { ...next, morale: clamp(next.morale + hazard.effect.morale, 0, 100) };
  }
  if (hazard.effect?.health && hazard.effect.health < 0) {
    next = hurt(next, -hazard.effect.health, "injury");
  }
  if (hazard.condition && next.phase !== "ended") {
    next = applyEffect(next, { addConditions: [hazard.condition] });
  } else if (hazard.condition) {
    next = {
      ...next,
      conditions: upsert(next.conditions, hazard.condition.id, hazard.condition.hours),
    };
  }
  if (hazard.sprainHours) {
    next = { ...next, sprainHours: Math.min(96, next.sprainHours + hazard.sprainHours) };
  }
  return { state: next, journal };
}

function upsert(
  conditions: RunState["conditions"],
  id: string,
  hours: number,
): RunState["conditions"] {
  const existing = conditions.find((condition) => condition.id === id);
  if (!existing) return [...conditions, { id, hoursLeft: hours }];
  return conditions.map((condition) =>
    condition.id === id
      ? { ...condition, hoursLeft: Math.max(condition.hoursLeft, hours) }
      : condition,
  );
}

export function rollHazards(
  state: RunState,
  journal: Journal,
  data: GameData,
  rng: { next(): number },
  activity: "travel" | "search",
  atCamp: boolean,
  locationId: string,
  plan?: Pick<ActionPlan, "dark" | "light" | "risk">,
): { state: RunState; journal: Journal } {
  if (state.phase === "ended") return { state, journal };
  const tags = exposureTags(activity, atCamp);
  const band = bandAt(state.hour, data.biome);
  let current = state;
  for (const hazard of data.hazards) {
    if (current.phase === "ended") break;
    if (!hazard.on.some((tag) => tags.includes(tag))) continue;
    if (hazard.bands && !hazard.bands.includes(band.id)) continue;
    if (hazard.id === "sunburn" && current.conditions.some((c) => c.id === "sunburn")) continue;
    let chance = hazard.chance[locationId] ?? 0;
    const bandScale = hazard.bandChance?.[band.id];
    if (bandScale !== undefined) chance *= bandScale;
    if (plan) chance *= plan.risk * darkHazardMult(hazard.id, plan, data);
    chance = Math.min(chance, 0.95);
    if (chance <= 0) continue;
    if (rng.next() >= chance) continue;
    const applied = applyHazard(current, journal, hazard, data);
    current = applied.state;
    journal = applied.journal;
  }
  return { state: current, journal };
}
