import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { RunState } from "../src/models/types.ts";
import { resolveDawn, rollStillYield } from "../src/logic/dawn.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { effectiveRescueDay, rollRescueDay } from "../src/logic/rescue.ts";
import { createRun } from "../src/logic/setup.ts";
import { projectPlay } from "../src/logic/view.ts";

function flatRng(value: number): Rng {
  return { next: () => value, getState: () => 1, setState() {} };
}

function morning(patch: Partial<RunState> = {}): RunState {
  const state = createRun(gameData, emptyJournal(), makeRng(11), 11);
  state.day = 14;
  state.hour = 6;
  state.phase = "playing";
  state.ending = null;
  state.camp.firePit = true;
  state.camp.shelter = true;
  state.camp.signalLit = false;
  state.camp.stills = [];
  state.rescue = { baseDay: 20, signalDays: 0 };
  return { ...state, ...patch, camp: { ...state.camp, ...patch.camp }, rescue: { ...state.rescue, ...patch.rescue } };
}

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    keysOf(child, found);
  }
  return found;
}

describe("rescue timing", () => {
  it("rolls a hidden day from 18 through 25 and floors the signal shift at day 11", () => {
    expect(rollRescueDay(() => 0, gameData.rescue)).toBe(18);
    expect(rollRescueDay(() => 0.999, gameData.rescue)).toBe(25);
    expect(effectiveRescueDay(22, 0, gameData.rescue)).toBe(22);
    expect(effectiveRescueDay(22, 4, gameData.rescue)).toBe(18);
    expect(effectiveRescueDay(18, 10, gameData.rescue)).toBe(11);
    expect(effectiveRescueDay(25, 100, gameData.rescue)).toBe(11);
    for (let seed = 1; seed <= 40; seed += 1) {
      const day = rollRescueDay(makeRng(seed).next.bind(makeRng(seed)), gameData.rescue);
      expect(day).toBeGreaterThanOrEqual(18);
      expect(day).toBeLessThanOrEqual(25);
    }
  });

  it("counts a fueled signal night before the rescue check, and ignores a dead fire", () => {
    const pulled = resolveDawn(
      morning({
        camp: { signalLit: true } as RunState["camp"],
        rescue: { baseDay: 15, signalDays: 0 },
        inventory: { fuel: 2 },
      }),
      emptyJournal(),
      gameData,
      flatRng(0.9),
    );
    expect(pulled.state.ending?.rescued).toBe(true);
    expect(pulled.state.rescue.signalDays).toBe(1);
    expect(pulled.state.ending?.effectiveRescueDay).toBe(14);
    expect(pulled.state.ending?.baseRescueDay).toBe(15);

    const starved = resolveDawn(
      morning({
        day: 14,
        camp: { signalLit: true } as RunState["camp"],
        rescue: { baseDay: 15, signalDays: 0 },
        inventory: { fuel: 0 },
      }),
      emptyJournal(),
      gameData,
      flatRng(0.9),
    );
    expect(starved.state.phase).toBe("playing");
    expect(starved.state.camp.signalLit).toBe(false);
    expect(starved.state.rescue.signalDays).toBe(0);

    const onTime = resolveDawn(
      morning({ day: 20, rescue: { baseDay: 20, signalDays: 0 } }),
      emptyJournal(),
      gameData,
      flatRng(0.9),
    );
    expect(onTime.state.ending?.rescued).toBe(true);
    expect(onTime.state.ending?.signalDays).toBe(0);
    expect(onTime.state.ending?.effectiveRescueDay).toBe(20);
  });

  it("keeps the rescue day out of the play view and shows it on the end card", () => {
    const state = morning();
    const play = projectPlay(state, emptyJournal(), gameData);
    const keys = keysOf(play);
    expect(keys.has("baseDay")).toBe(false);
    expect(keys.has("baseRescueDay")).toBe(false);
    expect(keys.has("effectiveRescueDay")).toBe(false);
    expect(keys.has("signalDays")).toBe(false);
    expect(keys.has("seed")).toBe(false);
    expect(play.classified.toLowerCase()).toContain("classified");

    const ended = resolveDawn(
      morning({ day: 20, rescue: { baseDay: 20, signalDays: 0 } }),
      emptyJournal(),
      gameData,
      flatRng(0.9),
    );
    expect(ended.state.ending?.baseRescueDay).toBe(20);
    expect(ended.state.ending?.seed).toBe(state.seed);
  });

  it("yields 0.5 to 1 L per still, with a wash bonus capped at 1.25", () => {
    expect(rollStillYield(() => 0, false, gameData)).toBe(0.5);
    expect(rollStillYield(() => 1, false, gameData)).toBe(1);
    expect(rollStillYield(() => 0, true, gameData)).toBe(0.75);
    expect(rollStillYield(() => 1, true, gameData)).toBe(1.25);
  });
});
