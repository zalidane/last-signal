import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { Command, Journal, RunState } from "../src/models/types.ts";
import { applyCommand, hasValidAction, listActions } from "../src/logic/actions.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { contextFor, regenBlockers, regenRate, threatParts } from "../src/logic/needs.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";

function flatRng(value: number): Rng {
  return { next: () => value, getState: () => 1, setState() {} };
}

function cut(patch: Partial<RunState> = {}): RunState {
  const state = createRun(gameData, emptyJournal(), makeRng(31), 31);
  return {
    ...state,
    conditions: [{ id: "laceration", hoursLeft: 18 }],
    sprainHours: 0,
    sandstorm: false,
    hydration: 85,
    hunger: 85,
    morale: 60,
    fatigue: 10,
    health: 90,
    bodyTempC: 37,
    hour: 8,
    inventory: { water: 2, cloth: 1 },
    rescue: { baseDay: 25, signalDays: 0 },
    ...patch,
  };
}

const bandage: Command = { type: "item", itemId: "cloth", action: "bandage" };
const rinse: Command = { type: "item", itemId: "cloth", action: "bandage-rinse" };

function step(state: RunState, command: Command, rng: Rng = flatRng(0.99), journal: Journal = emptyJournal()) {
  return applyCommand(state, journal, command, gameData, rng);
}

function action(state: RunState, id: string) {
  return listActions(state, emptyJournal(), gameData).find((entry) => entry.id === id);
}

describe("improvised wound care", () => {
  it("offers Bandage the wound on the very first run, anywhere, any hour, with a laceration and cloth", () => {
    for (const [location, hour] of [["camp", 8], ["dry-wash", 23], ["rocky-ridge", 3]] as const) {
      const button = action(cut({ location, hour }), "bandage");
      expect(button?.disabled, `${location} ${hour}`).toBe(false);
      expect(button?.label).toBe("Bandage the wound");
    }
    // A real first run: an empty journal and a starting laceration.
    for (let seed = 1; seed < 400; seed += 1) {
      const run = createRun(gameData, emptyJournal(), makeRng(seed), seed);
      if (!run.conditions.some((c) => c.id === "laceration") || (run.inventory.cloth ?? 0) < 1) continue;
      expect(listActions(run, emptyJournal(), gameData).find((a) => a.id === "bandage")?.disabled).toBe(false);
      return;
    }
    throw new Error("no seeded start with a laceration and cloth");
  });

  it("shows it disabled with 'Needs cloth.' when there is no cloth, and the run still has valid actions", () => {
    const bare = cut({ inventory: { water: 2 } });
    const button = action(bare, "bandage");
    expect(button?.disabled).toBe(true);
    expect(button?.detail).toBe("Needs cloth.");
    expect(hasValidAction(bare, emptyJournal(), gameData)).toBe(true);
    expect(step(bare, bandage).state.conditions[0]?.id).toBe("laceration");
  });

  it("cuts most of the drain and shortens the wound, but less than a first aid kit", () => {
    const before = threatParts(cut(), gameData).injury;
    const wrapped = step(cut(), bandage).state;
    expect(wrapped.inventory.cloth).toBeUndefined();
    const after = threatParts(wrapped, gameData).injury;
    expect(after).toBeCloseTo(before * 0.3, 5);
    const left = wrapped.conditions.find((c) => c.id.startsWith("bandaged"));
    expect(left?.hoursLeft).toBeLessThan(18 * 0.6 + 1);
    const kit = step(cut({ inventory: { "first-aid": 1 } }), { type: "item", itemId: "first-aid", action: "use" }).state;
    expect(threatParts(kit, gameData).injury).toBe(0);
    // The kit also clears a bandaged cut.
    const both = step({ ...wrapped, inventory: { "first-aid": 1 } }, { type: "item", itemId: "first-aid", action: "use" }).state;
    expect(both.conditions).toHaveLength(0);
  });

  it("counts a bandaged cut as treated for health regen", () => {
    const open = cut();
    expect(regenBlockers(open, gameData)).toContain("wounded");
    expect(regenRate(open, contextFor("rest", true), gameData)).toBe(0);
    const wrapped = step(open, bandage).state;
    expect(regenBlockers(wrapped, gameData)).not.toContain("wounded");
    expect(regenRate(wrapped, contextFor("rest", true), gameData)).toBeGreaterThan(0);
  });

  it("rolls infection from dirty cloth with a seeded chance; a rinse lowers it", () => {
    let dirty = 0;
    let rinsed = 0;
    for (let seed = 1; seed <= 2000; seed += 1) {
      if (step(cut(), bandage, makeRng(seed)).state.conditions.some((c) => c.id === "bandaged-cut-dirty")) dirty += 1;
      if (step(cut(), rinse, makeRng(seed)).state.conditions.some((c) => c.id === "bandaged-cut-dirty")) rinsed += 1;
    }
    expect(dirty / 2000).toBeGreaterThan(0.11);
    expect(dirty / 2000).toBeLessThan(0.19);
    expect(rinsed / 2000).toBeLessThan(0.08);
    expect(rinsed).toBeLessThan(dirty / 2);
    const wet = step(cut(), rinse).state;
    expect(wet.inventory.water ?? 0).toBeLessThanOrEqual(1.75);
    expect(wet.log.some((line) => line.text.includes("pour a little water"))).toBe(true);
  });

  it("turns a dirty bandage into an infection: fever, drain, slow pace, a journal entry and a lesson; the kit cures it", () => {
    const wrapped = step(cut(), bandage, flatRng(0)).state; // 0 < 15%: dirty
    expect(wrapped.conditions.some((c) => c.id === "bandaged-cut-dirty")).toBe(true);
    const waited = step({ ...wrapped, hour: 8 }, { type: "wait", hours: 12 }, flatRng(0.99));
    expect(waited.state.conditions.some((c) => c.id === "infection")).toBe(true);
    expect(waited.journal.hazards.infection?.text).toContain("dirty bandage");
    expect(waited.journal.lessons.some((l) => l.cause === "infection")).toBe(true);
    expect(waited.state.log.some((l) => l.text.includes("The wound has turned"))).toBe(true);
    expect(threatParts(waited.state, gameData).infection).toBeGreaterThan(0);
    expect(gameData.conditions.infection?.feverC).toBeGreaterThan(0);
    expect(gameData.conditions.infection?.budgetFlag).toBe("injured");
    const cured = step({ ...waited.state, inventory: { "first-aid": 1 } }, { type: "item", itemId: "first-aid", action: "use" }, flatRng(0.99), waited.journal).state;
    expect(cured.conditions.some((c) => c.id === "infection")).toBe(false);
  });

  it("records the first bandage in the journal", () => {
    const first = step(cut(), bandage);
    expect(first.journal.discoveries.bandage?.text).toBe("Cloth closes a cut well enough to keep walking. Rinse it first, or the wound turns.");
  });

  it("does not offer a bandage for snakebite or a scorpion sting", () => {
    for (const id of ["snakebite", "scorpion"]) {
      const venom = cut({ conditions: [{ id, hoursLeft: 10 }] });
      expect(action(venom, "bandage")).toBeUndefined();
      expect(action(venom, "bandage-rinse")).toBeUndefined();
      expect(step(venom, bandage).state.conditions[0]?.id).toBe(id);
    }
  });

  it("writes an infection lesson when infection kills", () => {
    const dying = cut({ health: 0.3, conditions: [{ id: "infection", hoursLeft: 40 }] });
    const dead = step(dying, { type: "wait", hours: 2 });
    expect(dead.state.phase).toBe("ended");
    expect(dead.state.ending?.causeLabel).toBe("Infection");
    expect(dead.journal.lessons.at(-1)?.text).toBe(gameData.lessons.infection.lesson);
  });
});
