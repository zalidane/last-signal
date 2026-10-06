import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { RunState } from "../src/models/types.ts";
import { applyHour, contextFor, threatParts } from "../src/logic/needs.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { makeRng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";

function base(): RunState {
  return createRun(gameData, emptyJournal(), makeRng(7), 7);
}

function loss(start: number, end: number): number {
  return Math.round((start - end) * 100) / 100;
}

describe("need decay and health drain order", () => {
  it("matches the field rates: heat hours, thirst about two days, hunger about four", () => {
    const thirstHours = 100 / gameData.needs.emptyHydrationHealthPerHour;
    const hungerHours = 100 / gameData.needs.emptyHungerHealthPerHour;
    expect(thirstHours).toBeGreaterThan(40);
    expect(thirstHours).toBeLessThan(55);
    expect(hungerHours).toBeGreaterThan(80);
    expect(hungerHours).toBeLessThan(110);
    expect(gameData.needs.heatHealthPerHour.critical).toBeGreaterThan(
      gameData.needs.emptyHydrationHealthPerHour,
    );
    expect(gameData.needs.emptyHydrationHealthPerHour).toBeGreaterThan(
      gameData.needs.emptyHungerHealthPerHour,
    );
  });

  it("ranks one hour of critical heat above empty thirst above empty hunger", () => {
    const state = base();
    state.conditions = [];
    state.hydration = 100;
    state.hunger = 100;
    state.bodyTempC = 41;
    const heat = threatParts(state, gameData);

    state.bodyTempC = 37;
    state.hydration = 0;
    const thirst = threatParts(state, gameData);

    state.hydration = 100;
    state.hunger = 0;
    const hunger = threatParts(state, gameData);

    expect(heat.heat).toBe(gameData.needs.heatHealthPerHour.critical);
    expect(thirst.dehydration).toBe(gameData.needs.emptyHydrationHealthPerHour);
    expect(hunger.starvation).toBe(gameData.needs.emptyHungerHealthPerHour);
    expect(heat.heat).toBeGreaterThan(thirst.dehydration);
    expect(thirst.dehydration).toBeGreaterThan(hunger.starvation);
  });

  it("lets heat win a tie and does not kill a healthy body in one hour of any single empty meter", () => {
    const state = base();
    state.conditions = [];
    state.bodyTempC = 41;
    state.hydration = 0;
    state.hunger = 0;
    const parts = threatParts(state, gameData);
    expect(parts.heat).toBe(parts.dehydration > parts.heat ? parts.dehydration : parts.heat);
    const tied = threatParts(
      { ...state, bodyTempC: 39, hydration: 0, hunger: 100 },
      gameData,
    );
    expect(tied.heat).toBeGreaterThan(0);

    const safe = base();
    safe.health = 100;
    safe.hunger = 100;
    safe.hydration = 0;
    safe.bodyTempC = 37;
    safe.conditions = [];
    safe.hour = 20;
    safe.camp.shelter = true;
    safe.camp.firePit = true;
    const thirsty = applyHour(safe, contextFor("sleep", true), gameData);
    expect(thirsty.health).toBeGreaterThan(90);
    expect(thirsty.phase).toBe("playing");

    safe.hydration = 100;
    safe.hunger = 0;
    const hungry = applyHour(safe, contextFor("sleep", true), gameData);
    expect(hungry.health).toBeGreaterThan(90);
  });

  it("deals more damage across six midday travel hours than six hours of thirst or hunger in shelter", () => {
    const simmer = (patch: Partial<RunState>, ctx: ReturnType<typeof contextFor>) => {
      let state = { ...base(), conditions: [], health: 100, ...patch };
      for (let i = 0; i < 6; i += 1) state = applyHour(state, ctx, gameData);
      return state;
    };
    const heat = simmer(
      { hour: 12, hydration: 100, hunger: 100, bodyTempC: 37, camp: { ...base().camp, shelter: false, firePit: false } },
      contextFor("travel", false, 1.15),
    );
    const shelter = base().camp;
    const thirst = simmer(
      {
        hour: 20,
        hydration: 0,
        hunger: 100,
        bodyTempC: 37,
        camp: { ...shelter, shelter: true, firePit: true },
      },
      contextFor("sleep", true),
    );
    const hunger = simmer(
      {
        hour: 20,
        hydration: 100,
        hunger: 0,
        bodyTempC: 37,
        camp: { ...shelter, shelter: true, firePit: true },
      },
      contextFor("sleep", true),
    );
    const heatLoss = loss(100, heat.health);
    const thirstLoss = loss(100, thirst.health);
    const hungerLoss = loss(100, hunger.health);
    expect(heat.phase).toBe("playing");
    expect(heatLoss).toBeGreaterThan(thirstLoss);
    expect(thirstLoss).toBeGreaterThan(hungerLoss);
    expect(hungerLoss).toBeGreaterThan(0);
  });
});
