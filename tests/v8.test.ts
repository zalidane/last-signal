import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { RunState } from "../src/models/types.ts";
import { applyCommand } from "../src/logic/actions.ts";
import { resolveDawn } from "../src/logic/dawn.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";

const flat = (v: number): Rng => ({ next: () => v, getState: () => 1, setState() {} });
const blankets = gameData.events.nightVisitor.log;
const shelterLog = gameData.events.nightVisitor.shelterLog;

function camp(patch: Partial<RunState> = {}): RunState {
  const s = createRun(gameData, emptyJournal(), makeRng(5), 5);
  return {
    ...s, conditions: [], sprainHours: 0, sandstorm: false, hydration: 95, hunger: 95, morale: 60, fatigue: 10,
    health: 100, bodyTempC: 37, hour: 2, day: 1, location: "camp", inventory: { water: 6, torch: 2, knife: 1 },
    rescue: { baseDay: 25, signalDays: 0 }, ...patch,
  };
}
const texts = (s: RunState) => s.log.map((l: any) => (typeof l === "string" ? l : l.text));

describe("dawn events respect what you were doing", () => {
  it("travel across dawn never puts a scorpion in the blankets, but the day still rolls over", () => {
    for (const v of [0, 0.01, 0.05]) {
      const out = applyCommand(camp(), emptyJournal(), { type: "travel", zoneId: "rocky-ridge" } as any, gameData, flat(v));
      const t = texts(out.state);
      expect(t.some((x) => x.includes(blankets) || x.includes(shelterLog))).toBe(false);
      expect(out.state.day).toBe(2);
      expect(t.some((x) => x.startsWith("Day 2."))).toBe(true);
    }
  });

  it("stills still produce when you cross dawn on the move", () => {
    const s = camp({ camp: { ...camp().camp, stills: [{ wash: false } as any] } });
    const out = applyCommand(s, emptyJournal(), { type: "travel", zoneId: "rocky-ridge" } as any, gameData, flat(0.5));
    expect(out.state.day).toBe(2);
    expect(texts(out.state).some((x) => x.includes("by morning"))).toBe(true);
  });

  it("sleeping at camp across dawn can still find the scorpion", () => {
    const out = applyCommand(camp(), emptyJournal(), { type: "sleep" } as any, gameData, flat(0));
    expect(texts(out.state).some((x) => x.includes(blankets))).toBe(true);
  });

  it("only sleeping in camp counts as blankets; awake or away does not", () => {
    for (const ctx of [
      { activity: "wait", atCamp: true }, { activity: "search", atCamp: true }, { activity: "build", atCamp: true },
      { activity: "travel", atCamp: false }, { activity: "sleep", atCamp: false },
    ] as const) {
      const out = resolveDawn(camp({ hour: 6, day: 2 }), emptyJournal(), gameData, flat(0), ctx as any);
      expect(texts(out.state).some((x) => x.includes(blankets) || x.includes(shelterLog))).toBe(false);
    }
  });

  it("a sandstorm caught while travelling ignores the camp shelter", () => {
    const s = camp({ hour: 6, day: 4, camp: { ...camp().camp, shelter: true } });
    const out = resolveDawn(s, emptyJournal(), gameData, flat(0), { activity: "travel", atCamp: false });
    expect(texts(out.state)).toContain(gameData.events.sandstorm.logOpen);
    const home = resolveDawn(s, emptyJournal(), gameData, flat(0), { activity: "sleep", atCamp: true });
    expect(texts(home.state)).toContain(gameData.events.sandstorm.logShelter);
  });

  it("the Day line comes before the day's events (sandstorm)", () => {
    const out = resolveDawn(camp({ hour: 6, day: 4 }), emptyJournal(), gameData, flat(0), { activity: "wait", atCamp: true });
    const t = texts(out.state);
    const day = t.findIndex((x) => x.startsWith("Day 4."));
    const storm = t.indexOf(gameData.events.sandstorm.logOpen);
    expect(day).toBeGreaterThanOrEqual(0);
    expect(storm).toBeGreaterThan(day);
  });
});
