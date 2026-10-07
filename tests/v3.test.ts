import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { Command, Journal, RunState } from "../src/models/types.ts";
import { applyCommand, buildItemModal, hasValidAction, listActions } from "../src/logic/actions.ts";
import { Game, OLD_SAVE_NOTICE, SESSION_KEY } from "../src/logic/game.ts";
import { emptyJournal, JOURNAL_KEY, MemoryStore } from "../src/logic/journal.ts";
import { contextFor, regenRate } from "../src/logic/needs.ts";
import { darkHazardMult, planAction } from "../src/logic/pace.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";
import { projectPlay } from "../src/logic/view.ts";
import { bestWeapon, killOdds, resolveSighting, rollSighting } from "../src/logic/wildlife.ts";

function flatRng(value: number): Rng {
  return { next: () => value, getState: () => 1, setState() {} };
}

/** A healthy survivor with no strain, so only the factor under test moves the numbers. */
function fresh(patch: Partial<RunState> = {}): RunState {
  const state = createRun(gameData, emptyJournal(), makeRng(31), 31);
  state.conditions = [];
  state.sprainHours = 0;
  state.sandstorm = false;
  state.hydration = 85;
  state.hunger = 85;
  state.morale = 60;
  state.fatigue = 10;
  state.health = 100;
  state.bodyTempC = 37;
  state.inventory = { water: 2 };
  state.rescue = { baseDay: 25, signalDays: 0 };
  return { ...state, ...patch, camp: { ...state.camp, ...patch.camp } };
}

function step(state: RunState, command: Command, rng: Rng = flatRng(0.99), journal: Journal = emptyJournal()) {
  return applyCommand(state, journal, command, gameData, rng);
}

function action(state: RunState, id: string, journal: Journal = emptyJournal()) {
  return listActions(state, journal, gameData).find((entry) => entry.id === id);
}

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    keysOf(child, found);
  }
  return found;
}

describe("no work-hour budget", () => {
  it("never gates work on hours: long days, night travel, and walks across dawn all go", () => {
    let state = fresh({ hour: 6 });
    for (let i = 0; i < 4; i += 1) {
      state = { ...step(state, { type: "search" }).state, fatigue: 10 };
    }
    expect(state.camp.wreckSearchesLeft).toBe(0);
    expect(state.hour).toBe(14);

    const late = fresh({ hour: 23 });
    const go = action(late, "go-rocky-ridge");
    expect(go?.disabled).toBe(false);
    const walked = step(late, { type: "travel", zoneId: "rocky-ridge" }).state;
    expect(walked.location).toBe("rocky-ridge");
    expect(walked.day).toBe(2);

    const play = projectPlay(fresh(), emptyJournal(), gameData);
    const keys = keysOf(play);
    for (const gone of ["laborHours", "laborMax", "laborNotes", "forecastHours", "forecastNotes"]) {
      expect(keys.has(gone)).toBe(false);
    }
    const text = listActions(fresh({ hour: 3 }), emptyJournal(), gameData)
      .map((entry) => `${entry.label} ${entry.detail}`)
      .join(" ");
    expect(text.toLowerCase()).not.toContain("work hour");
    expect(text.toLowerCase()).not.toContain("past dawn. sleep");
  });

  it("turns low meters into slower actions and higher hazard odds instead of lost hours", () => {
    const fine = planAction(fresh({ hour: 8 }), 2, gameData);
    const parched = planAction(fresh({ hour: 8, hydration: 10, hunger: 15 }), 2, gameData);
    expect(fine.hours).toBe(2);
    expect(parched.hours).toBeGreaterThan(fine.hours);
    expect(parched.risk).toBeGreaterThan(fine.risk);
  });
});

describe("fatigue is the limiter", () => {
  it("scales action time ×1.25 when tired and ×1.5 when exhausted", () => {
    const at = (fatigue: number, base: number) => planAction(fresh({ hour: 8, fatigue }), base, gameData).hours;
    expect(at(10, 2)).toBe(2);
    expect(at(65, 2)).toBe(3);
    expect(at(90, 2)).toBe(3);
    expect(at(10, 4)).toBe(4);
    expect(at(65, 4)).toBe(5);
    expect(at(90, 4)).toBe(6);
    const rested = step(fresh({ hour: 8, fatigue: 10 }), { type: "search" }).state;
    const spent = step(fresh({ hour: 8, fatigue: 65 }), { type: "search" }).state;
    expect(rested.hour).toBe(10);
    expect(spent.hour).toBe(11);
  });

  it("warns before an action would push fatigue to 100", () => {
    const state = fresh({ hour: 10, location: "dry-wash", visited: ["camp", "dry-wash"], fatigue: 95 });
    expect(action(state, "search-zone")?.warning).toBe(gameData.needs.collapse.warning);
    expect(action(state, "rest")?.warning).not.toBe(gameData.needs.collapse.warning);
  });

  it("collapses at 100: forced sleep where you stand until 06:00, nothing else happens first", () => {
    const state = fresh({ hour: 10, location: "dry-wash", visited: ["camp", "dry-wash"], fatigue: 95 });
    const after = step(state, { type: "search" }, flatRng(0.99));
    const s = after.state;
    expect(s.phase).toBe("playing");
    expect(s.location).toBe("dry-wash");
    expect(s.hour).toBe(6);
    expect(s.day).toBe(2);
    expect(s.fatigue).toBeLessThan(100);
    const texts = s.log.map((line) => line.text);
    const fell = texts.indexOf(gameData.needs.collapse.logOpen);
    const dawn = texts.findIndex((text) => text.startsWith("Day 2."));
    expect(fell).toBeGreaterThan(texts.indexOf("You search the Dry Wash."));
    expect(dawn).toBeGreaterThan(fell);
    // Between the search and dawn, the only log lines are the collapse itself and its wake-up.
    const between = texts.slice(fell + 1, dawn);
    expect(between.every((text) => text === gameData.needs.collapse.logWake || text.startsWith("The day") === false)).toBe(true);
    expect(hasValidAction(s, after.journal, gameData)).toBe(true);
  });

  it("writes a collapse lesson when the forced night kills you", () => {
    const state = fresh({ hour: 19, location: "wreckage-field", visited: ["camp", "wreckage-field"], fatigue: 96, health: 8 });
    const after = step(state, { type: "search" }, flatRng(0.99));
    expect(after.state.phase).toBe("ended");
    expect(after.state.ending?.cause).toBe("exhaustion");
    expect(after.journal.lessons.at(-1)?.cause).toBe("exhaustion");
    expect(after.journal.lessons.at(-1)?.text).toBe(gameData.lessons.exhaustion.lesson);
  });
});

describe("darkness", () => {
  it("slows work in the dark and raises bite and fall odds; light cuts most of it", () => {
    const night = fresh({ hour: 21, location: "wreckage-field", visited: ["camp", "wreckage-field"] });
    const plan = planAction(night, 2, gameData, { useTorch: true });
    expect(plan.dark).toBe(true);
    expect(plan.hours).toBe(3);
    expect(darkHazardMult("snakebite", plan, gameData)).toBeCloseTo(1.6);
    expect(darkHazardMult("fall", plan, gameData)).toBeCloseTo(2.2);
    const lit = planAction({ ...night, inventory: { torch: 1 } }, 2, gameData, { useTorch: true });
    expect(lit.light).toBe("torch");
    expect(lit.hours).toBe(2);
    expect(darkHazardMult("snakebite", lit, gameData)).toBeLessThan(1.3);
    const day = planAction(fresh({ hour: 12 }), 2, gameData);
    expect(darkHazardMult("snakebite", day, gameData)).toBe(1);
  });

  it("disables light-gated work in the dark with a reason, and allows it with a torch or a lit camp fire", () => {
    const ridge = fresh({ hour: 22, location: "rocky-ridge", visited: ["camp", "rocky-ridge"] });
    const blocked = action(ridge, "search-zone");
    expect(blocked?.disabled).toBe(true);
    expect(blocked?.detail.startsWith("Too dark. Needs light.")).toBe(true);
    const refused = step(ridge, { type: "search" });
    expect(refused.state.hour).toBe(22);
    expect(refused.state.log.at(-1)?.text).toContain("Too dark. Needs light.");

    const torch = { ...ridge, inventory: { ...ridge.inventory, torch: 1 } };
    expect(action(torch, "search-zone")?.disabled).toBe(false);
    const searched = step(torch, { type: "search" }).state;
    expect(searched.inventory.torch ?? 0).toBe(0);
    expect(searched.hour).not.toBe(22);

    const journal = { ...emptyJournal(), schematics: { "solar-still": { id: "solar-still", name: "Solar still", text: "", learnedOnRun: 1 } } };
    const parts = { "plastic-sheet": 1, container: 1, tubing: 1 };
    const darkCamp = fresh({ hour: 23, inventory: parts });
    const still = action(darkCamp, "build-still", journal);
    expect(still?.disabled).toBe(true);
    expect(still?.detail).toContain("Too dark. Needs light.");
    const litCamp = fresh({ hour: 23, inventory: parts, camp: { ...darkCamp.camp, firePit: true } });
    expect(action(litCamp, "build-still", journal)?.disabled).toBe(false);
  });
});

describe("health regen", () => {
  it("heals slowly while resting or sleeping when fed, watered, warm, and unwounded", () => {
    const camp = fresh({ health: 50, hour: 22, camp: { ...fresh().camp, shelter: true, firePit: true } });
    const slept = step(camp, { type: "sleep" }).state;
    expect(slept.health).toBeGreaterThan(56);
    expect(slept.health).toBeLessThanOrEqual(58.5);

    const shade = fresh({ health: 50, hour: 12, camp: { ...fresh().camp, shelter: true } });
    const rested = step(shade, { type: "rest" }).state;
    expect(rested.health).toBeGreaterThan(50);
    expect(rested.health).toBeLessThan(51.5);

    const base = fresh();
    const rate = (activity: "sleep" | "rest", atCamp: boolean, shelter: boolean, fire: boolean) =>
      regenRate({ ...base, camp: { ...base.camp, shelter, firePit: fire } }, contextFor(activity, atCamp), gameData);
    expect(rate("sleep", true, true, true)).toBe(1);
    expect(rate("sleep", true, true, false)).toBe(0.7);
    expect(rate("rest", false, false, false)).toBe(0.3);
    expect(rate("sleep", false, false, false)).toBe(0.15);
    expect(regenRate(base, contextFor("search", true), gameData)).toBe(0);
  });

  it("does not heal while thirsty, hungry, or carrying a draining wound", () => {
    const night = { hour: 22, health: 50, camp: { ...fresh().camp, shelter: true, firePit: true } };
    const thirsty = step(fresh({ ...night, hydration: 35 }), { type: "sleep" }).state;
    expect(thirsty.health).toBeLessThanOrEqual(50);
    const hungry = step(fresh({ ...night, hunger: 25 }), { type: "sleep" }).state;
    expect(hungry.health).toBeLessThanOrEqual(50);
    const cut = step(fresh({ ...night, conditions: [{ id: "laceration", hoursLeft: 12 }] }), { type: "sleep" }).state;
    expect(cut.health).toBeLessThan(50);
  });
});

describe("animal sightings and hunting", () => {
  const wash = () => fresh({ hour: 7, location: "dry-wash", visited: ["camp", "dry-wash"] });

  it("pauses on a sighting with exactly two choices, and refuses everything else", () => {
    const seen = rollSighting(wash(), gameData, flatRng(0), "search");
    expect(seen.pending?.type).toBe("sighting");
    const buttons = listActions(seen, emptyJournal(), gameData);
    expect(buttons.map((entry) => entry.command?.type)).toEqual(["sighting", "sighting"]);
    expect(buttons.map((entry) => entry.id)).toEqual(["sighting-back", "sighting-kill"]);
    expect(hasValidAction(seen, emptyJournal(), gameData)).toBe(true);
    const refused = step(seen, { type: "wait", hours: 2 });
    expect(refused.state.hour).toBe(seen.hour);
    expect(refused.state.pending).not.toBeNull();
    const backed = step(seen, { type: "sighting", choice: "back-away" }, flatRng(0.99)).state;
    expect(backed.pending).toBeNull();
    expect(backed.conditions).toHaveLength(0);
  });

  it("rolls sightings more often in the wash at dawn than at the wreckage at noon, and never at camp", async () => {
    const { sightingChance } = await import("../src/logic/wildlife.ts");
    const dawnWash = sightingChance(fresh({ hour: 6, location: "dry-wash" }), "search", gameData);
    const noonWreck = sightingChance(fresh({ hour: 12, location: "wreckage-field" }), "search", gameData);
    expect(dawnWash).toBeGreaterThan(noonWreck * 5);
    expect(sightingChance(fresh({ hour: 6 }), "search", gameData)).toBe(0);
  });

  it("gives far better kill odds with a weapon (seeded trials)", () => {
    const snake = { ...wash(), pending: { type: "sighting" as const, animalId: "rattlesnake" } };
    const armed = { ...snake, inventory: { ...snake.inventory, knife: 1 } };
    expect(bestWeapon(snake, gameData).id).toBe("none");
    expect(bestWeapon({ ...armed, inventory: { ...armed.inventory, club: 1, spear: 1 } }, gameData).id).toBe("spear");
    const animal = gameData.animalById.get("rattlesnake");
    if (!animal) throw new Error("no snake");
    expect(killOdds(armed, animal, bestWeapon(armed, gameData), gameData)).toBeGreaterThan(
      killOdds(snake, animal, bestWeapon(snake, gameData), gameData) * 2,
    );
    let bare = 0;
    let knife = 0;
    let bitten = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const a = resolveSighting(snake, emptyJournal(), "kill", gameData, makeRng(seed)).state;
      const b = resolveSighting(armed, emptyJournal(), "kill", gameData, makeRng(seed)).state;
      if ((a.inventory["snake-meat"] ?? 0) > 0) bare += 1;
      if ((b.inventory["snake-meat"] ?? 0) > 0) knife += 1;
      if (a.conditions.some((condition) => condition.id === "snakebite")) bitten += 1;
    }
    expect(knife).toBeGreaterThan(bare * 2);
    expect(bitten).toBeGreaterThan(150);
  });

  it("turns a kill into meat and a journal entry, and a miss into the real bite", () => {
    const snake = { ...wash(), pending: { type: "sighting" as const, animalId: "rattlesnake" } };
    const killed = resolveSighting(snake, emptyJournal(), "kill", gameData, flatRng(0));
    expect(killed.state.inventory["snake-meat"]).toBe(1);
    expect(killed.journal.discoveries.rattlesnake?.text).toContain("Its head can still bite after it is dead.");
    const missed = resolveSighting(snake, emptyJournal(), "kill", gameData, flatRng(0.85)).state;
    expect(missed.conditions.some((condition) => condition.id === "snakebite")).toBe(true);
    const scorp = { ...wash(), pending: { type: "sighting" as const, animalId: "scorpion" } };
    const crushed = resolveSighting(scorp, emptyJournal(), "kill", gameData, flatRng(0));
    expect(crushed.journal.discoveries["scorpion-food"]?.text).toBe("Scorpions are edible cooked once the stinger is off.");
  });

  it("feeds less and risks sickness raw; cooked at the fire pit feeds more, heals a little, and is safe", () => {
    const raw = step(fresh({ hunger: 50, inventory: { "snake-meat": 1 } }), { type: "item", itemId: "snake-meat", action: "eat" }, flatRng(0));
    expect(raw.state.hunger).toBe(68);
    expect(raw.state.conditions.map((condition) => condition.id)).toEqual(expect.arrayContaining(["stomach", "diarrhea"]));
    expect(raw.journal.discoveries["raw-snake"]?.text).toBe("Raw snake meat can make you sick. Cook it on the fire pit.");

    const campFire = fresh({ hour: 8, hunger: 50, health: 80, inventory: { "snake-meat": 1 } });
    campFire.camp.firePit = true;
    const cooked = step(campFire, { type: "item", itemId: "snake-meat", action: "cook" }, flatRng(0)).state;
    expect(cooked.hunger).toBeGreaterThan(raw.state.hunger + 8);
    expect(cooked.health).toBeGreaterThan(80);
    expect(cooked.conditions).toHaveLength(0);
    expect(cooked.hour).toBe(9);

    const away = fresh({ location: "dry-wash", inventory: { "snake-meat": 1 } });
    const modal = buildItemModal(away, emptyJournal(), "snake-meat", gameData);
    const cook = modal?.actions.find((entry) => entry.id === "cook");
    expect(cook?.disabled).toBe(true);
    expect(cook?.detail).toContain("fire pit");
  });

  it("spoils uncooked meat after its timer runs out", () => {
    const state = fresh({ inventory: { "snake-meat": 1 }, spoil: { "snake-meat": 2 } });
    const after = step(state, { type: "wait", hours: 3 }).state;
    expect(after.inventory["snake-meat"]).toBeUndefined();
    expect(after.log.some((line) => line.text.includes("turned"))).toBe(true);
  });
});

describe("invariants and saves", () => {
  it("always offers a valid action across seeded random play, including sighting prompts and collapses", () => {
    let prompts = 0;
    let collapses = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      const rng = makeRng(seed);
      const pick = makeRng(seed * 7919);
      let journal = emptyJournal();
      let state = createRun(gameData, journal, makeRng(seed), seed);
      for (let turn = 0; turn < 80 && state.phase === "playing"; turn += 1) {
        expect(hasValidAction(state, journal, gameData), `seed ${seed} turn ${turn}`).toBe(true);
        if (state.pending) prompts += 1;
        const options = listActions(state, journal, gameData).filter((entry) => !entry.disabled && entry.command);
        const choice = options[Math.floor(pick.next() * options.length)];
        if (!choice?.command) throw new Error("no action");
        const before = state.log.length;
        const result = applyCommand(state, journal, choice.command, gameData, rng);
        state = result.state;
        journal = result.journal;
        if (state.log.slice(before).some((line) => line.text === gameData.needs.collapse.logOpen || line.text === gameData.needs.collapse.logCamp)) {
          collapses += 1;
        }
      }
    }
    expect(prompts).toBeGreaterThan(0);
    expect(collapses).toBeGreaterThan(0);
  });

  it("drops an old-format saved run with a notice and keeps the journal", () => {
    const journalStore = new MemoryStore();
    const sessionStore = new MemoryStore();
    const journal = { ...emptyJournal(), discoveries: { "prickly-pear": { id: "prickly-pear", name: "Prickly pear", text: "Food.", learnedOnRun: 1 } } };
    journalStore.setItem(JOURNAL_KEY, JSON.stringify(journal));
    const old = { ...fresh(), laborHours: 0, laborMax: 12, laborNotes: [] } as Record<string, unknown>;
    delete old.pending;
    delete old.spoil;
    sessionStore.setItem(SESSION_KEY, JSON.stringify({ version: 1, state: old, rngState: 1, ui: { journalOpen: false, itemId: null } }));
    const game = new Game(journalStore, sessionStore);
    expect(game.state).toBeNull();
    expect(game.journal.discoveries["prickly-pear"]).toBeTruthy();
    expect(game.view().notice).toBe(OLD_SAVE_NOTICE);
    expect(sessionStore.getItem(SESSION_KEY)).toBeNull();
    game.dispatch({ type: "new-run", seed: 4 });
    expect(game.state?.pending).toBeNull();
    expect(game.view().notice).toBeNull();
  });
});
