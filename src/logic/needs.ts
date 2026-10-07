import type {
  Activity,
  GameData,
  HealthParts,
  HourContext,
  RunState,
  Threat,
} from "../models/types.ts";
import { bandAt } from "./time.ts";
import { clamp, round2 } from "./util.ts";

export function feltTemperature(
  state: RunState,
  ctx: HourContext,
  data: GameData,
): number {
  const band = bandAt(state.hour, data.biome);
  const mods = data.needs.felt;
  const exertion = data.needs.activities[ctx.activity].exertionC;
  let felt = band.airTempC + exertion;
  const cold = band.id === "cold";
  const shelter = ctx.atCamp && state.camp.shelter;
  const fire = ctx.atCamp && state.camp.firePit;

  if (ctx.activity === "travel") return felt;

  if (ctx.activity === "wait" && !ctx.atCamp) {
    return felt + (cold ? mods.openNightDeltaC : mods.openDayDeltaC);
  }

  if (ctx.activity === "search" && !ctx.atCamp) {
    return felt + (cold ? 0 : mods.zoneSearchShadeC);
  }

  if (ctx.activity === "sleep" || ctx.activity === "rest" || ctx.activity === "wait") {
    if (cold) {
      if (shelter) felt += mods.shelterNightDeltaC;
      else if (ctx.atCamp) felt += mods.wreckNightDeltaC;
      if (fire) felt += mods.fireNightDeltaC;
      return felt;
    }
    if (shelter) return felt + mods.shelterDayDeltaC;
    return felt + mods.shadeDeltaC;
  }

  if (cold) {
    if (shelter) felt += mods.shelterNightDeltaC * 0.65;
    else if (ctx.atCamp) felt += mods.wreckNightDeltaC;
    if (fire) felt += mods.fireNightDeltaC;
    return felt;
  }
  if (ctx.atCamp) return felt + mods.wreckShadeDeltaC;
  return felt + mods.zoneSearchShadeC;
}

export function equilibriumBodyTemp(feltC: number, bandId: string, data: GameData): number {
  const t = data.needs.bodyTemp;
  if (bandId === "cold") {
    return clamp(
      t.coldBaseC + (feltC - t.coldAnchorC) * t.coldSlope,
      t.minC,
      t.coldCapC,
    );
  }
  return clamp(
    t.heatBaseC + (feltC - t.heatAnchorC) * t.heatSlope,
    t.heatFloorC,
    t.maxC,
  );
}

export function hydrationContext(state: RunState, ctx: HourContext): string {
  if (ctx.activity === "travel") return "travel";
  if (ctx.activity === "search") return ctx.atCamp ? "search-camp" : "search-zone";
  if (ctx.activity === "build") return "build";
  if (ctx.activity === "camp") return "camp";
  if (ctx.activity === "rest") {
    return state.camp.shelter && ctx.atCamp ? "rest-shelter" : "rest-shade";
  }
  if (ctx.activity === "wait") {
    if (!ctx.atCamp) return "wait-open";
    return state.camp.shelter ? "wait-shelter" : "wait-camp";
  }
  if (state.camp.shelter && ctx.atCamp) return "sleep-shelter";
  if (ctx.atCamp) return "sleep-camp";
  return "sleep-open";
}

export function threatParts(state: RunState, data: GameData): HealthParts {
  const t = data.needs.bodyTemp;
  const parts: HealthParts = {
    heat: 0,
    cold: 0,
    dehydration: 0,
    starvation: 0,
    injury: 0,
    sickness: 0,
    infection: 0,
  };
  if (state.bodyTempC >= t.heatCriticalC) parts.heat = data.needs.heatHealthPerHour.critical;
  else if (state.bodyTempC >= t.heatSevereC) parts.heat = data.needs.heatHealthPerHour.severe;
  else if (state.bodyTempC >= t.heatMildC) parts.heat = data.needs.heatHealthPerHour.mild;

  if (state.bodyTempC <= t.coldSevereC) parts.cold = data.needs.coldHealthPerHour.severe;
  else if (state.bodyTempC <= t.coldMildC) parts.cold = data.needs.coldHealthPerHour.mild;

  if (state.hydration <= 0) parts.dehydration = data.needs.emptyHydrationHealthPerHour;
  if (state.hunger <= 0) parts.starvation = data.needs.emptyHungerHealthPerHour;

  for (const condition of state.conditions) {
    const def = data.conditions[condition.id];
    if (!def || condition.hoursLeft <= 0 || def.healthPerHour <= 0) continue;
    if (def.threat === "sickness") parts.sickness += def.healthPerHour;
    else if (def.threat === "infection") parts.infection += def.healthPerHour;
    else parts.injury += def.healthPerHour;
  }
  return parts;
}

export function partTotal(parts: HealthParts): number {
  return parts.heat + parts.cold + parts.dehydration + parts.starvation + parts.injury + parts.sickness + parts.infection;
}

/** Heat wins ties. Empty meters never outrank a hotter threat of equal size. */
export function dominantThreat(parts: HealthParts): Threat | null {
  const order: (keyof HealthParts)[] = [
    "heat",
    "cold",
    "dehydration",
    "starvation",
    "injury",
    "sickness",
    "infection",
  ];
  let best: Threat | null = null;
  let bestValue = 0;
  for (const key of order) {
    if (parts[key] > bestValue) {
      best = key;
      bestValue = parts[key];
    }
  }
  return best;
}

function tickConditions(state: RunState): RunState["conditions"] {
  return state.conditions
    .map((condition) => ({ ...condition, hoursLeft: condition.hoursLeft - 1 }))
    .filter((condition) => condition.hoursLeft > 0);
}

export function applyHour(state: RunState, ctx: HourContext, data: GameData): RunState {
  if (state.phase === "ended") return state;
  const next: RunState = structuredClone(state);
  const band = bandAt(next.hour, data.biome);
  const rates = data.needs.activities[ctx.activity];
  const felt = feltTemperature(next, ctx, data);
  let target = equilibriumBodyTemp(felt, band.id, data);
  if (
    next.hydration < data.needs.bodyTemp.dehydratedHeatBelow &&
    (band.id === "hot" || band.id === "extreme")
  ) {
    target += data.needs.bodyTemp.dehydratedHeatBonusC;
  }
  for (const condition of next.conditions) {
    if (condition.hoursLeft > 0) target += data.conditions[condition.id]?.feverC ?? 0;
  }
  const approach = data.needs.bodyTemp.approach;
  next.bodyTempC = clamp(
    next.bodyTempC + (target - next.bodyTempC) * approach,
    data.needs.bodyTemp.minC,
    data.needs.bodyTemp.maxC,
  );

  const contextKey = hydrationContext(next, ctx);
  const contextMult = data.needs.contextHydrationMultiplier[contextKey] ?? 1;
  const bandMult = data.needs.bandHydrationMultiplier[band.id];
  let hydrationLoss = rates.hydration * bandMult * contextMult;
  if (ctx.activity === "travel" || (ctx.activity === "search" && !ctx.atCamp)) {
    hydrationLoss *= ctx.exposure;
  }
  if (next.sandstorm && !(next.camp.shelter && ctx.atCamp)) {
    hydrationLoss += data.needs.sandstormHydrationBonus;
  }
  for (const condition of next.conditions) {
    const def = data.conditions[condition.id];
    if (def && condition.hoursLeft > 0) hydrationLoss += def.hydrationPerHour;
  }

  next.hydration = clamp(next.hydration - hydrationLoss, 0, 100);
  next.hunger = clamp(next.hunger - rates.hunger, 0, 100);
  const openSleep = ctx.activity === "sleep" && !ctx.atCamp ? data.needs.wait.openSleep : null;
  let fatigueRate = openSleep && rates.fatigue < 0 ? rates.fatigue * openSleep.fatigueMultiplier : rates.fatigue;
  let moraleRate = openSleep ? openSleep.moralePerHour : rates.morale;
  if (ctx.collapsed) {
    fatigueRate = rates.fatigue * data.needs.collapse.fatigueMultiplier;
    moraleRate = data.needs.collapse.moralePerHour;
  }
  if (isExertion(ctx.activity)) fatigueRate += data.needs.fatigue.heatPerHour[band.id] ?? 0;
  next.fatigue = clamp(next.fatigue + fatigueRate, 0, 100);
  next.morale = clamp(next.morale + moraleRate, 0, 100);

  const parts = threatParts(next, data);
  const loss = partTotal(parts);
  if (loss > 0) {
    next.health -= loss;
    const threat = dominantThreat(parts);
    if (threat) next.lastThreat = threat;
    if (next.health <= 0) {
      next.health = 0;
      next.phase = "ended";
      next.pendingCause = threat ?? next.lastThreat ?? "dehydration";
    }
  }

  if (loss <= 0 && next.phase !== "ended") {
    const regen = regenRate(next, ctx, data);
    if (regen > 0) next.health = Math.min(100, next.health + regen);
  }

  for (const id of Object.keys(next.spoil ?? {})) {
    next.spoil[id] = (next.spoil[id] ?? 0) - 1;
  }

  next.conditions = tickConditions(next);
  if (next.sprainHours > 0) next.sprainHours -= 1;

  next.health = clamp(round2(next.health), 0, 100);
  next.hunger = round2(next.hunger);
  next.hydration = round2(next.hydration);
  next.fatigue = round2(next.fatigue);
  next.morale = round2(next.morale);
  next.bodyTempC = round2(next.bodyTempC);
  return next;
}

export function advanceTime(
  state: RunState,
  hours: number,
  ctx: HourContext,
  data: GameData,
  onDawn?: (state: RunState) => RunState,
  onNote?: (state: RunState, note: string) => RunState,
): RunState {
  let current = state;
  for (let i = 0; i < hours; i += 1) {
    const turning = current.conditions
      .filter((condition) => condition.hoursLeft === 1 && data.conditions[condition.id]?.becomes)
      .map((condition) => data.conditions[condition.id]?.becomes as string);
    current = applyHour(current, ctx, data);
    if (current.phase === "ended") return current;
    for (const id of turning) {
      const hoursLeft = id === data.woundcare.infection.id ? data.woundcare.infection.hours : 24;
      current = { ...current, conditions: [...current.conditions.filter((c) => c.id !== id), { id, hoursLeft }] };
      if (onNote && id === data.woundcare.infection.id) current = onNote(current, data.woundcare.logs.onset);
    }
    const spoiled = spoilMeat(current, data);
    current = spoiled.state;
    if (onNote) for (const note of spoiled.notes) current = onNote(current, note);
    const hour = (current.hour + 1) % 24;
    current = { ...current, hour };
    if (hour === 6) {
      current = { ...current, day: current.day + 1 };
      if (onDawn) current = onDawn(current);
      if (current.phase === "ended") return current;
    }
  }
  return current;
}

export function isExertion(activity: Activity): boolean {
  return activity === "camp" || activity === "build" || activity === "search" || activity === "travel";
}

/** Which regen row applies, or null while working. */
export function regenContext(state: RunState, ctx: HourContext): string | null {
  if (ctx.collapsed) return "collapse";
  const shelter = ctx.atCamp && state.camp.shelter;
  const fire = ctx.atCamp && state.camp.firePit;
  if (ctx.activity === "sleep") {
    if (!ctx.atCamp) return "sleep-open";
    if (shelter && fire) return "sleep-shelter-fire";
    if (shelter) return "sleep-shelter";
    if (fire) return "sleep-fire";
    return "sleep-camp";
  }
  if (ctx.activity === "rest") return shelter ? "rest-shelter" : ctx.atCamp ? "rest-camp" : "rest-shade";
  if (ctx.activity === "wait") return !ctx.atCamp ? "wait-open" : shelter ? "wait-shelter" : "wait-camp";
  return null;
}

/** Health comes back only while still, fed, watered, at a normal temperature, and with no draining wound. */
export function regenBlockers(state: RunState, data: GameData): string[] {
  const r = data.needs.regen;
  const out: string[] = [];
  if (state.hydration <= r.minHydration) out.push("thirsty");
  if (state.hunger <= r.minHunger) out.push("hungry");
  if (state.bodyTempC < r.minBodyC) out.push("cold");
  if (state.bodyTempC > r.maxBodyC) out.push("overheated");
  const draining = state.conditions.some((condition) => {
    const def = data.conditions[condition.id];
    return Boolean(def) && !def?.treated && condition.hoursLeft > 0 && (def?.healthPerHour ?? 0) > 0;
  });
  if (draining) out.push("wounded");
  return out;
}

export function regenRate(state: RunState, ctx: HourContext, data: GameData): number {
  const key = regenContext(state, ctx);
  if (!key) return 0;
  if (regenBlockers(state, data).length > 0) return 0;
  return data.needs.regen.rates[key] ?? 0;
}

function spoilMeat(state: RunState, data: GameData): { state: RunState; notes: string[] } {
  const notes: string[] = [];
  let next = state;
  for (const [id, left] of Object.entries(state.spoil ?? {})) {
    if ((next.inventory[id] ?? 0) <= 0) {
      const spoil = { ...next.spoil };
      delete spoil[id];
      next = { ...next, spoil };
      continue;
    }
    if (left > 0) continue;
    const inventory = { ...next.inventory };
    delete inventory[id];
    const spoil = { ...next.spoil };
    delete spoil[id];
    next = { ...next, inventory, spoil };
    const name = data.itemById.get(id)?.name.toLowerCase() ?? id;
    notes.push(data.wildlife.spoilLog.replace("{name}", name));
  }
  return { state: next, notes };
}

export function hasBudgetFlag(
  state: RunState,
  data: GameData,
  flag: "injured" | "sunburn" | "gut",
): boolean {
  if (flag === "injured" && state.sprainHours > 0) return true;
  return state.conditions.some((condition) => data.conditions[condition.id]?.budgetFlag === flag);
}

export function contextFor(
  activity: Activity,
  atCamp: boolean,
  exposure = 1,
): HourContext {
  return { activity, atCamp, exposure };
}
