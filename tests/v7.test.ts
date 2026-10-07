import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { Command, RunState } from "../src/models/types.ts";
import { applyCommand, collapse, hasValidAction, listActions } from "../src/logic/actions.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { rollHazards } from "../src/logic/hazards.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";
import { bestWeapon, killOdds } from "../src/logic/wildlife.ts";

function seqRng(values: number[], fallback = 0.99): Rng {
  let i = 0;
  return { next: () => values[i++] ?? fallback, getState: () => 1, setState() {} };
}
const flat = (v: number): Rng => ({ next: () => v, getState: () => 1, setState() {} });

function fresh(patch: Partial<RunState> = {}): RunState {
  const s = createRun(gameData, emptyJournal(), makeRng(31), 31);
  return {
    ...s, conditions: [], sprainHours: 0, sandstorm: false, hydration: 85, hunger: 85, morale: 60, fatigue: 20,
    health: 100, bodyTempC: 37, hour: 21, location: "rocky-ridge", inventory: { water: 2, knife: 1 },
    rescue: { baseDay: 25, signalDays: 0 }, ...patch,
  };
}
const hazardIds = gameData.hazards.map((h) => h.id);
/** rng that hits exactly one hazard (by order) and then returns `then` for the ambush roll. */
function hitOnly(id: string, then: number): Rng {
  const values: number[] = [];
  for (const h of gameData.hazards) {
    if (!h.on.some((t) => ["search", "search-zone"].includes(t))) continue;
    if (h.bands && !h.bands.includes("cold")) continue;
    values.push(h.id === id ? 0 : 0.999);
    if (h.id === id) { values.push(then); break; }
  }
  return seqRng(values, 0.999);
}

describe("awake animal hazards open a sighting", () => {
  it("found the bug's text: the scorpion hazard is the 'stone disagrees' line", () => {
    expect(gameData.hazardById.get("scorpion")?.log).toContain("the stone disagrees");
    expect(hazardIds).toContain("snakebite");
  });

  for (const [hazard, animal, condition] of [["scorpion", "scorpion", "scorpion"], ["snakebite", "rattlesnake", "snakebite"]] as const) {
    it(`a ${hazard} roll while awake searching never stings silently: it pauses on a sighting`, () => {
      const out = rollHazards(fresh({ hour: 2 }), emptyJournal(), gameData, hitOnly(hazard, 0.9), "search", false, "rocky-ridge");
      expect(out.state.pending).toEqual({ type: "sighting", animalId: animal });
      expect(out.state.conditions.some((c) => c.id === condition)).toBe(false);
      const ids = listActions(out.state, out.journal, gameData).map((a) => a.id);
      expect(ids).toEqual(["sighting-back", "sighting-kill"]);
      expect(hasValidAction(out.state, out.journal, gameData)).toBe(true);
      expect(listActions(out.state, out.journal, gameData)[1]?.detail).toContain("Factory knife");
    });

    it(`a ${hazard} ambush strikes first, then still offers the kill with better odds`, () => {
      const out = rollHazards(fresh({ hour: 2 }), emptyJournal(), gameData, hitOnly(hazard, 0.1), "search", false, "rocky-ridge");
      expect(out.state.conditions.some((c) => c.id === condition)).toBe(true);
      expect(out.state.pending).toEqual({ type: "sighting", animalId: animal, ambush: true });
      const def = gameData.animalById.get(animal);
      if (!def) throw new Error("animal");
      const weapon = bestWeapon(out.state, gameData, def);
      const plain = killOdds({ ...out.state, pending: { type: "sighting", animalId: animal } }, def, weapon, gameData);
      expect(Math.abs(killOdds(out.state, def, weapon, gameData) - Math.min(0.95, plain + 0.15))).toBeLessThanOrEqual(0.011);
      const buttons = listActions(out.state, out.journal, gameData);
      expect(buttons.map((b) => b.label)).toEqual(["Let it go", "Kill it for the meat"]);
      const killed = applyCommand(out.state, out.journal, { type: "sighting", choice: "kill" }, gameData, flat(0));
      expect(killed.state.pending).toBeNull();
      expect((killed.state.inventory[def.meat.item] ?? 0)).toBe(1);
      const let_go = applyCommand(out.state, out.journal, { type: "sighting", choice: "back-away" }, gameData, flat(0)).state;
      expect(let_go.pending).toBeNull();
      expect(let_go.conditions.filter((c) => c.id === condition)).toHaveLength(1);
    });
  }

  it("the ambush share is about 25% over seeded trials, and every awake hit pauses", () => {
    let hits = 0;
    let ambush = 0;
    for (let seed = 1; seed <= 3000; seed += 1) {
      const out = rollHazards(fresh({ hour: 2 }), emptyJournal(), gameData, makeRng(seed), "search", false, "rocky-ridge");
      const stung = out.state.conditions.some((c) => c.id === "scorpion" || c.id === "snakebite");
      if (stung) expect(out.state.pending?.ambush, `seed ${seed}`).toBe(true);
      if (out.state.pending) hits += 1;
      if (out.state.pending?.ambush) ambush += 1;
    }
    expect(hits).toBeGreaterThan(200);
    expect(ambush / hits).toBeGreaterThan(0.18);
    expect(ambush / hits).toBeLessThan(0.32);
  });

  it("travel and full searches through applyCommand also pause instead of stinging", () => {
    let paused = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const out = applyCommand(fresh({ hour: 6 }), emptyJournal(), { type: "search" } as Command, gameData, makeRng(seed));
      const stung = out.state.conditions.some((c) => c.id === "scorpion" || c.id === "snakebite");
      if (stung) expect(out.state.pending?.ambush).toBe(true);
      if (out.state.pending) paused += 1;
      expect(hasValidAction(out.state, out.journal, gameData)).toBe(true);
    }
    expect(paused).toBeGreaterThan(0);
  });

  it("asleep and collapsed stings stay automatic with no choice", () => {
    const night = fresh({ hour: 22, location: "dry-wash" });
    const slept = applyCommand(night, emptyJournal(), { type: "sleep", hours: 8 }, gameData, flat(0)).state;
    expect(slept.conditions.some((c) => c.id === "scorpion")).toBe(true);
    expect(slept.pending).toBeNull();
    const out = collapse(fresh({ hour: 20, location: "dry-wash", fatigue: 100 }), emptyJournal(), gameData, flat(0)).state;
    expect(out.conditions.some((c) => c.id === "scorpion" || c.id === "snakebite")).toBe(true);
    expect(out.pending).toBeNull();
  });
});
