import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { Command, Journal, RunState, SlotId } from "../src/models/types.ts";
import { applyCommand, hasValidAction, listActions } from "../src/logic/actions.ts";
import {
  applyBuild,
  breakChance,
  killBonus,
  resolveBuild,
  slotMaterials,
  torchBurns,
} from "../src/logic/crafting.ts";
import { Game, OLD_SAVE_NOTICE, SESSION_KEY } from "../src/logic/game.ts";
import { emptyJournal, JOURNAL_KEY, MemoryStore } from "../src/logic/journal.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";
import { bestWeapon, resolveSighting } from "../src/logic/wildlife.ts";

function flatRng(value: number): Rng {
  return { next: () => value, getState: () => 1, setState() {} };
}

function seqRng(values: number[], fallback = 0.99): Rng {
  let i = 0;
  return { next: () => values[i++] ?? fallback, getState: () => 1, setState() {} };
}

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
  state.hour = 8;
  state.inventory = { water: 2 };
  state.rescue = { baseDay: 25, signalDays: 0 };
  return { ...state, ...patch, camp: { ...state.camp, ...patch.camp } };
}

function step(state: RunState, command: Command, journal: Journal = emptyJournal(), rng: Rng = flatRng(0.99)) {
  return applyCommand(state, journal, command, gameData, rng);
}

function action(state: RunState, id: string, journal: Journal = emptyJournal()) {
  return listActions(state, journal, gameData).find((entry) => entry.id === id);
}

function tool(id: string) {
  const found = gameData.toolById.get(id);
  if (!found) throw new Error(`no tool ${id}`);
  return found;
}

/** One valid part per slot for each tool. */
const KITS: Record<string, Record<SlotId, Record<string, number>>> = {
  knife: { handle: { "seat-strut": 1 }, end: { "metal-shard": 1 }, binding: { cord: 1 } },
  club: { handle: { "creosote-stick": 1 }, end: { stone: 1 }, binding: { wire: 1 } },
  spear: { handle: { "mesquite-branch": 1 }, end: { chert: 1 }, binding: { "yucca-leaves": 1 } },
  torch: { handle: { "creosote-stick": 1 }, end: { fuel: 1 }, binding: { "duct-tape": 1 } },
};

function kit(toolId: string, without?: SlotId): Record<string, number> {
  const inv: Record<string, number> = { water: 2 };
  for (const [slot, items] of Object.entries(KITS[toolId] ?? {})) {
    if (slot === without) continue;
    for (const [id, qty] of Object.entries(items)) inv[id] = (inv[id] ?? 0) + qty;
  }
  return inv;
}

describe("component crafting", () => {
  it("requires a handle, a tool end, and a binding for every tool", () => {
    for (const toolId of ["knife", "club", "spear", "torch"]) {
      const t = tool(toolId);
      const ok = step(fresh({ inventory: kit(toolId) }), { type: "craft", toolId }).state;
      expect(ok.inventory[t.item] ?? 0, `${toolId} with all three`).toBeGreaterThan(0);
      for (const slot of ["handle", "end", "binding"] as SlotId[]) {
        const state = fresh({ inventory: kit(toolId, slot) });
        const button = action(state, `craft-${toolId}`);
        expect(button?.disabled, `${toolId} without ${slot}`).toBe(true);
        expect(button?.command).toBeNull();
        const tried = step(state, { type: "craft", toolId }).state;
        expect(tried.inventory[t.item] ?? 0, `${toolId} without ${slot}`).toBe(0);
        expect(tried.hour).toBe(state.hour);
      }
    }
  });

  it("matches the end type to the tool: knife and spear sharp, club blunt, torch flammable", () => {
    expect(tool("knife").end).toBe("sharp");
    expect(tool("spear").end).toBe("sharp");
    expect(tool("club").end).toBe("blunt");
    expect(tool("torch").end).toBe("flammable");
    for (const t of gameData.crafting.tools) {
      for (const material of slotMaterials(t, "end", gameData)) expect(material.kind).toBe(t.end);
    }
    // A blunt stone does not make a knife; glass does not make a club; glass does not burn.
    const stoneKnife = fresh({ inventory: { "seat-strut": 1, stone: 1, cord: 1 } });
    expect(action(stoneKnife, "craft-knife")?.detail).toContain("Needs a sharp tool end");
    const glassClub = fresh({ inventory: { "seat-strut": 1, "glass-shard": 1, cord: 1 } });
    expect(action(glassClub, "craft-club")?.detail).toContain("Needs a blunt tool end");
    const glassTorch = fresh({ inventory: { "seat-strut": 1, "glass-shard": 1, cord: 1 } });
    expect(action(glassTorch, "craft-torch")?.detail).toContain("Needs a flammable tool end");
    // Even when an explicit pick names the wrong kind, it is not used.
    const both = fresh({ inventory: { "seat-strut": 1, stone: 1, "glass-shard": 1, cord: 1 } });
    expect(resolveBuild(both, tool("knife"), gameData, { end: "heavy-stone" }).build?.end).toBe("glass-shard");
  });

  it("needs a long handle for a spear and a short one for a knife; plastic pipe flexes on a spear", () => {
    const short = fresh({ inventory: { "creosote-stick": 1, "metal-shard": 1, cord: 1 } });
    const spearBtn = action(short, "craft-spear");
    expect(spearBtn?.disabled).toBe(true);
    expect(spearBtn?.detail).toContain("Needs a long handle: mesquite branch, ironwood, aluminum tube, or plastic pipe.");
    expect(spearBtn?.detail).toContain("A short handle is no good for a spear.");
    expect(action(short, "craft-knife")?.disabled).toBe(false);

    const long = fresh({ inventory: { "mesquite-branch": 1, "metal-shard": 1, cord: 1 } });
    expect(action(long, "craft-spear")?.disabled).toBe(false);
    expect(action(long, "craft-knife")?.detail).toContain("Needs a short handle: creosote stick, seat strut, or panel strip.");

    const pipe = { handle: "plastic-pipe", end: "metal-shard", binding: "cord" };
    const tube = { handle: "aluminum-tube", end: "metal-shard", binding: "cord" };
    const spear = tool("spear");
    expect(killBonus(spear, pipe, gameData)).toBeCloseTo(killBonus(spear, tube, gameData) - 0.12, 5);
    // The flex penalty is spear-only: on a club the same plastic costs only its base modifier.
    expect(killBonus(tool("club"), { ...pipe, end: "heavy-stone" }, gameData)).toBeCloseTo(-0.03 + 0.04 - 0.02, 5);
    const pipeSpear = fresh({ inventory: { "plastic-pipe": 1, "metal-shard": 1, cord: 1 } });
    expect(action(pipeSpear, "craft-spear")?.disabled).toBe(false);
  });

  it("applies material modifiers to kill odds, breakage, and torch burns", () => {
    const club = tool("club");
    const metal = { handle: "seat-strut", end: "heavy-stone", binding: "cord" };
    const plastic = { handle: "panel-strip", end: "heavy-stone", binding: "cord" };
    expect(killBonus(club, metal, gameData)).toBeGreaterThan(killBonus(club, plastic, gameData));
    expect(breakChance(plastic, gameData)).toBeGreaterThan(breakChance(metal, gameData));

    const knife = tool("knife");
    const glass = { handle: "seat-strut", end: "glass-shard", binding: "cord" };
    const sheet = { handle: "seat-strut", end: "metal-shard", binding: "cord" };
    expect(killBonus(knife, glass, gameData)).toBeGreaterThan(killBonus(knife, sheet, gameData));
    expect(breakChance(glass, gameData)).toBeGreaterThan(breakChance(sheet, gameData) * 3);
    expect(breakChance({ ...sheet, binding: "sinew" }, gameData)).toBeLessThan(breakChance({ ...sheet, binding: "cloth-strips" }, gameData));

    // The crafted weapon in the pack carries its build into the fight.
    const base = gameData.wildlife.weapons.find((w) => w.id === "crafted-knife");
    const factory = gameData.wildlife.weapons.find((w) => w.id === "knife");
    if (!base || !factory) throw new Error("weapons");
    const best = applyBuild(base, glass, gameData);
    expect(best.kill.rattlesnake).toBeCloseTo((base.kill.rattlesnake ?? 0) + 0.06 + 0.04 + 0.02, 5);
    expect(best.kill.rattlesnake ?? 0).toBeLessThan(factory.kill.rattlesnake ?? 0);
    const armed = fresh({ location: "dry-wash", inventory: { "crafted-knife": 1 }, gear: { "crafted-knife": glass } });
    expect(bestWeapon(armed, gameData).kill.rattlesnake).toBeCloseTo(best.kill.rattlesnake ?? 0, 5);

    // A failed kill can take a crafted weapon apart. A factory knife never comes apart.
    const sighting = { type: "sighting" as const, animalId: "rattlesnake" };
    const broke = resolveSighting({ ...armed, pending: sighting }, emptyJournal(), "kill", gameData, seqRng([0.99, 0, 0.99])).state;
    expect(broke.inventory["crafted-knife"]).toBeUndefined();
    expect(broke.gear["crafted-knife"]).toBeUndefined();
    expect(broke.log.some((line) => line.text.includes("glass edge shatters"))).toBe(true);
    const steel = fresh({ location: "dry-wash", inventory: { knife: 1 }, pending: sighting });
    const kept = resolveSighting(steel, emptyJournal(), "kill", gameData, seqRng([0.99, 0, 0.99])).state;
    expect(kept.inventory.knife).toBe(1);

    // Torches: the end sets the burns; wire adds one; tape and plastic melt.
    expect(torchBurns({ handle: "creosote-stick", end: "fuel-head", binding: "cord" }, gameData)).toBe(2);
    expect(torchBurns({ handle: "creosote-stick", end: "resin-cloth", binding: "cord" }, gameData)).toBe(3);
    expect(torchBurns({ handle: "seat-strut", end: "resin-cloth", binding: "wire" }, gameData)).toBe(4);
    expect(torchBurns({ handle: "panel-strip", end: "fuel-head", binding: "duct-tape" }, gameData)).toBe(1);
    const made = step(fresh({ inventory: { "creosote-stick": 1, cloth: 1, creosote: 1, wire: 1 } }), { type: "craft", toolId: "torch" }).state;
    expect(made.inventory.torch).toBe(4);
  });

  it("says exactly which slot is missing", () => {
    const noBinding = fresh({ inventory: { "seat-strut": 1, "metal-shard": 1 } });
    expect(action(noBinding, "craft-knife")?.detail).toBe("Needs a binding: cord, wire, cloth strips, fiber, tape, or sinew.");
    const noEnd = fresh({ inventory: { "seat-strut": 1, cord: 1 } });
    expect(action(noEnd, "craft-knife")?.detail).toBe("Needs a sharp tool end: glass shard, sheet-metal shard, or stone flake.");
    const noHandle = fresh({ inventory: { stone: 1, cord: 1 } });
    expect(action(noHandle, "craft-club")?.detail).toBe(
      "Needs a handle: creosote stick, mesquite branch, ironwood, seat strut, aluminum tube, panel strip, or plastic pipe.",
    );
    const noFlame = fresh({ inventory: { "creosote-stick": 1, cord: 1 } });
    expect(action(noFlame, "craft-torch")?.detail).toBe(
      "Needs a flammable tool end: fuel bundle or resin-soaked cloth (cloth + creosote).",
    );
  });

  it("turns a rattlesnake kill into sinew that works as a binding", () => {
    const snake = fresh({ location: "dry-wash", inventory: { "creosote-stick": 1, stone: 1 }, pending: { type: "sighting", animalId: "rattlesnake" } });
    expect(action({ ...snake, pending: null }, "craft-club")?.detail).toContain("Needs a binding");
    const killed = applyCommand(snake, emptyJournal(), { type: "sighting", choice: "kill" }, gameData, flatRng(0));
    expect(killed.state.inventory["snake-sinew"]).toBe(1);
    expect(action(killed.state, "craft-club", killed.journal)?.disabled).toBe(false);
    const crafted = step(killed.state, { type: "craft", toolId: "club", picks: { binding: "sinew" } }, killed.journal).state;
    expect(crafted.inventory.club).toBe(1);
    expect(crafted.gear.club?.binding).toBe("sinew");
    expect(crafted.inventory["snake-sinew"]).toBeUndefined();
  });

  it("records the pattern and material notes in the journal, then shows the pattern as known next run", () => {
    const first = step(fresh({ inventory: kit("knife") }), { type: "craft", toolId: "knife" });
    expect(first.journal.schematics["pattern-knife"]?.text).toContain("Short handle + sharp end");
    expect(first.journal.discoveries["material-seat-strut"]).toBeTruthy();
    expect(first.journal.discoveries["material-metal-shard"]).toBeTruthy();
    expect(first.journal.discoveries["material-cord"]).toBeTruthy();
    expect(first.state.runSchematics).toContain("pattern-knife");
    expect(first.state.gear["crafted-knife"]).toEqual({ handle: "seat-strut", end: "metal-shard", binding: "cord" });

    const glass = step(fresh({ inventory: { "seat-strut": 1, "glass-shard": 1, cord: 1 } }), { type: "craft", toolId: "knife", picks: { end: "glass-shard" } });
    expect(glass.journal.discoveries["material-glass-shard"]?.text).toBe("Glass takes an edge and loses it the first time it hits bone.");

    const nextRun = fresh({ inventory: { water: 2 } });
    expect(action(nextRun, "craft-knife")).toBeUndefined();
    const known = action(nextRun, "craft-knife", first.journal);
    expect(known?.label).toBe("Craft a knife");
    expect(known?.disabled).toBe(true);
    expect(known?.detail).toContain("Needs a short handle");
  });

  it("lets the player pick a material per slot in the build dialog", () => {
    const game = new Game(new MemoryStore(), new MemoryStore());
    game.dispatch({ type: "new-run", seed: 9 });
    if (!game.state) throw new Error("no run");
    game.state = { ...game.state, pending: null, location: "camp", inventory: { water: 2, "aluminum-tube": 1, "mesquite-branch": 1, "glass-shard": 1, "metal-shard": 1, cord: 1, cloth: 1 } };
    game.dispatch({ type: "open-craft", toolId: "spear" });
    let view = game.view().craft;
    expect(view?.slots.map((slot) => slot.id)).toEqual(["handle", "end", "binding"]);
    expect(view?.slots[1]?.options.find((o) => o.selected)?.materialId).toBe("metal-shard");
    game.dispatch({ type: "craft-pick", slot: "end", materialId: "glass-shard" });
    game.dispatch({ type: "craft-pick", slot: "binding", materialId: "cloth-strips" });
    view = game.view().craft;
    expect(view?.slots[1]?.options.find((o) => o.selected)?.materialId).toBe("glass-shard");
    expect(view?.slots[2]?.options.find((o) => o.selected)?.materialId).toBe("cloth-strips");
    expect(view?.summary.join(" ")).toContain("Comes apart on a failed kill");
    if (!view?.command) throw new Error("no craft command");
    game.dispatch(view.command);
    expect(game.view().craft).toBeNull();
    expect(game.state?.gear.spear).toEqual({ handle: "aluminum-tube", end: "glass-shard", binding: "cloth-strips" });
    expect(game.state?.inventory["metal-shard"]).toBe(1);
  });

  it("keeps the old invariants: crafted torches light the dark, and a valid action always exists", () => {
    const ridge = fresh({ location: "rocky-ridge", hour: 21, inventory: { water: 2, "creosote-stick": 1, fuel: 1, cord: 1 } });
    expect(action(ridge, "search-zone")?.disabled).toBe(true);
    const lit = step(ridge, { type: "craft", toolId: "torch" }).state;
    expect(lit.inventory.torch).toBe(2);
    expect(action(lit, "search-zone")?.disabled).toBe(false);
    expect(hasValidAction(lit, emptyJournal(), gameData)).toBe(true);
    const searched = step(lit, { type: "search" }).state;
    expect(searched.inventory.torch).toBe(1);
    // Crafting is refused while a sighting is pending.
    const pending = { ...fresh({ inventory: kit("club") }), pending: { type: "sighting" as const, animalId: "scorpion" } };
    expect(step(pending, { type: "craft", toolId: "club" }).state.inventory.club).toBeUndefined();
    expect(listActions(pending, emptyJournal(), gameData).every((entry) => entry.id.startsWith("sighting"))).toBe(true);
  });

  it("drops a v3 save (no crafted gear) with a notice and keeps the journal", () => {
    const journalStore = new MemoryStore();
    const sessionStore = new MemoryStore();
    const journal = { ...emptyJournal(), discoveries: { rattlesnake: { id: "rattlesnake", name: "Rattlesnake", text: "Food.", learnedOnRun: 1 } } };
    journalStore.setItem(JOURNAL_KEY, JSON.stringify(journal));
    const old = { ...fresh(), inventory: { torch: 2, club: 1 } } as Record<string, unknown>;
    delete old.gear;
    sessionStore.setItem(SESSION_KEY, JSON.stringify({ version: 2, state: old, rngState: 1, ui: { journalOpen: false, itemId: null } }));
    const game = new Game(journalStore, sessionStore);
    expect(game.state).toBeNull();
    expect(game.view().notice).toBe(OLD_SAVE_NOTICE);
    expect(game.journal.discoveries.rattlesnake).toBeTruthy();
    game.dispatch({ type: "new-run", seed: 5 });
    expect(game.state?.gear).toEqual({});
  });
});
