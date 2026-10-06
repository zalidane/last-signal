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
    else parts.injury += def.healthPerHour;
  }
  return parts;
}

export function partTotal(parts: HealthParts): number {
  return parts.heat + parts.cold + parts.dehydration + parts.starvation + parts.injury + parts.sickness;
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
  const fatigueRate = openSleep && rates.fatigue < 0 ? rates.fatigue * openSleep.fatigueMultiplier : rates.fatigue;
  const moraleRate = openSleep ? openSleep.moralePerHour : rates.morale;
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
    current = applyHour(current, ctx, data);
    if (current.phase === "ended") return current;
    const reconciled = reconcileLabor(current, data);
    current = reconciled.state;
    if (reconciled.note && onNote) current = onNote(current, reconciled.note);
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

export function reconcileLabor(
  state: RunState,
  data: GameData,
): { state: RunState; note: string | null } {
  if (state.phase === "ended") return { state, note: null };
  const budget = computeBudget(state, data);
  if (budget.hours < state.laborMax) {
    const laborHours = Math.max(0, state.laborHours - (state.laborMax - budget.hours));
    const note = `The day shrinks. ${laborHours} work ${laborHours === 1 ? "hour" : "hours"} left.`;
    return {
      note,
      state: {
        ...state,
        laborMax: budget.hours,
        laborHours,
        laborNotes: budget.notes,
      },
    };
  }
  return { state, note: null };
}

export interface BudgetResult {
  hours: number;
  notes: string[];
}

/** Imported lazily-shaped helper kept here so hour ticks and dawn share one formula. */
export function computeBudget(state: RunState, data: GameData): BudgetResult {
  const rules = data.needs.actionBudget;
  let hours = rules.base;
  const notes: string[] = [];
  for (const rule of rules.rules) {
    let hit = false;
    if (rule.meter) {
      const value = state[rule.meter];
      if (rule.below !== undefined && value < rule.below) hit = true;
      if (rule.above !== undefined && value > rule.above) hit = true;
    }
    if (rule.flag && hasBudgetFlag(state, data, rule.flag)) hit = true;
    if (hit) {
      hours += rule.delta;
      notes.push(rule.note);
    }
  }
  hours = Math.max(rules.minimum, hours);
  if (notes.length === 0) notes.push("You are intact. The day is full length.");
  return { hours, notes };
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
