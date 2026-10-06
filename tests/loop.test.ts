import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { Command, Journal, RunState } from "../src/models/types.ts";
import { applyCommand } from "../src/logic/actions.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";
import { hoursUntilDawn } from "../src/logic/time.ts";

function step(state: RunState, journal: Journal, command: Command, rng: Rng) {
  return applyCommand(state, journal, command, gameData, rng);
}

describe("the desert loop", () => {
  it("makes barrel cactus a net loss against simply resting", () => {
    const rng = makeRng(4);
    let cursed = createRun(gameData, emptyJournal(), makeRng(4), 4);
    let control = structuredClone(cursed);
    cursed.hour = 8;
    control.hour = 8;
    cursed.hydration = 80;
    control.hydration = 80;
    cursed.inventory = { ...cursed.inventory, "barrel-cactus": 1 };
    cursed.camp.shelter = true;
    control.camp.shelter = true;
    const eaten = step(cursed, emptyJournal(), { type: "item", itemId: "barrel-cactus", action: "eat" }, rng);
    expect(eaten.journal.discoveries["barrel-cactus"]).toBeTruthy();
    let left = eaten.state;
    let right = control;
    const journal = eaten.journal;
    for (let i = 0; i < 4; i += 1) {
      left = step(left, journal, { type: "rest" }, rng).state;
      right = step(right, emptyJournal(), { type: "rest" }, rng).state;
    }
    expect(left.hydration).toBeLessThan(right.hydration - 10);
    expect(left.conditions.some((condition) => condition.id === "vomiting" || condition.id === "diarrhea") || left.hydration < 40).toBe(true);
  });

  it("burns more water on a midday ridge walk than the same walk at dawn", () => {
    const dawn = createRun(gameData, emptyJournal(), makeRng(8), 8);
    dawn.hour = 6;
    dawn.laborHours = 12;
    dawn.laborMax = 12;
    dawn.hydration = 90;
    dawn.health = 100;
    dawn.bodyTempC = 37;
    dawn.location = "camp";
    dawn.sandstorm = false;
    dawn.sprainHours = 0;
    const noon = structuredClone(dawn);
    noon.hour = 10;
    const morning = step(dawn, emptyJournal(), { type: "travel", zoneId: "rocky-ridge" }, makeRng(1));
    const harsh = step(noon, emptyJournal(), { type: "travel", zoneId: "rocky-ridge" }, makeRng(1));
    const dawnLoss = dawn.hydration - morning.state.hydration;
    const noonLoss = noon.hydration - harsh.state.hydration;
    expect(morning.state.location).toBe("rocky-ridge");
    expect(harsh.state.location).toBe("rocky-ridge");
    expect(noonLoss).toBeGreaterThan(dawnLoss + 15);
    expect(harsh.state.bodyTempC).toBeGreaterThan(morning.state.bodyTempC);
  });

  it("can be won from shade, three wash stills, and a stocked camp", () => {
    const rng = makeRng(15);
    let state = createRun(gameData, emptyJournal(), makeRng(15), 15);
    let journal = emptyJournal();
    state.camp.shelter = true;
    state.camp.firePit = true;
    state.camp.stills = [
      { id: 1, wash: true },
      { id: 2, wash: true },
      { id: 3, wash: true },
    ];
    state.inventory = { ...state.inventory, water: 3, ration: 20, fuel: 4 };
    state.health = 100;
    state.hydration = 80;
    state.hunger = 80;
    state.conditions = [];
    state.sprainHours = 0;
    let guard = 0;
    while (state.phase === "playing" && state.day < 40 && guard < 400) {
      guard += 1;
      if (state.hydration < 55 && (state.inventory.water ?? 0) >= 0.5) {
        const drank = step(state, journal, { type: "item", itemId: "water", action: "drink" }, rng);
        state = drank.state;
        journal = drank.journal;
      }
      if (state.phase !== "playing") break;
      if (state.hunger < 40 && (state.inventory.ration ?? 0) >= 1) {
        const ate = step(state, journal, { type: "item", itemId: "ration", action: "eat" }, rng);
        state = ate.state;
        journal = ate.journal;
      }
      if (state.phase !== "playing") break;
      const command: Command =
        state.hour >= 10 && state.hour < 16 && hoursUntilDawn(state.hour) >= 2
          ? { type: "rest" }
          : { type: "sleep" };
      const moved = step(state, journal, command, rng);
      state = moved.state;
      journal = moved.journal;
    }
    expect(state.ending?.rescued, `ended by ${state.ending?.cause} on day ${state.day}`).toBe(true);
    expect(state.ending?.effectiveRescueDay).toBeGreaterThanOrEqual(11);
    expect(state.ending?.effectiveRescueDay).toBeLessThanOrEqual(state.ending?.baseRescueDay ?? 25);
  });
});
