import type { AnimalDef, GameData, Journal, RunState, WeaponDef } from "../models/types.ts";
import { applyBuild, brokenPart } from "./crafting.ts";
import { addConditions } from "./effects.ts";
import { applyHazard } from "./hazards.ts";
import { addItem } from "./inventory.ts";
import { learnDiscovery, noteRunDiscovery, runNumber } from "./journal.ts";
import { pushLog } from "./log.ts";
import { fatigueTier, lightAt } from "./pace.ts";
import { bandAt } from "./time.ts";
import { clamp, round2, weightedIndex } from "./util.ts";

export type SightingTrigger = "search" | "travel" | "rest";

/** Every weapon in reach, with crafted builds applied. Bare hands always count. */
export function carriedWeapons(state: RunState, data: GameData): WeaponDef[] {
  return data.wildlife.weapons
    .filter((weapon) => weapon.id === "none" || (state.inventory[weapon.id] ?? 0) >= 1)
    .map((weapon) => applyBuild(weapon, state.gear?.[weapon.id], data));
}

/**
 * What you reach for. Against a known animal: the best odds for it.
 * Otherwise: the highest tier you carry.
 */
export function bestWeapon(state: RunState, data: GameData, animal?: AnimalDef): WeaponDef {
  const weapons = carriedWeapons(state, data).sort((a, b) => {
    if (animal) {
      const diff = (b.kill[animal.id] ?? 0) - (a.kill[animal.id] ?? 0);
      if (Math.abs(diff) > 1e-9) return diff;
    }
    return b.tier - a.tier;
  });
  return weapons[0] ?? (data.wildlife.weapons[0] as WeaponDef);
}

export function killOdds(state: RunState, animal: AnimalDef, weapon: WeaponDef, data: GameData): number {
  const mods = data.wildlife.killMods;
  let odds = weapon.kill[animal.id] ?? 0;
  if (lightAt(state, data) === "none") odds *= mods.darkNoLight;
  const tier = fatigueTier(state.fatigue, data);
  const top = data.needs.fatigue.tiers[data.needs.fatigue.tiers.length - 1];
  if (tier && top && tier.above >= top.above) odds *= mods.exhausted;
  return clamp(round2(odds), mods.min, mods.max);
}

export function sightingChance(state: RunState, trigger: SightingTrigger, data: GameData): number {
  if (state.location === "camp") return 0;
  const spec = data.wildlife.sighting;
  const band = bandAt(state.hour, data.biome);
  let chance = spec.zoneChance[state.location] ?? 0;
  chance *= spec.triggerMult[trigger] ?? 1;
  chance *= spec.bandMult[band.id] ?? 1;
  if (lightAt(state, data) !== "day") chance *= spec.darkMult;
  return chance;
}

/** Roll for an animal at the end of an action in a zone. A hit pauses the game on a choice. */
export function rollSighting(
  state: RunState,
  data: GameData,
  rng: { next(): number },
  trigger: SightingTrigger,
): RunState {
  if (state.phase !== "playing" || state.pending) return state;
  const chance = sightingChance(state, trigger, data);
  if (chance <= 0 || rng.next() >= chance) return state;
  const animals = data.wildlife.animals;
  const index = weightedIndex(
    () => rng.next(),
    animals.map((animal) => animal.zoneWeight[state.location] ?? 0),
  );
  const animal = animals[index];
  if (!animal) return state;
  return pushLog({ ...state, pending: { type: "sighting", animalId: animal.id } }, animal.sightLog);
}

function strike(
  state: RunState,
  journal: Journal,
  animal: AnimalDef,
  data: GameData,
  log: string,
): { state: RunState; journal: Journal } {
  const hazard = data.hazardById.get(animal.strikeHazard);
  if (!hazard) return { state: pushLog(state, log), journal };
  return applyHazard(state, journal, hazard, data, log);
}

export function resolveSighting(
  state: RunState,
  journal: Journal,
  choice: "back-away" | "kill",
  data: GameData,
  rng: { next(): number },
): { state: RunState; journal: Journal } {
  const pending = state.pending;
  if (!pending) return { state, journal };
  const animal = data.animalById.get(pending.animalId);
  let next: RunState = { ...state, pending: null };
  if (!animal) return { state: next, journal };

  if (choice === "back-away") {
    if (rng.next() < animal.backAwayStrike) return strike(next, journal, animal, data, animal.backAwayStrikeLog);
    return { state: pushLog(next, animal.backAwayLog), journal };
  }

  const weapon = bestWeapon(next, data, animal);
  const odds = killOdds(next, animal, weapon, data);
  next = { ...next, fatigue: clamp(next.fatigue + animal.killFatigue, 0, 100) };
  if (rng.next() < odds) {
    const meat = data.wildlife.meat[animal.meat.item];
    next = {
      ...next,
      inventory: addItem(next.inventory, animal.meat.item, animal.meat.qty),
      spoil: { ...next.spoil, [animal.meat.item]: meat?.spoilHours ?? 24 },
    };
    next = pushLog(next, animal.killLog);
    for (const drop of animal.drops ?? []) {
      next = pushLog({ ...next, inventory: addItem(next.inventory, drop.item, drop.qty) }, drop.log);
    }
    const learned = learnDiscovery(journal, { ...animal.journal, learnedOnRun: runNumber(journal) });
    if (learned.learned) {
      next = pushLog(noteRunDiscovery(next, animal.journal.id), `Journal: ${animal.journal.text}`);
    }
    return { state: next, journal: learned.journal };
  }
  if (weapon.crafted && weapon.build && (weapon.breakChance ?? 0) > 0 && rng.next() < (weapon.breakChance ?? 0)) {
    const part = brokenPart(weapon.build, data);
    const gear = { ...(next.gear ?? {}) };
    delete gear[weapon.id];
    next = pushLog(
      { ...next, inventory: addItem(next.inventory, weapon.id, -1), gear },
      `${part?.breakLog ?? "It comes apart in your hands."} The ${data.wildlife.weapons.find((w) => w.id === weapon.id)?.name.toLowerCase() ?? "tool"} is finished.`,
    );
  }
  if (rng.next() < weapon.failStrike) return strike(next, journal, animal, data, animal.failLog);
  return { state: pushLog(next, animal.escapeLog), journal };
}

/** Raw meat: hunger now, a chance of sickness. */
export function eatRawMeat(
  state: RunState,
  journal: Journal,
  itemId: string,
  data: GameData,
  rng: { next(): number },
): { state: RunState; journal: Journal } {
  const meat = data.wildlife.meat[itemId];
  if (!meat) return { state, journal };
  let next: RunState = {
    ...state,
    inventory: addItem(state.inventory, itemId, -1),
    hunger: clamp(round2(state.hunger + meat.raw.hunger), 0, 100),
    morale: clamp(round2(state.morale + meat.raw.morale), 0, 100),
  };
  next = pushLog(next, meat.raw.log);
  if (rng.next() < meat.raw.sickChance) {
    next = pushLog(addConditions(next, meat.raw.sick), meat.raw.sickLog);
    if (meat.raw.journal) {
      const learned = learnDiscovery(journal, { ...meat.raw.journal, learnedOnRun: runNumber(journal) });
      journal = learned.journal;
      if (learned.learned) next = pushLog(noteRunDiscovery(next, meat.raw.journal.id), `Journal: ${meat.raw.journal.text}`);
    }
  }
  return { state: next, journal };
}

/** Every journal id the wildlife system can write. Counted toward completion. */
export function wildlifeJournalEntries(data: GameData): { id: string; name: string }[] {
  const out = data.wildlife.animals.map((animal) => ({ id: animal.journal.id, name: animal.journal.name }));
  for (const meat of Object.values(data.wildlife.meat)) {
    if (meat.raw.journal) out.push({ id: meat.raw.journal.id, name: meat.raw.journal.name });
  }
  return out;
}
