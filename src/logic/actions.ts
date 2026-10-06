import type {
  ActionButton,
  Command,
  DiscoveryDef,
  EffectDef,
  GameData,
  HourContext,
  ItemActionView,
  ItemModal,
  Journal,
  RecipeDef,
  RunState,
} from "../models/types.ts";
import { resolveDawn } from "./dawn.ts";
import { applyEffect } from "./effects.ts";
import { finishIfEnded } from "./ending.ts";
import { rollHazards } from "./hazards.ts";
import { addItem, findLog, hasAll, itemQty, missingNames, presentItem, spend } from "./inventory.ts";
import {
  learnDiscovery,
  learnSchematic,
  noteRunDiscovery,
  noteRunSchematic,
  runNumber,
} from "./journal.ts";
import { pushLog } from "./log.ts";
import { advanceTime, contextFor, reconcileLabor } from "./needs.ts";
import type { Rng } from "./rng.ts";
import { hoursUntilDawn } from "./time.ts";
import { weightedIndex } from "./util.ts";

export interface StepResult {
  state: RunState;
  journal: Journal;
}

function fail(state: RunState, journal: Journal, text: string): StepResult {
  return { state: pushLog(state, text), journal };
}

function timeBlock(state: RunState, hours: number, usesLabor: boolean): string | null {
  if (usesLabor && state.laborHours < hours) {
    return `Need ${hours} work hours, have ${state.laborHours}.`;
  }
  if (hours > hoursUntilDawn(state.hour)) {
    return "That runs past dawn. Sleep, or start earlier.";
  }
  return null;
}

function runHours(
  state: RunState,
  journal: Journal,
  hours: number,
  ctx: HourContext,
  data: GameData,
  rng: Rng,
): StepResult {
  let journalNow = journal;
  const next = advanceTime(
    state,
    hours,
    ctx,
    data,
    (dawnState) => {
      const dawned = resolveDawn(dawnState, journalNow, data, rng);
      journalNow = dawned.journal;
      return dawned.state;
    },
    (noted, note) => pushLog(noted, note),
  );
  return { state: next, journal: journalNow };
}

function atCamp(state: RunState): boolean {
  return state.location === "camp";
}

function travelCost(state: RunState, hours: number): number {
  return hours + (state.sprainHours > 0 ? 1 : 0);
}

export function applyCommand(
  state: RunState,
  journal: Journal,
  command: Command,
  data: GameData,
  rng: Rng,
): StepResult {
  if (state.phase === "ended") return { state, journal };
  switch (command.type) {
    case "rest":
      return rest(state, journal, data, rng);
    case "sleep":
      return sleep(state, journal, data, rng);
    case "travel":
      return travel(state, journal, command.zoneId, data, rng);
    case "return":
      return travelBack(state, journal, data, rng);
    case "search":
      return search(state, journal, data, rng);
    case "build":
      return build(state, journal, command.recipeId, data, rng);
    case "douse-signal":
      return douse(state, journal);
    case "item":
      return useItem(state, journal, command.itemId, command.action, data, rng);
    default:
      return { state, journal };
  }
}

function rest(state: RunState, journal: Journal, data: GameData, rng: Rng): StepResult {
  const hours = data.needs.restHours;
  const block = timeBlock(state, hours, false);
  if (block) return fail(state, journal, block);
  const camp = atCamp(state);
  let step = runHours(
    pushLog(state, camp ? "You get out of the sun and wait." : "You take the shade the rocks will give you."),
    journal,
    hours,
    contextFor("rest", camp),
    data,
    rng,
  );
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  const sheltered = camp && step.state.camp.shelter;
  step = {
    ...step,
    state: pushLog(
      step.state,
      sheltered
        ? "The shelter holds a cooler dark. Thirst slows down in here."
        : "Shade is not safety, but it is cheaper than walking.",
    ),
  };
  return step;
}

function sleep(state: RunState, journal: Journal, data: GameData, rng: Rng): StepResult {
  if (!atCamp(state)) {
    return fail(state, journal, "Not out here. Get back to the wreck before you close your eyes.");
  }
  const hours = hoursUntilDawn(state.hour);
  const cold =
    !state.camp.shelter && !state.camp.firePit
      ? " The wreck will only blunt the night, not stop it."
      : "";
  const step = runHours(
    pushLog(state, `You sleep.${cold}`),
    journal,
    hours,
    contextFor("sleep", true),
    data,
    rng,
  );
  return finishIfEnded(step.state, step.journal, data);
}

function travel(
  state: RunState,
  journal: Journal,
  zoneId: string,
  data: GameData,
  rng: Rng,
): StepResult {
  if (!atCamp(state)) return fail(state, journal, "Return to camp before you strike out again.");
  if (state.sandstorm) {
    return fail(state, journal, "A sandstorm is up. You are not walking out into it.");
  }
  const zone = data.zoneById.get(zoneId);
  if (!zone) return { state, journal };
  const hours = travelCost(state, zone.travelHours);
  const block = timeBlock(state, hours, true);
  if (block) return fail(state, journal, `${zone.name}: ${block}`);
  let step = runHours(
    pushLog({ ...state, laborHours: state.laborHours - hours }, `You leave camp for the ${zone.name}.`),
    journal,
    hours,
    contextFor("travel", false, zone.exposure),
    data,
    rng,
  );
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  const first = !step.state.visited.includes(zone.id);
  step = {
    ...step,
    state: {
      ...step.state,
      location: zone.id,
      visited: first ? [...step.state.visited, zone.id] : step.state.visited,
    },
  };
  step = {
    ...step,
    state: pushLog(step.state, first ? zone.arriveLog : `You are back at the ${zone.name}.`),
  };
  step = rollHazards(step.state, step.journal, data, rng, "travel", false, zone.id);
  return finishIfEnded(step.state, step.journal, data);
}

function travelBack(state: RunState, journal: Journal, data: GameData, rng: Rng): StepResult {
  if (atCamp(state)) return fail(state, journal, "You are already at the wreck.");
  const zone = data.zoneById.get(state.location);
  if (!zone) return { state, journal };
  const hours = travelCost(state, zone.travelHours);
  const block = timeBlock(state, hours, true);
  if (block) return fail(state, journal, `The walk back: ${block}`);
  let step = runHours(
    pushLog(
      { ...state, laborHours: state.laborHours - hours },
      `You turn back toward the wreck. ${hours} hours, if the ankle and the sun agree.`,
    ),
    journal,
    hours,
    contextFor("travel", false, zone.exposure),
    data,
    rng,
  );
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  step = { ...step, state: { ...step.state, location: "camp" } };
  step = { ...step, state: pushLog(step.state, "The fuselage comes up out of the glare. Camp, such as it is.") };
  step = rollHazards(step.state, step.journal, data, rng, "travel", false, zone.id);
  return finishIfEnded(step.state, step.journal, data);
}

function search(state: RunState, journal: Journal, data: GameData, rng: Rng): StepResult {
  const camp = atCamp(state);
  if (camp && state.camp.wreckSearchesLeft <= 0) {
    return fail(state, journal, "The cabin has given up its easy secrets. The rest is out in the zones.");
  }
  const zone = camp ? null : data.zoneById.get(state.location);
  const hours = camp ? data.camp.searchHours : (zone?.searchHours ?? 2);
  const block = timeBlock(state, hours, true);
  if (block) return fail(state, journal, block);
  const exposure = zone?.exposure ?? 1;
  let step = runHours(
    pushLog(
      { ...state, laborHours: state.laborHours - hours },
      camp ? "You pick through the cabin, hands slow in the heat." : `You search the ${zone?.name ?? "ground"}.`,
    ),
    journal,
    hours,
    contextFor("search", camp, exposure),
    data,
    rng,
  );
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  if (camp) {
    step = {
      ...step,
      state: {
        ...step.state,
        camp: { ...step.state.camp, wreckSearchesLeft: step.state.camp.wreckSearchesLeft - 1 },
      },
    };
  }
  const table = camp ? data.camp.loot : (zone?.loot ?? []);
  for (let roll = 0; roll < 2; roll += 1) {
    const index = weightedIndex(
      () => rng.next(),
      table.map((entry) => entry.weight),
    );
    const entry = table[index];
    if (!entry) continue;
    step = { ...step, state: pushLog(step.state, findLog(entry.id, step.journal, data)) };
    if (entry.id !== "nothing" && entry.qty > 0) {
      step = {
        ...step,
        state: { ...step.state, inventory: addItem(step.state.inventory, entry.id, entry.qty) },
      };
    }
  }
  step = rollHazards(step.state, step.journal, data, rng, "search", camp, camp ? "camp" : (zone?.id ?? "camp"));
  return finishIfEnded(step.state, step.journal, data);
}

function build(
  state: RunState,
  journal: Journal,
  recipeId: string,
  data: GameData,
  rng: Rng,
): StepResult {
  const recipe = data.recipeById.get(recipeId);
  if (!recipe) return { state, journal };
  if (recipe.grants === "signalFire" && state.camp.signalBuilt && !state.camp.signalLit && recipe.relight) {
    return relight(state, journal, recipe, data, rng);
  }
  if (recipe.grants === "shelter" && state.camp.shelter) return fail(state, journal, recipe.already ?? "Already built.");
  if (recipe.grants === "firePit" && state.camp.firePit) return fail(state, journal, recipe.already ?? "Already built.");
  if (recipe.grants === "signalFire" && state.camp.signalLit) return fail(state, journal, recipe.already ?? "Already burning.");
  if (recipe.max && state.camp.stills.length >= recipe.max) {
    return fail(state, journal, `You have ${recipe.max} stills. That is as many as you can tend.`);
  }
  if (!recipe.where.includes(state.location)) {
    return fail(state, journal, `${recipe.name} has to be built at ${recipe.where.join(" or ")}.`);
  }
  if (recipe.requiresFlag === "firePit" && !state.camp.firePit) {
    return fail(state, journal, "The signal needs a fire pit under it.");
  }
  if (!hasAll(state.inventory, recipe.requires)) {
    return fail(state, journal, `Missing ${missingNames(state.inventory, recipe.requires, data).join(", ")}.`);
  }
  const block = timeBlock(state, recipe.hours, true);
  if (block) return fail(state, journal, block);
  let step = runHours(
    pushLog(
      {
        ...state,
        laborHours: state.laborHours - recipe.hours,
        inventory: spend(state.inventory, recipe.requires),
      },
      `You start on the ${recipe.name.toLowerCase()}.`,
    ),
    journal,
    recipe.hours,
    contextFor("build", atCamp(state)),
    data,
    rng,
  );
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  step = { ...step, state: grantRecipe(step.state, recipe) };
  const builtLog = recipe.grants === "solarStill" && state.location === "dry-wash" && recipe.washLog
    ? recipe.washLog
    : recipe.log;
  step = { ...step, state: pushLog(step.state, builtLog) };
  if (recipe.schematic) {
    const spec = data.schematicById.get(recipe.schematic);
    if (spec) {
      const learned = learnSchematic(step.journal, {
        id: spec.id,
        name: spec.name,
        text: spec.text,
        learnedOnRun: runNumber(step.journal),
      });
      step = { ...step, journal: learned.journal };
      if (learned.learned) {
        step = {
          ...step,
          state: pushLog(
            noteRunSchematic(step.state, spec.id),
            "It works. The journal keeps the arrangement. Next run you will not be guessing.",
          ),
        };
      }
    }
  }
  const reconciled = reconcileLabor(step.state, data);
  step = {
    ...step,
    state: reconciled.note ? pushLog(reconciled.state, reconciled.note) : reconciled.state,
  };
  return step;
}

function grantRecipe(state: RunState, recipe: RecipeDef): RunState {
  const moraleBump = recipe.grants === "shelter" ? 8 : recipe.grants === "signalFire" ? 6 : 4;
  const camp = { ...state.camp, stills: [...state.camp.stills] };
  if (recipe.grants === "shelter") camp.shelter = true;
  if (recipe.grants === "firePit") camp.firePit = true;
  if (recipe.grants === "signalFire") {
    camp.signalBuilt = true;
    camp.signalLit = true;
  }
  if (recipe.grants === "solarStill") {
    camp.stills.push({ id: state.nextStillId, wash: state.location === "dry-wash" });
    return {
      ...state,
      camp,
      nextStillId: state.nextStillId + 1,
      morale: Math.min(100, state.morale + moraleBump),
    };
  }
  return { ...state, camp, morale: Math.min(100, state.morale + moraleBump) };
}

function relight(
  state: RunState,
  journal: Journal,
  recipe: RecipeDef,
  data: GameData,
  rng: Rng,
): StepResult {
  const spec = recipe.relight;
  if (!spec) return { state, journal };
  if (state.location !== "camp") return fail(state, journal, "The beacon is at camp.");
  if (!hasAll(state.inventory, spec.requires)) {
    return fail(state, journal, `Relighting needs ${missingNames(state.inventory, spec.requires, data).join(", ")}.`);
  }
  const block = timeBlock(state, spec.hours, true);
  if (block) return fail(state, journal, block);
  let step = runHours(
    pushLog(
      {
        ...state,
        laborHours: state.laborHours - spec.hours,
        inventory: spend(state.inventory, spec.requires),
      },
      "You kneel at the dead beacon.",
    ),
    journal,
    spec.hours,
    contextFor("camp", true),
    data,
    rng,
  );
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  step = {
    ...step,
    state: pushLog(
      { ...step.state, camp: { ...step.state.camp, signalLit: true } },
      spec.log,
    ),
  };
  return step;
}

function douse(state: RunState, journal: Journal): StepResult {
  if (!state.camp.signalLit) return fail(state, journal, "The signal fire is already out.");
  return {
    journal,
    state: pushLog(
      { ...state, camp: { ...state.camp, signalLit: false } },
      "You kick the signal down to save fuel. The sky goes ordinary.",
    ),
  };
}

function useItem(
  state: RunState,
  journal: Journal,
  itemId: string,
  action: string,
  data: GameData,
  rng: Rng,
): StepResult {
  if (action === "ignore") {
    const knownFind = data.discoveryByItemId.get(itemId);
    if (knownFind && !journal.discoveries[knownFind.id]) {
      return fail(state, journal, "You leave it alone. The journal learns nothing.");
    }
    return { state, journal };
  }
  if (itemQty(state.inventory, itemId) <= 0) return fail(state, journal, "You don't have that anymore.");
  if (itemId === "water" && action === "drink") return drink(state, journal, data);
  if (itemId === "ration" && (action === "eat" || action === "warm")) {
    return eatRation(state, journal, data, action === "warm");
  }
  if (itemId === "field-manual" && action === "read") return readManual(state, journal, data, rng);
  if (itemId === "first-aid" && action === "use") return useKit(state, journal, data);
  const discovery = data.discoveryByItemId.get(itemId);
  if (!discovery) return fail(state, journal, "Nothing useful to do with that.");
  if (action === "eat") return eatDiscovery(state, journal, discovery, data);
  if (action === "experiment") return experiment(state, journal, discovery, data, rng);
  if (action === "prepare") return prepare(state, journal, discovery, data, rng);
  if (action === "boil") return boil(state, journal, discovery, data, rng);
  if (action === "poultice") return poultice(state, journal, discovery, data);
  return { state, journal };
}

function drink(state: RunState, journal: Journal, data: GameData): StepResult {
  const liters = Math.min(data.needs.drinkLiters, state.inventory.water ?? 0);
  const gain = liters * data.needs.pointsPerLiter;
  const next = pushLog(
    {
      ...state,
      inventory: addItem(state.inventory, "water", -liters),
      hydration: Math.min(100, Math.round((state.hydration + gain) * 100) / 100),
    },
    `You drink ${liters.toFixed(1)} L. It tastes like the bottle, which is to say: enough.`,
  );
  return { state: next, journal };
}

function eatRation(state: RunState, journal: Journal, data: GameData, warm: boolean): StepResult {
  const bonus = warm && state.camp.firePit && atCamp(state);
  const hunger = data.needs.ration.hunger + (bonus ? data.needs.ration.warmedHunger : 0);
  const morale = data.needs.ration.morale + (bonus ? data.needs.ration.warmedMorale : 0);
  const next = pushLog(
    {
      ...state,
      inventory: addItem(state.inventory, "ration", -1),
      hunger: Math.min(100, state.hunger + hunger),
      morale: Math.min(100, state.morale + morale),
    },
    bonus
      ? "You warm the ration over the pit. It is still trail food. It is also a small kindness."
      : "You eat a ration. Salt, calories, and no surprises.",
  );
  return { state: next, journal };
}

function readManual(state: RunState, journal: Journal, data: GameData, rng: Rng): StepResult {
  const spec = data.schematicById.get("solar-still");
  if (!spec) return { state, journal };
  const already = Boolean(journal.schematics[spec.id]);
  if (already) {
    return {
      journal,
      state: pushLog(
        { ...state, inventory: addItem(state.inventory, "field-manual", -1) },
        "You already know this page by heart.",
      ),
    };
  }
  const block = timeBlock(state, 1, true);
  if (block) return fail(state, journal, `The page can wait. ${block}`);
  const learned = learnSchematic(journal, {
    id: spec.id,
    name: spec.name,
    text: spec.text,
    learnedOnRun: runNumber(journal),
  });
  let next = noteRunSchematic(
    { ...state, inventory: addItem(state.inventory, "field-manual", -1), laborHours: state.laborHours - 1 },
    spec.id,
  );
  const step = runHours(
    pushLog(next, `You read the charred page. ${spec.text}`),
    learned.journal,
    1,
    contextFor("camp", atCamp(next)),
    data,
    rng,
  );
  return finishIfEnded(
    pushLog(step.state, "You know the still now. Plastic, a container, tubing, a pit."),
    step.journal,
    data,
  );
}

function useKit(state: RunState, journal: Journal, data: GameData): StepResult {
  const treatable = new Set(["snakebite", "scorpion", "laceration"]);
  const had = state.conditions.filter((condition) => treatable.has(condition.id));
  if (had.length === 0 && state.sprainHours <= 0) {
    return fail(state, journal, "You pocket the kit again. Nothing is open or swelling.");
  }
  let next: RunState = {
    ...state,
    inventory: addItem(state.inventory, "first-aid", -1),
    conditions: state.conditions.filter((condition) => !treatable.has(condition.id)),
    sprainHours: Math.max(0, state.sprainHours - 24),
  };
  const names = had.map((condition) => data.conditions[condition.id]?.name ?? condition.id);
  next = pushLog(
    next,
    names.length
      ? `You spend the kit on ${names.join(" and ")}. The clock on that wound stops.`
      : "You wrap the ankle. It is not healed. It is less of a tax.",
  );
  const reconciled = reconcileLabor(next, data);
  return { journal, state: reconciled.state };
}

function remember(
  state: RunState,
  journal: Journal,
  discovery: DiscoveryDef,
  effect: EffectDef | undefined,
): StepResult {
  if (!effect?.learn || !effect.journal) return { state, journal };
  const learned = learnDiscovery(journal, {
    id: discovery.id,
    name: discovery.name,
    text: effect.journal,
    learnedOnRun: runNumber(journal),
  });
  return {
    journal: learned.journal,
    state: learned.learned ? noteRunDiscovery(state, discovery.id) : state,
  };
}

function eatDiscovery(state: RunState, journal: Journal, discovery: DiscoveryDef, data: GameData): StepResult {
  let next = { ...state, inventory: addItem(state.inventory, discovery.itemId, -1) };
  next = applyEffect(next, discovery.eat);
  let step = remember(next, journal, discovery, discovery.eat);
  step = countPear(step.state, step.journal, discovery);
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  const reconciled = reconcileLabor(step.state, data);
  return {
    journal: step.journal,
    state: reconciled.note ? pushLog(reconciled.state, reconciled.note) : reconciled.state,
  };
}

function countPear(state: RunState, journal: Journal, discovery: DiscoveryDef): StepResult {
  if (discovery.countsAs !== "pear") return { state, journal };
  let next = { ...state, pearsToday: state.pearsToday + 1 };
  if (discovery.overeatAt && next.pearsToday >= discovery.overeatAt && discovery.overeat) {
    next = applyEffect(next, discovery.overeat);
  }
  return { state: next, journal };
}

function experiment(
  state: RunState,
  journal: Journal,
  discovery: DiscoveryDef,
  data: GameData,
  rng: Rng,
): StepResult {
  const hours = discovery.experiment.hours ?? 1;
  const block = timeBlock(state, hours, true);
  if (block) return fail(state, journal, block);
  let next = {
    ...state,
    laborHours: state.laborHours - hours,
    inventory: addItem(state.inventory, discovery.itemId, -1),
  };
  let step = runHours(next, journal, hours, contextFor(atCamp(next) ? "camp" : "rest", atCamp(next)), data, rng);
  if (step.state.phase === "ended") {
    step = remember(step.state, step.journal, discovery, discovery.experiment);
    return finishIfEnded(step.state, step.journal, data);
  }
  step = { ...step, state: applyEffect(step.state, discovery.experiment) };
  step = remember(step.state, step.journal, discovery, discovery.experiment);
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  const reconciled = reconcileLabor(step.state, data);
  return {
    journal: step.journal,
    state: reconciled.note ? pushLog(reconciled.state, reconciled.note) : reconciled.state,
  };
}

function prepare(
  state: RunState,
  journal: Journal,
  discovery: DiscoveryDef,
  data: GameData,
  rng: Rng,
): StepResult {
  const prep = discovery.prepare;
  if (!prep) return { state, journal };
  const hours = prep.hours ?? 1;
  const block = timeBlock(state, hours, true);
  if (block) return fail(state, journal, block);
  const fired = Boolean(prep.fireBonus) && state.camp.firePit && atCamp(state);
  let step = runHours(
    pushLog(
      {
        ...state,
        laborHours: state.laborHours - hours,
        inventory: addItem(state.inventory, discovery.itemId, -1),
      },
      fired ? "You work it over the fire." : "You prepare it without a fire.",
    ),
    journal,
    hours,
    contextFor("camp", atCamp(state)),
    data,
    rng,
  );
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  step = { ...step, state: applyEffect(step.state, prep) };
  if (fired && prep.fireBonus) {
    step = {
      ...step,
      state: applyEffect(step.state, {
        hunger: prep.fireBonus.hunger,
        hydration: prep.fireBonus.hydration,
        morale: prep.fireBonus.morale,
        log: prep.fireBonus.log,
      }),
    };
  }
  step = countPear(step.state, step.journal, discovery);
  return finishIfEnded(step.state, step.journal, data);
}

function boil(
  state: RunState,
  journal: Journal,
  discovery: DiscoveryDef,
  data: GameData,
  rng: Rng,
): StepResult {
  const spec = discovery.boil;
  if (!spec) return { state, journal };
  if (!state.camp.firePit || !atCamp(state)) {
    return fail(state, journal, "Boiling needs the fire pit, and the fire pit is at camp.");
  }
  const block = timeBlock(state, spec.hours, true);
  if (block) return fail(state, journal, block);
  let step = runHours(
    pushLog(
      {
        ...state,
        laborHours: state.laborHours - spec.hours,
        inventory: addItem(state.inventory, discovery.itemId, -1),
      },
      "You set the seep on the fire.",
    ),
    journal,
    spec.hours,
    contextFor("camp", true),
    data,
    rng,
  );
  if (step.state.phase === "ended") return finishIfEnded(step.state, step.journal, data);
  step = {
    ...step,
    state: pushLog(
      { ...step.state, inventory: addItem(step.state.inventory, "water", spec.yieldsWater) },
      spec.log,
    ),
  };
  return step;
}

function poultice(state: RunState, journal: Journal, discovery: DiscoveryDef, data: GameData): StepResult {
  const spec = discovery.poultice;
  if (!spec) return { state, journal };
  if (!state.conditions.some((condition) => condition.id === spec.clears)) {
    return fail(state, journal, "No burn to treat. Save the sprigs.");
  }
  let next: RunState = {
    ...state,
    inventory: addItem(state.inventory, discovery.itemId, -1),
    conditions: state.conditions.filter((condition) => condition.id !== spec.clears),
    morale: Math.min(100, state.morale + (spec.morale ?? 0)),
  };
  next = pushLog(next, spec.log);
  const reconciled = reconcileLabor(next, data);
  return { journal, state: reconciled.state };
}

export function previewLine(
  state: RunState,
  hours: number,
  ctx: HourContext,
  data: GameData,
): { detail: string; warning: string } {
  const end = advanceTime(structuredClone(state), hours, ctx, data);
  const liters = Math.max(0, state.hydration - end.hydration) / data.needs.pointsPerLiter;
  let warning = "";
  if (end.bodyTempC >= data.needs.bodyTemp.heatSevereC) warning = "Heat stroke risk";
  else if (end.bodyTempC >= data.needs.bodyTemp.heatMildC) warning = "You will overheat";
  else if (end.bodyTempC <= data.needs.bodyTemp.coldSevereC) warning = "Hypothermia risk";
  else if (end.bodyTempC <= data.needs.bodyTemp.coldMildC) warning = "The cold will get in";
  const health = end.health < state.health - 1 ? ` · ${Math.round(state.health - end.health)} health` : "";
  return {
    detail: `${hours}h · about ${liters.toFixed(1)} L${health}`,
    warning,
  };
}

function button(
  id: string,
  group: string,
  label: string,
  detail: string,
  warning: string,
  disabled: boolean,
  command: Command | null,
): ActionButton {
  return { id, group, label, detail, warning, disabled, command: disabled ? null : command };
}

export function listActions(state: RunState, journal: Journal, data: GameData): ActionButton[] {
  if (state.phase !== "playing") return [];
  const actions: ActionButton[] = [];
  const camp = atCamp(state);

  if ((state.inventory.water ?? 0) >= 0.05 && state.hydration < 92) {
    actions.push(
      button(
        "drink",
        "Now",
        `Drink ${data.needs.drinkLiters.toFixed(1)} L`,
        `${(state.inventory.water ?? 0).toFixed(1)} L on hand`,
        "",
        false,
        { type: "item", itemId: "water", action: "drink" },
      ),
    );
  }
  if ((state.inventory.ration ?? 0) >= 1 && state.hunger < 90) {
    const warm = state.camp.firePit && camp;
    actions.push(
      button(
        "eat-ration",
        "Now",
        warm ? "Eat a warmed ration" : "Eat a ration",
        `${state.inventory.ration} left`,
        "",
        false,
        { type: "item", itemId: "ration", action: warm ? "warm" : "eat" },
      ),
    );
  }
  const treatable = state.conditions.some((c) => ["snakebite", "scorpion", "laceration"].includes(c.id));
  if ((treatable || state.sprainHours > 0) && (state.inventory["first-aid"] ?? 0) >= 1) {
    actions.push(button("kit", "Now", "Use first aid", "Stops a bite, sting, or open cut", "", false, {
      type: "item",
      itemId: "first-aid",
      action: "use",
    }));
  }

  const restHours = data.needs.restHours;
  const restBlock = timeBlock(state, restHours, false);
  const restPreview = restBlock ? { detail: restBlock, warning: "" } : previewLine(state, restHours, contextFor("rest", camp), data);
  actions.push(button("rest", "Now", camp && state.camp.shelter ? "Rest in the shelter" : "Rest in shade", restPreview.detail, restPreview.warning, Boolean(restBlock), { type: "rest" }));

  const sleepBlock = camp ? null : "Sleep is at camp. Get back first.";
  const night =
    !state.camp.shelter && !state.camp.firePit
      ? "A hard night against the wreck"
      : state.camp.shelter && state.camp.firePit
        ? "Shelter and fire"
        : state.camp.shelter
          ? "The shelter should blunt the cold"
          : "The fire should cover the cold";
  actions.push(button("sleep", "Now", "Sleep until dawn", sleepBlock ?? night, "", Boolean(sleepBlock), { type: "sleep" }));

  if (camp && state.camp.wreckSearchesLeft > 0) {
    const hours = data.camp.searchHours;
    const block = timeBlock(state, hours, true);
    const preview = block ? { detail: block, warning: "" } : previewLine(state, hours, contextFor("search", true), data);
    actions.push(
      button(
        "search-camp",
        "Now",
        "Search the cabin",
        `${preview.detail} · ${state.camp.wreckSearchesLeft} passes left`,
        preview.warning,
        Boolean(block),
        { type: "search" },
      ),
    );
  } else if (camp) {
    actions.push(button("search-camp", "Now", "Search the cabin", "The cabin is stripped.", "", true, null));
  } else {
    const zone = data.zoneById.get(state.location);
    const hours = zone?.searchHours ?? 2;
    const block = timeBlock(state, hours, true);
    const preview = block
      ? { detail: block, warning: "" }
      : previewLine(state, hours, contextFor("search", false, zone?.exposure ?? 1), data);
    actions.push(button("search-zone", "Now", "Search here", preview.detail, preview.warning, Boolean(block), { type: "search" }));
  }

  for (const recipe of data.recipes) {
    actions.push(...recipeButtons(state, journal, recipe, data));
  }
  if (state.camp.signalLit) {
    actions.push(button("douse", "Build", "Bank the signal fire", "Stops the fuel drain. Also stops the smoke.", "", false, { type: "douse-signal" }));
  }

  if (camp) {
    for (const zone of data.zones) {
      const hours = travelCost(state, zone.travelHours);
      const storm = state.sandstorm ? "A sandstorm is up. You are not walking out into it." : null;
      const block = storm ?? timeBlock(state, hours, true);
      const preview = block
        ? { detail: block, warning: "" }
        : previewLine(state, hours, contextFor("travel", false, zone.exposure), data);
      actions.push(
        button(
          `go-${zone.id}`,
          "Move",
          `Travel to ${zone.name}`,
          `${preview.detail}${state.sprainHours > 0 ? " · +1h ankle" : ""}`,
          preview.warning,
          Boolean(block),
          { type: "travel", zoneId: zone.id },
        ),
      );
    }
  } else {
    const zone = data.zoneById.get(state.location);
    const hours = zone ? travelCost(state, zone.travelHours) : 1;
    const block = timeBlock(state, hours, true);
    const preview = block || !zone
      ? { detail: block ?? "", warning: "" }
      : previewLine(state, hours, contextFor("travel", false, zone.exposure), data);
    actions.push(
      button("return", "Move", "Return to camp", preview.detail, preview.warning, Boolean(block), { type: "return" }),
    );
  }

  return actions;
}

function recipeButtons(
  state: RunState,
  journal: Journal,
  recipe: RecipeDef,
  data: GameData,
): ActionButton[] {
  if (recipe.grants === "signalFire" && state.camp.signalBuilt && !state.camp.signalLit && recipe.relight) {
    const block = state.location !== "camp"
      ? "The beacon is at camp."
      : !hasAll(state.inventory, recipe.relight.requires)
        ? `Need ${missingNames(state.inventory, recipe.relight.requires, data).join(", ")}`
        : timeBlock(state, recipe.relight.hours, true);
    return [
      button("relight", "Build", "Relight the signal", block || `${recipe.relight.hours}h · 1 fuel`, "", Boolean(block), {
        type: "build",
        recipeId: recipe.id,
      }),
    ];
  }
  if (recipe.grants === "shelter" && state.camp.shelter) return [];
  if (recipe.grants === "firePit" && state.camp.firePit) return [];
  if (recipe.grants === "signalFire" && state.camp.signalLit) return [];
  if (recipe.grants === "solarStill") {
    const known = Boolean(journal.schematics["solar-still"]);
    const parts = hasAll(state.inventory, recipe.requires);
    if (!known && !parts) return [];
    return [stillButton(state, recipe, data, known)];
  }
  return [standardRecipeButton(state, recipe, data, recipe.name)];
}

function stillButton(state: RunState, recipe: RecipeDef, data: GameData, known: boolean): ActionButton {
  const count = state.camp.stills.length;
  const label = known
    ? `${recipe.knownLabel ?? recipe.name}${count ? ` (${count}/${recipe.max ?? 4})` : ""}`
    : (recipe.unknownLabel ?? "Rig a water still");
  const place = state.location === "dry-wash" ? "Wash placement yields more." : "A wash placement yields more.";
  let block: string | null = null;
  if (recipe.max && count >= recipe.max) block = "You are tending as many stills as you can.";
  else if (!recipe.where.includes(state.location)) block = "Build this at camp, or in the dry wash for a better yield.";
  else if (!hasAll(state.inventory, recipe.requires)) {
    block = `Need ${missingNames(state.inventory, recipe.requires, data).join(", ")}`;
  } else block = timeBlock(state, recipe.hours, true);
  const detail = block || `${known ? recipe.hours + "h · " + place : recipe.unknownDetail ?? ""}`;
  return button(known ? "build-still" : "discover-still", "Build", label, detail, "", Boolean(block), {
    type: "build",
    recipeId: recipe.id,
  });
}

function standardRecipeButton(
  state: RunState,
  recipe: RecipeDef,
  data: GameData,
  label: string,
): ActionButton {
  let block: string | null = null;
  if (!recipe.where.includes(state.location)) block = `Build this at ${recipe.where.join(" or ")}.`;
  else if (recipe.requiresFlag === "firePit" && !state.camp.firePit) block = "Needs a fire pit.";
  else if (!hasAll(state.inventory, recipe.requires)) {
    block = `Need ${missingNames(state.inventory, recipe.requires, data).join(", ")}`;
  } else block = timeBlock(state, recipe.hours, true);
  const needs = Object.entries(recipe.requires)
    .map(([id, qty]) => `${data.itemById.get(id)?.name ?? id} ×${qty}`)
    .join(", ");
  const detail = block || `${recipe.hours}h · ${needs}`;
  return button(`build-${recipe.id}`, "Build", label, detail, "", Boolean(block), {
    type: "build",
    recipeId: recipe.id,
  });
}

export function buildItemModal(
  state: RunState,
  journal: Journal,
  itemId: string,
  data: GameData,
): ItemModal | null {
  const item = data.itemById.get(itemId);
  if (!item || itemQty(state.inventory, itemId) <= 0) return null;
  const presented = presentItem(itemId, journal, data);
  const qty = state.inventory[itemId] ?? 0;
  const qtyLabel = item.unit === "L" ? `${qty.toFixed(1)} L` : qty > 1 ? `×${qty}` : "";
  const actions: ItemActionView[] = [];
  const discovery = data.discoveryByItemId.get(itemId);

  if (itemId === "water") {
    actions.push(act("drink", `Drink ${data.needs.drinkLiters.toFixed(1)} L`, "Raises hydration. Does not take a work hour.", false, ""));
  } else if (itemId === "ration") {
    actions.push(act("eat", "Eat", "Calories, no experiment required.", false, ""));
    if (state.camp.firePit && atCamp(state)) {
      actions.push(act("warm", "Warm it on the fire", "A little more comfort.", false, ""));
    }
  } else if (itemId === "field-manual") {
    const known = Boolean(journal.schematics["solar-still"]);
    actions.push(act("read", known ? "Read it again" : "Read the page", known ? "You already know the still." : "1h. Teaches the solar still.", false, ""));
  } else if (itemId === "first-aid") {
    actions.push(act("use", "Use the kit", "Bites, stings, cuts. A sprain gets a day back.", false, ""));
  } else if (discovery) {
    const ids = presented.known ? discovery.knownActions : discovery.unknownActions;
    for (const id of ids) {
      if (id === "ignore") continue;
      actions.push(discoveryAction(id, discovery, presented.known, state));
    }
  }

  actions.push(act("ignore", "Close", "Put it back.", false, ""));
  return {
    itemId,
    title: presented.name,
    blurb: presented.blurb,
    known: presented.known,
    qtyLabel,
    actions,
  };
}

function discoveryAction(
  id: string,
  discovery: DiscoveryDef,
  known: boolean,
  state: RunState,
): ItemActionView {
  if (id === "ignore") return act("ignore", "Ignore", "Learn nothing.", false, "");
  if (id === "eat") {
    if (!known) return act("eat", "Eat", "The direct way. The journal keeps whatever happens.", false, "");
    if (discovery.safe) return act("eat", "Eat raw", discovery.summary, false, "");
    return act("eat", discovery.boil ? "Drink raw" : "Eat anyway", "You know the cost.", false, "");
  }
  if (id === "experiment") {
    const hours = discovery.experiment.hours ?? 1;
    const block = timeBlock(state, hours, true);
    return act("experiment", "Experiment", block ?? `${hours}h · a small test, then the truth`, Boolean(block), block ?? "");
  }
  if (id === "prepare") {
    const hours = discovery.prepare?.hours ?? 1;
    const block = timeBlock(state, hours, true);
    const fire = state.camp.firePit && atCamp(state) ? "Fire makes it better." : "Edible without a fire. Better at camp if the pit is lit.";
    return act("prepare", "Prepare", block ?? `${hours}h · ${fire}`, Boolean(block), block ?? "");
  }
  if (id === "boil") {
    const hours = discovery.boil?.hours ?? 1;
    let block: string | null = null;
    if (!state.camp.firePit || !atCamp(state)) block = "Needs the fire pit at camp.";
    else block = timeBlock(state, hours, true);
    return act("boil", "Boil it", block ?? `${hours}h · makes ${discovery.boil?.yieldsWater ?? 0.5} L of clean water`, Boolean(block), block ?? "");
  }
  if (id === "poultice") {
    const burned = state.conditions.some((condition) => condition.id === "sunburn");
    return act("poultice", "Make a poultice", burned ? "Clears sunburn." : "No burn to treat.", !burned, burned ? "" : "No burn to treat.");
  }
  return act(id, id, "", true, "");
}

function act(id: string, label: string, detail: string, disabled: boolean, reason: string): ItemActionView {
  return { id, label, detail, disabled, reason };
}
