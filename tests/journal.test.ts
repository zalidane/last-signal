import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import { buildItemModal, listActions } from "../src/logic/actions.ts";
import { Game } from "../src/logic/game.ts";
import {
  emptyJournal,
  learnDiscovery,
  learnSchematic,
  loadJournal,
  MemoryStore,
  saveJournal,
} from "../src/logic/journal.ts";
import { presentItem } from "../src/logic/inventory.ts";
import { makeRng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";

describe("journal persistence and identification", () => {
  it("round-trips discoveries and identifies them on the next run", () => {
    const store = new MemoryStore();
    const learned = learnDiscovery(emptyJournal(), {
      id: "barrel-cactus",
      name: "Barrel cactus",
      text: "Do not eat it.",
      learnedOnRun: 1,
    }).journal;
    saveJournal(store, learned);
    const loaded = loadJournal(store);
    expect(loaded.discoveries["barrel-cactus"]?.text).toMatch(/eat/i);

    const unknown = presentItem("barrel-cactus", emptyJournal(), gameData);
    const known = presentItem("barrel-cactus", loaded, gameData);
    expect(unknown.name).toBe("Ribbed green cactus");
    expect(unknown.known).toBe(false);
    expect(known.name).toBe("Barrel cactus");
    expect(known.known).toBe(true);

    const session = new MemoryStore();
    const game = new Game(store, session);
    game.dispatch({ type: "new-run", seed: 21 });
    if (!game.state) throw new Error("run missing");
    game.state.inventory = { ...game.state.inventory, "barrel-cactus": 1 };
    const chip = game.view().play?.inventory.find((item: { id: string }) => item.id === "barrel-cactus");
    expect(chip?.name).toBe("Barrel cactus");
    expect(chip?.warning).toBe(false);
  });

  it("hides the meal button once a trap is known, and shows the still once the schematic is", () => {
    const state = createRun(gameData, emptyJournal(), makeRng(5), 5);
    state.hour = 6;
    state.location = "camp";
    state.inventory = { ...state.inventory, "barrel-cactus": 1, "plastic-sheet": 1, container: 1, tubing: 1 };

    const unknownModal = buildItemModal(state, emptyJournal(), "barrel-cactus", gameData);
    expect(unknownModal?.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(["eat", "experiment"]),
    );

    const journal = learnDiscovery(emptyJournal(), {
      id: "barrel-cactus",
      name: "Barrel cactus",
      text: "Trap.",
      learnedOnRun: 1,
    }).journal;
    const knownModal = buildItemModal(state, journal, "barrel-cactus", gameData);
    expect(knownModal?.actions.map((action) => action.id)).not.toContain("eat");
    expect(knownModal?.actions.map((action) => action.id)).not.toContain("experiment");

    const guessing = listActions(state, emptyJournal(), gameData).find((action) => action.id === "discover-still");
    expect(guessing?.label).toMatch(/still/i);
    expect(guessing?.disabled).toBe(false);

    const withPlan = learnSchematic(emptyJournal(), {
      id: "solar-still",
      name: "Solar still",
      text: "Plastic, cup, tube.",
      learnedOnRun: 1,
    }).journal;
    state.inventory = { water: 1 };
    const planned = listActions(state, withPlan, gameData).find((action) => action.id === "build-still");
    expect(planned?.disabled).toBe(true);
    expect(planned?.detail.toLowerCase()).toContain("plastic");
  });

  it("writes a death lesson into storage even when the run discovered nothing", () => {
    const journalStore = new MemoryStore();
    const game = new Game(journalStore, new MemoryStore());
    game.dispatch({ type: "new-run", seed: 9 });
    if (!game.state) throw new Error("run missing");
    game.state.health = 1;
    game.state.hydration = 0;
    game.state.hunger = 90;
    game.state.bodyTempC = 37;
    game.state.hour = 20;
    game.state.conditions = [];
    game.state.camp.shelter = true;
    game.state.camp.firePit = true;
    game.dispatch({ type: "rest" });
    expect(game.state?.phase).toBe("ended");
    expect(game.journal.lessons.length).toBe(1);
    expect(game.journal.stats.deaths).toBe(1);
    expect(game.view().end?.baseRescueDay).toBeGreaterThanOrEqual(18);
    expect(game.view().end?.baseRescueDay).toBeLessThanOrEqual(25);
    expect(game.view().end?.seed).toBe(9);
    expect(loadJournal(journalStore).lessons).toHaveLength(1);
  });

  it("rejects corrupt journal json", () => {
    const store = new MemoryStore();
    store.setItem("last-signal.journal.v1", "{");
    expect(loadJournal(store).stats.runs).toBe(0);
  });
});
