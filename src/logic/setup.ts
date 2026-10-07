import type { GameData, Journal, RunState } from "../models/types.ts";
import { addItem } from "./inventory.ts";
import { pushLog } from "./log.ts";
import type { Rng } from "./rng.ts";
import { rollRescueDay } from "./rescue.ts";
import { clamp, round1, weightedIndex } from "./util.ts";

function between(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

function rollInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

export function createRun(data: GameData, journal: Journal, rng: Rng, seed: number): RunState {
  const baseDay = rollRescueDay(() => rng.next(), data.rescue);
  let state: RunState = {
    seed,
    day: 1,
    hour: 6,
    health: 100,
    hunger: Math.round(between(rng, data.starting.hunger[0], data.starting.hunger[1])),
    hydration: Math.round(between(rng, data.starting.hydration[0], data.starting.hydration[1])),
    bodyTempC: data.needs.bodyTemp.startC,
    fatigue: Math.round(between(rng, data.starting.fatigue[0], data.starting.fatigue[1])),
    morale: Math.round(between(rng, data.starting.morale[0], data.starting.morale[1])),
    conditions: [],
    sprainHours: 0,
    pearsToday: 0,
    inventory: {},
    location: "camp",
    camp: {
      shelter: false,
      firePit: false,
      stills: [],
      signalBuilt: false,
      signalLit: false,
      wreckSearchesLeft: data.camp.wreckSearches,
    },
    rescue: { baseDay, signalDays: 0 },
    visited: ["camp"],
    runDiscoveries: [],
    runSchematics: [],
    runHazards: [],
    log: [],
    nextLogId: 1,
    phase: "playing",
    lastThreat: null,
    pendingCause: null,
    sandstorm: false,
    nextStillId: 1,
    ending: null,
    pending: null,
    spoil: {},
    gear: {},
  };

  let injuryLog: string | null = null;
  if (rng.next() < data.starting.injuryChance) {
    const index = weightedIndex(
      () => rng.next(),
      data.starting.injuries.map((injury) => injury.weight),
    );
    const injury = data.starting.injuries[index];
    if (injury) {
      if (injury.sprainHours) state = { ...state, sprainHours: injury.sprainHours };
      if (injury.condition) {
        state = {
          ...state,
          conditions: [
            ...state.conditions,
            { id: injury.condition.id, hoursLeft: injury.condition.hours },
          ],
        };
      }
      if (injury.fatigue) state = { ...state, fatigue: clamp(state.fatigue + injury.fatigue, 0, 100) };
      if (injury.morale) state = { ...state, morale: clamp(state.morale + injury.morale, 0, 100) };
      if (injury.health) state = { ...state, health: clamp(state.health + injury.health, 0, 100) };
      injuryLog = injury.log;
    }
  }

  for (const stack of data.starting.stacks) {
    if (stack.chance !== undefined) {
      if (rng.next() < stack.chance) state = { ...state, inventory: addItem(state.inventory, stack.id, stack.qty ?? 1) };
      continue;
    }
    const qty = rollInt(rng, stack.min ?? 0, stack.max ?? 0);
    if (qty > 0) state = { ...state, inventory: addItem(state.inventory, stack.id, qty) };
  }

  const water = round1(between(rng, data.starting.waterLiters[0], data.starting.waterLiters[1]));
  state = { ...state, inventory: addItem(state.inventory, "water", water) };

  for (const line of data.copy.opening) state = pushLog(state, line);
  if (injuryLog) state = pushLog(state, injuryLog);
  const rations = state.inventory.ration ?? 0;
  state = pushLog(
    state,
    `You have ${water.toFixed(1)} L of water and ${rations} ration${rations === 1 ? "" : "s"}. Count them like time.`,
  );
  const known = Object.keys(journal.discoveries).length + Object.keys(journal.schematics).length;
  if (known > 0) {
    state = pushLog(
      state,
      `The journal already holds ${known} hard lesson${known === 1 ? "" : "s"}. Trust it before your thirst does.`,
    );
  }

  state = pushLog(state, "Day 1. No one is keeping hours for you. The sun and your own legs will.");
  return state;
}
