import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { Command, RunState } from "../src/models/types.ts";
import { applyCommand, hasValidAction, listActions } from "../src/logic/actions.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";

function flatRng(value: number): Rng {
  return { next: () => value, getState: () => 1, setState() {} };
}

function run(patch: Partial<RunState> = {}): RunState {
  const state = createRun(gameData, emptyJournal(), makeRng(21), 21);
  state.conditions = [];
  state.sprainHours = 0;
  state.sandstorm = false;
  state.rescue = { baseDay: 25, signalDays: 0 };
  return { ...state, ...patch, camp: { ...state.camp, ...patch.camp } };
}

/** Antonio's once soft-locked run: Day 1, 05:00, Dry Wash, mild hypothermia. (Work hours no longer exist.) */
function softLock(): RunState {
  return run({
    day: 1,
    hour: 5,
    location: "dry-wash",
    visited: ["dry-wash"],
    bodyTempC: 34.2,
    health: 28,
    hydration: 86,
    hunger: 100,
    fatigue: 0,
    morale: 64,
  });
}

function step(state: RunState, command: Command, rng: Rng = flatRng(0.9)) {
  return applyCommand(state, emptyJournal(), command, gameData, rng);
}

function enabled(state: RunState, id: string) {
  return listActions(state, emptyJournal(), gameData).find((action) => action.id === id && !action.disabled);
}

describe("waiting is always a choice", () => {
  it("offers an enabled Wait in every zone, at every hour, in any condition", () => {
    for (const location of ["camp", ...gameData.zones.map((zone) => zone.id)]) {
      for (let hour = 0; hour < 24; hour += 1) {
        const state = run({ location, hour, fatigue: 99, health: 3, bodyTempC: 34, hydration: 0 });
        const wait = enabled(state, "wait-1");
        expect(wait?.command, `${location} ${hour}:00`).toEqual({ type: "wait", hours: 1 });
        expect(hasValidAction(state, emptyJournal(), gameData)).toBe(true);
        expect(enabled(state, "rest"), `rest ${location} ${hour}:00`).toBeTruthy();
        const sleeps = listActions(state, emptyJournal(), gameData).filter((a) => a.group === "Sleep" && !a.disabled);
        expect(sleeps.length, `sleep ${location} ${hour}:00`).toBeGreaterThan(0);
      }
    }
  });

  it("advances the day and runs dawn when a wait crosses 06:00", () => {
    const state = run({ day: 3, hour: 4, location: "rocky-ridge", bodyTempC: 37 });
    const after = step(state, { type: "wait", hours: 3 }).state;
    expect(after.phase).toBe("playing");
    expect(after.day).toBe(4);
    expect(after.hour).toBe(7);
    expect(after.log.some((line) => line.text.startsWith("Day 4."))).toBe(true);

    const untilDawn = step(run({ day: 3, hour: 22, location: "dry-wash" }), { type: "wait" }).state;
    expect(untilDawn.hour).toBe(6);
    expect(untilDawn.day).toBe(4);
  });

  it("unlocks the exact soft-lock state from the field report", () => {
    const state = softLock();
    expect(hasValidAction(state, emptyJournal(), gameData)).toBe(true);
    expect(enabled(state, "wait-1")).toBeTruthy();
    expect(enabled(state, "search-zone")).toBeTruthy();
    expect(enabled(state, "return")).toBeTruthy();
    expect(enabled(state, "sleep-dawn")?.detail).toContain("in the open");

    const waited = step(state, { type: "wait", hours: 1 }).state;
    expect(waited.phase).toBe("playing");
    expect(waited.day).toBe(2);
    expect(waited.hour).toBe(6);
    expect(waited.health).toBeLessThan(28);
    expect(hasValidAction(waited, emptyJournal(), gameData)).toBe(true);

    const rested = step(state, { type: "rest" }).state;
    expect(rested.day).toBe(2);
    expect(rested.hour).toBe(7);
  });

  it("makes the open dangerous: midday heat and exposed nights both cost more than cover", () => {
    const noon = run({ hour: 10, location: "dry-wash", bodyTempC: 37, hydration: 90, health: 100 });
    const exposed = step(noon, { type: "wait", hours: 4 }).state;
    const shaded = step(noon, { type: "rest" }).state;
    const shadedTwice = step(shaded, { type: "rest" }).state;
    expect(exposed.bodyTempC).toBeGreaterThan(shadedTwice.bodyTempC + 1.5);
    expect(exposed.health).toBeLessThan(shadedTwice.health - 10);

    const dusk = run({ hour: 22, bodyTempC: 37, hydration: 90, health: 100, fatigue: 50 });
    const openNight = step({ ...dusk, location: "dry-wash" }, { type: "sleep" }).state;
    const campNight = step({ ...dusk, camp: { ...dusk.camp, shelter: true, firePit: true } }, { type: "sleep" }).state;
    expect(openNight.day).toBe(2);
    expect(openNight.health).toBeLessThan(campNight.health - 20);
    expect(openNight.fatigue).toBeGreaterThan(campNight.fatigue);
    const awake = step({ ...dusk, location: "dry-wash" }, { type: "wait" }).state;
    expect(awake.health).toBeLessThan(campNight.health - 20);
  });
});
