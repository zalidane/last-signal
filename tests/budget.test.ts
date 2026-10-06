import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { RunState } from "../src/models/types.ts";
import { applyCommand } from "../src/logic/actions.ts";
import { computeBudget, reconcileLabor } from "../src/logic/budget.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { makeRng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";
import { hoursUntilDawn } from "../src/logic/time.ts";

function healthy(): RunState {
  const state = createRun(gameData, emptyJournal(), makeRng(3), 3);
  state.hydration = 80;
  state.hunger = 80;
  state.fatigue = 10;
  state.morale = 60;
  state.conditions = [];
  state.sprainHours = 0;
  state.laborMax = 12;
  state.laborHours = 12;
  return state;
}

describe("action hours", () => {
  it("starts at 12 and cuts hours as thirst, hunger, fatigue, and injury stack", () => {
    const state = healthy();
    expect(computeBudget(state, gameData).hours).toBe(12);

    state.hydration = 40;
    expect(computeBudget(state, gameData).hours).toBe(11);
    expect(computeBudget(state, gameData).notes.some((note) => note.includes("Thirst"))).toBe(true);

    state.hydration = 25;
    expect(computeBudget(state, gameData).hours).toBe(9);

    state.hydration = 10;
    state.hunger = 15;
    state.fatigue = 90;
    state.morale = 10;
    state.sprainHours = 10;
    state.conditions = [
      { id: "sunburn", hoursLeft: 4 },
      { id: "vomiting", hoursLeft: 4 },
    ];
    expect(computeBudget(state, gameData).hours).toBe(gameData.needs.actionBudget.minimum);
  });

  it("shrinks today's remaining hours when a meter crosses a line, and does not give them back", () => {
    const state = healthy();
    state.hydration = 10;
    state.laborMax = 12;
    state.laborHours = 10;
    const cut = reconcileLabor(state, gameData);
    expect(cut.state.laborMax).toBe(7);
    expect(cut.state.laborHours).toBe(5);
    expect(cut.note).toMatch(/shrinks/);

    cut.state.hydration = 100;
    const restored = reconcileLabor(cut.state, gameData);
    expect(restored.state.laborHours).toBe(5);
    expect(restored.state.laborMax).toBe(7);
    expect(restored.note).toBeNull();
  });

  it("refuses a long walk that would cross dawn", () => {
    const state = healthy();
    state.hour = 3;
    state.location = "camp";
    state.sandstorm = false;
    expect(hoursUntilDawn(3)).toBe(3);
    const step = applyCommand(state, emptyJournal(), { type: "travel", zoneId: "rocky-ridge" }, gameData, makeRng(1));
    expect(step.state.location).toBe("camp");
    expect(step.state.log.at(-1)?.text.toLowerCase()).toContain("dawn");
  });
});
