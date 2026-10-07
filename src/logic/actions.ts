import type {
  ActionButton,
  Command,
  CraftView,
  DiscoveryDef,
  EffectDef,
  GameData,
  HourContext,
  ItemActionView,
  ItemModal,
  Journal,
  RecipeDef,
  RunState,
  SlotId,
} from "../models/types.ts";
import {
  buildCost,
  buildMaterials,
  craftBlock,
  craftHours,
  describeMaterial,
  knowsPattern,
  materialNoteId,
  missingSlotText,
  patternId,
  resolveBuild,
  SLOTS,
  slotMaterials,
  slotRule,
  torchBurns,
  applyBuild,
  carryBlock,
} from "./crafting.ts";
import { resolveDawn } from "./dawn.ts";
import { applyEffect } from "./effects.ts";
import { finishIfEnded } from "./ending.ts";
import { applyHazard, rollHazards } from "./hazards.ts";
import { addItem, findLog, hasAll, itemQty, missingNames, presentItem, spend } from "./inventory.ts";
import {
  learnDiscovery,
  learnHazard,
  addLesson,
  noteRunHazard,
  learnSchematic,
  noteRunDiscovery,
  noteRunSchematic,
  runNumber,
} from "./journal.ts";
import { pushLog } from "./log.ts";
import { advanceTime, contextFor } from "./needs.ts";
import { planAction, planLabel, type ActionPlan } from "./pace.ts";
import type { Rng } from "./rng.ts";
import { hoursUntilDawn } from "./time.ts";
import { clamp, round2, weightedIndex } from "./util.ts";
import { bestWeapon, eatRawMeat, killOdds, resolveSighting, rollSighting } from "./wildlife.ts";

export interface StepResult {
  state: RunState;
  journal: Journal;
}

function fail(state: RunState, journal: Journal, text: string): StepResult {
  return { state: pushLog(state, text), journal };
}

function runHours(
  state: RunState,
  journal: Journal,
  hours: number,
  ctx: HourContext,
  data: GameData,
  rng: Rng,
  beforeDawn?: (state: RunState, journal: Journal) => StepResult,
): StepResult {
  let journalNow = journal;
  const next = advanceTime(
    state,
    hours,
    ctx,
    data,
    (dawnState) => {
      let ready = dawnState;
      if (beforeDawn) {
        const pre = beforeDawn(dawnState, journalNow);
        ready = pre.state;
        journalNow = pre.journal;
      }
      const dawned = resolveDawn(ready, journalNow, data, rng);
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

function blockedText(plan: ActionPlan, data: GameData): string {
  return `${plan.blocked} ${data.needs.darkness.lightHint}`;
}

/** Light the torch if this plan relies on one. It is spent by the action. */
function lightTorch(state: RunState, plan: ActionPlan): RunState {
  if (!plan.torch) return state;
  const left = Math.max(0, (state.inventory.torch ?? 0) - 1);
  return pushLog(
    { ...state, inventory: addItem(state.inventory, "torch", -1) },
    left > 0
      ? `You light the torch for this job. ${left} burn${left === 1 ? "" : "s"} left on it.`
      : "You light the torch. This is its last burn.",
  );
}

function slowNote(plan: ActionPlan): RunState["log"][number]["text"] | null {
  if (plan.hours <= plan.base) return null;
  return `It takes ${plan.hours} hours instead of ${plan.base}.`;
}

function withSlowNote(state: RunState, plan: ActionPlan): RunState {
  const note = slowNote(plan);
  return note ? pushLog(state, note) : state;
}

export function applyCommand(
  state: RunState,
  journal: Journal,
  command: Command,
  data: GameData,
  rng: Rng,
): StepResult {
  if (state.phase === "ended") return { state, journal };
  if (state.pending) {
    if (command.type !== "sighting") {
      const animal = data.animalById.get(state.pending.animalId);
      return fail(state, journal, `The ${animal?.name.toLowerCase() ?? "animal"} is right there. Decide first.`);
    }
    return afterStep(resolveSighting(state, journal, command.choice, data, rng), data, rng);
  }
  if (command.type === "sighting") return { state, journal };
  return afterStep(dispatch(state, journal, command, data, rng), data, rng);
}

/** Runs after every command: an unanswered choice waits; fatigue at the limit drops you. */
function afterStep(step: StepResult, data: GameData, rng: Rng): StepResult {
  step = noteInfection(step, data);
  const ended = finishIfEnded(step.state, step.journal, data);
  if (ended.state.phase !== "playing" || ended.state.pending) return ended;
  if (ended.state.fatigue >= data.needs.fatigue.collapseAt) return collapse(ended.state, ended.journal, data, rng);
  return ended;
}

/** The first infected wound writes a journal entry, whenever it shows up. */
function noteInfection(step: StepResult, data: GameData): StepResult {
  const spec = data.woundcare.infectionJournal;
  if (step.journal.hazards[spec.id]) return step;
  if (!step.state.conditions.some((c) => c.id === data.woundcare.infection.id)) return step;
  const learned = learnHazard(step.journal, { ...spec, learnedOnRun: runNumber(step.journal) });
  const run = runNumber(step.journal);
  const withLesson = addLesson(learned.journal, {
    id: `first-infection-run${run}-d${step.state.day}-s${step.state.seed}`,
    cause: "infection",
    day: step.state.day,
    text: data.lessons.infection.lesson,
    run,
    seed: step.state.seed,
  });
  return {
    journal: withLesson,
    state: pushLog(noteRunHazard(step.state, spec.id), `Journal: ${spec.text}`),
  };
}

/** Improvised wound care: cloth over a cut. Weaker than a kit; dirty cloth can turn the wound. */
function bandage(state: RunState, journal: Journal, rinse: boolean, data: GameData, rng: Rng): StepResult {
  const spec = data.woundcare;
  const cut = state.conditions.find((c) => c.id === spec.treats);
  if (!cut) return fail(state, journal, "There is no open cut to bandage. Cloth does nothing for venom.");
  if ((state.inventory[spec.cloth] ?? 0) < 1) return fail(state, journal, spec.logs.noCloth);
  if (rinse && (state.inventory.water ?? 0) < spec.rinse.liters) return fail(state, journal, "Not enough water to rinse it.");
  const plan = planAction(state, spec.hours, data);
  const dirty = rng.next() < (rinse ? spec.rinse.infectionChance : spec.infectionChance);
  const hoursLeft = Math.max(spec.minHours, Math.ceil(cut.hoursLeft * spec.hoursFactor));
  let inventory = addItem(state.inventory, spec.cloth, -1);
  if (rinse) inventory = addItem(inventory, "water", -spec.rinse.liters);
  let next: RunState = {
    ...state,
    inventory,
    conditions: [
      ...state.conditions.filter((c) => c.id !== spec.treats),
      { id: dirty ? spec.dirty : spec.clean, hoursLeft },
    ],
  };
  if (rinse) next = pushLog(next, spec.logs.rinse);
  next = withSlowNote(pushLog(next, spec.logs.bandage), plan);
  let nextJournal = journal;
  const learned = learnDiscovery(nextJournal, { ...spec.journal, learnedOnRun: runNumber(nextJournal) });
  if (learned.learned) {
    nextJournal = learned.journal;
    next = pushLog(noteRunDiscovery(next, spec.journal.id), `Journal: ${spec.journal.text}`);
  }
  return runHours(next, nextJournal, plan.hours, contextFor("camp", atCamp(state)), data, rng);
}

function bandageButtons(state: RunState, data: GameData): ActionButton[] {
  const spec = data.woundcare;
  if (!state.conditions.some((c) => c.id === spec.treats)) return [];
  const plan = planAction(state, spec.hours, data);
  const cloth = state.inventory[spec.cloth] ?? 0;
  if (cloth < 1) return [button("bandage", "Now", "Bandage the wound", spec.logs.noCloth, "", true, null)];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const out = [
    button("bandage", "Now", "Bandage the wound", `${planLabel(plan)} · 1 cloth · slows the bleeding by ${pct(spec.drainCut)} · ${pct(spec.infectionChance)} it turns`, "", false, {
      type: "item", itemId: spec.cloth, action: "bandage",
    }),
  ];
  const water = state.inventory.water ?? 0;
  if (water >= spec.rinse.liters) {
    out.push(button("bandage-rinse", "Now", "Rinse and bandage", `${planLabel(plan)} · 1 cloth + ${spec.rinse.liters} L water · ${pct(spec.rinse.infectionChance)} it turns`, "", false, {
      type: "item", itemId: spec.cloth, action: "bandage-rinse",
    }));
  }
  return out;
}

/** Bites and stings that find someone lying still in the open. Rolled once, on waking. */
function rollLyingHazards(
  step: StepResult,
  risks: { id: string; chance: number; log?: string }[],
  data: GameData,
  rng: Rng,
): StepResult {
  let woke = step;
  for (const risk of risks) {
    if (woke.state.phase === "ended") break;
    if (rng.next() >= risk.chance) continue;
    const hazard = data.hazardById.get(risk.id);
    if (hazard) woke = applyHazard(woke.state, woke.journal, hazard, data, risk.log);
  }
  return woke;
}

/**
 * Fatigue hit the limit. A hard stop: unconscious where you stand for a fixed number of hours
 * (data: collapse.hours) from this moment, at any time of day. Full exposure away from camp,
 * poor recovery, and things that bite. Dawn still resolves if the hours cross 06:00.
 */
export function collapse(state: RunState, journal: Journal, data: GameData, rng: Rng): StepResult {
  const spec = data.needs.collapse;
  const camp = atCamp(state);
  let step = runHours(
    pushLog(state, camp ? spec.logCamp : spec.logOpen),
    journal,
    spec.hours,
    { activity: "sleep", atCamp: camp, exposure: 1, collapsed: true },
    data,
    rng,
  );
  if (step.state.phase !== "ended" && !camp) step = rollLyingHazards(step, spec.hazards, data, rng);
  if (step.state.phase !== "ended") step = { ...step, state: pushLog(step.state, spec.logWake) };
  if (step.state.phase === "ended" && !step.state.ending) {
    step = { ...step, state: { ...step.state, pendingCause: "exhaustion" } };
  }
  return finishIfEnded(step.state, step.journal, data);
}

function dispatch(
  state: RunState,
  journal: Journal,
  command: Command,
  data: GameData,
  rng: Rng,
): StepResult {
  switch (command.type) {
    case "rest":
      return rest(state, journal, data, rng);
    case "sleep":
      return sleep(state, journal, command.hours, data, rng);
    case "wait":
      return wait(state, journal, command.hours, data, rng);
    case "travel":
      return travel(state, journal, command.zoneId, data, rng);
    case "return":
      return travelBack(state, journal, data, rng);
    case "search":
      return search(state, journal, data, rng);
    case "build":
      return build(state, journal, command.recipeId, data, rng);
    case "craft":
      return craft(state, journal, command.toolId, command.picks ?? {}, data, rng);
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
  const camp = atCamp(state);
  let step = runHours(
    pushLog(state, camp ? "You get out of the sun and wait." : "You take the shade the rocks will give you."),
    journal,
    hours,
    contextFor("rest", camp),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
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
  return { ...step, state: rollSighting(step.state, data, rng, "rest") };
}

/** Resolve a sleep request. Omitted means "until dawn", which is only legal when dawn is close. */
export function sleepHoursFor(state: RunState, requested: number | undefined, data: GameData): number {
  if (requested === undefined) {
    const dawn = hoursUntilDawn(state.hour);
    return dawn <= data.needs.sleep.dawnMaxHours ? dawn : 0;
  }
  if (!Number.isFinite(requested)) return 0;
  return Math.floor(requested);
}

function sleep(state: RunState, journal: Journal, hoursRequested: number | undefined, data: GameData, rng: Rng): StepResult {
  const hours = sleepHoursFor(state, hoursRequested, data);
  if (hours < 1 || hours > 24) return fail(state, journal, "Dawn is too far off to sleep straight through. Pick a length.");
  if (!atCamp(state)) return sleepOpen(state, journal, hours, data, rng);
  const cold =
    !state.camp.shelter && !state.camp.firePit
      ? " The wreck will only blunt the night, not stop it."
      : "";
  return runHours(
    pushLog(state, `You sleep.${cold}`),
    journal,
    hours,
    contextFor("sleep", true),
    data,
    rng,
  );
}

/** Sleeping away from camp: allowed, but worse recovery and something may find you. */
function sleepOpen(state: RunState, journal: Journal, hours: number, data: GameData, rng: Rng): StepResult {
  const spec = data.needs.wait;
  let step = runHours(pushLog(state, spec.logs.sleepOpen), journal, hours, contextFor("sleep", false), data, rng);
  if (step.state.phase === "ended") return step;
  const chance = spec.openSleep.hazardChance * Math.min(1, hours / spec.openSleep.fullNightHours);
  step = rollLyingHazards(step, [{ id: spec.openSleep.hazardId, chance, log: spec.openSleep.hazardLog }], data, rng);
  if (step.state.phase === "ended") return step;
  return { ...step, state: pushLog(step.state, spec.logs.sleepOpenDone) };
}

/** Resolve a wait request to whole hours. Omitted means "until the next dawn". */
export function waitHoursFor(state: RunState, requested: number | undefined): number {
  if (requested === undefined) return hoursUntilDawn(state.hour);
  if (!Number.isFinite(requested)) return 0;
  return Math.floor(requested);
}

/**
 * Waiting is always legal: any zone, any hour, any condition.
 * It applies normal exposure. Camp gives the wreck, shelter, and fire; the open gives nothing.
 */
function wait(
  state: RunState,
  journal: Journal,
  requested: number | undefined,
  data: GameData,
  rng: Rng,
): StepResult {
  const hours = waitHoursFor(state, requested);
  if (hours < 1 || hours > 24) return fail(state, journal, "Wait how long?");
  const camp = atCamp(state);
  const logs = data.needs.wait.logs;
  const opener = !camp ? logs.waitOpen : state.camp.shelter ? logs.waitShelter : logs.waitCamp;
  const step = runHours(pushLog(state, opener), journal, hours, contextFor("wait", camp), data, rng);
  if (step.state.phase === "ended") return step;
  return { ...step, state: rollSighting(pushLog(step.state, logs.waitDone), data, rng, "rest") };
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
  const plan = planAction(state, travelCost(state, zone.travelHours), data, { useTorch: true });
  let step = runHours(
    withSlowNote(lightTorch(pushLog(state, `You leave camp for the ${zone.name}.`), plan), plan),
    journal,
    plan.hours,
    contextFor("travel", false, zone.exposure),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
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
  step = rollHazards(step.state, step.journal, data, rng, "travel", false, zone.id, plan);
  if (step.state.phase === "ended") return step;
  return { ...step, state: rollSighting(step.state, data, rng, "travel") };
}

function travelBack(state: RunState, journal: Journal, data: GameData, rng: Rng): StepResult {
  if (atCamp(state)) return fail(state, journal, "You are already at the wreck.");
  const zone = data.zoneById.get(state.location);
  if (!zone) return { state, journal };
  const plan = planAction(state, travelCost(state, zone.travelHours), data, { useTorch: true });
  let step = runHours(
    withSlowNote(
      lightTorch(pushLog(state, `You turn back toward the wreck. ${plan.hours} hours, if the ankle and the sun agree.`), plan),
      plan,
    ),
    journal,
    plan.hours,
    contextFor("travel", false, zone.exposure),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
  step = { ...step, state: { ...step.state, location: "camp" } };
  step = { ...step, state: pushLog(step.state, "The fuselage comes up out of the glare. Camp, such as it is.") };
  return rollHazards(step.state, step.journal, data, rng, "travel", false, zone.id, plan);
}

function searchPlan(state: RunState, data: GameData): ActionPlan {
  const camp = atCamp(state);
  const zone = camp ? null : data.zoneById.get(state.location);
  const hours = camp ? data.camp.searchHours : (zone?.searchHours ?? 2);
  return planAction(state, hours, data, { needsLight: Boolean(zone?.searchNeedsLight), useTorch: true });
}

function search(state: RunState, journal: Journal, data: GameData, rng: Rng): StepResult {
  const camp = atCamp(state);
  if (camp && state.camp.wreckSearchesLeft <= 0) {
    return fail(state, journal, "The cabin has given up its easy secrets. The rest is out in the zones.");
  }
  const zone = camp ? null : data.zoneById.get(state.location);
  const plan = searchPlan(state, data);
  if (plan.blocked) return fail(state, journal, blockedText(plan, data));
  const exposure = zone?.exposure ?? 1;
  let step = runHours(
    withSlowNote(
      lightTorch(
        pushLog(state, camp ? "You pick through the cabin, hands slow in the heat." : `You search the ${zone?.name ?? "ground"}.`),
        plan,
      ),
      plan,
    ),
    journal,
    plan.hours,
    contextFor("search", camp, exposure),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
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
  step = rollHazards(step.state, step.journal, data, rng, "search", camp, camp ? "camp" : (zone?.id ?? "camp"), plan);
  if (step.state.phase === "ended") return step;
  return { ...step, state: rollSighting(step.state, data, rng, "search") };
}

function recipeHidden(state: RunState, recipe: RecipeDef): boolean {
  if (recipe.grants !== "item") return false;
  const max = recipe.maxCarry;
  if (!max) return false;
  return Object.keys(recipe.yields ?? {}).every((id) => (state.inventory[id] ?? 0) >= max);
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
  if (recipeHidden(state, recipe)) return fail(state, journal, `You already carry enough of those.`);
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
  const plan = planAction(state, recipe.hours, data, { needsLight: recipe.needsLight });
  if (plan.blocked) return fail(state, journal, blockedText(plan, data));
  let step = runHours(
    withSlowNote(
      lightTorch(
        pushLog(
          { ...state, inventory: spend(state.inventory, recipe.requires) },
          `You start on the ${recipe.name.toLowerCase()}.`,
        ),
        plan,
      ),
      plan,
    ),
    journal,
    plan.hours,
    contextFor("build", atCamp(state)),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
  step = { ...step, state: grantRecipe(step.state, recipe, state.location) };
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
  return step;
}

/** Component crafting: handle + tool end + binding. */
function craft(
  state: RunState,
  journal: Journal,
  toolId: string,
  picks: Partial<Record<SlotId, string>>,
  data: GameData,
  rng: Rng,
): StepResult {
  const tool = data.toolById.get(toolId);
  if (!tool) return { state, journal };
  const resolved = resolveBuild(state, tool, data, picks);
  const block = craftBlock(state, tool, data, resolved);
  if (block || !resolved.build) return fail(state, journal, block ?? "Missing parts.");
  const build = resolved.build;
  const mats = buildMaterials(build, data);
  const plan = planAction(state, craftHours(tool, build, data), data);
  const names = mats.map((m) => m.name.toLowerCase());
  let step = runHours(
    withSlowNote(
      pushLog(
        { ...state, inventory: spend(state.inventory, buildCost(build, data)) },
        `You lay out ${names[0]}, ${names[1]} and ${names[2]}, and start on a ${tool.name.toLowerCase()}.`,
      ),
      plan,
    ),
    journal,
    plan.hours,
    contextFor("build", atCamp(state)),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
  let next = step.state;
  if (tool.end === "flammable") {
    const burns = torchBurns(build, data);
    next = pushLog(
      { ...next, inventory: addItem(next.inventory, tool.item, burns) },
      `${tool.log} About ${burns} burn${burns === 1 ? "" : "s"} of light.`,
    );
  } else {
    next = {
      ...next,
      inventory: addItem(next.inventory, tool.item, 1),
      gear: { ...(next.gear ?? {}), [tool.item]: build },
      morale: clamp(next.morale + 2, 0, 100),
    };
    next = pushLog(next, tool.log);
  }
  let nextJournal = step.journal;
  const learned = learnSchematic(nextJournal, {
    id: patternId(tool),
    name: tool.pattern.name,
    text: `${tool.pattern.text} First made from ${names.join(", ")}.`,
    learnedOnRun: runNumber(nextJournal),
  });
  nextJournal = learned.journal;
  if (learned.learned) {
    next = pushLog(noteRunSchematic(next, patternId(tool)), `Journal: ${tool.pattern.name.toLowerCase()} recorded. Handle, ${tool.end} end, binding.`);
  }
  for (const material of mats) {
    const note = learnDiscovery(nextJournal, {
      id: materialNoteId(material),
      name: material.note.name,
      text: material.note.text,
      learnedOnRun: runNumber(nextJournal),
    });
    nextJournal = note.journal;
    if (note.learned) next = pushLog(noteRunDiscovery(next, materialNoteId(material)), `Journal: ${material.note.text}`);
  }
  step = { state: next, journal: nextJournal };
  return step;
}

function grantRecipe(state: RunState, recipe: RecipeDef, builtAt: string): RunState {
  if (recipe.grants === "item") {
    let inventory = state.inventory;
    for (const [id, qty] of Object.entries(recipe.yields ?? {})) inventory = addItem(inventory, id, qty);
    return { ...state, inventory };
  }
  const moraleBump = recipe.grants === "shelter" ? 8 : recipe.grants === "signalFire" ? 6 : 4;
  const camp = { ...state.camp, stills: [...state.camp.stills] };
  if (recipe.grants === "shelter") camp.shelter = true;
  if (recipe.grants === "firePit") camp.firePit = true;
  if (recipe.grants === "signalFire") {
    camp.signalBuilt = true;
    camp.signalLit = true;
  }
  if (recipe.grants === "solarStill") {
    camp.stills.push({ id: state.nextStillId, wash: builtAt === "dry-wash" });
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
  const plan = planAction(state, spec.hours, data);
  let step = runHours(
    pushLog({ ...state, inventory: spend(state.inventory, spec.requires) }, "You kneel at the dead beacon."),
    journal,
    plan.hours,
    contextFor("camp", true),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
  step = {
    ...step,
    state: pushLog({ ...step.state, camp: { ...step.state.camp, signalLit: true } }, spec.log),
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
  if (data.wildlife.meat[itemId]) {
    if (action === "eat") return eatRawMeat(state, journal, itemId, data, rng);
    if (action === "cook") return cookMeat(state, journal, itemId, data, rng);
    return { state, journal };
  }
  if (itemId === "field-manual" && action === "read") return readManual(state, journal, data, rng);
  if (itemId === "first-aid" && action === "use") return useKit(state, journal, data);
  if (itemId === data.woundcare.cloth && (action === "bandage" || action === "bandage-rinse")) {
    return bandage(state, journal, action === "bandage-rinse", data, rng);
  }
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
  const r = data.needs.ration;
  const hunger = r.hunger + (bonus ? r.warmedHunger : 0);
  const morale = r.morale + (bonus ? r.warmedMorale : 0);
  const next = pushLog(
    {
      ...state,
      inventory: addItem(state.inventory, "ration", -1),
      hunger: Math.min(100, state.hunger + hunger),
      morale: Math.min(100, state.morale + morale),
      health: bonus ? Math.min(100, round2(state.health + r.warmedHealth)) : state.health,
    },
    bonus
      ? "You warm the ration over the pit. It is still trail food. It is also a small kindness."
      : "You eat a ration. Salt, calories, and no surprises.",
  );
  return { state: next, journal };
}

export function canCook(state: RunState): boolean {
  return atCamp(state) && state.camp.firePit;
}

function cookMeat(state: RunState, journal: Journal, itemId: string, data: GameData, rng: Rng): StepResult {
  const meat = data.wildlife.meat[itemId];
  if (!meat) return { state, journal };
  if (!canCook(state)) return fail(state, journal, "Cooking needs the lit fire pit at camp.");
  const plan = planAction(state, meat.cook.hours, data);
  const step = runHours(
    withSlowNote(pushLog({ ...state, inventory: addItem(state.inventory, itemId, -1) }, "You set the meat over the fire pit."), plan),
    journal,
    plan.hours,
    contextFor("camp", true),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
  const cooked: RunState = {
    ...step.state,
    hunger: clamp(round2(step.state.hunger + meat.cook.hunger), 0, 100),
    health: clamp(round2(step.state.health + meat.cook.health), 0, 100),
    morale: clamp(round2(step.state.morale + meat.cook.morale), 0, 100),
  };
  return { ...step, state: pushLog(cooked, meat.cook.log) };
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
  const plan = planAction(state, 1, data, { needsLight: true });
  if (plan.blocked) return fail(state, journal, `The page can wait. ${blockedText(plan, data)}`);
  const learned = learnSchematic(journal, {
    id: spec.id,
    name: spec.name,
    text: spec.text,
    learnedOnRun: runNumber(journal),
  });
  const next = noteRunSchematic(
    lightTorch({ ...state, inventory: addItem(state.inventory, "field-manual", -1) }, plan),
    spec.id,
  );
  const step = runHours(
    pushLog(next, `You read the charred page. ${spec.text}`),
    learned.journal,
    plan.hours,
    contextFor("camp", atCamp(next)),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
  return { ...step, state: pushLog(step.state, "You know the still now. Plastic, a container, tubing, a pit.") };
}

function useKit(state: RunState, journal: Journal, data: GameData): StepResult {
  const w = data.woundcare;
  const treatable = new Set(["snakebite", "scorpion", "laceration", w.clean, w.dirty, w.infection.id]);
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
  return { journal, state: next };
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

function eatDiscovery(state: RunState, journal: Journal, discovery: DiscoveryDef, _data: GameData): StepResult {
  let next = { ...state, inventory: addItem(state.inventory, discovery.itemId, -1) };
  next = applyEffect(next, discovery.eat);
  const step = remember(next, journal, discovery, discovery.eat);
  return countPear(step.state, step.journal, discovery);
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
  const plan = planAction(state, discovery.experiment.hours ?? 1, data);
  const next = { ...state, inventory: addItem(state.inventory, discovery.itemId, -1) };
  let step = runHours(withSlowNote(next, plan), journal, plan.hours, contextFor(atCamp(next) ? "camp" : "rest", atCamp(next)), data, rng);
  if (step.state.phase === "ended") {
    return remember(step.state, step.journal, discovery, discovery.experiment);
  }
  step = { ...step, state: applyEffect(step.state, discovery.experiment) };
  return remember(step.state, step.journal, discovery, discovery.experiment);
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
  const plan = planAction(state, prep.hours ?? 1, data);
  const fired = Boolean(prep.fireBonus) && canCook(state);
  let step = runHours(
    withSlowNote(
      pushLog(
        { ...state, inventory: addItem(state.inventory, discovery.itemId, -1) },
        fired ? "You work it over the fire." : "You prepare it without a fire.",
      ),
      plan,
    ),
    journal,
    plan.hours,
    contextFor("camp", atCamp(state)),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
  step = { ...step, state: applyEffect(step.state, prep) };
  if (fired && prep.fireBonus) {
    step = {
      ...step,
      state: applyEffect(step.state, {
        health: prep.fireBonus.health,
        hunger: prep.fireBonus.hunger,
        hydration: prep.fireBonus.hydration,
        morale: prep.fireBonus.morale,
        log: prep.fireBonus.log,
      }),
    };
  }
  return countPear(step.state, step.journal, discovery);
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
  if (!canCook(state)) {
    return fail(state, journal, "Boiling needs the fire pit, and the fire pit is at camp.");
  }
  const plan = planAction(state, spec.hours, data);
  let step = runHours(
    withSlowNote(
      pushLog({ ...state, inventory: addItem(state.inventory, discovery.itemId, -1) }, "You set the seep on the fire."),
      plan,
    ),
    journal,
    plan.hours,
    contextFor("camp", true),
    data,
    rng,
  );
  if (step.state.phase === "ended") return step;
  step = {
    ...step,
    state: pushLog({ ...step.state, inventory: addItem(step.state.inventory, "water", spec.yieldsWater) }, spec.log),
  };
  return step;
}

function poultice(state: RunState, journal: Journal, discovery: DiscoveryDef, _data: GameData): StepResult {
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
  return { journal, state: next };
}

export function previewLine(
  state: RunState,
  hours: number,
  ctx: HourContext,
  data: GameData,
  label?: string,
): { detail: string; warning: string } {
  const end = advanceTime(structuredClone(state), hours, ctx, data);
  const liters = Math.max(0, state.hydration - end.hydration) / data.needs.pointsPerLiter;
  let warning = "";
  if (end.fatigue >= data.needs.fatigue.collapseAt && !ctx.collapsed) warning = data.needs.collapse.warning;
  else if (end.bodyTempC >= data.needs.bodyTemp.heatSevereC) warning = "Heat stroke risk";
  else if (end.bodyTempC >= data.needs.bodyTemp.heatMildC) warning = "You will overheat";
  else if (end.bodyTempC <= data.needs.bodyTemp.coldSevereC) warning = "Hypothermia risk";
  else if (end.bodyTempC <= data.needs.bodyTemp.coldMildC) warning = "The cold will get in";
  const delta = end.health - state.health;
  const health = delta < -1 ? ` · −${Math.round(-delta)} health` : delta >= 0.5 ? ` · +${delta.toFixed(1)} health` : "";
  return {
    detail: `${label ?? `${hours}h`} · about ${liters.toFixed(1)} L${health}`,
    warning,
  };
}

function planPreview(state: RunState, plan: ActionPlan, ctx: HourContext, data: GameData): { detail: string; warning: string } {
  const preview = previewLine(state, plan.hours, ctx, data, planLabel(plan));
  const torch = plan.torch ? " · burns a torch" : "";
  return { detail: `${preview.detail}${torch}`, warning: preview.warning };
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

function sightingButtons(state: RunState, data: GameData): ActionButton[] {
  const pending = state.pending;
  const animal = pending ? data.animalById.get(pending.animalId) : undefined;
  if (!animal) {
    return [button("sighting-back", "Now", "Back away", "", "", false, { type: "sighting", choice: "back-away" })];
  }
  const weapon = bestWeapon(state, data, animal);
  const odds = killOdds(state, animal, weapon, data);
  const miss = Math.round((1 - odds) * weapon.failStrike * 100);
  const snap = Math.round((1 - odds) * (weapon.breakChance ?? 0) * 100);
  return [
    button(
      "sighting-back",
      "Now",
      "Back away",
      `Small chance it strikes anyway (${Math.round(animal.backAwayStrike * 100)}%)`,
      "",
      false,
      { type: "sighting", choice: "back-away" },
    ),
    button(
      "sighting-kill",
      "Now",
      `Try to kill the ${animal.name.toLowerCase()}`,
      `${weapon.name} · about ${Math.round(odds * 100)}% to kill · ${miss}% it ${animal.strikeHazard === "snakebite" ? "bites" : "stings"} you${snap > 0 ? ` · ${snap}% the weapon comes apart` : ""}`,
      miss >= 50 ? "Risky with what you are holding" : "",
      false,
      { type: "sighting", choice: "kill" },
    ),
  ];
}

export function listActions(state: RunState, journal: Journal, data: GameData): ActionButton[] {
  if (state.phase !== "playing") return [];
  if (state.pending) return sightingButtons(state, data);
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
    const warm = canCook(state);
    actions.push(
      button(
        "eat-ration",
        "Now",
        warm ? "Eat a warmed ration" : "Eat a ration",
        `${state.inventory.ration} left${warm ? ` · +${data.needs.ration.warmedHealth} health` : ""}`,
        "",
        false,
        { type: "item", itemId: "ration", action: warm ? "warm" : "eat" },
      ),
    );
  }
  for (const [itemId, meat] of Object.entries(data.wildlife.meat)) {
    if ((state.inventory[itemId] ?? 0) < 1 || !canCook(state)) continue;
    const plan = planAction(state, meat.cook.hours, data);
    actions.push(
      button(`cook-${itemId}`, "Now", `Cook ${data.itemById.get(itemId)?.name.toLowerCase() ?? itemId}`, `${planLabel(plan)} · +${meat.cook.hunger} hunger · +${meat.cook.health} health`, "", false, {
        type: "item",
        itemId,
        action: "cook",
      }),
    );
  }
  actions.push(...bandageButtons(state, data));
  const w = data.woundcare;
  const treatable = state.conditions.some((c) => ["snakebite", "scorpion", "laceration", w.clean, w.dirty, w.infection.id].includes(c.id));
  if ((treatable || state.sprainHours > 0) && (state.inventory["first-aid"] ?? 0) >= 1) {
    actions.push(button("kit", "Now", "Use first aid", "Fully treats a bite, sting, cut, or infection", "", false, {
      type: "item",
      itemId: "first-aid",
      action: "use",
    }));
  }

  const restHours = data.needs.restHours;
  const restPreview = previewLine(state, restHours, contextFor("rest", camp), data);
  actions.push(button("rest", "Now", camp && state.camp.shelter ? "Rest in the shelter" : "Rest in shade", restPreview.detail, restPreview.warning, false, { type: "rest" }));

  actions.push(...sleepButtons(state, data));

  actions.push(...waitButtons(state, data));

  if (camp && state.camp.wreckSearchesLeft > 0) {
    const plan = searchPlan(state, data);
    const preview = planPreview(state, plan, contextFor("search", true), data);
    actions.push(
      button(
        "search-camp",
        "Now",
        "Search the cabin",
        `${preview.detail} · ${state.camp.wreckSearchesLeft} passes left`,
        preview.warning,
        false,
        { type: "search" },
      ),
    );
  } else if (camp) {
    actions.push(button("search-camp", "Now", "Search the cabin", "The cabin is stripped.", "", true, null));
  } else {
    const zone = data.zoneById.get(state.location);
    const plan = searchPlan(state, data);
    const preview = plan.blocked
      ? { detail: blockedText(plan, data), warning: "" }
      : planPreview(state, plan, contextFor("search", false, zone?.exposure ?? 1), data);
    actions.push(button("search-zone", "Now", "Search here", preview.detail, preview.warning, Boolean(plan.blocked), { type: "search" }));
  }

  for (const recipe of data.recipes) {
    actions.push(...recipeButtons(state, journal, recipe, data));
  }
  actions.push(...toolButtons(state, journal, data));
  if (state.camp.signalLit) {
    actions.push(button("douse", "Build", "Bank the signal fire", "Stops the fuel drain. Also stops the smoke.", "", false, { type: "douse-signal" }));
  }

  if (camp) {
    for (const zone of data.zones) {
      const plan = planAction(state, travelCost(state, zone.travelHours), data, { useTorch: true });
      const storm = state.sandstorm ? "A sandstorm is up. You are not walking out into it." : null;
      const preview = storm
        ? { detail: storm, warning: "" }
        : planPreview(state, plan, contextFor("travel", false, zone.exposure), data);
      actions.push(
        button(
          `go-${zone.id}`,
          "Move",
          `Travel to ${zone.name}`,
          `${preview.detail}${state.sprainHours > 0 ? " · +1h ankle" : ""}`,
          preview.warning,
          Boolean(storm),
          { type: "travel", zoneId: zone.id },
        ),
      );
    }
  } else {
    const zone = data.zoneById.get(state.location);
    const plan = planAction(state, zone ? travelCost(state, zone.travelHours) : 1, data, { useTorch: true });
    const preview = zone
      ? planPreview(state, plan, contextFor("travel", false, zone.exposure), data)
      : { detail: "", warning: "" };
    actions.push(button("return", "Move", "Return to camp", preview.detail, preview.warning, false, { type: "return" }));
  }

  return actions;
}

/** Sleep for a chosen length. "Until dawn" only when dawn is close: no 23-hour daytime sleeps. */
export function sleepButtons(state: RunState, data: GameData): ActionButton[] {
  const camp = atCamp(state);
  const ctx = contextFor("sleep", camp);
  const where = camp
    ? !state.camp.shelter && !state.camp.firePit
      ? "against the wreck"
      : state.camp.shelter && state.camp.firePit
        ? "shelter and fire"
        : state.camp.shelter
          ? "in the shelter"
          : "by the fire"
    : "in the open · poor rest, things that bite";
  const dawnHours = hoursUntilDawn(state.hour);
  const dawnOk = dawnHours <= data.needs.sleep.dawnMaxHours;
  const out: ActionButton[] = [];
  for (const hours of [...new Set(data.needs.sleep.hourOptions)].filter((h) => h >= 1 && h <= 24)) {
    if (dawnOk && hours >= dawnHours) continue;
    const preview = previewLine(state, hours, ctx, data);
    out.push(button(`sleep-${hours}`, "Sleep", `Sleep ${hours}h`, `${preview.detail} · ${where}`, preview.warning, false, { type: "sleep", hours }));
  }
  if (dawnOk) {
    const preview = previewLine(state, dawnHours, ctx, data);
    out.push(button("sleep-dawn", "Sleep", "Sleep until dawn", `${preview.detail} · ${where}`, preview.warning, false, { type: "sleep" }));
  }
  return out;
}

/** The always-available actions. These never disable: waiting is a survivor's choice, not a menu state. */
export function waitButtons(state: RunState, data: GameData): ActionButton[] {
  const camp = atCamp(state);
  const ctx = contextFor("wait", camp);
  const dawnHours = hoursUntilDawn(state.hour);
  const buttons: ActionButton[] = [];
  const options = [...new Set(data.needs.wait.hourOptions.filter((hours) => hours >= 1 && hours <= 24))];
  for (const hours of options) {
    const preview = previewLine(state, hours, ctx, data);
    const dawn = hours === dawnHours ? " · until dawn" : hours > dawnHours ? " · past dawn" : "";
    buttons.push(
      button(`wait-${hours}`, "Now", `Wait ${hours}h`, `${preview.detail}${dawn}`, preview.warning, false, { type: "wait", hours }),
    );
  }
  if (!options.includes(dawnHours)) {
    const preview = previewLine(state, dawnHours, ctx, data);
    buttons.push(
      button("wait-dawn", "Now", "Wait until dawn", `${preview.detail}${camp ? "" : " · awake, in the open"}`, preview.warning, false, { type: "wait" }),
    );
  }
  return buttons;
}

function toolButtons(state: RunState, journal: Journal, data: GameData): ActionButton[] {
  const out: ActionButton[] = [];
  for (const tool of data.crafting.tools) {
    const resolved = resolveBuild(state, tool, data);
    const known = knowsPattern(journal, tool);
    const anyPart = SLOTS.some((slot) => !resolved.missing.includes(slot));
    if (!known && !anyPart) continue;
    if (carryBlock(state, tool, data)) continue;
    const block = craftBlock(state, tool, data, resolved);
    const label = `${tool.end === "flammable" ? "Make" : "Craft"} a ${tool.name.toLowerCase()}`;
    let detail = block ?? "";
    let warning = "";
    if (!block && resolved.build) {
      const plan = planAction(state, craftHours(tool, resolved.build, data), data);
      const parts = buildMaterials(resolved.build, data).map((m) => m.short.replace(/ \(.*\)$/, "")).join(" + ");
      detail = `${planLabel(plan)} · ${parts}`;
      const preview = previewLine(state, plan.hours, contextFor("build", atCamp(state)), data);
      warning = preview.warning;
    }
    out.push(
      button(`craft-${tool.id}`, "Build", known ? label : `${label} (untried)`, detail, warning, Boolean(block), {
        type: "craft",
        toolId: tool.id,
      }),
    );
  }
  return out;
}

/** The build dialog: three slots, what fits each, and what will be used. */
export function buildCraftView(
  state: RunState,
  journal: Journal,
  toolId: string,
  picks: Partial<Record<SlotId, string>>,
  data: GameData,
): CraftView | null {
  const tool = data.toolById.get(toolId);
  if (!tool) return null;
  const resolved = resolveBuild(state, tool, data, picks);
  const block = craftBlock(state, tool, data, resolved);
  const slots = data.crafting.slots.map((slotDef) => {
    const slot = slotDef.id;
    const chosen = resolved.chosen[slot];
    return {
      id: slot,
      label: slotDef.label,
      rule: slotRule(tool, slot),
      options: slotMaterials(tool, slot, data).map((material) => ({
        materialId: material.id,
        name: material.name,
        detail: describeMaterial(tool, material, state),
        have: hasAll(state.inventory, material.consumes),
        selected: material.id === chosen,
      })),
      missing: resolved.missing.includes(slot) ? missingSlotText(state, tool, slot, data) : null,
    };
  });
  const summary: string[] = [];
  let timeLabel = `${tool.hours}h`;
  if (resolved.build) {
    const plan = planAction(state, craftHours(tool, resolved.build, data), data);
    timeLabel = planLabel(plan);
    if (tool.end === "flammable") {
      const burns = torchBurns(resolved.build, data);
      summary.push(`${burns} burn${burns === 1 ? "" : "s"} of light: one per job in the dark.`);
    } else if (tool.weapon) {
      const base = data.wildlife.weapons.find((w) => w.id === tool.weapon);
      if (base) {
        const built = applyBuild(base, resolved.build, data);
        const odds = Object.entries(built.kill)
          .map(([id, value]) => `${Math.round(value * 100)}% vs ${data.animalById.get(id)?.name.toLowerCase() ?? id}`)
          .join(" · ");
        summary.push(`Kill odds in daylight: ${odds}.`);
        summary.push(`Comes apart on a failed kill: ${Math.round((built.breakChance ?? 0) * 100)}%.`);
        if (tool.id === "knife") summary.push("A factory knife beats any of these, and never comes apart.");
      }
    }
  }
  return {
    toolId: tool.id,
    toolName: tool.name,
    known: knowsPattern(journal, tool),
    slots,
    summary,
    timeLabel,
    block,
    command: block || !resolved.build ? null : { type: "craft", toolId: tool.id, picks: resolved.build },
  };
}

/** Invariant: a live run always offers at least one enabled action. */
export function hasValidAction(state: RunState, journal: Journal, data: GameData): boolean {
  if (state.phase !== "playing") return true;
  return listActions(state, journal, data).some((action) => !action.disabled && action.command !== null);
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
        : null;
    const plan = planAction(state, recipe.relight.hours, data);
    return [
      button("relight", "Build", "Relight the signal", block || `${planLabel(plan)} · 1 fuel`, "", Boolean(block), {
        type: "build",
        recipeId: recipe.id,
      }),
    ];
  }
  if (recipe.grants === "shelter" && state.camp.shelter) return [];
  if (recipe.grants === "firePit" && state.camp.firePit) return [];
  if (recipe.grants === "signalFire" && state.camp.signalLit) return [];
  if (recipeHidden(state, recipe)) return [];
  if (recipe.grants === "item" && !hasAll(state.inventory, recipe.requires)) return [];
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
  const plan = planAction(state, recipe.hours, data, { needsLight: recipe.needsLight });
  let block: string | null = null;
  if (recipe.max && count >= recipe.max) block = "You are tending as many stills as you can.";
  else if (!recipe.where.includes(state.location)) block = "Build this at camp, or in the dry wash for a better yield.";
  else if (!hasAll(state.inventory, recipe.requires)) {
    block = `Need ${missingNames(state.inventory, recipe.requires, data).join(", ")}`;
  } else if (plan.blocked) block = blockedText(plan, data);
  const detail = block || `${known ? `${planLabel(plan)} · ${place}` : recipe.unknownDetail ?? ""}${plan.torch && !block ? " · burns a torch" : ""}`;
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
  const plan = planAction(state, recipe.hours, data, { needsLight: recipe.needsLight });
  let block: string | null = null;
  if (!recipe.where.includes(state.location)) block = `Build this at ${recipe.where.join(" or ")}.`;
  else if (recipe.requiresFlag === "firePit" && !state.camp.firePit) block = "Needs a fire pit.";
  else if (!hasAll(state.inventory, recipe.requires)) {
    block = `Need ${missingNames(state.inventory, recipe.requires, data).join(", ")}`;
  } else if (plan.blocked) block = blockedText(plan, data);
  const needs = Object.entries(recipe.requires)
    .map(([id, qty]) => `${data.itemById.get(id)?.name ?? id} ×${qty}`)
    .join(", ");
  let detail = block || `${planLabel(plan)} · ${needs}`;
  let warning = "";
  if (!block) {
    const preview = previewLine(state, plan.hours, contextFor("build", atCamp(state)), data);
    if (preview.warning) warning = preview.warning;
    if (plan.torch) detail += " · burns a torch";
  }
  return button(`build-${recipe.id}`, recipe.grants === "item" ? "Build" : "Build", label, detail, warning, Boolean(block), {
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
  const qtyLabel = item.unit === "L" ? `${qty.toFixed(1)} L` : item.unit === "burns" ? `${qty} burn${qty === 1 ? "" : "s"}` : qty > 1 ? `×${qty}` : "";
  const actions: ItemActionView[] = [];
  const discovery = data.discoveryByItemId.get(itemId);
  const meat = data.wildlife.meat[itemId];
  let blurb = presented.blurb;

  if (itemId === "water") {
    actions.push(act("drink", `Drink ${data.needs.drinkLiters.toFixed(1)} L`, "Raises hydration. Instant.", false, ""));
  } else if (itemId === "ration") {
    actions.push(act("eat", "Eat", "Calories, no experiment required.", false, ""));
    if (canCook(state)) {
      actions.push(act("warm", "Warm it on the fire", `A little more comfort. +${data.needs.ration.warmedHealth} health.`, false, ""));
    }
  } else if (meat) {
    const left = state.spoil[itemId];
    if (left !== undefined) blurb = `${blurb} Turns in about ${Math.max(0, left)}h.`;
    actions.push(act("eat", "Eat raw", `+${meat.raw.hunger} hunger now · about ${Math.round(meat.raw.sickChance * 100)}% it makes you sick`, false, ""));
    const plan = planAction(state, meat.cook.hours, data);
    const cookBlock = canCook(state) ? null : "Needs the lit fire pit at camp.";
    actions.push(
      act("cook", "Cook it", cookBlock ?? `${planLabel(plan)} · +${meat.cook.hunger} hunger · +${meat.cook.health} health · no sickness`, Boolean(cookBlock), cookBlock ?? ""),
    );
  } else if (itemId === "field-manual") {
    const known = Boolean(journal.schematics["solar-still"]);
    const plan = planAction(state, 1, data, { needsLight: true });
    const block = known ? null : plan.blocked ? blockedText(plan, data) : null;
    actions.push(act("read", known ? "Read it again" : "Read the page", block ?? (known ? "You already know the still." : `${planLabel(plan)} · teaches the solar still.`), Boolean(block), block ?? ""));
  } else if (itemId === "first-aid") {
    actions.push(act("use", "Use the kit", "Bites, stings, cuts. A sprain gets a day back.", false, ""));
  } else if (discovery) {
    const ids = presented.known ? discovery.knownActions : discovery.unknownActions;
    for (const id of ids) {
      if (id === "ignore") continue;
      actions.push(discoveryAction(id, discovery, presented.known, state, data));
    }
  } else if (data.wildlife.weapons.some((weapon) => weapon.id === itemId)) {
    const base = data.wildlife.weapons.find((weapon) => weapon.id === itemId);
    const build = state.gear?.[itemId];
    if (base && build) {
      const built = applyBuild(base, build, data);
      const parts = buildMaterials(build, data).map((m) => m.name.toLowerCase()).join(", ");
      blurb = `${blurb} Made from ${parts}. About ${Math.round((built.kill.rattlesnake ?? 0) * 100)}% against a rattlesnake in daylight; ${Math.round((built.breakChance ?? 0) * 100)}% it comes apart on a miss.`;
    }
    const best = bestWeapon(state, data);
    blurb = `${blurb} ${best.id === itemId ? "This is what you will reach for if something rattles." : `Against most things you will reach for the ${data.wildlife.weapons.find((w) => w.id === best.id)?.name.toLowerCase() ?? best.name.toLowerCase()} first.`}`;
  } else if (itemId === "torch") {
    blurb = `${blurb} ${qty} burn${qty === 1 ? "" : "s"} left. It lights itself for travel, searching, and fine work after dark.`;
  }

  actions.push(act("ignore", "Close", "Put it back.", false, ""));
  return {
    itemId,
    title: presented.name,
    blurb,
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
  data: GameData,
): ItemActionView {
  if (id === "ignore") return act("ignore", "Ignore", "Learn nothing.", false, "");
  if (id === "eat") {
    if (!known) return act("eat", "Eat", "The direct way. The journal keeps whatever happens.", false, "");
    if (discovery.safe) return act("eat", "Eat raw", discovery.summary, false, "");
    return act("eat", discovery.boil ? "Drink raw" : "Eat anyway", "You know the cost.", false, "");
  }
  if (id === "experiment") {
    const plan = planAction(state, discovery.experiment.hours ?? 1, data);
    return act("experiment", "Experiment", `${planLabel(plan)} · a small test, then the truth`, false, "");
  }
  if (id === "prepare") {
    const plan = planAction(state, discovery.prepare?.hours ?? 1, data);
    const fire = canCook(state) ? "Fire makes it better." : "Edible without a fire. Better at camp if the pit is lit.";
    return act("prepare", "Prepare", `${planLabel(plan)} · ${fire}`, false, "");
  }
  if (id === "boil") {
    const plan = planAction(state, discovery.boil?.hours ?? 1, data);
    const block = canCook(state) ? null : "Needs the fire pit at camp.";
    return act("boil", "Boil it", block ?? `${planLabel(plan)} · makes ${discovery.boil?.yieldsWater ?? 0.5} L of clean water`, Boolean(block), block ?? "");
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
